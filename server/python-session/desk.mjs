// Where researchers' code reaches their Python sessions. The command tool in a seat's
// folder writes each request to python/requests/, with the lease of the agent that
// ran it, and the desk writes the answer to python/responses/. A request whose lease
// is no longer the seat's is refused. Code still running after the wait is answered
// with a note, and its output is delivered to the researcher as a message later.
import { copyFileSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, watch, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PythonSession } from "./session.mjs";

const TOOL = join(dirname(fileURLToPath(import.meta.url)), "python.mjs");
const DEFAULT_WAIT = 3 * 60_000;

const plural = (n, unit) => `${n} ${unit}${n === 1 ? "" : "s"}`;
const duration = (ms) => (ms >= 60_000 && ms % 60_000 === 0 ? plural(ms / 60_000, "minute") : plural(Math.max(1, Math.round(ms / 1000)), "second"));

export class SessionDesk {
  /** @param {{home: string, library?: string | null, wait?: number, outputLimit?: number, poll?: number, session?: (options: any) => any}} options */
  constructor({ home, library = null, wait = DEFAULT_WAIT, outputLimit, poll = 1000, session = (options) => new PythonSession(options) }) {
    this.home = home;
    this.library = library;
    this.wait = wait;
    this.outputLimit = outputLimit;
    this.poll = poll;
    this.makeSession = session;
    this.seats = new Map();
  }
  // Opens a seat's desk: its tool is placed in its folder, its session starts, and a
  // run cut short before is reported. authorize(lease) says whether a lease is the
  // seat's current one; deliver(text) sends the researcher a message.
  open(key, { folder, authorize, deliver }) {
    this.close(key);
    const requests = join(folder, "python", "requests");
    mkdirSync(requests, { recursive: true });
    mkdirSync(join(folder, "python", "responses"), { recursive: true });
    mkdirSync(join(folder, "tools"), { recursive: true });
    copyFileSync(TOOL, join(folder, "tools", "python.mjs"));
    const seat = {
      key,
      folder,
      authorize,
      deliver,
      session: this.makeSession({ folder, library: this.library, home: this.home, outputLimit: this.outputLimit }),
      taken: new Set(),
    };
    this.seats.set(key, seat);
    seat.watcher = watch(requests, () => this.collect(seat));
    seat.timer = setInterval(() => this.collect(seat), this.poll);
    seat.timer.unref();
    this.collect(seat);
    seat.session.start().then(
      ({ interrupted, problem }) => {
        if (interrupted) deliver(`Your last Python run was interrupted before it finished, when the app or the session restarted. It was not run again; your variables are as they were after the run before it.`);
        if (problem) deliver(problem);
      },
      (error) => deliver(`Your Python session could not start: ${error.message}`),
    );
    return seat;
  }
  close(key) {
    const seat = this.seats.get(key);
    if (!seat) return;
    this.seats.delete(key);
    seat.closed = true;
    seat.watcher?.close();
    clearInterval(seat.timer);
    seat.session.stop();
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
    seat.session.run(request.code).then(
      (result) => {
        clearTimeout(timer);
        if (!answered) return this.answer(seat, id, { output: result.output, failed: result.failed });
        if (!seat.closed && seat.authorize(request.lease)) seat.deliver(`Your long Python run has finished${result.failed ? " with an error" : ""}. Its output:\n\n${result.output || "(nothing printed)"}`);
      },
      (error) => {
        clearTimeout(timer);
        if (!answered) return this.answer(seat, id, { error: error.message });
        if (!seat.closed && seat.authorize(request.lease)) seat.deliver(`Your long Python run did not finish: ${error.message}`);
      },
    );
  }
}
