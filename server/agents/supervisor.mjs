import { execFile, spawn } from "node:child_process";
import { basename, dirname, join } from "node:path";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { AgentProblem } from "./problem.mjs";
import { LiveActivity } from "../live-activity.mjs";
import { claudeAdapter } from "./claude.mjs";
import { codexAdapter } from "./codex.mjs";

const LOG_LIMIT = 2_000_000;
const AGENT_CLIS = new Set(["claude", "codex"]);

// The processes running beneath each agent, from one listing of the system's processes.
function listProcesses() {
  return new Promise((resolve) =>
    execFile("ps", ["-Ao", "pid=,ppid=,command="], { maxBuffer: 20_000_000 }, (error, stdout) => {
      if (error) return resolve([]);
      resolve(
        stdout.split("\n").flatMap((line) => {
          const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
          return match ? [{ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] }] : [];
        }),
      );
    }),
  );
}
// An agent CLI, whether run directly or as a script by an interpreter such as node.
const INTERPRETERS = /^(node|bun|deno|sh|bash|zsh|dash|env|python3?)$/;
export function agentCli(command) {
  const [first = "", second] = command.split(/\s+/);
  return [first, INTERPRETERS.test(basename(first)) ? second : null].some((part) => part && AGENT_CLIS.has(basename(part)));
}

// Launches and supervises agent processes. Each agent keeps its input open, so
// it can be sent messages, steered mid-turn, interrupted and stopped; what it
// does is read from its output stream and reported to the live activity model.
export class AgentSupervisor {
  // Homes are the app's own Codex home and home folder, from agentHomes. With hosts,
  // each agent runs under its own host process, which can outlive the app; the
  // registry folder records them and the socket folder holds their sockets.
  constructor({ hosts = /** @type {any} */ (null), launch = spawn, live = new LiveActivity(), adapters = { claude: claudeAdapter, codex: codexAdapter }, stopGrace = 5000, homes = null, watchInterval = 2000, quotaWait = { unknown: 30 * 60_000, margin: 60_000 } } = {}) {
    this.launch = launch;
    this.homes = homes;
    this.live = live;
    this.adapters = adapters;
    this.stopGrace = stopGrace;
    this.agents = new Set();
    this.watchInterval = watchInterval;
    this.quotaWait = quotaWait;
    // The latest usage each provider reported, for showing remaining quota.
    this.usage = /** @type {Record<string, any>} */ ({});
    this.hosts = hosts;
    if (hosts) {
      mkdirSync(hosts.registry, { recursive: true, mode: 0o700 });
      mkdirSync(hosts.sockets, { recursive: true, mode: 0o700 });
      // The heartbeat that keeps hosted agents running while the app is.
      this.beat = setInterval(() => {
        for (const agent of this.agents) agent.heartbeat?.();
      }, hosts.heartbeat ?? 3000);
      this.beat.unref();
    }
  }
  // Only the app starts agents. One started beneath an agent is stopped and reported.
  async watch() {
    const running = [...this.agents].filter((a) => a.child?.pid && !a.ended);
    if (!running.length) return;
    const processes = await listProcesses();
    const children = new Map();
    for (const p of processes) children.set(p.ppid, [...(children.get(p.ppid) || []), p]);
    for (const agent of running) {
      const beneath = [...(children.get(agent.child.pid) || [])];
      for (let i = 0; i < beneath.length; i++) beneath.push(...(children.get(beneath[i].pid) || []));
      for (const p of beneath.filter((p) => agentCli(p.command))) {
        try {
          process.kill(p.pid, "SIGKILL");
        } catch {
          continue;
        }
        agent.emit("action", "Tried to start another agent; the app stopped it");
        agent.emit("intruder", { command: p.command });
      }
    }
  }
  // Starts an agent in its folder and sends it its first message.
  // Options: instructions, model, effort and web are passed to the
  // adapter. The raw stream is kept in the log file, by default beside the agent's
  // folder, where the agent does not read its own output back.
  start({ key, provider, executable, folder, env = process.env, prompt, live, describe, log = `${folder}.log`, meta = {}, ...options }) {
    const adapter = this.adapters[provider];
    if (!adapter) throw new Error(`No adapter for ${provider}.`);
    if (this.hosts) return this.watchAgent(this.startHosted({ key, provider, executable, folder, env, prompt, describe, log, meta, options }), { key, provider, live });
    const child = this.launch(executable, adapter.args({ folder, ...options }), {
      cwd: folder,
      env: adapter.env ? adapter.env({ ...env }, { homes: this.homes }) : { ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const agent = new Agent(key, child, this.stopGrace, this.quotaWait);
    if (!this.watcher) {
      this.watcher = setInterval(() => this.watch(), this.watchInterval);
      this.watcher.unref();
    }
    agent.session = adapter.session({ write: (message) => agent.write(message), describe, folder, ...options });
    this.watchAgent(agent, { key, provider, live });
      this.live.begin(key, live);

    let logSize = 0;
    // The log is for diagnosis only; losing it, say because its folder was removed, stops nothing.
    const append = (chunk) => {
      if ((logSize += chunk.length) > LOG_LIMIT) return;
      try {
        writeFileSync(log, chunk, { flag: "a", mode: 0o600 });
      } catch {
        logSize = LOG_LIMIT;
      }
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    agent.read();
    agent.session.open?.();
    if (prompt) agent.send(prompt);
    return agent;
  }
  // The live panel, usage and bookkeeping that every agent gets, local or hosted.
  watchAgent(agent, { key, provider, live }) {
    this.agents.add(agent);
    // An agent with no live entry, such as the coordinator, reports its actions itself.
    if (live) {
      this.live.begin(key, live);
      agent.on("action", (text) => this.live.note(key, text));
      agent.on("current", (text) => this.live.note(key, text));
      agent.on("paused", ({ reason }) => this.live.note(key, reason));
    }
    agent.on("usage", (usage) => {
      this.usage[provider] = { ...usage, at: Date.now() };
    });
    agent.on("exit", () => {
      if (live) this.live.end(key);
      this.agents.delete(agent);
      // A hosted agent's files go once every listener has handled its end.
      if (agent.record) setImmediate(() => this.forget(agent.record));
      if (!this.agents.size && this.watcher) {
        clearInterval(this.watcher);
        this.watcher = null;
      }
    });
    return agent;
  }
  // Starts an agent under its own host process, which the app then talks to.
  startHosted({ key, provider, executable, folder, env, prompt, describe, log, meta, options }) {
    const id = randomUUID().slice(0, 8);
    const registry = join(this.hosts.registry, `${id}.json`);
    const record = { id, key, provider, meta, socket: join(this.hosts.sockets, `${id}.sock`), events: join(this.hosts.registry, `${id}.events.jsonl`), startedAt: Date.now() };
    writeFileSync(record.events, "", { mode: 0o600 });
    writeFileSync(registry, JSON.stringify(record, null, 2), { mode: 0o600 });
    const spec = {
      registry,
      socket: record.socket,
      events: record.events,
      homes: this.homes,
      quotaWait: this.quotaWait,
      stopGrace: this.stopGrace,
      watchInterval: this.watchInterval,
      heartbeatTimeout: this.hosts.timeout ?? 15_000,
      describe: { names: describe?.names || {}, titles: describe?.titles || {} },
      start: { key, provider, executable, folder, prompt, log, ...options },
    };
    const specFile = join(this.hosts.registry, `${id}.spec.json`);
    writeFileSync(specFile, JSON.stringify(spec), { mode: 0o600 });
    const host = spawn(process.execPath, ["--no-warnings", HOST, specFile], { cwd: folder, env: { ...env }, detached: true, stdio: "ignore" });
    host.unref();
    return new HostedAgent(record, { from: 0 });
  }
  // Agents whose hosts are still running, or that ended while the app was closed,
  // for the role that started them to take back.
  hosted(filter = (/** @type {any} */ _record) => true) {
    if (!this.hosts) return [];
    return readdirSync(this.hosts.registry)
      .filter((name) => /^[0-9a-f]{8}\.json$/.test(name))
      .map((name) => {
        try {
          return JSON.parse(readFileSync(join(this.hosts.registry, name), "utf8"));
        } catch {
          return null;
        }
      })
      .filter((record) => record && filter(record));
  }
  // Takes back an agent from its host, getting every event the app has not handled.
  reattach(record, { live } = {}) {
    const agent = new HostedAgent(record, { from: record.acked || 0 });
    return this.watchAgent(agent, { key: record.key, provider: record.provider, live });
  }
  // Stops a host that no role takes back, such as a coordinator from an earlier opening.
  dismiss(record) {
    this.reattach(record).stop();
  }
  // On quitting with workers kept running: their hosts carry on without the app.
  keep(filter = (/** @type {any} */ _record) => true) {
    for (const agent of this.agents) if (agent.record && filter(agent.record)) agent.keep();
  }
  // The files of a host that has ended and been handled.
  forget(record) {
    for (const suffix of [".json", ".events.jsonl", ".spec.json"]) rmSync(join(this.hosts.registry, `${record.id}${suffix}`), { force: true });
  }
}

const HOST = join(dirname(fileURLToPath(import.meta.url)), "host.mjs");

// The app's side of a hosted agent: the same interface as a local one, carried over
// the host's socket. Each event is acknowledged once handled, so nothing is lost or
// handled twice across a restart.
class HostedAgent extends EventEmitter {
  constructor(record, { from }) {
    super();
    this.record = record;
    this.key = record.key;
    this.busy = false;
    this.paused = null;
    this.finishing = false;
    this.ended = false;
    this.queue = [];
    this.connect(from, 0);
  }
  connect(from, tries) {
    if (this.ended) return;
    const socket = createConnection(this.record.socket);
    socket.on("connect", () => {
      this.socket = socket;
      socket.write(`${JSON.stringify({ op: "attach", from })}\n`);
      socket.write(`${JSON.stringify({ op: "heartbeat" })}\n`);
      for (const line of this.queue.splice(0)) socket.write(line);
    });
    let pending = "";
    socket.on("data", (chunk) => {
      pending += chunk.toString();
      const lines = pending.split("\n");
      pending = lines.pop();
      for (const line of lines) if (line) this.receive(JSON.parse(line));
    });
    socket.on("error", () => {});
    socket.on("close", () => {
      if (this.ended) return;
      this.socket = null;
      // The host may still be starting, or it has gone; its saved events say which.
      if (tries < 100 && !this.hostGone()) setTimeout(() => this.connect(this.lastSeq ?? from, tries + 1), 100);
      else this.replayEnded(this.lastSeq ?? from);
    });
  }
  hostGone() {
    try {
      const record = JSON.parse(readFileSync(join(dirname(this.record.events), `${this.record.id}.json`), "utf8"));
      if (record.ended) return true;
      if (!record.pid) return false;
      process.kill(record.pid, 0);
      return false;
    } catch {
      return true;
    }
  }
  // A host that ended while the app was away left its last events on disk.
  replayEnded(from) {
    try {
      for (const line of readFileSync(this.record.events, "utf8").split("\n").filter(Boolean)) {
        const event = JSON.parse(line);
        if (event.seq > from) this.receive(event);
      }
    } catch {
      /* No saved events. */
    }
    if (!this.ended) this.receive({ seq: 0, type: "exit", data: { code: null, stopped: false }, state: {} });
  }
  receive(event) {
    if (event.state) {
      this.busy = Boolean(event.state.busy);
      this.paused = event.state.paused || null;
      this.finishing = this.finishing || Boolean(event.state.finishing);
    }
    if (event.seq) this.lastSeq = event.seq;
    // On attaching, what the agent is doing now shows at once; it is not a new action.
    if (event.type === "state" && event.state?.latest) this.emit("current", event.state.latest);
    if (event.type === "state" || event.type === "refused") return;
    if (event.type === "exit") this.ended = true;
    const data = event.type === "failed" ? Object.assign(event.data.problem ? new AgentProblem(event.data.message) : new Error(event.data.message)) : event.data;
    this.emit(event.type, data);
    if (event.seq) this.command({ op: "ack", seq: event.seq });
  }
  command(command) {
    const line = `${JSON.stringify(command)}\n`;
    if (this.socket) this.socket.write(line);
    else this.queue.push(line);
  }
  send(text) {
    if (this.finishing) throw new Error("This agent has already closed its input.");
    this.command({ op: "send", text });
    this.busy = true;
  }
  steer(text) {
    this.send(text);
  }
  interrupt() {
    this.command({ op: "interrupt" });
  }
  compact() {
    this.command({ op: "compact" });
  }
  finish() {
    this.finishing = true;
    this.command({ op: "finish" });
  }
  stop() {
    if (this.kept) return;
    this.finishing = true;
    this.command({ op: "stop" });
  }
  heartbeat() {
    if (this.socket) this.command({ op: "heartbeat" });
  }
  // Kept running: the host carries on when the app closes, so closing does not stop it.
  keep() {
    this.kept = true;
    this.command({ op: "keep" });
  }
}

class Agent extends EventEmitter {
  constructor(key, child, stopGrace, quotaWait) {
    super();
    this.key = key;
    this.child = child;
    this.stopGrace = stopGrace;
    this.quotaWait = quotaWait;
    // Set while the provider's usage limit holds the agent; messages wait for it.
    this.paused = null;
    this.held = [];
    this.busy = false;
    this.interrupting = false;
    this.closed = false;
    this.stopped = false;
    child.stdin.on("error", () => {});
    child.on("error", (error) => {
      this.emit("failed", error);
      this.exited(null);
    });
    child.on("close", (code) => this.exited(code));
  }
  read() {
    let pending = "";
    this.child.stdout.on("data", (chunk) => {
      pending += chunk.toString();
      const lines = pending.split("\n");
      pending = lines.pop();
      for (const line of lines) {
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        let result;
        try {
          result = this.session.read(event);
        } catch (error) {
          result = { actions: [], failure: error };
        }
        const { actions, turn, failure, usage, context, compacted } = result;
        for (const text of actions) this.emit("action", text);
        if (context) this.emit("context", context);
        if (compacted) this.emit("compacted", compacted);
        if (usage) {
          this.usage = usage;
          this.emit("usage", usage);
        }
        if (failure) {
          this.emit("failed", failure);
          this.stop();
          return;
        }
        // A turn the usage limit stopped is not over: the agent waits and carries on.
        if (turn?.quota && !this.interrupting) {
          this.pauseForQuota();
          continue;
        }
        if (turn) {
          const outcome = this.interrupting ? "interrupted" : turn.ok ? "done" : "error";
          this.busy = false;
          this.interrupting = false;
          this.emit("turn", { outcome, text: turn.text ?? "" });
        }
        this.closeWhenIdle();
      }
    });
  }
  // Protocol replies after input is closed have nowhere to go.
  write(message) {
    if (this.closed) return;
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }
  // Starts a turn when the agent is waiting, or reaches it at its next step.
  send(text) {
    if (this.finishing) throw new Error("This agent has already closed its input.");
    if (this.paused) {
      this.held.push(text);
      return;
    }
    this.session.send(text);
    this.busy = true;
  }
  // Waits until the reported reset, or a while when none was reported, then carries on.
  pauseForQuota() {
    const now = Date.now();
    const reported = this.usage?.exhausted && this.usage.resetsAt > now ? this.usage.resetsAt : null;
    const resetsAt = reported ?? now + this.quotaWait.unknown;
    const at = new Date(resetsAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    const reason = `Paused: the usage limit is reached${reported ? "" : " and no reset time was given"}. It carries on at ${at}.`;
    this.paused = { resetsAt, reason };
    this.busy = false;
    this.emit("paused", this.paused);
    this.resumeTimer = setTimeout(() => this.resume(), Math.max(0, resetsAt - now) + (reported ? this.quotaWait.margin : 0));
  }
  resume() {
    if (!this.paused || this.finishing) return;
    this.paused = null;
    const held = this.held.splice(0);
    this.emit("resumed");
    this.send(["The usage limit has reset. Carry on with your assignment from where you stopped.", ...held].join("\n\n"));
  }
  // Redirects a running turn; the adapter delivers it at the agent's next step.
  steer(text) {
    this.send(text);
  }
  interrupt() {
    if (!this.busy || this.closed) return;
    this.interrupting = true;
    this.session.interrupt();
  }
  // Compacts the agent's conversation now, with its CLI's own compaction.
  compact() {
    if (this.finishing) return;
    this.session.compact?.();
    this.busy = true;
  }
  // Closes input once the agent is idle, so it exits after anything already sent.
  finish() {
    this.finishing = true;
    this.closeWhenIdle();
  }
  closeWhenIdle() {
    if (!this.finishing || this.closed || this.session.idle?.() === false) return;
    this.close();
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.child.stdin.end();
  }
  // Ends the agent now, forcefully if it does not exit within the grace period.
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    clearTimeout(this.resumeTimer);
    this.finishing = true;
    this.close();
    if (this.child.exitCode !== null) return;
    this.child.kill("SIGTERM");
    const timer = setTimeout(() => {
      if (this.child.exitCode === null) this.child.kill("SIGKILL");
    }, this.stopGrace);
    timer.unref();
  }
  exited(code) {
    if (this.ended) return;
    this.ended = true;
    clearTimeout(this.resumeTimer);
    this.busy = false;
    this.emit("exit", { code, stopped: this.stopped });
  }
}
