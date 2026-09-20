import { describe, expect, it } from "vitest";
import { graphBlocker } from "../src/domain/review-flow.ts";

const batch = (
  number: number,
  graphReviews: { status: string }[],
  jobs: { status: string; resumeRequest?: { status: string } }[],
) => ({ number, reviewFlow: { graphReviews, jobs, walkthroughs: [] } });

describe("graphBlocker", () => {
  it("blocks while a job could still produce a review", () => {
    expect(graphBlocker({ investigations: [batch(1, [], [{ status: "running" }])] })).toBe(
      "A graph update for batch 1 is still in preparation.",
    );
  });

  it("blocks on a pending graph review", () => {
    expect(graphBlocker({ investigations: [batch(1, [{ status: "pending" }], [])] })).toBe(
      "Finish the graph review for batch 1 first.",
    );
  });

  it("names the decision when a paused job awaits a resume answer", () => {
    const state = {
      investigations: [batch(2, [], [{ status: "paused", resumeRequest: { status: "pending" } }])],
    };
    expect(graphBlocker(state)).toBe(
      "A graph update for batch 2 is paused, waiting for you to approve or decline resuming it.",
    );
  });

  it("releases the slot once a batch's graph review is applied", () => {
    const state = {
      investigations: [
        batch(1, [{ status: "applied" }], [
          { status: "paused", resumeRequest: { status: "pending" } },
          { status: "paused", resumeRequest: { status: "approved" } },
        ]),
      ],
    };
    expect(graphBlocker(state)).toBeNull();
  });

  it("releases the slot when the human declined the resume", () => {
    const state = {
      investigations: [batch(2, [], [{ status: "paused", resumeRequest: { status: "declined" } }])],
    };
    expect(graphBlocker(state)).toBeNull();
  });

  it("lets a later batch start when only finished and declined jobs remain", () => {
    const state = {
      investigations: [
        batch(1, [{ status: "applied" }], [{ status: "paused", resumeRequest: { status: "pending" } }]),
        batch(2, [], [{ status: "paused", resumeRequest: { status: "declined" } }]),
        batch(5, [], []),
      ],
    };
    expect(graphBlocker(state)).toBeNull();
  });
});
