import { describe, expect, it } from "vitest";
import { upgradeGraphState, needsGraphUpgrade } from "../src/domain/graph-upgrade.ts";
import { reviewGraph } from "../src/domain/graph-delivery.ts";
import { GraphModel } from "../src/domain/model.ts";

// Explicitly fictional: a proposal-format review of an invented works in an imaginary bay.
const evidence = { "report/passage": { id: "passage", sourceId: "register", quote: "Example Works stood in Example Bay.", context: "Invented.", locator: "Page 1", interpretation: "Reported location." } };
const sources = [{ id: "register", title: "Fictional register" }];
const base = {
  version: 2 as const, title: "Example Bay", initialFocusId: "town", people: [],
  contextEntities: [{ id: "town", name: "Example Town", kind: "place" as const }], claims: [],
};
const proposal = {
  schemaVersion: 1, baseGraphRevision: 0, researchRevision: "r1", consumedUpdateSequence: 0, title: "The works and its bay", summary: "A reported location.",
  nodes: [
    { id: "bay", kind: "place", label: "Example Bay", existingId: null, evidenceRefs: ["report/passage"] },
    { id: "the-town", kind: "place", label: "Example Town", existingId: "town", evidenceRefs: [] },
    { id: "works", kind: "facility", label: "Example Works", existingId: null, evidenceRefs: ["report/passage"] },
  ],
  claims: [
    { id: "location", subjectId: "works", predicate: "located_in", object: { entityId: "bay" }, qualification: "reported", time: null, reasoning: "The register names the bay.", evidence: [{ ref: "report/passage", role: "supports" }] },
    { id: "near", subjectId: "bay", predicate: "near", object: { entityId: "the-town" }, qualification: "inferred", time: null, reasoning: "Implied by the register.", evidence: [] },
  ],
  groups: [
    { id: "place", title: "The bay", nodeIds: ["bay", "the-town"], claimIds: ["near"], dependsOn: [] },
    { id: "factory", title: "The works", nodeIds: ["works"], claimIds: ["location"], dependsOn: ["place"] },
  ],
  issues: [{ id: "street", kind: "research", question: "Which street?", nodeIds: ["works"], claimIds: ["location"], evidenceRefs: [], provisionalTreatment: "Kept at bay level.", requestedResearch: null, blocksGroupIds: [] }],
  coverage: [], identityDecisions: [],
  representationNotes: [{ id: "reuse", nodeIds: ["the-town"], claimIds: [], issueIds: [], decision: "Reused the town.", alternatives: ["A new town node"], reason: "Same place." }],
};
const tour = { graphSha256: "x", introduction: "The works and its bay.", steps: [
  { id: "bay-step", title: "The bay", focusNodeIds: ["bay", "the-town"], focusClaimIds: ["near"], explanation: "The bay is near the town.", issueIds: [], transition: "Next, the works." },
  { id: "works-step", title: "The works", focusNodeIds: ["works"], focusClaimIds: ["location"], explanation: "The works stood in the bay.", issueIds: ["street"], transition: "That is all." },
] };
const review = (status: string, applied: string[]) => ({
  id: `review-${status}`, jobId: "job", walkthroughId: "w", revision: 1, createdAt: "2026-01-01T00:00:00.000Z", graphSha256: "x",
  graph: structuredClone(proposal), tour: structuredClone(tour), evidence, sources, baseDataset: structuredClone(base),
  expectedGraphRevision: 0, appliedGroupIds: applied, rejectedGroupIds: [], status, annotationIds: [],
});
function state() {
  return {
    dataset: structuredClone(base),
    queue: [],
    investigations: [{
      annotations: [{ id: "a", target: { label: "The works", graphReviewId: "review-pending", groupId: "factory" } }],
      reviewFlow: {
        walkthroughs: [],
        jobs: [{ id: "job", status: "returned", baseDataset: structuredClone(base), candidate: { graph: structuredClone(proposal), packet: { evidence, sources }, submissionDirectory: "old" }, issues: [], submissions: [{ graph: structuredClone(proposal), packet: {}, submissionDirectory: "old" }] }],
        graphReviews: [review("applied", ["place"]), review("pending", [])],
      },
    }],
  };
}

describe("converting stored proposal-format reviews", () => {
  it("turns a pending review into a draft of every group, with existing nodes reused", () => {
    const converted: any = upgradeGraphState(state() as never);
    const r = converted.investigations[0].reviewFlow.graphReviews[1];
    expect(r.format).toBe("draft");
    expect(r).not.toHaveProperty("graph");
    expect(r.summary).toBe("2 new nodes, 2 new edges, 1 change to types and relationships, 1 evidence record added from the research.");
    expect(r.draft.nodes.map((n: any) => n.id)).toEqual(["town", "bay", "works"]);
    expect(r.diff.vocabulary).toEqual(["New type: facility."]);
    expect(r.draft.claims.find((c: any) => c.id === "near").object).toEqual({ entityId: "town" });
    // Research reaches the graph only when the draft is accepted.
    expect(r.draft.evidence ?? []).toEqual([]);
    expect(r.cited.evidence.map((e: any) => e.id)).toEqual(["report/passage"]);
    expect(r.questions).toEqual([{ id: "street", question: "Which street?", nodeIds: ["works"], edgeIds: ["location"], provisionalTreatment: "Kept at bay level.", requestedResearch: "" }]);
    expect(r.notes[0]).toMatchObject({ nodeIds: ["town"], decision: "Reused the town." });
    expect(r.tour.steps[0].focusNodeIds).toEqual(["bay", "town"]);
    new GraphModel(reviewGraph(r).dataset);
  });

  it("turns an applied review into the draft of the groups actually applied", () => {
    const r = (upgradeGraphState(state() as never) as any).investigations[0].reviewFlow.graphReviews[0];
    expect(r.status).toBe("applied");
    expect(r.draft.nodes.map((n: any) => n.id)).toEqual(["town", "bay"]);
    expect(r.draft.claims.map((c: any) => c.id)).toEqual(["near"]);
  });

  it("converts an unpublished candidate and slims old submissions", () => {
    const job = (upgradeGraphState(state() as never) as any).investigations[0].reviewFlow.jobs[0];
    expect(job.candidate).toMatchObject({ summary: "2 new nodes, 2 new edges, 1 change to types and relationships, 1 evidence record added from the research.", consumedUpdateSequence: 0, researchRevision: "r1", baseGraphRevision: 0 });
    expect(job).not.toHaveProperty("issues");
    expect(job.submissions).toEqual([{ submissionDirectory: "old", summary: "The works and its bay" }]);
  });

  it("points a note about a group at the tour step that showed it", () => {
    const converted: any = upgradeGraphState(state() as never);
    expect(converted.investigations[0].annotations[0].target).toEqual({ label: "The works", graphReviewId: "review-pending", stepId: "works-step" });
    expect(needsGraphUpgrade(converted)).toBe(false);
  });
});
