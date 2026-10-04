// Live check, outside `npm run check`: a real team of two researchers, on Claude Code
// and then on Codex, works a batch on a fictional library. They post to the board,
// publish findings from the saved document, and finish with the done phrase, so the
// batch reaches Review; a post from the coordinator then wakes them, and they finish
// again. It costs some model calls on the human's sign-ins.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { AgentSupervisor } from "../server/agents/supervisor.mjs";
import { agentHomes } from "../server/agents/isolation.mjs";
import { LiveActivity } from "../server/live-activity.mjs";
import { SessionDesk } from "../server/python-session/desk.mjs";
import { ResearcherPool, executableOnPath } from "../server/researchers.mjs";
import { WorkspaceStore } from "../server/store.mjs";
import { emptyGraph } from "../src/domain/graph-schema.ts";
import { ResearchLibrary } from "../server/research-library.mjs";
import { FindingPublisher } from "../server/finding-publisher.mjs";

const appHome = resolve(process.env.RESEARCH_HOME || ".research");
const models = { claude: { model: "haiku", effort: "low" }, codex: { model: "gpt-6-luna", effort: "low" } };
const only = process.argv.slice(2);
let failed = false;

for (const provider of only.length ? only : ["claude", "codex"]) {
  if (!executableOnPath(provider)) {
    console.log(`${provider}: not installed, skipped.`);
    continue;
  }
  const project = mkdtempSync(join(appHome, "live-team-"));
  mkdirSync(join(project, "documents"), { recursive: true });
  // A project whose library holds one fictional three-page document.
  const store = new WorkspaceStore(project, emptyGraph());
  writeFileSync(join(project, "documents", "doc-1"), "%PDF-");
  store.update((next) => {
    next.documents.push({ id: "doc-1", collectionId: "imports", name: "Fictional harbor ledger.pdf", mime: "application/pdf", size: 5, sha256: "x", importedAt: "2026-01-01T00:00:00Z", pages: 3, revision: 1, reading: { state: "done" }, text: "[Page 1]\nExample Mill opened in 1882.\n\n[Page 2]\nThe ledger names Ada Example as its owner.\n\n[Page 3]\nAda Example sold the mill to Ben Example in 1901." });
    (next.dataset.sources ||= []).push({ id: "doc-1", title: "Fictional harbor ledger" });
    next.researchSettings = { timeLimitMinutes: null, researchersPerBatch: 2 };
  });
  const files = new ResearchLibrary(store, project);
  const publisher = new FindingPublisher(store, { directory: project, published: () => files.write() });
  const live = new LiveActivity();
  const supervisor = new AgentSupervisor({ homes: agentHomes(appHome), live });
  let pool;
  const desk = new SessionDesk({
    home: appHome,
    library: join(project, "library"),
    calls: { publish: (given, seat) => publisher.publish(seat.key, given.finding), findings: (given, seat) => publisher.findings(seat.key), post: (given, seat) => pool.post(seat.key, given.text) },
  });
  pool = new ResearcherPool(store, project, resolve("."), { supervisor, live, sessions: desk });
  const batch = () => store.state.investigations[0];
  const statuses = () => batch().assignments.map((a) => a.status).join(", ");
  const review = async (what, minutes = 8) => {
    const deadline = Date.now() + minutes * 60_000;
    while (batch().status !== "review") {
      if (Date.now() > deadline) throw new Error(`${what}: the team had not finished after ${minutes} minutes (${statuses()}).`);
      await new Promise((done) => setTimeout(done, 500));
    }
  };
  const statements = () => batch().proposals.flatMap((p) => p.findings.filter((f) => f.status !== "superseded").map((f) => f.statement));
  try {
    store.command({
      type: "open-batch",
      title: "Who sold the Example mill",
      goal: "From the project's saved documents only, find who sold the fictional Example mill, to whom, and in what year.",
      scope: ["imports"],
      choice: { engine: provider, ...models[provider] },
    });
    pool.pump();
    await review("First pass");
    console.log(`${provider}: the batch reached Review. Board:\n${(batch().board || []).map((p) => `  ${batch().assignments.find((a) => a.id === p.assignmentId)?.title}: ${p.text}`).join("\n")}`);
    console.log(`${provider}: findings:\n${statements().map((s) => `  ${s}`).join("\n")}`);
    assert.ok((batch().board || []).length >= 1, "the team posted to the board");
    assert.ok(statements().some((s) => /1901/.test(s)), "a finding gives the year of the sale");
    assert.ok(batch().proposals.every((p) => p.evidence.every((e) => e.check === "checked")), "every quote was checked against the saved document");
    assert.deepEqual(batch().assignments.map((a) => a.status), ["finished", "finished"], "both researchers said the done phrase");
    assert.match(readFileSync(join(project, "library", "batches", "batch-1", "findings.md"), "utf8"), /1901/, "the findings are in the library");
    // The human says keep going; the coordinator's post wakes the whole team.
    const before = statements().length;
    pool.announce(batch().id, "The human also wants to know the year the mill opened. Publish it as a finding if the saved document says.");
    assert.equal(batch().status, "running", "the post took the batch out of Review");
    await review("After the coordinator's post");
    console.log(`${provider}: after the post, findings:\n${statements().map((s) => `  ${s}`).join("\n")}`);
    assert.ok(statements().length > before && statements().some((s) => /1882/.test(s)), "the woken team published the year the mill opened");
    assert.ok(batch().assignments.every((a) => a.session), "each researcher kept its conversation");
    console.log(`${provider}: passed.`);
  } catch (error) {
    failed = true;
    console.log(`${provider}: FAILED: ${error.message}`);
    console.log(`Seats: ${statuses()}. Events:\n${batch()?.events.map((e) => `  ${e.message}`).join("\n")}`);
  } finally {
    pool.stop();
    files.stop();
    await new Promise((done) => setTimeout(done, 1500));
    rmSync(project, { recursive: true, force: true, maxRetries: 5 });
  }
}
process.exit(failed ? 1 : 0);
