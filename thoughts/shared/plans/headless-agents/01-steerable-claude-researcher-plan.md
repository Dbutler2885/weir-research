# Slice 01 plan: steerable Claude researcher

Slice: [01 - Steerable Claude researcher](slices/01-steerable-claude-researcher.md)

## Current state

- `server/researchers.mjs` (`ResearcherPool`) spawns Claude with `--print --output-format stream-json` and the task prompt as an argument, then calls `stdin.end()` at launch.
  Nothing can reach a running researcher; the only stop is the lease-fence `terminate` in `pump()` or the time limit.
- The stream is read by `streamReader` and `fileDescriber` from `server/live-activity.mjs`, which already turn Claude tool calls into sentences for `LiveActivity`.
- The coordinator is still an external session driving `server/coordinator.mjs` commands; it has no command to redirect or stop a researcher.
- A stopped/paused investigation already shows in the live panel as "Paused. <last event>" (`src/ui/live-panel.ts`).

## Protocol, confirmed against Claude Code 2.1.282 on 2026-09-25

`claude -p --input-format stream-json --output-format stream-json --verbose`, input kept open:

- A user message is `{"type":"user","message":{"role":"user","content":"..."}}`.
- A message written mid-turn is picked up after the current tool result: the probe was told to run three slow commands, a redirection sent during the first one replaced the other two, and the turn ended with one `result`.
- Interrupt is `{"type":"control_request","request_id":"...","request":{"subtype":"interrupt"}}`; Claude answers with a `control_response` and ends the turn with `result` subtype `error_during_execution`, then waits for input.
- A `result` event marks each turn boundary; the process exits when input is closed.
- The stream also carries `rate_limit_event`, useful to slice 12.

## Design

### New module `server/agents/supervisor.mjs`

One supervisor for every agent process (researchers now; builders, writers and the coordinator in later slices).

```js
const supervisor = new AgentSupervisor({ launch, live, adapters: { claude: claudeAdapter } });
const agent = supervisor.start({
  key, provider, executable, folder, env,
  instructions, prompt, tools,            // adapter turns these into CLI args + first message
  live: { role, name, investigationId },  // live panel row
  describe,                               // fileDescriber for this role
});
agent.send(text);      // start a turn, or queue for the next step if one is running
agent.steer(text);     // same write for Claude; named separately because Codex differs (slice 02)
agent.interrupt();     // end the current turn, keep the agent
agent.stop();          // interrupt, close input, SIGTERM, then SIGKILL after a grace
agent.finish();        // close input so the CLI exits after anything already queued
agent.on("action", text) / on("turn", { outcome }) / on("exit", { code }) / on("output", chunk)
agent.busy             // true between a message and its turn boundary
```

The supervisor owns the `LiveActivity` begin/note/end calls and the process log, so pools stop doing that themselves.

### New module `server/agents/claude.mjs` (adapter)

Pure functions, no process handling:

- `args({ instructions, tools })` returns the print-mode, stream-json in/out argument list, with `--append-system-prompt`, `--permission-mode dontAsk` and `--allowedTools` as today.
- `message(text)` and `interrupt(id)` return the input lines.
- `read(event)` returns `{ actions, turn }`, using `streamActions` for actions and `result` for the turn boundary (`outcome: "done" | "interrupted" | "error"`).

Sandbox, isolation flags and `--setting-sources` are slice 04; this slice keeps the current environment.

### `ResearcherPool` changes

- The Claude path starts researchers through the supervisor; the prompt becomes the first message and input stays open.
  The Codex path is unchanged until slice 02.
- New pool methods `steer(id, message)` and `halt(id, reason)`:
  - `steer` writes the message into the running researcher and records an investigation event ("Coordinator redirected the researcher: ...").
  - `halt` stops the agent, pauses the investigation through the store and records "Coordinator stopped the researcher: <reason>", which the live panel shows as the paused row.
  - `steer` refuses a Codex researcher until slice 02, with "This researcher cannot take instructions mid-run; stop it and request another pass instead."
- On a turn boundary:
  - If `result.json` exists, the pool calls `finish()`; the CLI exits and the existing close handler validates and hands the result on as today.
  - Otherwise the researcher is waiting: the pool records "Researcher is waiting for instructions" as an investigation event so the coordinator wakes, and the coordinator either steers it or stops it.
  - An interrupted turn is always followed by `stop()`, since interrupt is only used for stopping in this slice.
- The existing close, fail, checkpoint, time limit and lease-fence behaviour stays; `terminate` becomes `agent.stop()`.

### Coordinator commands

In `server/coordinator.mjs`, with the pool passed in from `server/main.mjs`:

- `{"action":"steer","investigationId":"...","message":"..."}` for a running managed researcher.
- `{"action":"stop-researcher","investigationId":"...","reason":"..."}`.
- Live-panel sentences in `coordinatorAction`: "Redirecting the researcher on batch N" and "Stopping the researcher on batch N".
- `skills/coordinate-research/SKILL.md` documents both, beside `revise`.

## Tests

- `tests/fixtures/fake-claude.mjs`: a real executable node script that speaks Claude's stream protocol.
  It reads a step script from its folder (tool calls with delays, files to write), emits `system init`, `assistant` tool_use events, `user` tool results and `result`, applies a message received mid-turn at the next step, honours interrupt control requests, and exits when input closes.
- `tests/agent-supervisor.test.ts` drives the supervisor through the real spawned fake CLI:
  actions reported in plain sentences to `LiveActivity`, a message delivered at the next step and changing what the agent does, interrupt, stop, turn boundaries, and `finish()` closing the process.
- `tests/claude-adapter.test.ts`: recorded stream lines from the probe above map to actions and turn outcomes.
- `tests/researchers.test.ts` updates: the Claude researcher keeps input open, gets the prompt as a message, closes itself after writing `result.json`, can be steered and halted (paused with the reason), and Codex still behaves as before.
- Coordinator command tests for `steer` and `stop-researcher`, including refusal for a non-running or Codex researcher.

## Success criteria

### Automated

- [x] `npm run check` passes.
- [x] `npm run test:integration` passes.

### Manual

- [x] In a real project with a Claude researcher running, `steer` changes what it does within one step, and `stop-researcher` stops it with the panel showing the reason.
