// Where agents' code reaches their Python sessions. The command tool in an agent's
// folder writes each request to python/requests/, with the lease of the agent that
// ran it, and the desk writes the answer to python/responses/. A request whose lease
// is no longer the seat's is refused. Code still running after the wait is answered
// with a note, and its output is delivered to the agent as a message later.
// Running code reaches the app the same way: the session writes each call to calls/ in
// its own folder, naming its run, and the desk makes the call and writes the answer to
// answers/. A run the desk accepted keeps its ticket until it ends: its calls are made
// even when the agent that started it has since been paused or switched, and are
// refused only once the seat is stopped. What a session's code may ask for depends on
// whose session it is: a helper's cannot post, publish or send helpers.
import { copyFileSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, watch, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PythonSession } from "./session.mjs";

const TOOL = join(dirname(fileURLToPath(import.meta.url)), "python.mjs");
const DEFAULT_WAIT = 3 * 60_000;

const plural = (n, unit) => `${n} ${unit}${n === 1 ? "" : "s"}`;
const duration = (ms) => (ms >= 60_000 && ms % 60_000 === 0 ? plural(ms / 60_000, "minute") : plural(Math.max(1, Math.round(ms / 1000)), "second"));

export class SessionDesk {
  // calls: what running code may ask of the app, by name; each is given the call's
  // arguments, the seat's key and its agent's folder, and resolves with the result.
  // closed(key) is told when a seat's session ends, so work under way for it can be dropped.
  /** @param {{home: string, library?: string | null, wait?: number, outputLimit?: number, poll?: number, calls?: Record<string, (args: any, context: {key: string, folder: string}) => any>, closed?: (key: string) => void, session?: (options: any) => any}} options */
  constructor({ home, library = null, wait = DEFAULT_WAIT, outputLimit, poll = 1000, calls = {}, closed = () => {}, session = (options) => new PythonSession(options) }) {
    this.calls = calls;
    this.closed = closed;
    this.home = home;
    this.library = library;
    this.wait = wait;
    this.outputLimit = outputLimit;
    this.poll = poll;
    this.makeSession = session;
    this.seats = new Map();
  }
  // Opens a seat's desk: its tool is placed in the agent's folder, the seat's session
  // starts, and a run cut short before is reported. The session belongs to the seat,
  // so it outlasts the agent's folder: a seat opened again, for a researcher resumed or
  // switched to another agent, keeps its session and whatever it is running.
  // authorize(lease) says whether a lease is the seat's current one; deliver(text)
  // sends the agent a message; live() says whether the seat may still act, which it
  // may until it is stopped; can names what its code may ask of the app, all of it
  // when absent, with refusal(name) the words for what it may not.
  open(key, { folder, seat: seatFolder, authorize, deliver, live = () => true, can = null, refusal = (name) => `This session cannot ask the app for ${JSON.stringify(name)}.` }) {
    const requests = join(folder, "python", "requests");
    mkdirSync(requests, { recursive: true });
    mkdirSync(join(folder, "python", "responses"), { recursive: true });
    mkdirSync(join(folder, "tools"), { recursive: true });
    copyFileSync(TOOL, join(folder, "tools", "python.mjs"));
    const watching = (seat) => {
      seat.watcher?.close();
      seat.watcher = watch(requests, () => this.collect(seat));
    };
    const open = this.seats.get(key);
    if (open) {
      Object.assign(open, { folder, authorize, deliver, live, can, refusal });
      watching(open);
      this.collect(open);
      return open;
    }
    // Calls and answers left by a run that was cut short belong to nobody now.
    const state = join(seatFolder, "session");
    for (const name of ["calls", "answers"]) {
      rmSync(join(state, name), { recursive: true, force: true });
      mkdirSync(join(state, name), { recursive: true });
    }
    const seat = {
      key,
      folder,
      authorize,
      deliver,
      live,
      can,
      refusal,
      session: this.makeSession({ folder: seatFolder, library: this.library, home: this.home, outputLimit: this.outputLimit }),
      taken: new Set(),
      state,
      // The runs in progress, each with the lease it was accepted on.
      runs: new Map(),
    };
    this.seats.set(key, seat);
    watching(seat);
    seat.callWatcher = watch(join(state, "calls"), () => this.collectCalls(seat));
    seat.timer = setInterval(() => {
      this.collect(seat);
      this.collectCalls(seat);
    }, this.poll);
    seat.timer.unref();
    this.collect(seat);
    // Until the session has started and said what it found, the seat may yet be owed
    // a notice of a run cut short.
    seat.starting = seat.session
      .start()
      .then(
        ({ interrupted, problem }) => {
          if (interrupted) seat.deliver(`Your last Python run was interrupted before it finished, when the app or the session restarted. It was not run again; your variables are as they were after the run before it.`);
          if (problem) seat.deliver(problem);
        },
        (error) => seat.deliver(`Your Python session could not start: ${error.message}`),
      )
      .then(() => (seat.starting = null));
    return seat;
  }
  close(key) {
    const seat = this.seats.get(key);
    if (!seat) return;
    this.seats.delete(key);
    seat.closed = true;
    seat.watcher?.close();
    seat.callWatcher?.close();
    clearInterval(seat.timer);
    seat.session.stop();
    this.closed(key);
  }
  has(key) {
    return this.seats.has(key);
  }
  keys() {
    return [...this.seats.keys()];
  }
  // Resolves once a seat's session has started and its notices are delivered; null
  // when it already has.
  starting(key) {
    return this.seats.get(key)?.starting ?? null;
  }
  // How many of a seat's runs are under way.
  running(key) {
    return this.seats.get(key)?.runs.size ?? 0;
  }
  closeAll() {
    for (const key of [...this.seats.keys()]) this.close(key);
  }
  collect(seat) {
    if (seat.closed) return;
    const requests = join(seat.folder, "python", "requests");
    let names;
    try {
      names = readdirSync(requests).filter((name) => name.endsWith(".json"));
    } catch {
      return;
    }
    for (const name of names) {
      if (seat.taken.has(name)) continue;
      seat.taken.add(name);
      const file = join(requests, name);
      let request;
      try {
        request = JSON.parse(readFileSync(file, "utf8"));
      } catch {
        seat.taken.delete(name);
        continue;
      }
      rmSync(file, { force: true });
      seat.taken.delete(name);
      this.handle(seat, name.replace(/\.json$/, ""), request);
    }
  }
  // Makes the calls the session's running code has written, each once.
  collectCalls(seat) {
    if (seat.closed) return;
    const calls = join(seat.state, "calls");
    let names;
    try {
      names = readdirSync(calls).filter((name) => name.endsWith(".json"));
    } catch {
      return;
    }
    for (const name of names) {
      const file = join(calls, name);
      let call;
      try {
        call = JSON.parse(readFileSync(file, "utf8"));
      } catch {
        continue;
      }
      rmSync(file, { force: true });
      const id = name.replace(/\.json$/, "");
      const reply = (message) => {
        try {
          writeFileSync(join(seat.state, "answers", `${id}.tmp`), JSON.stringify(message));
          renameSync(join(seat.state, "answers", `${id}.tmp`), join(seat.state, "answers", `${id}.json`));
        } catch {
          /* The seat's folder is gone; nobody is waiting. */
        }
      };
      // The run's ticket: it was accepted, has not ended, and its seat has not been stopped.
      if (!seat.runs.has(call.run) || !seat.live()) reply({ error: "This run's seat has been stopped, so the app did not do what its code asked." });
      else if (!Object.hasOwn(this.calls, call.name)) reply({ error: `The app has nothing called ${JSON.stringify(call.name)} for a session to ask for.` });
      else if (seat.can && !seat.can.has(call.name)) reply({ error: seat.refusal(call.name) });
      else
        Promise.resolve()
          .then(() => this.calls[call.name](call.arguments || {}, { key: seat.key, folder: seat.folder }))
          .then(
            (result) => reply({ result: result ?? null }),
            (error) => reply({ error: error.message }),
          );
    }
  }
  answer(seat, id, message) {
    const responses = join(seat.folder, "python", "responses");
    try {
      writeFileSync(join(responses, `${id}.tmp`), JSON.stringify(message));
      renameSync(join(responses, `${id}.tmp`), join(responses, `${id}.json`));
    } catch {
      /* The seat's folder is gone; nobody is waiting. */
    }
  }
  handle(seat, id, request) {
    if (!seat.authorize(request.lease)) return this.answer(seat, id, { error: "This agent's lease on the seat is no longer current, so its code was not run." });
    if (typeof request.code !== "string" || !request.code.trim()) return this.answer(seat, id, { error: "Send some Python code to run." });
    let answered = false;
    const timer = setTimeout(() => {
      answered = true;
      this.answer(seat, id, { pending: true, note: `Still running after ${duration(this.wait)}. It carries on, and its output will reach you as a message when it finishes; you can keep working meanwhile, and later code waits for it.` });
    }, this.wait);
    seat.runs.set(id, request.lease);
    // The agent that asked may be gone by the time the run ends, paused or switched:
    // what its code printed then goes to the seat as a message, for whoever holds it next.
    const asker = () => !seat.closed && seat.folder === folder && seat.authorize(request.lease);
    const folder = seat.folder;
    seat.session.run(request.code, { id }).finally(() => seat.runs.delete(id)).then(
      (result) => {
        clearTimeout(timer);
        if (seat.closed) return;
        if (!answered && asker()) return this.answer(seat, id, { output: result.output, failed: result.failed });
        seat.deliver(`${answered ? "Your long Python run has finished" : "A Python run started before this seat's researcher was paused or switched has finished"}${result.failed ? " with an error" : ""}. Its output:\n\n${result.output || "(nothing printed)"}`);
      },
      (error) => {
        clearTimeout(timer);
        if (seat.closed) return;
        if (!answered && asker()) return this.answer(seat, id, { error: error.message });
        seat.deliver(`${answered ? "Your long Python run" : "A Python run started before this seat's researcher was paused or switched"} did not finish: ${error.message}`);
      },
    );
  }
}
