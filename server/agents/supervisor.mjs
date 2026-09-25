import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { writeFileSync } from "node:fs";
import { LiveActivity } from "../live-activity.mjs";
import { claudeAdapter } from "./claude.mjs";
import { codexAdapter } from "./codex.mjs";

const LOG_LIMIT = 2_000_000;

// Launches and supervises agent processes. Each agent keeps its input open, so
// it can be sent messages, steered mid-turn, interrupted and stopped; what it
// does is read from its output stream and reported to the live activity model.
export class AgentSupervisor {
  constructor({ launch = spawn, live = new LiveActivity(), adapters = { claude: claudeAdapter, codex: codexAdapter }, stopGrace = 5000 } = {}) {
    this.launch = launch;
    this.live = live;
    this.adapters = adapters;
    this.stopGrace = stopGrace;
  }
  // Starts an agent in its folder and sends it its first message.
  // Options: instructions, tools, flags, model, effort and web are passed to the
  // adapter. The raw stream is kept in the log file, by default beside the agent's
  // folder, where the agent does not read its own output back.
  start({ key, provider, executable, folder, env = process.env, prompt, live, describe, log = `${folder}.log`, ...options }) {
    const adapter = this.adapters[provider];
    if (!adapter) throw new Error(`No adapter for ${provider}.`);
    const child = this.launch(executable, adapter.args({ folder, ...options }), {
      cwd: folder,
      env: { ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const agent = new Agent(key, child, this.stopGrace);
    agent.session = adapter.session({ write: (message) => agent.write(message), describe, folder, ...options });
    this.live.begin(key, live);
    agent.on("action", (text) => this.live.note(key, text));
    agent.on("exit", () => this.live.end(key));
    let logSize = 0;
    const append = (chunk) => {
      if ((logSize += chunk.length) <= LOG_LIMIT) writeFileSync(log, chunk, { flag: "a", mode: 0o600 });
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
