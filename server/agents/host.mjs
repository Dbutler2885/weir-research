// The host for one agent: a small process that owns the agent's input and output,
// keeps its events on disk, and takes commands from the app over a local socket.
// The app sends a heartbeat; when it stops, the host stops the agent, unless the
// human chose to keep workers running when the app closed. A kept agent carries on
// with the code and instructions it started with, including waiting out a usage
// limit and resuming at the reset.
//
// node server/agents/host.mjs <spec.json>
import { appendFileSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { AgentSupervisor } from "./supervisor.mjs";
import { AgentProblem } from "./problem.mjs";
import { fileDescriber } from "../live-activity.mjs";

const spec = JSON.parse(readFileSync(process.argv[2], "utf8"));
const registry = spec.registry;
const record = { ...JSON.parse(readFileSync(registry, "utf8")), pid: process.pid, acked: 0 };
// Written whole, so the app never reads half a record.
const save = () => {
  writeFileSync(`${registry}.tmp`, JSON.stringify(record, null, 2), { mode: 0o600 });
  renameSync(`${registry}.tmp`, registry);
};
save();

const supervisor = new AgentSupervisor({ homes: spec.homes, quotaWait: spec.quotaWait, stopGrace: spec.stopGrace, watchInterval: spec.watchInterval });
const agent = supervisor.start({ ...spec.start, describe: fileDescriber(spec.describe.names, spec.describe.titles) });

// Every event is numbered and kept, so an app that reconnects gets what it missed.
let seq = 0;
const clients = new Set();
// What the agent is doing now, so a returning app can show it at once.
let latest = null;
agent.on("action", (text) => (latest = text));
agent.on("paused", ({ reason }) => (latest = reason));
const state = () => ({ busy: agent.busy, paused: agent.paused, finishing: Boolean(agent.finishing), latest });
function publish(type, data = {}) {
  const event = { seq: ++seq, type, data, state: state(), at: Date.now() };
  appendFileSync(spec.events, `${JSON.stringify(event)}\n`, { mode: 0o600 });
  for (const client of clients) client.write(`${JSON.stringify(event)}\n`);
}
for (const type of ["session", "action", "turn", "usage", "paused", "resumed", "intruder", "context", "compacted"]) agent.on(type, (data) => publish(type, data ?? {}));
agent.on("failed", (error) => publish("failed", { message: error.message, problem: error instanceof AgentProblem }));

let lastBeat = Date.now();
let kept = false;
// Set when the host stops the agent itself, having lost the app.
let stopReason = null;
const commands = {
  send: ({ text, now }) => agent.send(text, { now }),
  steer: ({ text }) => agent.steer(text),
  interrupt: () => agent.interrupt(),
  compact: () => agent.compact(),
  finish: () => agent.finish(),
  stop: () => agent.stop(),
  heartbeat: () => {
    lastBeat = Date.now();
  },
  keep: () => {
    kept = true;
    record.kept = true;
    save();
  },
  // Once the agent has ended, the app handles its last events and removes the record.
  ack: ({ seq: handled }) => {
    if (!record.ended && handled > record.acked) {
      record.acked = handled;
      save();
    }
  },
};

const server = createServer((socket) => {
  let pending = "";
  socket.on("data", (chunk) => {
    pending += chunk.toString();
    const lines = pending.split("\n");
    pending = lines.pop();
    for (const line of lines) {
      let command;
      try {
        command = JSON.parse(line);
      } catch {
        continue;
      }
      if (command.op === "attach") {
        // The current state first, then every event the app has not handled.
        socket.write(`${JSON.stringify({ seq: 0, type: "state", data: {}, state: state() })}\n`);
        for (const line of readFileSync(spec.events, "utf8").split("\n").filter(Boolean)) {
          const event = JSON.parse(line);
          if (event.seq > (command.from ?? 0)) socket.write(`${line}\n`);
        }
        clients.add(socket);
        lastBeat = Date.now();
        // An app that opens again takes the agent back from being kept running.
        if (kept) {
          kept = false;
          record.kept = false;
          save();
        }
        continue;
      }
      try {
        commands[command.op]?.(command);
      } catch (error) {
        socket.write(`${JSON.stringify({ seq: 0, type: "refused", data: { message: error.message }, state: state() })}\n`);
      }
    }
  });
  socket.on("close", () => clients.delete(socket));
  socket.on("error", () => clients.delete(socket));
});
rmSync(spec.socket, { force: true });
server.listen(spec.socket);

// Without the app's heartbeat, a worker that was not kept running stops. A computer
// that slept paused the app too, so on waking its heartbeat gets its full time again.
let lastCheck = Date.now();
const check = setInterval(() => {
  const now = Date.now();
  if (now - lastCheck > 3000) lastBeat = now;
  lastCheck = now;
  if (!kept && now - lastBeat > spec.heartbeatTimeout) {
    stopReason = "lost";
    agent.stop();
  }
}, 1000);

agent.on("exit", ({ code, stopped }) => {
  clearInterval(check);
  // Recorded before the app hears of it, so an app that then forgets the host is not undone.
  record.ended = true;
  save();
  publish("exit", { code, stopped, ...(stopReason ? { reason: stopReason } : {}) });
  // Let a connected app read the last event before the socket goes.
  setTimeout(() => {
    server.close();
    rmSync(spec.socket, { force: true });
    process.exit(0);
  }, 300);
});
