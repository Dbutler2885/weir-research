// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyGraph } from "../src/domain/graph-schema";
import { reviseText } from "../src/domain/text-revisions";
import { reuseCorrections } from "../src/domain/reconciliation";
import { WorkspaceStore } from "../server/store.mjs";
import { ResearchLibrary } from "../server/research-library.mjs";
import { FindingPublisher } from "../server/finding-publisher.mjs";
import { PdfReading } from "../server/pdf/reading.mjs";
import { fictionalPdf } from "../server/pdf/fictional-pdf.mjs";
import { Reconciler, seatsAtWork } from "../server/reconciler.mjs";
import { until } from "./fixtures/until";

const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).reverse().forEach((c) => c()));

// A fictional ledger of four pages, as its first reading gave it: the year on page 2
// and a name on page 3 misread.
const page = (n: number, text: string) => `[Page ${n}]\n${text}`;
const FIRST = [page(1, "Fictional Harbor Archive\nExample Trading Company was founded in 1842."), page(2, "Ada Example sold the mill\nto Ben Example in 190l."), page(3, "Cora Exarnple kept the ledger."), page(4, "Dan Example, witness.")].join("\n\n");
// A second reading: the year on page 2 now right, the founding year on page 1 misread,
// the name on page 3 misread another way, and the witness on page 4 misread.
const SECOND = [page(1, "Fictional Harbor Archive\nExample Trading Company was founded in 1B42."), page(2, "Ada Example sold the mill\nto Ben Example in 1901."), page(3, "Cora Exmple kept the ledger."), page(4, "Dan Examp1e, witness.")].join("\n\n");

function fixture({ picture }: { picture?: any } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "reconciliation-"));
  mkdirSync(join(directory, "documents"), { recursive: true });
  const store = new WorkspaceStore(directory, emptyGraph());
  store.update((next: any) => (next.researchSettings = { timeLimitMinutes: null, researchersPerBatch: 2 }));
  const { investigationId } = store.command({ type: "open-batch", title: "Who owned the Example mill", goal: "Find who owned the fictional mill, and when." }) as any;
  writeFileSync(join(directory, "documents", "ledger"), fictionalPdf([{ text: ["Fictional Harbor Archive", "Example Trading Company was founded in 1842."] }, { text: ["Ada Example sold the mill", "to Ben Example in 1901."] }, { text: ["Cora Example kept the ledger."] }, { text: ["Dan Example, witness."] }]));
  store.update((next: any) => {
    next.documents.push({ id: "ledger", collectionId: "web", name: "Harbor ledger.pdf", mime: "application/pdf", size: 9, sha256: "x", importedAt: "2026-01-01T00:00:00Z", text: FIRST, pages: 4, revision: 1, reading: { state: "done", engine: "standard" } });
    (next.dataset.sources ||= []).push({ id: "ledger", title: "Harbor ledger" });
  });
  const library = new ResearchLibrary(store, directory);
  const publisher = new FindingPublisher(store, { directory, published: () => library.write() });
  cleanup.push(() => {
    library.stop();
    rmSync(directory, { recursive: true, force: true });
  });
  const batch = () => store.state.investigations.find((i: any) => i.id === investigationId) as any;
  const doc = () => store.state.documents.find((d: any) => d.id === "ledger") as any;
  const [one] = batch().assignments.map((a: any) => a.id) as [string];
  const publish = (pageNumber: number, quote: string, statement: string) =>
    publisher.publish(one, { statement, qualification: "supported", explanation: "As the ledger has it.", evidence: [{ document: "ledger", page: pageNumber, quote, interpretation: "The ledger's words." }] }).id as string;
  // The model's stand-in: what it was given for each page, and the reply the test gives.
  const tasks: any[] = [];
  const replies = new Map<number, unknown>();
  const jobs = {
    async task(spec: any) {
      const folder = join(spec.folder, "agent-1");
      spec.prepare(folder);
      const given = JSON.parse(readFileSync(join(folder, "task.json"), "utf8"));
      tasks.push({ spec, folder, given, current: readFileSync(join(folder, "current.txt"), "utf8"), earlier: readFileSync(join(folder, "earlier.txt"), "utf8") });
      const reply = replies.get(given.page);
      if (reply instanceof Error) throw reply;
      return typeof reply === "string" ? reply : JSON.stringify(reply ?? { quotes: [], corrections: [] });
    },
  };
  const notices: any[] = [];
  const reconciler = new Reconciler(store, directory, { jobs, written: () => library.write(), notify: (notice: any) => notices.push(notice), ...(picture === undefined ? { picture: () => "page.png" } : picture ? { picture } : {}) });
  // The document is read again, with this result.
  const reread = (text: string) => {
    const from = doc().revision;
    const { previous } = store.update((next: any) => reviseText(next, "ledger", text, { engine: "standard", at: new Date().toISOString() })) as any;
    if (previous) writeFileSync(join(directory, "documents", `ledger.r${previous.revision}.txt`), previous.text);
    return reconciler.revised("ledger", from);
  };
  const evidenceOf = (findingId: string) => batch().proposals.find((p: any) => p.id === findingId.split("/")[0]).evidence[0];
  const inLibrary = (path: string) => readFileSync(join(directory, "library", path), "utf8");
  return { directory, store, batch, doc, one, publish, tasks, replies, notices, reconciler, reread, evidenceOf, inLibrary, publisher };
}

// The four findings, and the model's decision about each page's quote.
function fourQuotes(f: ReturnType<typeof fixture>) {
  const founded = f.publish(1, "Example Trading Company was founded in 1842.", "The company was founded in 1842.");
  const sold = f.publish(2, "to Ben Example in 190l.", "The ledger dates the sale to Ben Example to 190l.");
  const kept = f.publish(3, "Cora Exarnple kept the ledger.", "Cora Exarnple kept the ledger.");
  const witness = f.publish(4, "Dan Example, witness.", "Dan Example witnessed it.");
  const ref = (id: string) => `${id.split("/")[0]}/e1`;
  f.replies.set(1, { quotes: [{ evidence: ref(founded), decision: "old", replaces: "1B42.", wording: "1842.", reason: "The page reads 1842; the 8 was misread as B.", finding: null }], corrections: [] });
  f.replies.set(2, {
    quotes: [{ evidence: ref(sold), decision: "new", quote: "to Ben Example in 1901.", reason: "The page reads 1901; the final 1 had been misread as l.", finding: { statement: "The ledger dates the sale to Ben Example to 1901.", explanation: "As the ledger has it.", qualification: "supported" } }],
    corrections: [],
  });
  f.replies.set(3, { quotes: [{ evidence: ref(kept), decision: "transcribed", replaces: "Cora Exmple kept the ledger.", wording: "Cora Example kept the ledger.", quote: "Cora Example kept the ledger.", reason: "The page reads Example; both readings misread it.", finding: null }], corrections: [] });
  f.replies.set(4, { quotes: [{ evidence: ref(witness), decision: "unsettled", reason: "The page is too faint there to tell.", finding: null }], corrections: [] });
  return { founded, sold, kept, witness, ref };
}

describe("a document read again, with quotes its new text words differently", () => {
  it("is reconciled without the human: one job for each affected page, given the page's texts, its picture, the quotes and their findings", async () => {
    const f = fixture({ picture: null });
    const q = fourQuotes(f);
    await f.reread(SECOND);
    expect(f.tasks.map((t) => t.given.page).sort()).toEqual([1, 2, 3, 4]);
    const second = f.tasks.find((t) => t.given.page === 2);
    expect(second.given).toEqual({
      document: { id: "ledger", name: "Harbor ledger.pdf", revision: 2 },
      page: 2,
      picture: "page.png",
      quotes: [{ evidence: q.ref(q.sold), quote: "to Ben Example in 190l.", checkedInRevision: 1, pages: [2, 2], interpretation: "The ledger's words.", finding: { statement: "The ledger dates the sale to Ben Example to 190l.", explanation: "As the ledger has it.", qualification: "supported" } }],
      earlierCorrections: [],
    });
    expect(second.current).toBe("Ada Example sold the mill\nto Ben Example in 1901.");
    expect(second.earlier).toBe("Ada Example sold the mill\nto Ben Example in 190l.");
    // The page itself, drawn from the PDF, is in the job's folder.
    expect(readFileSync(join(second.folder, "page.png")).subarray(1, 4).toString()).toBe("PNG");
    expect(second.spec.instructions).toContain("Look at it: it is the page itself");
  }, 60_000);

  it("keeps the right wording, corrects the text, updates the quote or transcribes the passage, as one corrected revision", async () => {
    const f = fixture();
    const q = fourQuotes(f);
    await f.reread(SECOND);
    // One corrected revision after the reading's own.
    expect(f.doc().revision).toBe(3);
    expect(f.doc().text).toBe([page(1, "Fictional Harbor Archive\nExample Trading Company was founded in 1842."), page(2, "Ada Example sold the mill\nto Ben Example in 1901."), page(3, "Cora Example kept the ledger."), page(4, "Dan Examp1e, witness.")].join("\n\n"));
    expect(f.doc().conversion.engine).toBe("reconciliation");
    // The reading's own text is kept as its own revision.
    expect(readFileSync(join(f.directory, "documents", "ledger.r2.txt"), "utf8")).toBe(SECOND);
    // The earlier wording was right: the quote stands, now found in the corrected text.
    expect(f.evidenceOf(q.founded)).toMatchObject({ quote: "Example Trading Company was founded in 1842.", revision: 3 });
    // The new reading was right: the quote takes its wording.
    expect(f.evidenceOf(q.sold)).toMatchObject({ quote: "to Ben Example in 1901.", revision: 3 });
    // Neither was: the passage was transcribed, and the quote follows it.
    expect(f.evidenceOf(q.kept)).toMatchObject({ quote: "Cora Example kept the ledger.", revision: 3 });
    // The page did not settle it: the quote keeps its wording and the revision it was checked in.
    expect(f.evidenceOf(q.witness)).toMatchObject({ quote: "Dan Example, witness.", revision: 1 });
  });

  it("records each decision with its page, the wording before and after, and the reason", async () => {
    const f = fixture();
    const q = fourQuotes(f);
    await f.reread(SECOND);
    const by = (id: string) => f.doc().corrections.find((c: any) => c.evidence === q.ref(id));
    expect(by(q.founded)).toMatchObject({
      status: "reconciled",
      decision: "old",
      pages: [1, 1],
      reason: "The page reads 1842; the 8 was misread as B.",
      fix: { page: 1, before: "1B42.", after: "1842.", context: { before: expect.stringContaining("Example Trading Company was founded in ") } },
      appliedIn: 3,
    });
    expect(by(q.sold)).toMatchObject({ status: "reconciled", decision: "new", quote: { before: "to Ben Example in 190l.", after: "to Ben Example in 1901." }, reason: "The page reads 1901; the final 1 had been misread as l." });
    expect(by(q.sold).fix).toBeUndefined();
    expect(by(q.kept)).toMatchObject({ status: "reconciled", decision: "transcribed", fix: { page: 3, before: "Cora Exmple kept the ledger.", after: "Cora Example kept the ledger." }, quote: { before: "Cora Exarnple kept the ledger.", after: "Cora Example kept the ledger." } });
    expect(by(q.witness)).toMatchObject({ status: "unsettled", decision: "unsettled", reason: "The page is too faint there to tell. The quote keeps the wording it was checked against." });
    // The library lists them for a researcher's session to read.
    const listed = JSON.parse(f.inLibrary("documents/corrections.json")).ledger;
    expect(listed).toHaveLength(4);
    expect(listed.find((c: any) => c.decision === "transcribed")).toMatchObject({ pages: [3, 3], status: "reconciled", text: { page: 3, before: "Cora Exmple kept the ledger.", after: "Cora Example kept the ledger." }, revision: 3 });
    expect(f.inLibrary("documents/ledger.r3.txt")).toBe(f.doc().text);
  });

  it("replaces a finding whose meaning the change alters, and leaves the others", async () => {
    const f = fixture();
    const q = fourQuotes(f);
    const before = f.batch().findingsRevision;
    await f.reread(SECOND);
    const [proposalId] = q.sold.split("/");
    expect(f.batch().proposals.find((p: any) => p.id === proposalId).findings[0].status).toBe("superseded");
    const replacement = f.batch().proposals.at(-1);
    expect(replacement).toMatchObject({ title: "The ledger dates the sale to Ben Example to 1901.", status: "accepted", assignmentId: f.one });
    expect(replacement.findings[0]).toMatchObject({ statement: "The ledger dates the sale to Ben Example to 1901.", status: "kept", replaces: { proposalId, findingId: "f1" } });
    expect(replacement.evidence[0]).toMatchObject({ quote: "to Ben Example in 1901.", revision: 3 });
    expect(f.batch().findingsRevision).toBe(before + 1);
    expect(f.doc().corrections.find((c: any) => c.evidence === q.ref(q.sold)).finding).toEqual({ replaced: q.sold, by: `${replacement.id}/f1` });
    // The finding whose quote was only transcribed still says what the page shows, and stays.
    expect(f.batch().proposals.filter((p: any) => p.findings[0].status === "superseded")).toHaveLength(1);
    expect(f.inLibrary("batches/batch-1/findings.md")).toContain("The ledger dates the sale to Ben Example to 1901.");
  });

  it("tells the researchers at work in one line, naming the document, both revisions and where the details are", async () => {
    const f = fixture();
    fourQuotes(f);
    await f.reread(SECOND);
    expect(f.notices).toHaveLength(1);
    expect(f.notices[0]).toMatchObject({ from: 1, to: 3, reconciled: 4 });
    expect(f.notices[0].text).toBe('"Harbor ledger.pdf" (ledger) has a new text: revision 3, where it was revision 1; 4 passages were reconciled against the page. weir.library.corrections("ledger") lists what changed, and weir.library.read gives the text as it is now.');
    // Seats that are running or paused are told; one that has finished is not woken for it.
    f.store.update((next: any) => (next.investigations[0].assignments[0].status = "running"));
    f.store.update((next: any) => (next.investigations[0].assignments[1].status = "finished"));
    expect(seatsAtWork(f.store.state)).toEqual([f.one]);
  });

  it("tells them of a new text that broke no quote, too", async () => {
    const f = fixture();
    f.publish(1, "Fictional Harbor Archive", "It is the harbor archive's.");
    await f.reread(FIRST.replace("190l", "1901"));
    expect(f.tasks).toEqual([]);
    expect(f.notices.map((n) => n.text)).toEqual(['"Harbor ledger.pdf" (ledger) has a new text: revision 2, where it was revision 1. weir.library.corrections("ledger") lists what changed, and weir.library.read gives the text as it is now.']);
  });
});

describe("a correction, when the document is read yet again", () => {
  it("is put back where its place still matches, with no job, and placed again where it does not", async () => {
    const f = fixture();
    const q = fourQuotes(f);
    await f.reread(SECOND);
    const jobs = f.tasks.length;
    // A third reading gives the second's text again: the same misreadings, in the same places.
    await f.reread(SECOND);
    expect(f.tasks).toHaveLength(jobs);
    // Revision 4 is the reading, and revision 5 the reading with its corrections put back.
    expect(f.doc().revision).toBe(5);
    expect(f.doc().conversion.engine).toBe("corrections");
    expect(f.doc().text).toContain("founded in 1842.");
    expect(f.doc().text).toContain("Cora Example kept the ledger.");
    expect(f.evidenceOf(q.founded).revision).toBe(5);
    expect(f.notices.at(-1).text).toContain("has a new text: revision 5, where it was revision 3; 2 earlier corrections were put back.");
    // A fourth reading misreads the founding year another way: the correction's place is gone.
    const third = SECOND.replace("founded in 1B42.", "founded in l842.");
    expect(reuseCorrections(f.doc(), third)!.reused).toHaveLength(1);
    f.replies.set(1, { quotes: [{ evidence: q.ref(q.founded), decision: "old", replaces: "l842.", wording: "1842.", reason: "The page reads 1842.", finding: null }], corrections: [] });
    await f.reread(third);
    expect(f.tasks).toHaveLength(jobs + 1);
    // The job is given the corrections made to the page before.
    expect(f.tasks.at(-1).given.earlierCorrections).toEqual([{ decision: "old", before: "1B42.", after: "1842.", reason: "The page reads 1842; the 8 was misread as B." }]);
    expect(f.doc().text).toContain("founded in 1842.");
    expect(f.doc().text).toContain("Cora Example kept the ledger.");
    expect(f.evidenceOf(q.founded)).toMatchObject({ quote: "Example Trading Company was founded in 1842.", revision: f.doc().revision });
  });
});

describe("a decision the app cannot bear out", () => {
  it("is not applied: the quote keeps its wording, and the record says why", async () => {
    const f = fixture();
    const q = fourQuotes(f);
    // Words that are not in the new reading; a new wording that is not on the page; a job that failed; a quote passed over.
    f.replies.set(1, { quotes: [{ evidence: q.ref(q.founded), decision: "old", replaces: "1742.", wording: "1842.", reason: "It reads 1842.", finding: null }], corrections: [] });
    f.replies.set(2, { quotes: [{ evidence: q.ref(q.sold), decision: "new", quote: "to Ben Example in 1911.", reason: "It reads 1911.", finding: null }], corrections: [] });
    f.replies.set(3, new Error("its turn ended with an error"));
    f.replies.set(4, { quotes: [], corrections: [] });
    await f.reread(SECOND);
    expect(f.doc().revision).toBe(2);
    expect(f.doc().text).toBe(SECOND);
    const by = (id: string) => f.doc().corrections.find((c: any) => c.evidence === q.ref(id));
    expect(by(q.founded)).toMatchObject({ status: "unsettled", reason: "The reconciliation kept the earlier wording without naming words of the new reading that it replaces, in one place on the page. The quote keeps the wording it was checked against." });
    expect(by(q.sold)).toMatchObject({ status: "unsettled", reason: "The wording the reconciliation gave for the quote is not in the text at the pages cited. The quote keeps the wording it was checked against." });
    expect(by(q.kept)).toMatchObject({ status: "unsettled", reason: "The reconciliation could not be completed: its turn ended with an error. The quote keeps the wording it was checked against." });
    expect(by(q.witness)).toMatchObject({ status: "unsettled", reason: "The reconciliation gave no decision for this quote. The quote keeps the wording it was checked against." });
    expect(f.evidenceOf(q.sold)).toMatchObject({ quote: "to Ben Example in 190l.", revision: 1 });
    expect(f.batch().proposals).toHaveLength(4);
  });
  it("does not put a whole quote where a few wrong words were named, which would repeat the rest of it", async () => {
    const f = fixture();
    const q = fourQuotes(f);
    f.replies.set(1, { quotes: [{ evidence: q.ref(q.founded), decision: "old", replaces: "1B42.", reason: "It reads 1842.", finding: null }], corrections: [] });
    await f.reread(SECOND);
    expect(f.doc().text).toContain("Example Trading Company was founded in 1B42.");
    expect(f.doc().corrections.find((c: any) => c.evidence === q.ref(q.founded)).status).toBe("unsettled");
    // Named in full, the earlier wording goes back as it was.
    const g = fixture();
    const r = fourQuotes(g);
    g.replies.set(1, { quotes: [{ evidence: r.ref(r.founded), decision: "old", replaces: "Example Trading Company was founded in 1B42.", reason: "It reads 1842.", finding: null }], corrections: [] });
    await g.reread(SECOND);
    expect(g.doc().text).toContain("Fictional Harbor Archive\nExample Trading Company was founded in 1842.\n");
  });
  it("does not replace a finding in a closed batch, and says what it should now read", async () => {
    const f = fixture();
    const q = fourQuotes(f);
    f.store.update((next: any) => Object.assign(next.investigations[0], { status: "closed", closedAt: new Date().toISOString() }));
    await f.reread(SECOND);
    expect(f.batch().proposals).toHaveLength(4);
    expect(f.evidenceOf(q.sold).quote).toBe("to Ben Example in 1901.");
    expect(f.doc().corrections.find((c: any) => c.evidence === q.ref(q.sold)).finding).toEqual({ replaced: q.sold, note: "Its batch is closed, so the finding was not replaced. It should now read: The ledger dates the sale to Ben Example to 1901." });
  });
});

describe("corrections left waiting", () => {
  it("are settled when the app opens: those slice 03 left marked as not yet reconciled", async () => {
    const f = fixture();
    const q = fourQuotes(f);
    // As before reconciliation existed: the new text arrived and nothing reconciled it.
    f.store.update((next: any) => reviseText(next, "ledger", SECOND, { engine: "standard" }));
    expect(f.doc().corrections.map((c: any) => c.status)).toEqual(["unreconciled", "unreconciled", "unreconciled", "unreconciled"]);
    f.reconciler.recover();
    await until(() => f.doc().corrections.every((c: any) => c.status !== "unreconciled"));
    expect(f.doc().text).toContain("founded in 1842.");
    expect(f.evidenceOf(q.sold).quote).toBe("to Ben Example in 1901.");
  });
});

describe("a researcher who notices a problem in a document's text", () => {
  it("can ask for the page to be checked: the text is corrected as a new revision, and the team is told", async () => {
    const f = fixture();
    f.replies.set(4, { quotes: [], corrections: [{ replaces: "Dan Example, witness.", wording: "Dan Example, witness, of Example Harbor.", reason: "The page has three more words at the end of the line." }] });
    expect(f.reconciler.request({ document: "ledger", page: 4, problem: "The line looks cut short: 'Dan Example, witness.'" })).toEqual({ started: true, document: "ledger", page: 4 });
    await until(() => f.doc().revision === 2);
    expect(f.tasks[0].given).toMatchObject({ page: 4, problem: "The line looks cut short: 'Dan Example, witness.'", quotes: [] });
    expect(f.doc().text).toContain("Dan Example, witness, of Example Harbor.");
    expect(f.doc().corrections).toMatchObject([{ status: "reconciled", decision: "transcribed", pages: [4, 4], fix: { page: 4, before: "Dan Example, witness.", after: "Dan Example, witness, of Example Harbor." }, reason: "The page has three more words at the end of the line.", appliedIn: 2 }]);
    await until(() => f.notices.length === 1);
    expect(f.notices[0].text).toContain("has a new text: revision 2, where it was revision 1; 1 passage was reconciled against the page.");
  });
  it("is told what to give when the document, the page or the problem is missing", () => {
    const f = fixture();
    expect(() => f.reconciler.request({ document: "nothing", page: 1, problem: "x" })).toThrow('No saved document has the ID "nothing".');
    expect(() => f.reconciler.request({ document: "ledger", page: 9, problem: "x" })).toThrow("Document ledger has no page 9.");
    expect(() => f.reconciler.request({ document: "ledger", page: 1, problem: " " })).toThrow("Say what is wrong with the text");
  });
});

describe("reading a PDF again", () => {
  it("hands a changed text to reconciliation, with the revision it had", async () => {
    const f = fixture();
    const q = fourQuotes(f);
    const home = join(f.directory, "app");
    mkdirSync(home);
    const revised: unknown[] = [];
    const reading = new PdfReading(f.store, { home, directory: f.directory, revised: (id: string, from: number) => (revised.push([id, from]), f.reconciler.revised(id, from)) });
    cleanup.push(() => reading.stop());
    reading.readAgain(["ledger"]);
    await until(() => revised.length === 1 && f.doc().corrections?.every((c: any) => c.status !== "unreconciled"), 60_000);
    expect(revised).toEqual([["ledger", 1]]);
    // The real reading has the page's own words, so the misread quotes are the ones reconciled.
    expect(existsSync(join(f.directory, "documents", "ledger.r1.txt"))).toBe(true);
    expect(f.tasks.map((t) => t.given.page).sort()).toEqual([2, 3]);
    expect(f.evidenceOf(q.founded).revision).toBe(2);
  }, 120_000);
});
