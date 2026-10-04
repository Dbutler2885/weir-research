// Live check, outside `npm run check`: a real helper, on Claude Code and then on Codex,
// is sent on an errand in a fictional library. It works in its own Python session,
// asks a reader, and answers with a quote the saved text holds; its researcher's seat
// gets a one-line notice, and the full answer is where the seat's session reads it.
// It costs some model calls on the human's sign-ins.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { AgentSupervisor } from "../server/agents/supervisor.mjs";
import { agentHomes } from "../server/agents/isolation.mjs";
import { SessionDesk } from "../server/python-session/desk.mjs";
import { executableOnPath } from "../server/researchers.mjs";
import { Readers } from "../server/readers.mjs";
import { Jobs } from "../server/jobs.mjs";
import { WorkspaceStore } from "../server/store.mjs";
import { ResearchLibrary } from "../server/research-library.mjs";
import { emptyGraph } from "../src/domain/graph-schema.ts";

const appHome = resolve(process.env.RESEARCH_HOME || ".research");
const models = { claude: { model: "haiku", effort: null }, codex: { model: "gpt-6-luna", effort: "high" } };
const only = process.argv.slice(2);
let failed = false;

for (const provider of only.length ? only : ["claude", "codex"]) {
  if (!executableOnPath(provider)) {
    console.log(`${provider}: not installed, skipped.`);
    continue;
  }
  const project = mkdtempSync(join(appHome, "live-helper-"));
  mkdirSync(join(project, "documents"), { recursive: true });
  const store = new WorkspaceStore(project, emptyGraph());
  writeFileSync(join(project, "documents", "doc-1"), "%PDF-");
  store.update((next) => {
    next.documents.push({ id: "doc-1", collectionId: "imports", name: "Fictional harbor ledger.pdf", mime: "application/pdf", size: 5, sha256: "x", importedAt: "2026-01-01T00:00:00Z", pages: 3, revision: 1, reading: { state: "done" }, text: "[Page 1]\nExample Mill opened in 1882.\n\n[Page 2]\nThe ledger names Ada Example as its owner.\n\n[Page 3]\nAda Example sold the mill to Ben Example in 1901." });
    (next.dataset.sources ||= []).push({ id: "doc-1", title: "Fictional harbor ledger" });
    next.researchSettings = { timeLimitMinutes: null, researchersPerBatch: 1 };
  });
  new ResearchLibrary(store, project).write();
  store.command({ type: "open-batch", title: "Who sold the Example mill", goal: "Find who sold the fictional Example mill.", scope: ["imports"] });
  const seat = store.state.investigations[0].assignments[0].id;
  const supervisor = new AgentSupervisor({ homes: agentHomes(appHome) });
  const dispatch = { choose: () => ({ agent: provider, ...models[provider] }) };
  const readers = new Readers(store, project, { supervisor, findExecutable: executableOnPath, dispatch });
  const notices = [];
  let jobs;
  const desk = new SessionDesk({ home: appHome, library: join(project, "library"), calls: { reader: (given, s) => jobs.reader(given, s.key) }, closed: (key) => readers.cancel(key) });
  jobs = new Jobs(store, project, { supervisor, sessions: desk, readers, dispatch, findExecutable: executableOnPath, notice: (to, text) => notices.push({ to, text }) });
  try {
    const started = Date.now();
    const handle = jobs.helper("In the saved document doc-1, find who sold the Example mill, to whom and when. Read it in your Python session, and ask a reader with weir.reader to confirm the page. Quote the sentence that says so.", seat);
    assert.deepEqual(handle, { id: "h1", status: "running" });
    const deadline = Date.now() + 8 * 60_000;
    while (!notices.length) {
      if (Date.now() > deadline) throw new Error("The helper had not answered after eight minutes.");
      await new Promise((done) => setTimeout(done, 500));
    }
    const shown = JSON.parse(readFileSync(join(project, "agents", store.state.investigations[0].id, seat, "session", "helpers", "h1.json"), "utf8"));
    console.log(`${provider}: answered in ${Math.round((Date.now() - started) / 1000)} s.\n  Notice: ${notices[0].text}\n  Answer: ${shown.answer}\n  Quotes: ${JSON.stringify(shown.quotes)}`);
    assert.equal(notices[0].to, seat);
    assert.match(notices[0].text, /^Helper h1 has answered/);
    assert.equal(shown.status, "answered");
    assert.match(shown.answer, /Ben Example/);
    assert.ok(shown.quotes.some((q) => q.document === "doc-1" && q.page === 3 && q.found), "a quote from page 3 that the saved text holds");
    assert.deepEqual(jobs.outstanding(seat), []);
    console.log(`${provider}: a helper does its errand in its own session and answers with a checked quote.`);
  } catch (error) {
    failed = true;
    console.error(`${provider}: FAILED: ${error.stack || error.message}`);
    console.error(`Kept for diagnosis: ${project}`);
    jobs.stop();
    desk.closeAll();
    readers.stop();
    continue;
  }
  jobs.stop();
  desk.closeAll();
  readers.stop();
  rmSync(project, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
