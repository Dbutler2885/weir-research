import type { Investigation, ResearchState } from "./research.ts";
import { graphWorkFinished } from "./review-flow.ts";
import { isTeam } from "./assignments.ts";

export type WaitingOn = "human" | "coordinator" | "worker" | "nobody";
export interface NextAction {
  waitingOn: WaitingOn;
  action: string;
}

const next = (waitingOn: WaitingOn, action: string): NextAction => ({ waitingOn, action });

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
    if (job?.status === "queued" && (job.awaitingBrief || job.engine === "manual"))
      return next("coordinator", "The human asked for a graph update; brief a graph builder with assign-graph, carrying any limits they set.");
    if (job?.status === "queued" || job?.status === "running")
      return next("worker", "A graph builder is preparing the draft.");
  }
  if (batch.held) return next("human", "Held by the human; start nothing on it until they release it.");
  if (batch.status === "paused")
    return next("human", isTeam(batch) ? "Paused. The human resumes its researchers; ask with request-resume only for a new reason." : "Paused. Leave it paused; ask with request-resume only for a new reason.");
  const assignments = batch.assignments || [];
  if (assignments.some((a) => a.status === "running" || a.status === "waiting"))
    return next("worker", isTeam(batch) ? "Its team is researching; findings appear as they are published." : "Researchers are working on it.");
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
  if (isTeam(batch)) return next("nobody", "Its team has finished.");
  return next("coordinator", "This batch has no team; open a new batch with a goal for further research.");
}
