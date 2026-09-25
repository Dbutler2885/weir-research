import { execFile, spawn } from "node:child_process";
import { basename } from "node:path";
import { EventEmitter } from "node:events";
import { writeFileSync } from "node:fs";
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
  // Homes are the app's own Codex home and home folder, from agentHomes.
  constructor({ launch = spawn, live = new LiveActivity(), adapters = { claude: claudeAdapter, codex: codexAdapter }, stopGrace = 5000, homes = null, watchInterval = 2000 } = {}) {
    this.launch = launch;
    this.homes = homes;
    this.live = live;
    this.adapters = adapters;
    this.stopGrace = stopGrace;
    this.agents = new Set();
    this.watchInterval = watchInterval;
  }
  // Only the app starts agents. One started beneath an agent is stopped and reported.
  async watch() {
    const running = [...this.agents].filter((a) => a.child.pid && !a.ended);
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
  start({ key, provider, executable, folder, env = process.env, prompt, live, describe, log = `${folder}.log`, ...options }) {
    const adapter = this.adapters[provider];
    if (!adapter) throw new Error(`No adapter for ${provider}.`);
    const child = this.launch(executable, adapter.args({ folder, ...options }), {
      cwd: folder,
      env: adapter.env ? adapter.env({ ...env }, { homes: this.homes }) : { ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const agent = new Agent(key, child, this.stopGrace);
    this.agents.add(agent);
    if (!this.watcher) {
      this.watcher = setInterval(() => this.watch(), this.watchInterval);
      this.watcher.unref();
    }
    agent.session = adapter.session({ write: (message) => agent.write(message), describe, folder, ...options });
    // An agent with no live entry, such as the coordinator, reports its actions itself.
    if (live) {
      this.live.begin(key, live);
      agent.on("action", (text) => this.live.note(key, text));
    }
    agent.on("exit", () => {
      if (live) this.live.end(key);
      this.agents.delete(agent);
      if (!this.agents.size) {
        clearInterval(this.watcher);
        this.watcher = null;
      }
    });
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
}

class Agent extends EventEmitter {
  constructor(key, child, stopGrace) {
    super();
    this.key = key;
    this.child = child;
    this.stopGrace = stopGrace;
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
        const { actions, turn, failure } = result;
        for (const text of actions) this.emit("action", text);
        if (failure) {
          this.emit("failed", failure);
          this.stop();
          return;
        }
        if (turn) {
          const outcome = this.interrupting ? "interrupted" : turn.ok ? "done" : "error";
          this.busy = false;
          this.interrupting = false;
          this.emit("turn", { outcome });
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
    this.session.send(text);
    this.busy = true;
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
    this.busy = false;
    this.emit("exit", { code, stopped: this.stopped });
  }
}
