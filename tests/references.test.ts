// @vitest-environment node
import { emptyGraph } from "../src/domain/graph-schema";
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSample } from "../server/sample-project.mjs";
import { WorkspaceStore } from "../server/store.mjs";
import { inbox } from "../server/coordinator-inbox.mjs";
import { describeReference } from "../src/domain/references";
import { buildCoordinatorContext } from "../src/domain/coordinator-context";

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((clean) => clean()));

// The fictional sample project: one batch with a report, a walkthrough and a draft graph.
function sample() {
  const directory = mkdtempSync(join(tmpdir(), "fictional-references-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  buildSample(directory);
  const store = new WorkspaceStore(directory, emptyGraph(""));
  const state = store.state;
  const batch = state.investigations[0];
  return {
    store,
    state,
    batch,
    proposal: batch.proposals[0],
    walkthrough: batch.reviewFlow.walkthroughs[0],
    review: batch.reviewFlow.graphReviews[0],
  };
}

describe("a reference, as the coordinator reads it", () => {
  it("names a graph record, its id, and the screen it was picked from", () => {
    const s = sample();
    const d = describeReference(s.state, { table: "nodes", recordId: "edith", label: "Edith Marrow", screen: { view: "research", focusId: "edith" } });
    expect(d).toEqual({
      kind: "Graph · person",
      about: "the person “Edith Marrow” on the graph",
      seenOn: "the graph, centred on “Edith Marrow”",
      ids: { record: "nodes/edith" },
    });
  });

  it("tells a record in a batch's draft graph from the accepted graph", () => {
    const s = sample();
    const d = describeReference(s.state, { table: "nodes", recordId: "thomas", label: "Thomas Marrow", graphReviewId: s.review.id });
    expect(d.kind).toBe("Batch 1 draft graph · person");
    expect(d.about).toBe("the person “Thomas Marrow” in batch 1's draft graph");
    expect(d.ids).toEqual({ batch: s.batch.id, record: "nodes/thomas", graphReview: s.review.id });
  });

  it("names findings, reports, batches and their research passes by what they say", () => {
    const s = sample();
    const finding = s.proposal.findings[0];
    expect(describeReference(s.state, { label: "", proposalId: s.proposal.id, findingId: finding.id })).toMatchObject({
      kind: "Batch 1 · finding",
      about: `the finding “${finding.statement}” in batch 1`,
      ids: { batch: s.batch.id, proposal: s.proposal.id, finding: finding.id },
    });
    expect(describeReference(s.state, { label: s.proposal.title, proposalId: s.proposal.id }).about).toBe(`the report “${s.proposal.title}” in batch 1`);
    expect(describeReference(s.state, { label: s.batch.title, investigationId: s.batch.id }).about).toBe(`batch 1, “${s.batch.title}”`);
    const pass = s.batch.assignments[0];
    expect(describeReference(s.state, { label: pass.title, investigationId: s.batch.id, assignmentId: pass.id })).toMatchObject({
      kind: "Batch 1 · research pass",
      about: `the research pass “${pass.title}” in batch 1`,
      ids: { batch: s.batch.id, assignment: pass.id },
    });
  });

  it("places walkthrough passages in their step, opening or closing", () => {
    const s = sample();
    const step = s.walkthrough.steps[0];
    const at = (label: string, stepId?: string) => describeReference(s.state, { label, walkthroughId: s.walkthrough.id, stepId }).about;
    expect(at(step.title, step.id)).toBe(`step 1, “${step.title}”, of batch 1's walkthrough`);
    expect(at("Where this leads", step.id)).toBe(`“Where this leads” in step 1, “${step.title}”, of batch 1's walkthrough`);
    expect(at("What remains open", "opening")).toBe("“What remains open” in the opening of batch 1's walkthrough");
    expect(at(s.walkthrough.title)).toBe(`batch 1's walkthrough, “${s.walkthrough.title}”`);
  });

  it("leads with the words the human selected", () => {
    const s = sample();
    const d = describeReference(s.state, { table: "sources", recordId: "register", label: "Tidewell parish register", text: "baptised 1851", anchor: { type: "text-range" } });
    expect(d.about).toBe("the words “baptised 1851” in the source “Tidewell parish register of baptisms (fictional)”");
    // A picked element carries its text, which is what the human pointed at.
    const picked = describeReference(s.state, { table: "sources", recordId: "register", label: "Tidewell parish register", text: "Available on request." });
    expect(picked.about).toBe("the text “Available on request.” in the source “Tidewell parish register of baptisms (fictional)”");
    expect(d.ids).toEqual({ source: "register" });
  });
});

describe("a note sent on the graph", () => {
  it("reaches the coordinator as that record, where it was seen, and the id to inspect", () => {
    const s = sample();
    const reference = { table: "nodes", recordId: "edith", label: "Edith Marrow", selector: "g.node:nth-of-type(1)", screen: { view: "research", focusId: "edith" } };
    s.store.command({ type: "send", annotation: { question: "Is this the same Edith as in the 1881 list?", references: [reference] } });
    // The coordinator receives it as an annotation on that record, where it was seen.
    const [message] = inbox(s.store.state, { messages: s.store.state.conversation.filter((m: any) => m.author === "human").slice(-1) });
    const said = "the person “Edith Marrow” on the graph (record nodes/edith), seen on the graph, centred on “Edith Marrow”";
    expect(message!.text).toContain(said);
    // Its startup context says the same, and never the page's structure.
    const conversation = buildCoordinatorContext(s.store.state).layers.find((l) => l.id === "conversation")!.text;
    expect(conversation).toContain(`on ${said}`);
    expect(message!.text + conversation).not.toContain("nth-of-type");
  });
});
