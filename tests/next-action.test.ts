import { describe, expect, it } from "vitest";
import { initialState, type Investigation, type ResearchState } from "../src/domain/research";
import { nextAction } from "../src/domain/next-action";
import { emptyGraph } from "../src/domain/graph-schema";
const empty = emptyGraph();

function batch(extra: Partial<Investigation> = {}): Investigation {
  return {
    id: "batch-1",
    number: 1,
    title: "The fictional mill's builder",
    status: "review",
    createdAt: "2026-01-01T00:00:00.000Z",
    scope: ["web"],
    annotations: [],
    checkpoints: [],
    proposals: [],
    events: [],
    ...extra,
  };
}
const findings = { kind: "findings", id: "p1", status: "pending", findings: [] } as never;
const flow = (jobs: object[] = [], graphReviews: object[] = [], walkthroughs: object[] = []) =>
  ({ jobs, graphReviews, walkthroughs }) as never;

function waitingOn(b: Investigation, extra: Record<string, unknown> = {}) {
  const state = { ...initialState(empty as never), investigations: [b], ...extra } as ResearchState;
  return nextAction(state, b).waitingOn;
}

describe("next action for a batch", () => {
  it("names nobody for a closed batch, even one whose status was never updated", () => {
    expect(waitingOn(batch({ status: "closed", closedAt: "2026-01-02" }))).toBe("nobody");
    expect(waitingOn(batch({ status: "queued", closedAt: "2026-01-02" }))).toBe("nobody");
  });

  it("waits on the human for access help, resume approval, a draft, and a ready batch", () => {
    expect(waitingOn(batch({ status: "paused", accessRequest: { instruction: "Sign in to the archive" } }))).toBe("human");
    expect(waitingOn(batch({ status: "paused", resumeRequest: { id: "r", reason: "x", at: "t", status: "pending" } }))).toBe("human");
    expect(waitingOn(batch({ reviewFlow: flow([], [{ status: "pending" }]) }))).toBe("human");
    expect(waitingOn(batch({ reviewFlow: flow([{ status: "paused", resumeRequest: { status: "pending" } }]) }))).toBe("human");
    expect(waitingOn(batch({ readyAt: "2026-01-02", proposals: [findings] }))).toBe("human");
    expect(waitingOn(batch({ status: "paused" }))).toBe("human");
  });

  it("waits on the coordinator for unassigned work, returned results, drafts to check, and walkthroughs", () => {
    expect(waitingOn(batch({ status: "queued" }))).toBe("coordinator");
    expect(waitingOn(batch({ reviewFlow: flow([{ status: "returned" }]) }))).toBe("coordinator");
    expect(waitingOn(batch({ reviewFlow: flow([{ status: "queued", engine: "manual" }]) }))).toBe("coordinator");
    expect(waitingOn(batch({ walkthroughRequestedAt: "2026-01-02", proposals: [findings] }))).toBe("coordinator");
    expect(waitingOn(batch({ proposals: [findings] }))).toBe("coordinator");
    const running = batch({ status: "running", lease: { token: "t", worker: "Codex researcher", at: "a", annotationIds: [], dataset: {} as never } });
    expect(waitingOn(running, { coordination: { candidates: [{ investigationId: "batch-1", token: "t" }] } })).toBe("coordinator");
    // A result from a fenced lease is stale and does not count.
    expect(waitingOn(running, { coordination: { candidates: [{ investigationId: "batch-1", token: "old" }] } })).toBe("worker");
  });

  it("waits on a worker while research or a graph draft is under way", () => {
    expect(waitingOn(batch({ status: "queued" }), { coordination: { assignments: { "batch-1": {} } } })).toBe("worker");
    expect(waitingOn(batch({ reviewFlow: flow([{ status: "running", engine: "claude" }]) }))).toBe("worker");
    expect(waitingOn(batch({ reviewFlow: flow([], [{ status: "pending", revisingSince: "t" }]) }))).toBe("worker");
  });

  it("ignores leftover graph jobs once the batch's graph review is finished", () => {
    const finished = flow([{ status: "paused", resumeRequest: { status: "pending" } }], [{ status: "applied" }]);
    expect(waitingOn(batch({ readyAt: "t", proposals: [findings], reviewFlow: finished }))).toBe("human");
    expect(nextAction({ ...initialState(empty as never) } as ResearchState, batch({ readyAt: "t", proposals: [findings], reviewFlow: finished })).action).toContain("new batch");
  });
});
