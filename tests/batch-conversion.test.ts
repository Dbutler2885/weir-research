import { describe, expect, it } from "vitest";
import { initialState, type ResearchState } from "../src/domain/research";
import { convertToBatches, headline } from "../src/domain/batch-conversion";
import empty from "../src/data/empty.json";

function legacy(): ResearchState {
  const state = initialState({ ...empty, title: "The fictional Harbour Mill" });
  const annotation = (id: string, question: string, dispatchedAt?: string) => ({
    id,
    target: { label: "Harbour Mill ledger" },
    references: [{ label: "Harbour Mill ledger" }],
    question,
    createdAt: "2026-01-01T09:00:00.000Z",
    ...(dispatchedAt ? { dispatchedAt } : {}),
  });
  state.investigations = [
    {
      id: "later",
      title: "is the ledger reliable",
      createdAt: "2026-01-03T09:00:00.000Z",
      status: "review",
      scope: ["web"],
      annotations: [annotation("a3", "is the ledger reliable? it looks copied", "2026-01-03T09:00:00.000Z"), annotation("a4", "Unsent thought")],
      checkpoints: [],
      proposals: [
        {
          id: "p1",
          kind: "findings",
          revision: 1,
          title: "The ledger's reliability",
          summary: "Checked against the tax roll.",
          ambiguity: "",
          evidence: [],
          changes: [],
          findings: [],
          addressedAnnotationIds: ["a3"],
          createdAt: "2026-01-03T12:00:00.000Z",
          status: "pending",
        },
      ],
      events: [{ at: "2026-01-03T12:00:00.000Z", message: "Proposal ready." }],
    },
    {
      id: "empty-draft",
      title: "test",
      createdAt: "2026-01-02T09:00:00.000Z",
      status: "draft",
      scope: ["web"],
      annotations: [],
      checkpoints: [],
      proposals: [],
      events: [],
    },
    {
      id: "first",
      title: "who built it",
      createdAt: "2026-01-01T09:00:00.000Z",
      status: "closed",
      scope: ["web", "imports"],
      annotations: [
        annotation("a1", "who built the mill", "2026-01-01T09:00:00.000Z"),
        annotation("a2", "and when", "2026-01-01T09:00:00.000Z"),
      ],
      checkpoints: [],
      proposals: [],
      events: [{ at: "2026-01-02T08:00:00.000Z", message: "Applied." }],
      reviewFlow: {
        walkthroughs: [
          {
            id: "w1",
            revision: 1,
            createdAt: "2026-01-01T15:00:00.000Z",
            proposalIds: [],
            title: "Who built the Harbour Mill",
            question: "",
            journey: "",
            answer: "",
            caveats: [],
            steps: [],
            closing: "",
          },
        ],
        jobs: [],
        graphReviews: [{ status: "applied", createdAt: "2026-01-01T20:00:00.000Z" } as never],
      },
    },
  ];
  return state;
}

describe("conversion to batches", () => {
  it("numbers investigations as batches in the order they began and drops empty drafts", () => {
    const next = convertToBatches(legacy());
    expect(next.investigations.map((i) => [i.number, i.id])).toEqual([
      [1, "first"],
      [2, "later"],
    ]);
    expect(next.investigations.map((i) => i.title)).toEqual([
      "Who built the Harbour Mill",
      "The ledger's reliability",
    ]);
  });

  it("gives every sent annotation a readable question and keeps report links", () => {
    const [first, later] = convertToBatches(legacy()).investigations;
    expect(first!.questions!.map((q) => q.title)).toEqual(["Who built the mill", "And when"]);
    expect(later!.questions![0]).toMatchObject({
      title: "Is the ledger reliable?",
      annotationIds: ["a3"],
    });
    expect(later!.proposals[0]!.addressedAnnotationIds).toEqual(later!.questions![0]!.annotationIds);
  });

  it("rebuilds the conversation from sends and returns unsent annotations to the queue", () => {
    const next = convertToBatches(legacy());
    expect(next.conversation!.map((m) => m.annotations!.map((a) => a.id))).toEqual([["a1", "a2"], ["a3"]]);
    expect(next.queue!.map((a) => a.id)).toEqual(["a4"]);
    expect(next.investigations[1]!.annotations.map((a) => a.id)).toEqual(["a3"]);
  });

  it("marks reviewed batches ready and applied graph reviews closed", () => {
    const [first, later] = convertToBatches(legacy()).investigations;
    expect(first!.readyAt).toBe("2026-01-01T15:00:00.000Z");
    expect(first!.closedAt).toBe("2026-01-02T08:00:00.000Z");
    expect(later!.readyAt).toBe("2026-01-03T12:00:00.000Z");
    expect(later!.closedAt).toBeUndefined();
  });

  it("keeps a batch open when research continued after its graph review", () => {
    const state = legacy();
    state.investigations[2]!.reviewFlow!.walkthroughs.push({
      ...state.investigations[2]!.reviewFlow!.walkthroughs[0]!,
      id: "w2",
      revision: 2,
      createdAt: "2026-01-01T22:00:00.000Z",
    });
    expect(convertToBatches(state).investigations[0]!.closedAt).toBeUndefined();
  });

  it("runs only once", () => {
    const once = convertToBatches(legacy());
    expect(convertToBatches(once)).toEqual(once);
  });

  it("shortens long annotations to their first sentence", () => {
    expect(headline("we have ONE gillise in all of maine? and more")).toBe("We have ONE gillise in all of maine?");
    expect(headline("x ".repeat(100)).length).toBeLessThanOrEqual(121);
  });
});
