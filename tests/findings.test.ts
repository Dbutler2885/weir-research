import { describe, it, expect } from "vitest";
import { initialState, transition } from "../src/domain/research";
import empty from "../src/data/empty.json";
function setup() {
  let state = initialState(empty);
  let investigationId: string;
  let token: string;
  const run = (c: any) => {
    const r = transition(state, { investigationId, ...c });
    state = r.state;
    return r.result as any;
  };
  investigationId = run({
    type: "annotate",
    question: "Who worked here?",
    dispatch: true,
  }).investigationId;
  const claim = () => {
    token = run({ type: "claim", worker: "Fixture researcher" }).investigation
      .lease.token;
  };
  claim();
  const publish = (p: any) => run({ type: "propose", token, proposal: p });
  const proposal = {
    kind: "findings",
    title: "Two findings",
    summary: "An attributed relationship and an open date.",
    ambiguity: "Opening date remains unknown.",
    changes: [],
    sources: [
      { id: "register", title: "Fictional register", access: "full-text" },
    ],
    evidence: [
      {
        id: "e",
        sourceId: "register",
        quote: "Alex worked here.",
        context: "Fictional register entry",
        locator: "Entry 1",
        interpretation: "The register attributes employment.",
        stance: "supports",
      },
    ],
    findings: [
      {
        id: "f1",
        statement: "The register says Alex worked here.",
        qualification: "reported",
        explanation: "Attributed to the register.",
        evidenceIds: ["e"],
      },
      {
        id: "f2",
        statement: "Opening date unknown.",
        qualification: "unresolved",
        explanation: "No date found.",
        evidenceIds: [],
      },
    ],
  };
  const id = publish(proposal).proposalId;
  return {
    run,
    claim,
    publish,
    id,
    proposal,
    state: () => state,
    investigationId,
  };
}
describe("finding and graph phases", () => {
  it("keeps attributed findings independently without changing the graph", () => {
    const f = setup();
    f.run({
      type: "finding-decision",
      proposalId: f.id,
      findingId: "f1",
      decision: "kept",
    });
    expect(f.state().dataset.people).toHaveLength(0);
    expect(f.state().datasetRevision).toBe(0);
    expect(
      f.state().investigations[0]!.proposals[0]!.findings!.map((x) => x.status),
    ).toEqual(["kept", "pending"]);
    expect(f.state().library).toHaveLength(1);
    expect(() => f.run({ type: "accept", proposalId: f.id })).toThrow(
      "individually",
    );
  });
  it("requires kept findings and explicit dependency acceptance for graph changes", () => {
    const f = setup();
    const refs = [{ proposalId: f.id, findingId: "f1" }];
    expect(() => f.run({ type: "build-graph", refs })).toThrow("kept");
    f.run({
      type: "finding-decision",
      proposalId: f.id,
      findingId: "f1",
      decision: "kept",
    });
    f.run({ type: "build-graph", refs });
    f.claim();
    const graph = {
      kind: "graph",
      title: "Represent employment",
      summary: "Add an attributed relationship.",
      ambiguity: "Reported by one source.",
      omissions: "Opening date omitted.",
      sources: [],
      evidence: f.proposal.evidence,
      changes: [
        {
          table: "people",
          recordId: "alex",
          before: null,
          after: { id: "alex", name: "Alex" },
          reason: "Named worker",
          evidenceIds: ["e"],
        },
        {
          table: "contextEntities",
          recordId: "shop",
          before: null,
          after: { id: "shop", name: "Workshop", kind: "organization" },
          reason: "Workplace",
          evidenceIds: ["e"],
        },
        {
          table: "claims",
          recordId: "job",
          before: null,
          after: {
            id: "job",
            subjectId: "alex",
            predicate: "reported_employment",
            object: { entityId: "shop" },
            qualification: "reported",
            time: null,
            reasoning: "Attributed by one source.",
            evidence: [],
            sourceIds: ["register"],
          },
          reason: "Attributed relationship",
          evidenceIds: ["e"],
        },
      ],
      groups: [
        {
          id: "entities",
          title: "Worker and workplace",
          changeIndexes: [0, 1],
          findingRefs: refs,
          dependsOn: [],
        },
        {
          id: "job",
          title: "Employment",
          changeIndexes: [2],
          findingRefs: refs,
          dependsOn: ["entities"],
        },
      ],
    };
    const p = f.publish(graph).proposalId;
    expect(() =>
      f.run({ type: "apply-groups", proposalId: p, groupIds: ["job"] }),
    ).toThrow("required groups");
    f.run({ type: "apply-groups", proposalId: p, groupIds: ["entities"] });
    expect(f.state().dataset.people).toHaveLength(1);
    expect(f.state().dataset.claims).toHaveLength(0);
    f.run({ type: "apply-groups", proposalId: p, groupIds: ["job"] });
    expect(f.state().dataset.claims).toHaveLength(1);
    expect(
      f.state().investigations[0]!.proposals[0]!.findings![1]!.status,
    ).toBe("pending");
  });
  it("edits unsent multi-reference instructions but preserves dispatched instructions", () => {
    const f = setup();
    f.run({
      type: "annotate",
      question: "Compare these",
      references: [
        { proposalId: f.id, findingId: "f1", label: "Finding one" },
        { proposalId: f.id, findingId: "f2", label: "Finding two" },
      ],
    });
    const a = f.state().investigations[0]!.annotations.at(-1)!;
    f.run({
      type: "edit-annotation",
      annotationId: a.id,
      question: "Compare these carefully",
      references: a.references,
    });
    f.run({ type: "dispatch" });
    expect(() =>
      f.run({ type: "delete-annotation", annotationId: a.id }),
    ).toThrow("immutable");
    expect(
      f.state().investigations[0]!.annotations.at(-1)!.references,
    ).toHaveLength(2);
  });
  it("keeps interface feedback out of research assignments", () => {
    const f = setup();
    f.run({
      type: "interface-feedback",
      question: "This label is confusing",
      references: [],
    });
    expect(f.state().interfaceFeedback).toHaveLength(1);
    expect(f.state().investigations[0]!.annotations).toHaveLength(1);
  });
});

it("keeps a corrected finding as a new revision without rewriting the earlier evidence", () => {
  const f = setup();
  f.run({
    type: "finding-decision",
    proposalId: f.id,
    findingId: "f1",
    decision: "kept",
  });
  f.run({
    type: "annotate",
    question: "Check the interpretation again",
    target: { label: "Attribution", proposalId: f.id, findingId: "f1" },
    dispatch: true,
  });
  f.claim();
  const revised = structuredClone(f.proposal);
  revised.findings = [
    {
      ...revised.findings[0]!,
      id: "replacement",
      statement: "The source attribution remains contested.",
      qualification: "disputed",
      replaces: { proposalId: f.id, findingId: "f1" },
    } as any,
  ];
  const second = f.publish(revised).proposalId;
  f.run({
    type: "finding-decision",
    proposalId: second,
    findingId: "replacement",
    decision: "kept",
  });
  const old = f.state().investigations[0]!.proposals[0]!;
  expect(old.findings![0]!.status).toBe("superseded");
  expect(old.evidence).toEqual(f.proposal.evidence);
  expect(() =>
    f.run({
      type: "build-graph",
      refs: [{ proposalId: f.id, findingId: "f1" }],
    }),
  ).toThrow("no longer kept");
});
it("pauses for browser access assistance and fences the previous researcher", () => {
  const f = setup();
  f.run({ type: "annotate", question: "Inspect the original", dispatch: true });
  f.claim();
  const token = f.state().investigations[0]!.lease!.token;
  f.run({
    type: "checkpoint",
    token,
    summary: "Original inaccessible",
    findings: "Catalog only",
    nextSteps: "Await original",
    accessRequest: {
      instruction: "Import the original document",
      url: "https://example.org/archive",
    },
  });
  expect(f.state().investigations[0]!.status).toBe("paused");
  expect(() => f.publish(f.proposal)).toThrow("lease");
  f.run({ type: "resolve-access" });
  expect(f.state().investigations[0]!.status).toBe("queued");
});
it("returns queued finding feedback to research after a graph request", () => {
  const f = setup();
  f.run({
    type: "finding-decision",
    proposalId: f.id,
    findingId: "f1",
    decision: "kept",
  });
  f.run({ type: "build-graph", refs: [{ proposalId: f.id, findingId: "f1" }] });
  f.run({
    type: "annotate",
    question: "Find another source",
    target: { label: "Attribution", proposalId: f.id, findingId: "f1" },
  });
  f.run({ type: "dispatch" });
  expect(f.state().investigations[0]!.phase).toBe("research");
});
it("moves an unsent annotation without rewriting its references or sending it", () => {
  const f = setup();
  f.run({
    type: "annotate",
    question: "Move this question",
    references: [
      { label: "Original finding", proposalId: f.id, findingId: "f1" },
    ],
  });
  const a = f.state().investigations[0]!.annotations.at(-1)!;
  const moved = f.run({
    type: "edit-annotation",
    annotationId: a.id,
    question: "Separate question",
    references: a.references,
    destinationInvestigationId: null,
  });
  const destination = f
    .state()
    .investigations.find((i) => i.id === moved.investigationId)!;
  expect(destination.annotations[0]!.id).toBe(a.id);
  expect(destination.annotations[0]!.dispatchedAt).toBeUndefined();
  expect(
    f.state().investigations[0]!.annotations.some((x) => x.id === a.id),
  ).toBe(false);
  f.run({
    type: "interface-feedback",
    investigationId: destination.id,
    annotationId: a.id,
    question: "This is really interface feedback",
    references: a.references,
  });
  expect(f.state().interfaceFeedback).toHaveLength(1);
  expect(
    f.state().investigations.find((i) => i.id === destination.id)!.annotations,
  ).toHaveLength(0);
});
it("records findings omitted from a graph without manufacturing graph changes", () => {
  const f = setup();
  f.run({
    type: "finding-decision",
    proposalId: f.id,
    findingId: "f2",
    decision: "kept",
  });
  f.run({ type: "build-graph", refs: [{ proposalId: f.id, findingId: "f2" }] });
  f.claim();
  const p = f.publish({
    kind: "graph",
    title: "No justified representation",
    summary: "Keep the open date in findings.",
    ambiguity: "Date unknown",
    evidence: [],
    changes: [],
    groups: [],
    omissions: "The unresolved opening date cannot justify a graph property.",
  }).proposalId;
  f.run({ type: "apply-groups", proposalId: p, groupIds: [] });
  expect(f.state().datasetRevision).toBe(0);
  expect(f.state().dataset.people).toHaveLength(0);
});
