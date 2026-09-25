#!/usr/bin/env node
// A stand-in for `codex app-server`, speaking its JSON-RPC protocol on stdio.
// A turn whose text is "steps: [...]" runs those steps; a step is {command}
// or {change: file}, with optional delay and writes: {file: text}. turn/steer
// replaces the remaining steps at the next step, and turn/interrupt ends the
// turn. FAKE_CODEX_VERSION sets the reported version, and FAKE_CODEX_MISSING
// names a method to refuse.
import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const out = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
const notify = (method, params) => out({ method, params });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stepsFor = (input) => {
  const text = input.map((i) => i.text).join("");
  return text.startsWith("steps:") ? JSON.parse(text.slice(6)) : [];
};

const threadId = "thread-1";
let turns = 0;
let active = null;

async function run(turn, steps) {
  notify("turn/started", { threadId, turn: { id: turn.id, items: [], status: "inProgress" } });
  let n = 0;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const item = step.change
      ? { type: "fileChange", id: `patch-${++n}`, changes: [{ path: step.change, kind: "add", diff: "" }] }
      : { type: "commandExecution", id: `exec-${++n}`, command: `/bin/zsh -lc '${step.command}'` };
    notify("item/started", { threadId, turnId: turn.id, item });
    const until = Date.now() + (step.delay || 0);
    while (Date.now() < until && !turn.interrupted) await sleep(5);
    if (turn.interrupted) return finish(turn, "interrupted");
    for (const [file, text] of Object.entries(step.writes || {})) writeFileSync(file, text);
    notify("item/completed", { threadId, turnId: turn.id, item: { ...item, status: "completed" } });
    if (turn.steered.length) {
      steps = stepsFor(turn.steered.shift());
      i = -1;
    }
  }
  notify("item/completed", { threadId, turnId: turn.id, item: { type: "agentMessage", id: "msg", text: "Done." } });
  finish(turn, "completed");
}
function finish(turn, status) {
  active = null;
  notify("turn/completed", { threadId, turn: { id: turn.id, items: [], status } });
}

createInterface({ input: process.stdin })
  .on("line", (line) => {
    const { id, method, params } = JSON.parse(line);
    if (id === undefined) return;
    if (method === process.env.FAKE_CODEX_MISSING)
      return out({ id, error: { code: -32601, message: `Unknown method ${method}` } });
    if (method === "initialize")
      return out({ id, result: { userAgent: `research-workspace/${process.env.FAKE_CODEX_VERSION || "0.155.1"} (fake)`, platformFamily: "unix" } });
    if (method === "thread/start") {
      out({ id, result: { thread: { id: threadId, cwd: params.cwd } } });
      return notify("thread/started", { thread: { id: threadId } });
    }
    if (method === "turn/start") {
      const turn = { id: `turn-${++turns}`, steered: [], interrupted: false };
      active = turn;
      out({ id, result: { turn: { id: turn.id, items: [], status: "inProgress" } } });
      run(turn, stepsFor(params.input));
      return;
    }
    if (method === "turn/steer") {
      if (!active || active.id !== params.expectedTurnId)
        return out({ id, error: { code: -32600, message: "No active turn matches expectedTurnId." } });
      active.steered.push(params.input);
      return out({ id, result: { turnId: active.id } });
    }
    if (method === "turn/interrupt") {
      if (active?.id === params.turnId) active.interrupted = true;
      return out({ id, result: {} });
    }
    out({ id, error: { code: -32601, message: `Unknown method ${method}` } });
  })
  .on("close", async () => {
    while (active) await sleep(5);
    process.exit(0);
  });
