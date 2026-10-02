// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initialState, transition, type ResearchCommand, type ResearchState } from "../src/domain/research";
import { emptyGraph } from "../src/domain/graph-schema";
import { libraryFiles, writeLibrary } from "../server/research-library.mjs";

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((clean) => clean()));

// A fictional project: one batch with two research passes, one published and one still
// running, a board post, a walkthrough, a candidate the coordinator has not reviewed,
// a saved PDF, and the human's conversation.
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
  const { investigationId } = run({
    type: "open-batch",
    title: "Who ran the mill",
    brief: { purpose: "Who ran the fictional mill after 1880.", scope: "Leases and directories only.", direction: "Leases first." },
    assignments: [
      { title: "Lease registers", brief: "Read the lease registers; finding f-17 in batch 1 is the one to test." },
      { title: "Trade directories", brief: "Read the directories from 1880." },
    ],
  });
  const [leases, directories] = state.investigations[0]!.assignments!.map((a) => a.id);
  const claim = (assignmentId: string) => run({ type: "claim", investigationId, assignmentId, worker: "Codex researcher" }).assignment.lease.token;
  const first = claim(leases!);
  run({ type: "checkpoint", investigationId, token: first, summary: "Volume 4 read", findings: "Lease to Holloway in 1881", nextSteps: "Volume 5" });
  run({ type: "steered", assignmentId: leases, message: "Look for Ann Pryce too." });
  run({
    type: "propose",
    investigationId,
    token: first,
    proposal: {
      kind: "findings",
      title: "Leases 1880 to 1895",
      summary: "Two lessees.",
      ambiguity: "The 1889 page is missing.",
      changes: [],
      evidence: [{ id: "e1", sourceId: "register", quote: "Lease renewed to Thomas Holloway, miller.", context: "Register entry", locator: "vol. 4, folio 112", interpretation: "A renewal.", stance: "supports" }],
      findings: [{ id: "f1", statement: "Holloway renewed the lease in 1881.", qualification: "supported", explanation: "The renewal is entered in full.", evidenceIds: ["e1"] }],
    },
  });
  const second = claim(directories!);
  run({ type: "checkpoint", investigationId, token: second, summary: "Kelly's 1891 read", findings: "Pryce as corn dealer", nextSteps: "1895 edition" });
  run({ type: "post", assignmentId: directories, token: second, text: "Kelly's 1889 is not online." });
  (state as any).coordination = { enabled: true, candidates: [{ id: "c", investigationId, token: second, proposal: { title: "An unreviewed candidate finding" } }] };
  state.investigations[0]!.reviewFlow = {
    walkthroughs: [{ id: "w", revision: 1, createdAt: "t", proposalIds: [], title: "Who ran the mill", question: "Who ran it?", journey: "We read the leases.", answer: "Holloway, then Pryce.", caveats: ["The 1889 page is missing."], steps: [{ id: "s", title: "The renewal", body: "Holloway renewed.", evidenceRefs: ["p/e1"], transition: "" }], closing: "" }],
    jobs: [],
    graphReviews: [],
  };
  state.documents.push({ id: "doc-1", collectionId: "imports", name: "Deed.PDF", mime: "application/pdf", size: 4, sha256: "x", importedAt: "t", text: "[Page 1]\nThe deed of the mill." });
  return { state, investigationId };
}

describe("the research library", () => {
  it("lays out batches, passes, walkthroughs, the graph, sources and documents as readable files", () => {
    const { state } = project();
    const files = libraryFiles(state);
    const text = (path: string) => files.get(path) as string;
    expect([...files.keys()].sort()).toEqual([
      "README.md",
      "batches/batch-1/board.md",
      "batches/batch-1/brief.md",
      "batches/batch-1/pass-1/assignment.md",
      "batches/batch-1/pass-1/checkpoints.md",
      "batches/batch-1/pass-1/findings.md",
      "batches/batch-1/pass-2/assignment.md",
      "batches/batch-1/pass-2/checkpoints.md",
      "batches/batch-1/pass-2/findings.md",
      "documents/doc-1.pdf",
      "documents/doc-1.txt",
      "documents/documents.csv",
      "graph/edges.csv",
      "graph/evidence.csv",
      "graph/fields.csv",
      "graph/nodes.csv",
      "graph/relationships.csv",
      "graph/types.csv",
      "sources.csv",
      "walkthroughs/batch-1.md",
    ]);
    expect(text("batches/batch-1/brief.md")).toContain("Who ran the fictional mill after 1880.");
    // A pass: the coordinator's direction and its steering, and IDs named inline.
    expect(text("batches/batch-1/pass-1/assignment.md")).toContain("## The coordinator's brief\n\nRead the lease registers; finding f-17 in batch 1 is the one to test.");
    expect(text("batches/batch-1/pass-1/assignment.md")).toContain("> Look for Ann Pryce too.");
    // Published findings, with each piece of evidence quoted with its source and place.
    const findings = text("batches/batch-1/pass-1/findings.md");
    expect(findings).toContain("### Holloway renewed the lease in 1881.");
    expect(findings).toContain("> Lease renewed to Thomas Holloway, miller.");
    expect(findings).toContain("Source: Fictional lease register (register), vol. 4, folio 112.");
    // A running researcher's checkpoints are there for the others.
    expect(text("batches/batch-1/pass-2/checkpoints.md")).toContain("Kelly's 1891 read");
    expect(text("batches/batch-1/pass-2/assignment.md")).toContain("A researcher is working on it now.");
    expect(text("batches/batch-1/board.md")).toContain("from the researcher on \"Trade directories\"\n\nKelly's 1889 is not online.");
    expect(text("walkthroughs/batch-1.md")).toContain("## The answer\n\nHolloway, then Pryce.");
    expect(text("graph/nodes.csv")).toContain("mill,place,Harbour Mill");
    expect(text("sources.csv").split("\n")[0]).toBe("id,title,repository");
    expect(text("sources.csv")).toContain("register,Fictional lease register,County archive");
    expect(text("documents/doc-1.txt")).toContain("[Page 1]");
    expect(text("documents/documents.csv")).toContain("doc-1,Deed.PDF,imports,documents/doc-1.pdf,documents/doc-1.txt,");
  });

  it("leaves out the conversation, annotations, unreviewed results and worker credentials", () => {
    const { state } = project();
    const all = [...libraryFiles(state).values()].filter((v) => typeof v === "string").join("\n");
    expect(all).not.toContain("Private words from the human");
    expect(all).not.toContain("A private annotation");
    expect(all).not.toContain("An unreviewed candidate finding");
    const token = state.investigations[0]!.assignments![1]!.lease!.token;
    expect(all).not.toContain(token);
  });

  it("is written into the project's folder, and rewritten as research is saved", () => {
    const directory = mkdtempSync(join(tmpdir(), "weir-library-"));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    mkdirSync(join(directory, "documents"));
    writeFileSync(join(directory, "documents", "doc-1"), "%PDF");
    const { state } = project();
    const folder = writeLibrary(state, directory);
    expect(readFileSync(join(folder, "documents", "doc-1.pdf"), "utf8")).toBe("%PDF");
    const brief = join(folder, "batches", "batch-1", "brief.md");
    const before = statSync(brief).mtimeMs;
    // A new post changes the board; untouched files are left as they were.
    const next = transition(state, { type: "post", assignmentId: state.investigations[0]!.assignments![1]!.id, token: state.investigations[0]!.assignments![1]!.lease!.token, text: "The 1895 edition is at the county library." }).state;
    writeLibrary(next, directory);
    expect(readFileSync(join(folder, "batches", "batch-1", "board.md"), "utf8")).toContain("The 1895 edition");
    expect(statSync(brief).mtimeMs).toBe(before);
    // What no longer belongs is removed.
    next.documents = [];
    writeLibrary(next, directory);
    expect(existsSync(join(folder, "documents", "doc-1.pdf"))).toBe(false);
  });
});
