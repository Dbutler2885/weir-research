// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceStore } from "../server/store.mjs";
import { FindingPublisher } from "../server/finding-publisher.mjs";
import { flowCommand, receiveDraft } from "../server/review-flow.mjs";
import { readDelivery } from "../src/domain/graph-delivery";
import { ResearchLibrary } from "../server/research-library.mjs";
import { PdfReading } from "../server/pdf/reading.mjs";
import { fictionalPdf } from "../server/pdf/fictional-pdf.mjs";
import { checkQuote, closestPassage, pagesOf } from "../src/domain/quotes";
import { draftFiles, emptyGraph, prepareResearch, returnDraft, tourFor } from "./fixtures/guided-flow";
import { until } from "./fixtures/until";

const cleanup: (() => void)[] = [];
afterEach(() =>
  cleanup
    .splice(0)
    .reverse()
    .forEach((c) => c()),
);

const LEDGER = "[Page 1]\nFictional Harbor Archive\nExample Trading Company was founded in 1842.\n\n[Page 2]\nAda Example sold the mill\nto Ben Example in 1901, for the sum of four hundred\n\n[Page 3]\nand twelve pounds. The deed was witnessed by Cy Example.";

// A fictional project with one batch, two seats, a three-page ledger and a transcribed image.
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "publishing-"));
  mkdirSync(join(directory, "documents"), { recursive: true });
  const store = new WorkspaceStore(directory, emptyGraph);
  store.update((next: any) => (next.researchSettings = { timeLimitMinutes: null, researchersPerBatch: 2 }));
  const { investigationId } = store.command({ type: "open-batch", title: "Who owned the Example mill", goal: "Find who owned the fictional mill, and when." }) as any;
  writeFileSync(join(directory, "documents", "ledger"), "fictional");
  store.update((next: any) => {
    next.documents.push({ id: "ledger", collectionId: "web", name: "Harbor ledger.pdf", mime: "application/pdf", size: 9, sha256: "x", importedAt: "2026-01-01T00:00:00Z", text: LEDGER, pages: 3, revision: 1, reading: { state: "done", engine: "standard" } });
    next.documents.push({ id: "plaque", collectionId: "web", name: "Mill plaque.png", mime: "image/png", size: 9, sha256: "y", importedAt: "2026-01-01T00:00:00Z", text: "Example Mill. Rebuilt 1911.", pages: 1, transcribed: true });
    (next.dataset.sources ||= []).push({ id: "ledger", title: "Harbor ledger" }, { id: "plaque", title: "Mill plaque" });
  });
  const library = new ResearchLibrary(store, directory);
  const publisher = new FindingPublisher(store, { directory, published: () => library.write() });
  cleanup.push(() => {
    library.stop();
    rmSync(directory, { recursive: true, force: true });
  });
  const batch = () => store.state.investigations.find((i: any) => i.id === investigationId) as any;
  const [one, two] = batch().assignments.map((a: any) => a.id) as [string, string];
  const sale = (page: number | [number, number] = 2, quote = "Ada Example sold the mill to Ben Example in 1901") => ({
    statement: "Ada Example sold the mill to Ben Example in 1901.",
    qualification: "supported",
    explanation: "The ledger records the sale.",
    evidence: [{ document: "ledger", ...(Array.isArray(page) ? { pages: page } : { page }), quote, interpretation: "A sale between the two." }],
  });
  const inLibrary = (path: string) => readFileSync(join(directory, "library", path), "utf8");
  return { directory, store, publisher, batch, one, two, sale, inLibrary, investigationId };
}

describe("checking a quote at its cited pages", () => {
  it("splits a document's text into its pages", () => {
    expect(pagesOf(LEDGER).map((p) => p.page)).toEqual([1, 2, 3]);
    expect(pagesOf(LEDGER)[2]!.text).toBe("and twelve pounds. The deed was witnessed by Cy Example.");
    expect(pagesOf("Plain text with no page marks.")).toEqual([{ page: 1, text: "Plain text with no page marks." }]);
  });
  it("finds a quote whatever its spacing and line breaks, and across a page break", () => {
    expect(checkQuote(LEDGER, 2, 2, "sold the  mill to\nBen Example")).toEqual({ found: true });
    expect(checkQuote(LEDGER, 2, 2, "for the sum of four hundred and twelve pounds")).toEqual({ found: true });
    expect(checkQuote(LEDGER, 2, 3, "four hundred and twelve pounds. The deed")).toEqual({ found: true });
  });
  it("says which page a real quote is on when the wrong page is cited", () => {
    expect(checkQuote(LEDGER, 1, 1, "Ada Example sold the mill")).toEqual({ found: false, reason: "The quote is not on page 1; it is on page 2. Cite the page it is on." });
    // Wholly on the next page is the wrong page, not a quote across the break.
    expect(checkQuote(LEDGER, 2, 2, "witnessed by Cy Example")).toMatchObject({ found: false, reason: expect.stringContaining("it is on page 3") });
    expect(checkQuote(LEDGER, 7, 7, "anything")).toEqual({ found: false, reason: "The document has no page 7; its pages run from 1 to 3." });
  });
  it("gives the nearest passage for a quote that is not in the text, and never passes a changed character", () => {
    const check = checkQuote(LEDGER, 2, 2, "Ada Example sold the mill to Ben Example in 1907");
    expect(check).toEqual({ found: false, reason: 'The quote does not appear on page 2 of the saved text. The nearest passage there is: "Ada Example sold the mill to Ben Example in 1901,". Quote the saved text exactly.' });
    expect(checkQuote("The balance was -100 pounds.", 1, 1, "The balance was 100 pounds.").found).toBe(false);
    expect(closestPassage("Nothing alike here.", "Zebra quartz")).toBe("");
  });
});

describe("publishing a finding", () => {
  it("publishes a finding whose quote is on its page, marked checked, for its seat and in the library at once", () => {
    const { publisher, batch, one, sale, inLibrary } = fixture();
    const receipt = publisher.publish(one, sale());
    const report = batch().proposals[0];
    expect(receipt).toEqual({ id: `${report.id}/f1`, statement: "Ada Example sold the mill to Ben Example in 1901.", evidence: [{ document: "ledger", pages: [2, 2], check: "checked" }] });
    expect(report).toMatchObject({ kind: "findings", status: "accepted", assignmentId: one });
    expect(report.findings[0]).toMatchObject({ status: "kept", qualification: "supported", evidenceIds: ["e1"] });
    expect(report.evidence[0]).toMatchObject({ sourceId: "ledger", documentId: "ledger", locator: "page 2", pages: [2, 2], check: "checked", revision: 1, stance: "supports" });
    expect(batch().findingsRevision).toBe(1);
    const page = inLibrary("batches/batch-1/findings.md");
    expect(page).toContain(`## Ada Example sold the mill to Ben Example in 1901.\n\nFinding ${receipt.id}, published by Researcher 1 on ${report.createdAt.slice(0, 10)}: supported.\n\nThe ledger records the sale.`);
    // The statement is said once, and nothing is said of a decision the human never made.
    expect(page.match(/Ada Example sold the mill to Ben Example in 1901\./g)).toHaveLength(1);
    expect(page).not.toMatch(/kept by the human|Report /);
    expect(page).toContain("The app found this quote at the page cited, in revision 1 of the saved text (documents/ledger.r1.txt).");
  });

  it("lists the batch's findings that stand, newest first, for a researcher about to publish", () => {
    const { publisher, one, two, sale } = fixture();
    expect(publisher.findings(one)).toEqual([]);
    const first = publisher.publish(one, sale());
    const founded = publisher.publish(two, { statement: "The company was founded in 1842.", qualification: "reported", explanation: "The archive's own account.", evidence: [{ document: "ledger", page: 1, quote: "Example Trading Company was founded in 1842.", interpretation: "The founding year." }] });
    expect(publisher.findings(one)).toEqual(publisher.findings(two));
    expect(publisher.findings(one)).toMatchObject([
      { id: founded.id, by: "Researcher 2", statement: "The company was founded in 1842.", qualification: "reported", evidence: [{ document: "ledger", pages: [1, 1], quote: "Example Trading Company was founded in 1842." }] },
      { id: first.id, by: "Researcher 1", statement: "Ada Example sold the mill to Ben Example in 1901.", qualification: "supported", explanation: "The ledger records the sale." },
    ]);
    // A replaced finding leaves the list, and its replacement says what it replaced.
    // The report's ID alone names its one finding.
    const fuller = publisher.publish(two, { ...sale(), statement: "Ada Example sold the mill to Ben Example in 1901, the ledger says.", replaces: first.id.split("/")[0] });
    expect(fuller.replaced).toBe(first.id);
    expect(publisher.findings(one).map((f: any) => [f.id, f.replaces])).toEqual([[fuller.id, first.id], [founded.id, undefined]]);
    expect(() => publisher.publish(one, { ...sale(), statement: "Another.", replaces: "no-such-report" })).toThrow("No finding no-such-report/f1 is published in this batch, so there is nothing to replace. weir.findings() lists the batch's findings with their IDs.");
    expect(() => publisher.findings("no-such-seat")).toThrow("This session's seat is in no batch.");
  });

  it("refuses a quote at the wrong page, or not in the text, saying why, and publishes nothing", () => {
    const { publisher, batch, one, sale } = fixture();
    expect(() => publisher.publish(one, sale(1))).toThrow("Evidence 1 was not found in ledger (Harbor ledger.pdf). The quote is not on page 1; it is on page 2. Cite the page it is on.");
    expect(() => publisher.publish(one, sale(2, "Ada Example sold the mill to Ben Example in 1907"))).toThrow('The nearest passage there is: "Ada Example sold the mill to Ben Example in 1901,".');
    expect(() => publisher.publish(one, { ...sale(), evidence: [] })).toThrow("Every finding needs evidence");
    expect(() => publisher.publish(one, { ...sale(), evidence: [{ document: "https://example.org/ledger", page: 1, quote: "x", interpretation: "y" }] })).toThrow("is not a saved document. Save the source first");
    expect(() => publisher.publish(one, { ...sale(), qualification: "probable" })).toThrow('The qualification is one of "supported"');
    expect(batch().proposals).toHaveLength(0);
    expect(batch().findingsRevision).toBeUndefined();
  });

  it("passes a quote across a page break, and marks evidence from a transcription as transcribed", () => {
    const { publisher, batch, one, sale } = fixture();
    publisher.publish(one, sale(2, "for the sum of four  hundred\nand twelve pounds"));
    const receipt = publisher.publish(one, { statement: "The mill was rebuilt in 1911.", qualification: "reported", explanation: "A plaque says so.", evidence: [{ document: "plaque", page: 1, quote: "Rebuilt 1911.", interpretation: "The plaque's date." }] });
    expect(receipt.evidence).toEqual([{ document: "plaque", pages: [1, 1], check: "transcribed" }]);
    expect(batch().proposals[1].evidence[0].check).toBe("transcribed");
  });

  it("lets any researcher replace a finding, once, and names the replacement to the second", () => {
    const { publisher, batch, one, two, sale } = fixture();
    const first = publisher.publish(one, sale());
    const better = { ...sale([2, 3], "to Ben Example in 1901, for the sum of four hundred and twelve pounds"), statement: "Ada Example sold the mill to Ben Example in 1901 for 412 pounds.", replaces: first.id };
    const second = publisher.publish(two, better);
    expect(second.replaced).toBe(first.id);
    expect(batch().proposals[0].findings[0].status).toBe("superseded");
    expect(batch().proposals[1].findings[0]).toMatchObject({ status: "kept", replaces: { proposalId: first.id.split("/")[0], findingId: "f1" } });
    expect(batch().findingsRevision).toBe(2);
    expect(() => publisher.publish(one, { ...sale(), statement: "Another correction.", replaces: first.id })).toThrow(
      `Finding ${first.id} was already replaced, by ${second.id}: "Ada Example sold the mill to Ben Example in 1901 for 412 pounds.". Replace that one instead.`,
    );
    expect(() => publisher.publish(one, { ...sale(), replaces: "nothing/f1" })).toThrow("No finding nothing/f1 is published in this batch");
    expect(batch().proposals).toHaveLength(2);
  });

  it("refuses the same finding from the same seat a second time, as when code is run again", () => {
    const { publisher, batch, one, two, sale } = fixture();
    const first = publisher.publish(one, sale());
    expect(() => publisher.publish(one, sale())).toThrow(`This finding was already published, as ${first.id}; it was not published again.`);
    expect(batch().proposals).toHaveLength(1);
    // A teammate reaching the same finding is another matter.
    publisher.publish(two, sale());
    expect(batch().proposals).toHaveLength(2);
  });
});

describe("graph work while findings change", () => {
  // A batch whose graph builder has been briefed, and a researcher who can still publish.
  function graphWork() {
    const directory = mkdtempSync(join(tmpdir(), "publishing-graph-"));
    cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
    const store = new WorkspaceStore(directory, emptyGraph);
    const research = prepareResearch(store);
    flowCommand(store, { action: "publish-walkthrough", ...research });
    const { jobId } = flowCommand(store, { action: "request-graph", investigationId: research.investigationId }, "human") as any;
    flowCommand(store, { action: "assign-graph", investigationId: research.investigationId, jobId, brief: "Represent the batch's findings." });
    store.update((next: any) => {
      next.documents.push({ id: "ledger", collectionId: "web", name: "Harbor ledger.pdf", mime: "application/pdf", size: 9, sha256: "x", importedAt: "2026-01-01T00:00:00Z", text: LEDGER, pages: 3, revision: 1 });
      (next.dataset.sources ||= []).push({ id: "ledger", title: "Harbor ledger" });
    });
    const batch = () => store.state.investigations[0] as any;
    const job = () => batch().reviewFlow.jobs[0];
    const seat = batch().assignments[0].id;
    const publisher = new FindingPublisher(store);
    const publish = (statement = "Ada Example sold the mill.") =>
      publisher.publish(seat, { statement, qualification: "supported", explanation: "The ledger records it.", evidence: [{ document: "ledger", page: 2, quote: "Ada Example sold the mill", interpretation: "A sale." }] });
    const command = (action: string, data: any = {}, actor = "coordinator") => flowCommand(store, { action, investigationId: research.investigationId, jobId, ...data }, actor);
    return { store, batch, job, publish, command, investigationId: research.investigationId };
  }

  it("sends the builder a graph update, with the findings as they stand, when a finding is published", () => {
    const { job, publish, batch } = graphWork();
    expect(job().packet.findingsRevision).toBe(0);
    const receipt = publish();
    expect(job().updates).toHaveLength(1);
    expect(job().updates[0]).toMatchObject({ from: "app", sequence: 1, message: expect.stringContaining(`A new finding was published, ${receipt.id}`) });
    expect(job().packet.findingsRevision).toBe(1);
    expect(Object.keys(job().packet.findings)).toContain(receipt.id);
    expect(batch().events.at(-1).message).toBe("The findings changed, so the graph builder was told.");
  });

  it("sends a returned draft back, and will not sign off a draft built from earlier findings", () => {
    const { store, job, publish, command, investigationId } = graphWork();
    returnDraft(store, investigationId);
    expect(job().status).toBe("returned");
    publish();
    expect(job().status).toBe("queued");
    expect(() => command("publish-graph-review", { tour: tourFor() })).toThrow("Inspect a completed graph draft first.");
    // The backstop: a returned draft whose findings revision is not the batch's.
    store.update((next: any) => (next.investigations[0].reviewFlow.jobs[0].status = "returned"));
    expect(() => command("publish-graph-review", { tour: tourFor() })).toThrow("This batch's findings changed after this draft was prepared. A revised draft is on its way and will replace it.");
    // The revised draft, built from the current findings, can be signed off.
    returnDraft(store, investigationId);
    expect(job().candidate.findingsRevision).toBe(1);
    command("publish-graph-review", { tour: tourFor() });
  });

  it("marks a draft the human is reviewing as being revised, and refuses to accept it", () => {
    const { store, batch, job, publish, command, investigationId } = graphWork();
    returnDraft(store, investigationId);
    const { graphReviewId } = command("publish-graph-review", { tour: tourFor() }) as any;
    publish();
    expect(batch().reviewFlow.graphReviews[0].revisingSince).toBeTruthy();
    expect(job().status).toBe("queued");
    expect(() => command("graph-accept", { graphReviewId }, "human")).toThrow("This draft is being revised.");
    // The backstop, were the mark missing.
    store.update((next: any) => delete next.investigations[0].reviewFlow.graphReviews[0].revisingSince);
    expect(() => command("graph-accept", { graphReviewId }, "human")).toThrow("This batch's findings changed after this draft was prepared.");
    // The revised draft replaces it and can be accepted.
    returnDraft(store, investigationId);
    const revised = command("publish-graph-review", { tour: tourFor() }) as any;
    expect(command("graph-accept", { graphReviewId: revised.graphReviewId }, "human")).toMatchObject({ accepted: true });
  });

  it("sends back a draft the builder wrote before the findings changed", () => {
    const { store, job, publish, investigationId } = graphWork();
    // The builder read its inputs, then a finding was published before it handed in.
    store.update((next: any) => (next.investigations[0].reviewFlow.jobs[0].status = "running"));
    const read = structuredClone(job());
    publish();
    const delivery = readDelivery({ ...draftFiles(read), "submission.txt": "done 1\n" }, read.baseDataset, { evidenceIds: Object.keys(read.packet.evidence), sourceIds: read.packet.sources.map((x: any) => x.id) });
    receiveDraft(store, investigationId, job().id, delivery, read.packet, "fictional");
    expect(job().status).toBe("queued");
    expect(job().candidate).toBeUndefined();
  });

  it("leaves a draft valid through a board post", () => {
    const { store, batch, job, command, investigationId } = graphWork();
    returnDraft(store, investigationId);
    store.command({ type: "coordinator-post", investigationId, text: "A note for the team." });
    expect(batch().findingsRevision).toBeUndefined();
    expect(job().updates).toHaveLength(0);
    const { graphReviewId } = command("publish-graph-review", { tour: tourFor() }) as any;
    expect(command("graph-accept", { graphReviewId }, "human")).toMatchObject({ accepted: true });
  });
});

describe("reading a cited document again", () => {
  it("keeps the earlier text as a revision, and a quote the new text words differently keeps its wording", async () => {
    const { directory, store, publisher, batch, one, inLibrary } = fixture();
    writeFileSync(join(directory, "documents", "ledger"), fictionalPdf([{ text: ["Fictional Harbor Archive", "Example Trading Company was founded in 1842."] }, { text: ["Ada Example sold the mill", "to Ben Example in 1901."] }]));
    // As an earlier reading gave it, with a misread year.
    const earlier = "[Page 1]\nFictional Harbor Archive\nExample Trading Company was founded in 1842.\n\n[Page 2]\nAda Example sold the mill\nto Ben Example in 190l.";
    store.update((next: any) => Object.assign(next.documents.find((d: any) => d.id === "ledger"), { text: earlier, reading: { state: "done", engine: "docling", at: "2025-09-01T00:00:00.000Z" } }));
    const quote = (text: string, page: number) => ({ statement: `The ledger says: ${text}`, qualification: "reported", explanation: "As the ledger has it.", evidence: [{ document: "ledger", page, quote: text, interpretation: "The ledger's words." }] });
    publisher.publish(one, quote("Example Trading Company was founded in 1842.", 1));
    publisher.publish(one, quote("to Ben Example in 190l.", 2));
    const home = join(directory, "app");
    mkdirSync(home);
    const reading = new PdfReading(store, { home, directory });
    cleanup.push(() => reading.stop());
    reading.readAgain(["ledger"]);
    const doc = () => store.state.documents.find((d: any) => d.id === "ledger") as any;
    await until(() => doc().reading?.state === "done", 60_000);
    expect(doc().revision).toBe(2);
    expect(doc().text).toContain("to Ben Example in 1901.");
    // The earlier text is recorded with the reader that made it and when, not the new reading's.
    expect(doc().textRevisions).toEqual([{ revision: 1, at: "2025-09-01T00:00:00.000Z", engine: "docling", pages: 3, size: earlier.length }]);
    expect(doc().conversion).toMatchObject({ engine: "standard", at: doc().reading.at });
    expect(readFileSync(join(directory, "documents", "ledger.r1.txt"), "utf8")).toBe(earlier);
    // The quote the new text still holds is checked against it; the other keeps its wording.
    const [founded, sold] = batch().proposals.map((p: any) => p.evidence[0]);
    expect(founded.revision).toBe(2);
    expect(sold).toMatchObject({ quote: "to Ben Example in 190l.", revision: 1 });
    expect(doc().corrections).toMatchObject([{ pages: [2, 2], wording: "to Ben Example in 190l.", fromRevision: 1, missingFrom: 2, evidence: `${batch().proposals[1].id}/e1`, status: "unreconciled" }]);
    // The library names the revision and keeps the earlier text.
    new (await import("../server/research-library.mjs")).ResearchLibrary(store, directory).stop();
    expect(inLibrary("documents/documents.csv").split("\n")[0]).toBe("id,name,collection,file,text,pages,url,saved,revision");
    // Each revision's text is a file of its own that never changes, so the text a
    // reader opens is the revision the list named.
    expect(inLibrary("documents/documents.csv")).toMatch(/^ledger,Harbor ledger\.pdf,web,documents\/ledger\.pdf,documents\/ledger\.r2\.txt,.*,2$/m);
    expect(inLibrary("documents/ledger.r1.txt")).toBe(earlier);
    expect(inLibrary("documents/ledger.r2.txt")).toBe(doc().text);
    expect(existsSync(join(directory, "library", "documents", "ledger.txt"))).toBe(false);
    // The findings say which revision each quote was checked in, and where that text is.
    const findings = inLibrary("batches/batch-1/findings.md");
    expect(findings).toContain("The app found this quote at the page cited, in revision 2 of the saved text (documents/ledger.r2.txt).");
    expect(findings).toContain("The app found this quote at the page cited, in revision 1 of the saved text (documents/ledger.r1.txt). The document has been read again since, and revision 2 (documents/ledger.r2.txt) words this passage differently; the quote keeps the wording it was checked in until the two are reconciled against the page.");
    // A quote from a variable read before says so, rather than only that it is not there.
    expect(() => publisher.publish(one, quote("Ada Example sold the mill to Ben Example in 190l.", 2))).toThrow(
      'Quote the saved text exactly. The quote does match revision 1 of the text (documents/ledger.r1.txt), but the document has been read again since. Read revision 2 (documents/ledger.r2.txt), which weir.library.read gives, and quote that.',
    );
    // Reading it again with the same result is not a new revision.
    reading.readAgain(["ledger"]);
    await until(() => doc().reading?.state === "done" && !existsSync(join(directory, "documents", "ledger.r2.txt")), 60_000);
    await new Promise((done) => setTimeout(done, 1500));
    expect(doc().revision).toBe(2);
    expect(doc().corrections).toHaveLength(1);
  }, 120_000);
});
