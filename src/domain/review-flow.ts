import type { ResearchClaim, ResearchEvidence, SourceRecord, FamilyDataset } from './types';

export interface WalkthroughStep {
  id: string;
  title: string;
  body: string;
  evidenceRefs: string[];
  transition: string;
}
export interface Walkthrough {
  id: string;
  revision: number;
  createdAt: string;
  proposalIds: string[];
  title: string;
  question: string;
  journey: string;
  answer: string;
  caveats: string[];
  steps: WalkthroughStep[];
  closing: string;
  correction?: string;
}
export interface GraphDraft {
  schemaVersion: number;
  baseGraphRevision: number;
  researchRevision: string;
  consumedUpdateSequence: number;
  title: string;
  summary: string;
  nodes: {id: string; kind: string; label: string; existingId: string | null; evidenceRefs: string[]}[];
  claims: ResearchClaim[];
  groups: {id: string; title: string; nodeIds: string[]; claimIds: string[]; dependsOn: string[]}[];
  issues: {id: string; kind: string; question: string; nodeIds: string[]; claimIds: string[]; evidenceRefs: string[]; provisionalTreatment: string; requestedResearch: string | null; blocksGroupIds: string[]}[];
  coverage: {findingRef: string; nodeIds: string[]; claimIds: string[]; omissionReason: string | null}[];
  identityDecisions: {nodeIds: string[]; decision: string; reason: string; evidenceRefs: string[]}[];
  representationNotes: {id: string; nodeIds: string[]; claimIds: string[]; issueIds: string[]; decision: string; alternatives: string[]; reason: string}[];
}
export interface GraphTour {
  graphSha256: string;
  introduction: string;
  steps: {id: string; title: string; focusNodeIds: string[]; focusClaimIds: string[]; explanation: string; issueIds: string[]; transition: string}[];
}
export interface GraphJob {
  id: string;
  walkthroughId?: string;
  status: 'queued' | 'running' | 'paused' | 'returned' | 'published' | 'superseded';
  engine: 'manual' | 'codex' | 'claude';
  progress: string;
  // The builder's own status note, kept beside the app's plain progress line.
  note?: string;
  createdAt: string;
  attempt: number;
  updates: {id: string; sequence: number; message: string; at: string; annotationIds: string[]}[];
  consumedUpdateSequence: number;
  issues?: GraphDraft['issues'];
  resumeRequest?: {reason: string; status: 'pending' | 'approved' | 'declined'};
}
export interface GraphReview {
  id: string;
  jobId: string;
  walkthroughId: string;
  revision: number;
  createdAt: string;
  graphSha256: string;
  graph: GraphDraft;
  tour: GraphTour;
  evidence: Record<string, ResearchEvidence>;
  sources: SourceRecord[];
  baseDataset: FamilyDataset;
  expectedGraphRevision: number;
  appliedGroupIds: string[];
  rejectedGroupIds: string[];
  // A newer revision for the same batch replaces a pending one.
  status: 'pending' | 'applied' | 'set-aside' | 'superseded';
  annotationIds: string[];
}
export interface ReviewFlow {
  walkthroughs: Walkthrough[];
  jobs: GraphJob[];
  graphReviews: GraphReview[];
}

// A finished graph review ends a batch: no more graph work belongs to it.
export function graphWorkFinished(batch: {
  closedAt?: string;
  reviewFlow?: { graphReviews: { status: string }[] };
}): boolean {
  return (
    Boolean(batch.closedAt) ||
    (batch.reviewFlow?.graphReviews.some((r) => ["applied", "set-aside"].includes(r.status)) ?? false)
  );
}

// One graph update at a time: a pending review or unfinished preparation blocks the next.
// Only a job that could still produce a review holds the slot. A leftover job on a
// finished batch can never resume, and a declined one was refused, so neither blocks.
export function graphBlocker(state: {
  investigations: {
    number?: number;
    closedAt?: string;
    reviewFlow?: {
      graphReviews: { status: string }[];
      jobs: { status: string; resumeRequest?: { status: string } }[];
    };
  }[];
}): string | null {
  for (const i of state.investigations) {
    const label = i.number ? `batch ${i.number}` : "another investigation";
    if (i.reviewFlow?.graphReviews.some((r) => r.status === "pending"))
      return `Finish the graph review for ${label} first.`;
    if (graphWorkFinished(i)) continue;
    const holding = i.reviewFlow?.jobs.find(
      (j) =>
        ["queued", "running", "returned"].includes(j.status) ||
        (j.status === "paused" && j.resumeRequest?.status !== "declined"),
    );
    if (!holding) continue;
    if (holding.status !== "paused")
      return `A graph update for ${label} is still in preparation.`;
    return holding.resumeRequest?.status === "pending"
      ? `A graph update for ${label} is paused, waiting for you to approve or decline resuming it.`
      : `A graph update for ${label} is paused. Resume it before starting another.`;
  }
  return null;
}
