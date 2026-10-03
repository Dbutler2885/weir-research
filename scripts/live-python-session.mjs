// Live check, outside `npm run check`: a real Claude Code and a real Codex researcher,
// each in the app's sandbox for its CLI, use their Python sessions through the command
// tool on a fictional library. It costs a few model calls on the human's sign-ins.
// The result is read from the seat's saved session, not from what the agent says.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { AgentSupervisor } from "../server/agents/supervisor.mjs";
import { agentHomes } from "../server/agents/isolation.mjs";
import { SessionDesk } from "../server/python-session/desk.mjs";
import { PythonSession } from "../server/python-session/session.mjs";
import { executableOnPath, SESSION_INSTRUCTIONS } from "../server/researchers.mjs";

// The app's own Codex home, where the human signed Codex in, and its tools folder.
const appHome = resolve(process.env.RESEARCH_HOME || ".research");
const supervisor = new AgentSupervisor({ homes: agentHomes(appHome) });
const models = { claude: { model: "haiku", effort: "low" }, codex: { model: "gpt-6-luna", effort: "low" } };
const only = process.argv.slice(2);
let failed = false;

for (const provider of only.length ? only : ["claude", "codex"]) {
  const executable = executableOnPath(provider);
  if (!executable) {
    console.log(`${provider}: not installed, skipped.`);
    continue;
  }
  const project = mkdtempSync(join(appHome, "live-session-"));
  const seat = join(project, "agents", "batch-1", "seat-1");
  const folder = join(seat, "lease-1");
  const library = join(project, "library");
  mkdirSync(folder, { recursive: true });
  mkdirSync(join(library, "documents"), { recursive: true });
  writeFileSync(join(library, "documents", "documents.csv"), "id,name,collection,file,text,pages\ndoc-1,Fictional harbor ledger.pdf,c1,documents/doc-1.pdf,documents/doc-1.txt,3\n");
  writeFileSync(join(library, "documents", "doc-1.txt"), "[Page 1]\nExample Mill opened in 1882.\n\n[Page 2]\nThe ledger names Ada Example.\n\n[Page 3]\nAda Example sold the mill in 1901.\n");
  const desk = new SessionDesk({ home: appHome, library });
  const lease = "lease-1";
  desk.open("seat-1", { folder, seat, authorize: (given) => given === lease, deliver: (text) => console.log(`${provider} message: ${text}`) });
  const instructions = `You are checking a research workspace's Python session. Work only in this folder.\n${SESSION_INSTRUCTIONS}`;
  writeFileSync(join(folder, "AGENTS.md"), instructions);
  try {
    const agent = supervisor.start({
      key: `live:${provider}`,
      provider,
      executable,
      folder,
      env: { ...process.env, WEIR_LEASE: lease },
      instructions,
      readOnly: [library],
      ...models[provider],
      prompt:
        "Using your Python session, in one run: read document doc-1 and store its number of pages in a variable named pages_count, and print it. Then, in a second, separate run, print pages_count * 10 without reading the document again. Reply with only the two numbers that were printed.",
    });
    const actions = [];
    agent.on("action", (text) => actions.push(text));
    const turn = await new Promise((done, fail) => {
      agent.on("turn", done);
      agent.on("failed", fail);
      setTimeout(() => fail(new Error("no answer within five minutes")), 5 * 60_000);
    });
    agent.stop();
    desk.close("seat-1");
    // What the session kept, read by a fresh session on the same seat.
    const check = new PythonSession({ folder: seat, library, home: appHome });
    const kept = (await check.run("print(pages_count)")).output.trim();
    check.stop();
    console.log(`${provider}: replied ${JSON.stringify(turn.text.trim())}; the session kept pages_count = ${kept}.`);
    console.log(`${provider} actions:\n  ${actions.join("\n  ")}`);
    assert.equal(kept, "3", "the session kept the variable the agent made");
    assert.match(turn.text, /\b3\b[\s\S]*\b30\b/, "the agent saw both runs' output");
    console.log(`${provider}: passed.`);
  } catch (error) {
    failed = true;
    console.log(`${provider}: FAILED: ${error.message}`);
  } finally {
    desk.closeAll();
    rmSync(project, { recursive: true, force: true, maxRetries: 5 });
  }
}
process.exit(failed ? 1 : 0);
