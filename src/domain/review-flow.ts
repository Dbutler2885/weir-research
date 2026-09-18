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
  walkthroughId: string;
  status: 'queued' | 'running' | 'paused' | 'returned' | 'published' | 'superseded';
  engine: 'manual' | 'codex' | 'claude';
  progress: string;
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
  status: 'pending' | 'applied' | 'set-aside';
  annotationIds: string[];
}
export interface ReviewFlow {
  walkthroughs: Walkthrough[];
  jobs: GraphJob[];
  graphReviews: GraphReview[];
}
