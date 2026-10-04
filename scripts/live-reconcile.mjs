// Live check, outside `npm run check`: a real model, on Claude Code and then on Codex,
// reconciles a scanned page of a fictional ledger. The page's picture says "to Ben
// Example in 1901."; the quote was checked against a reading that had "190l", and the
// new reading has the year right and the name wrong. The model looks at the picture,
// and the app corrects the text and the quote. It costs some model calls.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { AgentSupervisor } from "../server/agents/supervisor.mjs";
import { agentHomes } from "../server/agents/isolation.mjs";
import { SessionDesk } from "../server/python-session/desk.mjs";
import { executableOnPath } from "../server/researchers.mjs";
import { Jobs } from "../server/jobs.mjs";
import { Reconciler } from "../server/reconciler.mjs";
import { WorkspaceStore } from "../server/store.mjs";
import { ResearchLibrary } from "../server/research-library.mjs";
import { FindingPublisher } from "../server/finding-publisher.mjs";
import { fictionalPdf } from "../server/pdf/fictional-pdf.mjs";
import { reviseText } from "../src/domain/text-revisions.ts";
import { emptyGraph } from "../src/domain/graph-schema.ts";

const appHome = resolve(process.env.RESEARCH_HOME || ".research");
const models = { claude: { model: "sonnet", effort: null }, codex: { model: "gpt-6-luna", effort: "high" } };
const only = process.argv.slice(2);
let failed = false;
const first = "[Page 1]\nFictional Harbor Archive\nLedger of the Example Mill.\n\n[Page 2]\nAda Example sold the mill\nto Ben Example in 190l.";
const second = "[Page 1]\nFictional Harbor Archive\nLedger of the Example Mill.\n\n[Page 2]\nAda Example sold the mill\nto Ben Exarnple in 1901.";

for (const provider of only.length ? only : ["claude", "codex"]) {
  if (!executableOnPath(provider)) {
    console.log(`${provider}: not installed, skipped.`);
    continue;
  }
  const project = mkdtempSync(join(appHome, "live-reconcile-"));
  mkdirSync(join(project, "documents"), { recursive: true });
  const store = new WorkspaceStore(project, emptyGraph());
  writeFileSync(join(project, "documents", "ledger"), fictionalPdf([{ text: ["Fictional Harbor Archive", "Ledger of the Example Mill."] }, { scan: ["Ada Example sold the mill", "to Ben Example in 1901."] }]));
  store.update((next) => {
    next.documents.push({ id: "ledger", collectionId: "imports", name: "Fictional harbor ledger.pdf", mime: "application/pdf", size: 5, sha256: "x", importedAt: "2026-01-01T00:00:00Z", pages: 2, revision: 1, reading: { state: "done" }, text: first });
    (next.dataset.sources ||= []).push({ id: "ledger", title: "Fictional harbor ledger" });
    next.researchSettings = { timeLimitMinutes: null, researchersPerBatch: 1 };
  });
  const library = new ResearchLibrary(store, project);
  library.write();
  store.command({ type: "open-batch", title: "Who sold the Example mill", goal: "Find who sold the fictional Example mill.", scope: ["imports"] });
  const seat = store.state.investigations[0].assignments[0].id;
  const publisher = new FindingPublisher(store, { directory: project, published: () => library.write() });
  publisher.publish(seat, { statement: "The ledger dates the sale to Ben Example to 190l.", qualification: "reported", explanation: "As the ledger has it.", evidence: [{ document: "ledger", page: 2, quote: "to Ben Example in 190l.", interpretation: "The year of the sale." }] });
  const supervisor = new AgentSupervisor({ homes: agentHomes(appHome) });
  const desk = new SessionDesk({ home: appHome, library: join(project, "library"), calls: {} });
  const jobs = new Jobs(store, project, { supervisor, sessions: desk, dispatch: { choose: () => ({ agent: provider, ...models[provider] }) }, findExecutable: executableOnPath });
  const notices = [];
  const reconciler = new Reconciler(store, project, { jobs, written: () => library.write(), notify: (notice) => notices.push(notice) });
  try {
    const started = Date.now();
    // The document is read again.
    const { previous } = store.update((next) => reviseText(next, "ledger", second, { engine: "standard", at: new Date().toISOString() }));
    writeFileSync(join(project, "documents", `ledger.r${previous.revision}.txt`), previous.text);
    await reconciler.revised("ledger", 1);
    const doc = store.state.documents[0];
    const batch = store.state.investigations[0];
    const correction = doc.corrections[0];
    console.log(`${provider}: reconciled in ${Math.round((Date.now() - started) / 1000)} s.\n  Decision: ${correction.decision} (${correction.status}): ${correction.reason}\n  Text now: ${JSON.stringify(doc.text.split("[Page 2]\n")[1])}\n  Quote now: ${JSON.stringify(batch.proposals[0].evidence[0].quote)}\n  Findings: ${batch.proposals.map((p) => `${p.findings[0].status}: ${p.findings[0].statement}`).join(" | ")}\n  Notice: ${notices[0]?.text}`);
    assert.equal(correction.status, "reconciled");
    assert.match(doc.text, /to Ben Example in 1901\./, "the text has what the page says");
    assert.equal(batch.proposals[0].evidence[0].quote.includes("190l"), false, "the quote no longer has the misread year");
    assert.match(batch.proposals.at(-1).evidence[0].quote, /1901/);
    assert.equal(notices.length, 1);
    console.log(`${provider}: a misread scan is reconciled against the page's picture.`);
  } catch (error) {
    failed = true;
    console.error(`${provider}: FAILED: ${error.stack || error.message}`);
    console.error(`Kept for diagnosis: ${project}`);
    jobs.stop();
    desk.closeAll();
    continue;
  }
  jobs.stop();
  desk.closeAll();
  library.stop();
  rmSync(project, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
