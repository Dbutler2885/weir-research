import type { Investigation, ResearchState } from "./research.ts";
import { graphWorkFinished } from "./review-flow.ts";

export type WaitingOn = "human" | "coordinator" | "worker" | "nobody";
export interface NextAction {
  waitingOn: WaitingOn;
  action: string;
}

const next = (waitingOn: WaitingOn, action: string): NextAction => ({ waitingOn, action });

// Researcher results the coordinator has not yet judged, still valid for this batch.
export function currentCandidates(state: ResearchState, batch: Investigation) {
  const candidates = (state as { coordination?: { candidates?: { investigationId: string; token: string }[] } })
    .coordination?.candidates || [];
  return candidates.filter(
    (c) => c.investigationId === batch.id && batch.status === "running" && batch.lease?.token === c.token,
  );
}

// Who a batch is waiting on and what should happen next, read from its saved state alone.
export function nextAction(state: ResearchState, batch: Investigation): NextAction {
  if (batch.closedAt || batch.status === "closed") return next("nobody", "Closed.");
  if (batch.accessRequest && !batch.accessRequest.resolvedAt)
    return next("human", `Waiting for the human to help with source access: ${batch.accessRequest.instruction}`);
  if (batch.resumeRequest?.status === "pending")
    return next("human", "Waiting for the human to approve or decline resuming it.");
  const flow = batch.reviewFlow;
  const review = flow?.graphReviews.find((r) => r.status === "pending");
  if (review)
    return review.revisingSince
      ? next("worker", "A graph builder is revising the draft the coordinator sent back.")
      : next("human", "Graph draft waiting for the human's review.");
  if (flow && !graphWorkFinished(batch)) {
    const job = flow.jobs.find((j) => ["queued", "running", "returned", "paused"].includes(j.status));
    if (job?.status === "paused" && job.resumeRequest?.status === "pending")
      return next("human", "Graph update paused; waiting for the human to approve or decline resuming it.");
    if (job?.status === "returned")
      return next("coordinator", "Check the builder's draft against the human's instructions; send it back with graph-update, or write the tour and sign it off with publish-graph-review.");
    if (job?.status === "queued" && job.engine === "manual")
      return next("coordinator", "Assign a graph builder with assign-graph.");
    if (job?.status === "queued" || job?.status === "running")
      return next("worker", "A graph builder is preparing the draft.");
  }
  if (batch.status === "paused")
    return next("human", "Paused. Leave it paused; ask with request-resume only for a new reason.");
  if (currentCandidates(state, batch).length)
    return next("coordinator", "A researcher returned findings; inspect the candidate, then publish it or ask for another pass with revise.");
  if (batch.status === "running")
    return batch.lease?.worker.startsWith("Coordinator:")
      ? next("coordinator", "Claimed for native research; save checkpoints and publish the findings.")
      : next("worker", "A researcher is working on it.");
  if (batch.status === "queued") {
    const assigned = (state as { coordination?: { assignments?: Record<string, unknown> } }).coordination
      ?.assignments?.[batch.id];
    return assigned
      ? next("worker", "Assigned; waiting for a free researcher.")
      : next("coordinator", "Assign a researcher with a bounded brief.");
  }
  if (batch.walkthroughRequestedAt) {
    const writer = flow?.writer;
    if (writer?.status === "returned")
      return next("coordinator", "The walkthrough writer handed in a draft; check it against the findings and publish it.");
    if (writer?.status === "queued" || writer?.status === "running")
      return next("worker", "A walkthrough writer is working on it.");
    return next("coordinator", "The human asked for a walkthrough; assign a walkthrough writer with a brief.");
  }
  if (batch.readyAt)
    return next(
      "human",
      graphWorkFinished(batch)
        ? "Ready: the human reads the walkthrough. Its graph update is finished, so later work opens a new batch."
        : flow?.walkthroughs.length
        ? "Ready: the human reads the walkthrough and may ask for a graph update."
        : "Ready: the human may ask for a walkthrough or a graph update.",
    );
  if (batch.proposals.some((p) => p.kind === "findings"))
    return next("coordinator", "Findings are published; announce the batch with batch-ready when its research is complete.");
  return next("coordinator", "Decide the next step for this batch.");
}
