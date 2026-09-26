#!/usr/bin/env node
// A stand-in for Claude Code in print mode with stream-json input and output.
// A message "steps: [...]" runs those tool steps as one turn; any other message
// runs the steps in the file named by FAKE_CLAUDE_STEPS, or none. A step is
// {tool, input, delay, writes: {file: text}, run: [command, ...args]}, where
// run starts a process beneath it, and {quota: seconds} hits the usage limit.
// A message arriving mid-turn replaces the remaining steps at the next step, as
// Claude's does. FAKE_CLAUDE_RECORD keeps every message received in
// received.jsonl.
import { spawn } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const out = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stepsFor = (text) => {
  if (text.startsWith("steps:")) return JSON.parse(text.slice(6));
  return process.env.FAKE_CLAUDE_STEPS ? JSON.parse(readFileSync(process.env.FAKE_CLAUDE_STEPS, "utf8")) : [];
};

const inbox = [];
let interrupted = false;
let running = null;
let ended = false;
let wake = () => {};

out({ type: "system", subtype: "init", cwd: process.cwd(), tools: [] });

async function turn(steps) {
  let n = 0;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    // {quota: seconds} hits the usage limit, reporting a reset that many seconds away, as Claude does.
    if (step.quota) {
      const resetsAt = Math.floor(Date.now() / 1000) + step.quota;
      out({ type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt, rateLimitType: "five_hour", unifiedWindows: { five_hour: { utilization: 1, resetsAt } } } });
      out({ type: "assistant", message: { model: "<synthetic>", content: [{ type: "text", text: "You've hit your session limit" }] }, error: "rate_limit" });
      out({ type: "result", subtype: "success", is_error: true, result: "You've hit your session limit", api_error_status: 429 });
      return;
    }
    // {tokens} reports that much context in use, as Claude's usage does.
    const usage = step.tokens ? { input_tokens: step.tokens, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0 } : undefined;
    out({ type: "assistant", message: { content: [{ type: "tool_use", id: `tool-${++n}`, name: step.tool, input: step.input || {} }], usage } });
    if (step.run) spawn(step.run[0], step.run.slice(1), { stdio: "ignore" });
    const until = Date.now() + (step.delay || 0);
    while (Date.now() < until && !interrupted) await sleep(5);
    if (interrupted) {
      interrupted = false;
      out({ type: "user", message: { content: [{ type: "text", text: "[Request interrupted by user for tool use]" }] } });
      out({ type: "result", subtype: "error_during_execution", is_error: true });
      return;
    }
    for (const [file, text] of Object.entries(step.writes || {})) writeFileSync(file, text);
    out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: `tool-${n}`, content: "ok" }] } });
    // A message that arrived during the step redirects the rest of the turn.
    if (inbox.length) {
      steps = stepsFor(inbox.shift());
      i = -1;
    }
  }
  out({ type: "assistant", message: { content: [{ type: "text", text: "Done." }] } });
  out({ type: "result", subtype: "success", result: "Done." });
}

// /compact compacts the conversation, as Claude reports it.
async function compact() {
  out({ type: "system", subtype: "compact_boundary", compact_metadata: { trigger: "manual", pre_tokens: 150000 } });
  out({ type: "result", subtype: "success", result: "Compacted." });
}

async function loop() {
  for (;;) {
    if (inbox[0] === "/compact") {
      inbox.shift();
      await compact();
    } else if (inbox.length) {
      running = turn(stepsFor(inbox.shift()));
      await running;
      running = null;
    } else if (ended) break;
    else await new Promise((resolve) => (wake = resolve));
  }
  process.exit(0);
}

createInterface({ input: process.stdin })
  .on("line", (line) => {
    const event = JSON.parse(line);
    if (event.type === "user") {
      inbox.push(event.message.content);
      // With FAKE_CLAUDE_RECORD set, each message is kept in received.jsonl, noting whether a turn was running.
      if (process.env.FAKE_CLAUDE_RECORD)
        appendFileSync("received.jsonl", `${JSON.stringify({ text: event.message.content, midTurn: Boolean(running) })}\n`);
    }
    if (event.type === "control_request" && event.request.subtype === "interrupt") {
      if (running) interrupted = true;
      out({ type: "control_response", response: { subtype: "success", request_id: event.request_id, response: {} } });
    }
    wake();
  })
  .on("close", () => {
    ended = true;
    wake();
  });
loop();
