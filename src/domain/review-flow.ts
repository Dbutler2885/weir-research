import type { ResearchEvidence, SourceRecord, FamilyDataset } from './types';
import type { GraphDiff } from './graph-diff.ts';
import type { DraftNote, DraftQuestion } from './graph-delivery.ts';

export interface WalkthroughStep {
  id: string;
  title: string;
  body: string;
  evidenceRefs: string[];
  transition: string;
}
import type { WalkthroughEdits } from './walkthrough-edits';
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
export interface GraphTour {
  introduction: string;
  steps: {id: string; title: string; focusNodeIds: string[]; focusClaimIds: string[]; explanation: string; issueIds: string[]; transition: string}[];
}
// What a builder returned, read back and checked, awaiting the coordinator's sign-off.
export interface DraftCandidate {
  draft: FamilyDataset;
  diff: GraphDiff;
  summary: string;
  questions: DraftQuestion[];
  notes: DraftNote[];
  consumedUpdateSequence: number;
  researchRevision: string;
  baseGraphRevision: number;
  submissionDirectory: string;
}
export interface GraphJob {
  id: string;
  // Jobs created before builders edited tables carry no format.
  format?: 'tables';
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
  candidate?: DraftCandidate;
  resumeRequest?: {reason: string; status: 'pending' | 'approved' | 'declined'};
}
export interface GraphReview {
  id: string;
  jobId: string;
  walkthroughId?: string;
  revision: number;
  createdAt: string;
  format: 'draft';
  draft: FamilyDataset;
  diff: GraphDiff;
  summary: string;
  questions: DraftQuestion[];
  notes: DraftNote[];
  // Instructions the coordinator signed off as left undone, with the builder's reason.
  undone: {instruction: string; reason: string}[];
  tour: GraphTour;
  // Research records accepting will copy into the graph.
  cited: {evidence: ResearchEvidence[]; sources: SourceRecord[]};
  // The graph the draft was prepared against, which removed records are read from.
  baseDataset: FamilyDataset;
  expectedGraphRevision: number;
  // A newer revision for the same batch replaces a pending one.
  status: 'pending' | 'applied' | 'set-aside' | 'superseded' | 'undone';
  decidedAt?: string;
  undoneAt?: string;
  // Set when the coordinator sent this draft back; the next draft replaces it.
  revisingSince?: string;
  undoId?: string;
  annotationIds: string[];
}
// The agent writing a batch's requested walkthrough. The coordinator assigns it,
// and checks and publishes the draft it hands in.
export interface WalkthroughWriter {
  id: string;
  status: 'queued' | 'running' | 'returned' | 'paused' | 'published';
  engine: 'claude' | 'codex';
  brief: string;
  progress: string;
  attempt: number;
  corrections: number;
  draft?: Omit<Walkthrough, 'id' | 'createdAt' | 'revision'>;
  directory?: string;
}
export interface ReviewFlow {
  walkthroughs: Walkthrough[];
  jobs: GraphJob[];
  graphReviews: GraphReview[];
  writer?: WalkthroughWriter;
  // Edits the coordinator suggested to the latest walkthrough, awaiting the human.
  edits?: WalkthroughEdits;
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

const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 100_000;

// A tour explains a draft. Its steps can point at records the draft keeps and at
// ones it removes, which the review shows as ghosts.
export function validateDraftTour(tour: unknown, candidate: DraftCandidate, base: FamilyDataset): GraphTour {
  const problems: string[] = [];
  const t = tour as GraphTour;
  if (!t || !nonempty(t.introduction)) problems.push('The tour needs an introduction.');
  if (!Array.isArray(t?.steps) || !t.steps.length) problems.push('The tour needs at least one step.');
  const nodes = new Set([...candidate.draft.people, ...(candidate.draft.contextEntities || []), ...base.people, ...(base.contextEntities || [])].map((n) => n.id));
  const edges = new Set([...(candidate.draft.claims || []), ...(base.claims || [])].map((c) => c.id));
  const questions = new Set(candidate.questions.map((q) => q.id));
  const seen = new Set<string>();
  for (const step of Array.isArray(t?.steps) ? t.steps : []) {
    const where = `Tour step ${step?.id || '(no id)'}`;
    if (!['id', 'title', 'explanation', 'transition'].every((key) => nonempty((step as Record<string, unknown>)?.[key]))) problems.push(`${where} needs an id, title, explanation and transition.`);
    if (seen.has(step?.id)) problems.push(`${where} repeats a step id.`);
    seen.add(step?.id);
    for (const [key, known, what] of [['focusNodeIds', nodes, 'node'], ['focusClaimIds', edges, 'edge'], ['issueIds', questions, 'builder question']] as const) {
      const list = (step as Record<string, unknown>)?.[key];
      if (!Array.isArray(list)) { problems.push(`${where} needs ${key} as a list.`); continue; }
      for (const id of list) if (!known.has(id)) problems.push(`${where} names a ${what} that is neither in the draft nor the graph: ${id}`);
    }
  }
  if (problems.length) throw new Error(problems.join('\n'));
  return structuredClone(t);
}

// Feedback the human sent about a review after it was published has not reached a builder yet.
export function feedbackAwaitingDraft(
  batch: {annotations: {id: string; dispatchedAt?: string; target: {graphReviewId?: string}; references?: {graphReviewId?: string}[]}[]},
  review: {id: string; annotationIds: string[]},
): boolean {
  return batch.annotations.some((a) => a.dispatchedAt && !review.annotationIds.includes(a.id) && [a.target, ...(a.references || [])].some((t) => t?.graphReviewId === review.id));
}
