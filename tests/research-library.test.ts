// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initialState, transition, type ResearchCommand, type ResearchState } from "../src/domain/research";
import { publishFinding } from "../src/domain/publish";
import { emptyGraph } from "../src/domain/graph-schema";
import { libraryFiles, writeLibrary } from "../server/research-library.mjs";

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((clean) => clean()));

// A fictional project: a batch from before teams, kept as history, with one published
// research pass; a batch worked by a team of two, with a goal, board posts, a finding
// published from a saved PDF and one from a transcribed image, a checkpoint and a
// walkthrough; and the human's conversation.
function project() {
  let state: ResearchState = initialState({
    ...emptyGraph(),
    title: "The fictional Harbour Mill",
    nodes: [{ id: "mill", name: "Harbour Mill", type: "place", summary: "A fictional mill." }],
    types: [{ name: "place", fields: [] }],
    sources: [{ id: "register", title: "Fictional lease register", repository: "County archive" }],
  } as never);
  const run = (command: ResearchCommand): any => {
    const out = transition(state, command);
    state = out.state;
    return out.result;
  };
  run({ type: "send", text: "Private words from the human about the mill." });
  run({ type: "send", annotation: { question: "A private annotation on the mill.", references: [] } });
  // The batch from before teams, as an older version of the app saved it.
  state.investigations.push({
    id: "old-batch",
    number: 1,
    title: "Who ran the mill",
    brief: { purpose: "Who ran the fictional mill after 1880.", scope: "Leases and directories only.", direction: "Leases first.", updatedAt: "2026-01-01T00:00:00Z" },
    createdAt: "2026-01-01T00:00:00Z",
    status: "review",
    scope: ["web", "imports"],
    annotations: [],
    events: [],
    board: [{ id: "b", at: "2026-01-02T10:00:00Z", assignmentId: "leases", text: "Kelly's 1889 is not online." }],
    assignments: [
      {
        id: "leases",
        title: "Lease registers",
        brief: "Read the lease registers; finding f-17 in batch 1 is the one to test.",
        status: "done",
        createdAt: "2026-01-01T00:00:00Z",
        checkpoints: [{ id: "c", at: "2026-01-02T09:00:00Z", worker: "Codex researcher", summary: "Volume 4 read", findings: "Lease to Holloway in 1881", nextSteps: "Volume 5" }],
        steering: [{ at: "2026-01-02T09:30:00Z", message: "Look for Ann Pryce too." }],
      },
    ],
    proposals: [
      {
        kind: "findings",
        id: "old-report",
        revision: 1,
        title: "Leases 1880 to 1895",
        summary: "Two lessees.",
        ambiguity: "The 1889 page is missing.",
        changes: [],
        addressedAnnotationIds: [],
        assignmentId: "leases",
        createdAt: "2026-01-03T00:00:00Z",
        status: "accepted",
        evidence: [{ id: "e1", sourceId: "register", quote: "Lease renewed to Thomas Holloway, miller.", context: "Register entry", locator: "vol. 4, folio 112", interpretation: "A renewal.", stance: "supports" }],
        findings: [{ id: "f1", statement: "Holloway renewed the lease in 1881.", qualification: "supported", explanation: "The renewal is entered in full.", evidenceIds: ["e1"] }],
      },
    ],
  });
  state.documents.push({ id: "doc-1", collectionId: "imports", name: "Deed.PDF", mime: "application/pdf", size: 4, sha256: "x", importedAt: "t", text: "[Page 1]\nThe deed of the mill.\n\n[Page 2]\nSold to Ann Pryce, corn dealer, in 1896.", pages: 2, revision: 1 });
  state.documents.push({ id: "plaque", collectionId: "web", name: "Mill plaque.png", mime: "image/png", size: 4, sha256: "y", importedAt: "t", text: "Harbour Mill. Rebuilt 1911.", pages: 1, transcribed: true });
  // The team's batch.
  state.researchSettings = { timeLimitMinutes: null, researchersPerBatch: 2 };
  const { investigationId } = run({ type: "open-batch", title: "Who bought the mill", goal: "Find who bought the fictional Harbour Mill after the Holloways, and when." });
  const [first, second] = state.investigations[1]!.assignments!.map((a) => a.id);
  const claim = (assignmentId: string) => run({ type: "claim", investigationId, assignmentId, worker: "Codex researcher" }).assignment.lease.token;
  const token = claim(first!);
  claim(second!);
  run({ type: "checkpoint", investigationId, token, summary: "The deed read", findings: "Sale to Pryce in 1896", nextSteps: "The directories" });
  run({ type: "post", assignmentId: first, text: "I am taking the deeds; the directories are open.", key: "k1" });
  run({ type: "coordinator-post", investigationId, text: "The human has the 1895 directory on paper." });
  const publish = (seat: string, finding: object, key: string) => {
    state = structuredClone(state);
    return publishFinding(state, seat, finding as never, key, "2026-02-01T00:00:00Z");
  };
  const deed = publish(first!, { statement: "Ann Pryce bought the mill in 1896.", qualification: "supported", explanation: "The deed records the sale.", evidence: [{ document: "doc-1", page: 2, quote: "Sold to Ann Pryce, corn dealer, in 1896.", interpretation: "The sale." }] }, "p1");
  publish(second!, { statement: "The mill was rebuilt in 1911.", qualification: "reported", explanation: "The plaque says so.", evidence: [{ document: "plaque", page: 1, quote: "Rebuilt 1911.", interpretation: "The rebuilding." }] }, "p2");
  state.investigations[1]!.reviewFlow = {
    walkthroughs: [{ id: "w", revision: 1, createdAt: "t", proposalIds: [], title: "Who bought the mill", question: "Who bought it?", journey: "We read the deed.", answer: "Ann Pryce, in 1896.", caveats: ["The plaque is a transcription."], steps: [{ id: "s", title: "The sale", body: "Pryce bought it.", evidenceRefs: ["p/e1"], transition: "" }], closing: "" }],
    jobs: [],
    graphReviews: [],
  };
  return { state, investigationId, first: first!, second: second!, deed };
}

describe("the research library", () => {
  it("lays out a team's batch as its goal, board, one list of findings and each researcher's checkpoints, beside the graph, sources and documents", () => {
    const { state, deed } = project();
    const files = libraryFiles(state);
    const text = (path: string) => files.get(path) as string;
    expect([...files.keys()].sort()).toEqual([
      "README.md",
      "batches/batch-1/board.md",
      "batches/batch-1/brief.md",
      "batches/batch-1/pass-1/assignment.md",
      "batches/batch-1/pass-1/checkpoints.md",
      "batches/batch-1/pass-1/findings.md",
      "batches/batch-2/board.md",
      "batches/batch-2/findings.md",
      "batches/batch-2/goal.md",
      "batches/batch-2/researcher-1/checkpoints.md",
      "batches/batch-2/researcher-2/checkpoints.md",
      "documents/corrections.json",
      "documents/doc-1.pdf",
      "documents/doc-1.r1.txt",
      "documents/documents.csv",
      "documents/plaque.png",
      "documents/plaque.r1.txt",
      "graph/edges.csv",
      "graph/evidence.csv",
      "graph/fields.csv",
      "graph/nodes.csv",
      "graph/relationships.csv",
      "graph/types.csv",
      "sources.csv",
      "walkthroughs/batch-2.md",
    ]);
    // The goal the whole team shares, and who is in the team.
    expect(text("batches/batch-2/goal.md")).toContain("## The goal\n\nFind who bought the fictional Harbour Mill after the Holloways, and when.");
    expect(text("batches/batch-2/goal.md")).toContain("- Researcher 1: a researcher is working on it now");
    // The board, with each post's researcher by name, and the coordinator's.
    expect(text("batches/batch-2/board.md")).toContain("from Researcher 1\n\nI am taking the deeds; the directories are open.");
    expect(text("batches/batch-2/board.md")).toContain("from the coordinator\n\nThe human has the 1895 directory on paper.");
    // Findings published during the batch, newest first, each with its researcher and
    // its evidence; a transcription is marked as one.
    const findings = text("batches/batch-2/findings.md");
    expect(findings.indexOf("The mill was rebuilt in 1911.")).toBeLessThan(findings.indexOf("Ann Pryce bought the mill in 1896."));
    expect(findings).toContain(`Finding ${deed.id}, published by Researcher 1 on 2026-02-01: supported.`);
    expect(findings).toContain("> Sold to Ann Pryce, corn dealer, in 1896.");
    expect(findings).toContain("The app found this quote at the page cited, in revision 1 of the saved text (documents/doc-1.r1.txt).");
    expect(findings).toContain("published by Researcher 2 on 2026-02-01: reported.");
    expect(findings).toContain("From a transcription, which the app cannot check against the image.");
    // A running researcher's checkpoints are there for its teammates.
    expect(text("batches/batch-2/researcher-1/checkpoints.md")).toContain("The deed read");
    expect(text("batches/batch-2/researcher-2/checkpoints.md")).toContain("No checkpoints saved.");
    expect(text("walkthroughs/batch-2.md")).toContain("## The answer\n\nAnn Pryce, in 1896.");
    expect(text("graph/nodes.csv")).toContain("mill,place,Harbour Mill");
    expect(text("sources.csv")).toContain("register,Fictional lease register,County archive");
    expect(text("documents/doc-1.r1.txt")).toContain("[Page 1]");
    expect(text("documents/plaque.r1.txt")).toBe("Harbour Mill. Rebuilt 1911.");
    expect(text("documents/documents.csv")).toContain("doc-1,Deed.PDF,imports,documents/doc-1.pdf,documents/doc-1.r1.txt,");
  });

  it("keeps a batch from before teams as it was: its brief, and each pass with its direction, findings and checkpoints", () => {
    const { state } = project();
    const files = libraryFiles(state);
    const text = (path: string) => files.get(path) as string;
    expect(text("batches/batch-1/brief.md")).toContain("Who ran the fictional mill after 1880.");
    expect(text("batches/batch-1/pass-1/assignment.md")).toContain("## The coordinator's brief\n\nRead the lease registers; finding f-17 in batch 1 is the one to test.");
    expect(text("batches/batch-1/pass-1/assignment.md")).toContain("> Look for Ann Pryce too.");
    const findings = text("batches/batch-1/pass-1/findings.md");
    expect(findings).toContain("### Holloway renewed the lease in 1881.");
    expect(findings).toContain("> Lease renewed to Thomas Holloway, miller.");
    expect(findings).toContain("Source: Fictional lease register (register), vol. 4, folio 112.");
    expect(text("batches/batch-1/pass-1/checkpoints.md")).toContain("Volume 4 read");
    expect(text("batches/batch-1/board.md")).toContain("from the researcher on \"Lease registers\"\n\nKelly's 1889 is not online.");
  });

  it("leaves out the conversation, annotations and worker credentials", () => {
    const { state } = project();
    const all = [...libraryFiles(state).values()].filter((v) => typeof v === "string").join("\n");
    expect(all).not.toContain("Private words from the human");
    expect(all).not.toContain("A private annotation");
    for (const seat of state.investigations[1]!.assignments!) expect(all).not.toContain(seat.lease!.token);
  });

  it("is written into the project's folder, and rewritten as research is saved", () => {
    const directory = mkdtempSync(join(tmpdir(), "weir-library-"));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    mkdirSync(join(directory, "documents"));
    writeFileSync(join(directory, "documents", "doc-1"), "%PDF");
    writeFileSync(join(directory, "documents", "plaque"), "PNG");
    const { state, second } = project();
    const folder = writeLibrary(state, directory);
    expect(readFileSync(join(folder, "documents", "doc-1.pdf"), "utf8")).toBe("%PDF");
    const goal = join(folder, "batches", "batch-2", "goal.md");
    const before = statSync(goal).mtimeMs;
    // A new post changes the board; untouched files are left as they were.
    const next = transition(state, { type: "post", assignmentId: second, text: "The 1895 edition is at the county library.", key: "k2" }).state;
    writeLibrary(next, directory);
    expect(readFileSync(join(folder, "batches", "batch-2", "board.md"), "utf8")).toContain("The 1895 edition");
    expect(statSync(goal).mtimeMs).toBe(before);
    // What no longer belongs is removed.
    next.documents = [];
    writeLibrary(next, directory);
    expect(existsSync(join(folder, "documents", "doc-1.pdf"))).toBe(false);
  });
});
