import { GraphModel } from './model.ts';
import { canonical } from './changes.ts';
import type { GraphDataset, SourceRecord, ResearchEvidence } from './types';
import { diffGraphs, describeDiff } from './graph-diff.ts';

// The proposal format builders wrote before they edited the graph as tables. Only the
// one-time conversion of stored reviews reads it.
export interface LegacyGraphProposal {
  schemaVersion: number;
  baseGraphRevision: number;
  researchRevision: string;
  consumedUpdateSequence: number;
  title: string;
  summary: string;
  nodes: {id: string; kind: string; label: string; existingId: string | null; evidenceRefs: string[]}[];
  claims: import('./types').ResearchClaim[];
  groups: {id: string; title: string; nodeIds: string[]; claimIds: string[]; dependsOn: string[]}[];
  issues: {id: string; kind: string; question: string; nodeIds: string[]; claimIds: string[]; evidenceRefs: string[]; provisionalTreatment: string; requestedResearch: string | null; blocksGroupIds: string[]}[];
  coverage: {findingRef: string; nodeIds: string[]; claimIds: string[]; omissionReason: string | null}[];
  identityDecisions: {nodeIds: string[]; decision: string; reason: string; evidenceRefs: string[]}[];
  representationNotes: {id: string; nodeIds: string[]; claimIds: string[]; issueIds: string[]; decision: string; alternatives: string[]; reason: string}[];
}
type GraphDraft = LegacyGraphProposal;


export function materializeGraph(dataset: GraphDataset, graph: GraphDraft, evidence: Record<string, ResearchEvidence>, sources: SourceRecord[], ids = graph.groups.map(g => g.id)): GraphDataset {
  const data = structuredClone(dataset);
  const groups = graph.groups.filter(g => ids.includes(g.id));
  const nodeIds = new Set(groups.flatMap(g => g.nodeIds));
  const claimIds = new Set(groups.flatMap(g => g.claimIds));
  const aliases = new Map(graph.nodes.map(n => [n.id, n.existingId || n.id]));
  const mapped = (id: string) => aliases.get(id) || id;
  const existing = new Map(data.nodes.map(n => [n.id, n]));
  const sourceMap = new Map((data.sources || []).map(s => [s.id, s]));
  const evidenceMap = new Map((data.evidence || []).map(e => [e.id, e]));
  const availableSources = new Map(sources.map(s => [s.id, s]));
  const addEvidence = (refs: string[]) => {
    const sourceIds = new Set<string>();
    for (const ref of refs) {
      const e = evidence[ref];
      if (!e) throw new Error(`Missing evidence: ${ref}`);
      const record = {...e, id: ref};
      if (evidenceMap.has(ref) && canonical(evidenceMap.get(ref)) !== canonical(record)) throw new Error(`Evidence capture changed: ${ref}`);
      evidenceMap.set(ref, record);
      const source = availableSources.get(e.sourceId) || sourceMap.get(e.sourceId);
      if (!source) throw new Error(`Missing source: ${e.sourceId}`);
      if (sourceMap.has(source.id) && canonical(sourceMap.get(source.id)) !== canonical(source)) throw new Error(`Source capture changed: ${source.id}`);
      sourceMap.set(source.id, source);
      sourceIds.add(source.id);
    }
    return [...sourceIds];
  };
  for (const node of graph.nodes.filter(n => nodeIds.has(n.id))) {
    if (node.existingId) {
      const prior = existing.get(node.existingId);
      if (!prior || prior.type !== node.kind) throw new Error(`Reused node is missing or has a different type: ${node.existingId}`);
      continue;
    }
    if (existing.has(node.id)) throw new Error(`Node already exists; record an explicit reuse decision: ${node.id}`);
    const record = {id: node.id, name: node.label, type: node.kind, sourceIds: addEvidence(node.evidenceRefs)};
    data.nodes.push(record);
    if (!data.types.some(t => t.name === node.kind)) data.types.push({name: node.kind, fields: []});
    existing.set(node.id, record);
  }
  data.claims ||= [];
  const taken = new Set(data.claims.map(c => c.id));
  for (const claim of graph.claims.filter(c => claimIds.has(c.id))) {
    if (taken.has(claim.id) || existing.has(claim.id)) throw new Error(`Claim ID already exists: ${claim.id}`);
    const subjectId = mapped(claim.subjectId);
    const object = 'entityId' in claim.object ? {entityId: mapped(claim.object.entityId)} : claim.object;
    const sourceIds = addEvidence(claim.evidence.map(e => e.ref));
    data.claims.push({...structuredClone(claim), subjectId, object});
    taken.add(claim.id);
  }
  data.sources = [...sourceMap.values()];
  data.evidence = [...evidenceMap.values()];
  data.initialFocusId ||= data.nodes[0]?.id || null;
  new GraphModel(data);
  return data;
}

// One-time conversion of stored graph reviews and candidates from the proposal
// format to drafts. Each review's groups are applied to the graph it was built
// against to produce its draft; an applied review uses the groups actually applied,
// so its draft matches the graph as it stands.
type LegacyReview = {
  id: string; format?: string; status: string; graph?: GraphDraft; tour?: {steps: {id: string; focusNodeIds: string[]; focusClaimIds: string[]}[]};
  evidence?: Record<string, ResearchEvidence>; sources?: SourceRecord[]; baseDataset: GraphDataset;
  appliedGroupIds?: string[]; rejectedGroupIds?: string[]; graphSha256?: string; [key: string]: unknown;
};
type LegacyJob = {candidate?: {graph?: GraphDraft; packet?: {evidence: Record<string, ResearchEvidence>; sources: SourceRecord[]}; [key: string]: unknown}; baseDataset?: GraphDataset; issues?: unknown; submissions?: {graph?: GraphDraft; packet?: unknown; submissionDirectory?: string; [key: string]: unknown}[]; [key: string]: unknown};
type LegacyState = {investigations?: {annotations?: {target?: Record<string, unknown>; references?: Record<string, unknown>[]}[]; reviewFlow?: {jobs?: LegacyJob[]; graphReviews?: LegacyReview[]}}[]; queue?: {target?: Record<string, unknown>; references?: Record<string, unknown>[]}[]};

export function hasLegacyReviews(state: LegacyState): boolean {
  return (state.investigations || []).some((i) =>
    (i.reviewFlow?.graphReviews || []).some((r) => r.graph && r.format !== 'draft') || (i.reviewFlow?.jobs || []).some((j) => j.candidate?.graph));
}

function draftFrom(base: GraphDataset, graph: GraphDraft, evidence: Record<string, ResearchEvidence>, sources: SourceRecord[], groupIds: string[]) {
  const applied = materializeGraph(base, graph, evidence, sources, groupIds);
  const held = {evidence: new Set((base.evidence || []).map((e) => e.id)), sources: new Set((base.sources || []).map((s) => s.id))};
  const cited = {
    evidence: (applied.evidence || []).filter((e) => !held.evidence.has(e.id)),
    sources: (applied.sources || []).filter((s) => !held.sources.has(s.id)),
  };
  // Research records reach the graph only on acceptance, as for any draft.
  const draft: GraphDataset = {...applied, evidence: structuredClone(base.evidence || []), sources: structuredClone(base.sources || []), initialFocusId: base.initialFocusId};
  if (!draft.evidence!.length && !base.evidence) delete draft.evidence;
  if (!draft.sources!.length && !base.sources) delete draft.sources;
  const diff = diffGraphs(base, draft);
  const alias = new Map(graph.nodes.map((n) => [n.id, n.existingId || n.id]));
  const questions = graph.issues.map((issue) => ({
    id: issue.id, question: issue.question, nodeIds: issue.nodeIds.map((id) => alias.get(id) || id), edgeIds: issue.claimIds,
    provisionalTreatment: issue.provisionalTreatment, requestedResearch: issue.requestedResearch || '',
  }));
  const notes = graph.representationNotes.map((note) => ({
    id: note.id, nodeIds: note.nodeIds.map((id) => alias.get(id) || id), edgeIds: note.claimIds,
    decision: note.decision, alternatives: note.alternatives, reason: note.reason,
  }));
  return {draft, diff, summary: describeDiff(diff), questions, notes, cited, alias};
}

export function convertLegacyReviews<S extends LegacyState>(source: S): S {
  if (!hasLegacyReviews(source)) return source;
  const state = structuredClone(source);
  const stepOfGroup = new Map<string, {graphReviewId: string; stepId: string}>();
  for (const investigation of state.investigations || []) {
    for (const review of investigation.reviewFlow?.graphReviews || []) {
      if (!review.graph || review.format === 'draft') continue;
      const graph = review.graph;
      try {
        const groupIds = review.status === 'applied' ? review.appliedGroupIds || [] : graph.groups.map((g) => g.id);
        const converted = draftFrom(review.baseDataset, graph, review.evidence || {}, review.sources || [], groupIds);
        const tour = review.tour ? {...review.tour, steps: review.tour.steps.map((step) => ({...step, focusNodeIds: step.focusNodeIds.map((id) => converted.alias.get(id) || id)}))} : {introduction: graph.summary, steps: []};
        for (const group of graph.groups) {
          const members = new Set([...group.nodeIds.map((id) => converted.alias.get(id) || id), ...group.claimIds]);
          const step = tour.steps.find((s) => [...s.focusNodeIds, ...s.focusClaimIds].some((id) => members.has(id)));
          if (step) stepOfGroup.set(`${review.id}\u0000${group.id}`, {graphReviewId: review.id, stepId: step.id});
        }
        for (const key of ['graph', 'evidence', 'sources', 'appliedGroupIds', 'rejectedGroupIds', 'graphSha256']) delete review[key];
        Object.assign(review, {format: 'draft', draft: converted.draft, diff: converted.diff, summary: converted.summary, questions: converted.questions, notes: converted.notes, undone: [], tour, cited: converted.cited});
      } catch (error) {
        // A review that cannot be rebuilt stays readable as history, marked as such.
        review.conversionError = (error as Error).message;
      }
    }
    for (const job of investigation.reviewFlow?.jobs || []) {
      const candidate = job.candidate;
      if (candidate?.graph && candidate.packet && job.baseDataset) {
        const graph = candidate.graph;
        try {
          const converted = draftFrom(job.baseDataset, graph, candidate.packet.evidence, candidate.packet.sources, graph.groups.map((g) => g.id));
          job.candidate = {
            draft: converted.draft, diff: converted.diff, summary: converted.summary, questions: converted.questions, notes: converted.notes,
            consumedUpdateSequence: graph.consumedUpdateSequence, researchRevision: graph.researchRevision, baseGraphRevision: graph.baseGraphRevision,
            submissionDirectory: String(candidate.submissionDirectory || ''),
          };
        } catch {
          // An unconvertible candidate is dropped; the builder's saved files remain for a new draft.
          delete job.candidate;
          if (job.status === 'returned') { job.status = 'paused'; job.progress = 'This draft was prepared in an older format. Resume to prepare it again.'; }
        }
      }
      delete job.issues;
      if (job.submissions) job.submissions = job.submissions.map(({graph, packet, ...rest}) => ({...rest, ...(graph ? {summary: graph.title} : {})}));
    }
  }
  // Notes about a group now point at the tour step that showed it.
  const retarget = (target?: Record<string, unknown>) => {
    if (!target?.groupId || !target.graphReviewId) return;
    const step = stepOfGroup.get(`${target.graphReviewId}\u0000${target.groupId}`);
    if (step && !target.stepId) target.stepId = step.stepId;
    delete target.groupId;
  };
  for (const annotation of [...(state.queue || []), ...(state.investigations || []).flatMap((i) => i.annotations || [])]) {
    retarget(annotation.target);
    (annotation.references || []).forEach(retarget);
  }
  return state;
}
