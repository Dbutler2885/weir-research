import { randomUUID } from 'node:crypto';
import { GenealogyModel } from '../src/domain/model.ts';
import { canonical } from '../src/domain/changes.ts';
import { validateProposal } from '../skills/prepare-research-graph/scripts/validate-proposal.mjs';
import { validateWalkthrough, graphHash } from './review-flow.mjs';
import { validateTour } from '../skills/prepare-research-graph/scripts/validate-tour.mjs';
import { materializeGraph } from '../src/domain/graph-draft.ts';
import { organize } from './organization.mjs';

const confidence = { supported: 'established', reported: 'unknown', inferred: 'probable', disputed: 'disputed', unresolved: 'unknown' };
const relationshipType = predicate => ({ located_in: 'location', built_at: 'location', established: 'founding', built: 'founding', operated: 'management', partner_in: 'partnership' })[predicate] || 'association';

export function previewGraphImport(store, { graph, packet, focusId }) {
  if (!Array.isArray(packet?.sources)) throw new Error('Source records are required.');
  const validation = validateProposal(graph, packet);
  if (!validation.valid || validation.warnings.length) throw new Error([...validation.errors, ...validation.warnings].join('\n'));
  if (graph.baseGraphRevision !== store.state.datasetRevision) throw new Error('The live graph changed since this proposal was built.');
  const data = structuredClone(store.state.dataset);
  const existing = new Set([...data.people, ...(data.contextEntities || [])].map(n => n.id));
  if (graph.nodes.some(n => n.existingId || existing.has(n.id))) throw new Error('This importer supports new nodes only; reconcile existing identities first.');
  const claimIds = new Set((data.claims || []).map(c => c.id));
  if (graph.claims.some(c => claimIds.has(c.id))) throw new Error('An imported claim ID already exists.');
  const nodeIds = new Set(graph.nodes.map(n => n.id));
  if (graph.claims.some(c => nodeIds.has(c.id))) throw new Error('Node and claim IDs must be distinct.');
  const sourceMap = new Map((data.sources || []).map(s => [s.id, s]));
  for (const source of packet.sources) {
    if (sourceMap.has(source.id) && canonical(sourceMap.get(source.id)) !== canonical(source)) throw new Error(`Existing source differs: ${source.id}`);
    sourceMap.set(source.id, source);
  }
  data.sources = [...sourceMap.values()];
  const evidenceMap = new Map((data.evidence || []).map(e => [e.id, e]));
  const refs = new Set([...graph.nodes.flatMap(n => n.evidenceRefs), ...graph.claims.flatMap(c => c.evidence.map(e => e.ref))]);
  for (const id of refs) {
    const evidence = { ...packet.evidence[id], id };
    if (evidenceMap.has(id) && canonical(evidenceMap.get(id)) !== canonical(evidence)) throw new Error(`Existing evidence differs: ${id}`);
    evidenceMap.set(id, evidence);
  }
  data.evidence = [...evidenceMap.values()];
  const sourceIds = refs => [...new Set(refs.map(id => packet.evidence[id].sourceId))];
  data.contextEntities ||= [];
  for (const node of graph.nodes) {
    const record = { id: node.id, name: node.label, sourceIds: sourceIds(node.evidenceRefs) };
    if (node.kind === 'person') data.people.push(record);
    else data.contextEntities.push({ ...record, kind: node.kind });
  }
  data.claims = [...(data.claims || []), ...graph.claims];
  data.initialFocusId = focusId || data.initialFocusId || graph.nodes[0]?.id || null;
  new GenealogyModel(data);
  const id = randomUUID();
  store.update(next => {
    next.organization ||= { history: [] };
    next.organization.preview = {
      id, baseRevision: next.revision + 1, reason: `Import graph proposal: ${graph.title}`,
      dataset: data, removed: [], added: graph.nodes.map(n => ({ id: n.id, name: n.label, kind: n.kind })),
      graphProposal: structuredClone(graph),
    };
  });
  return { previewId: id, title: graph.title, ...validation.counts, focusId: data.initialFocusId, removes: 0, undoAvailable: true };
}

export function graphImport(store, command) {
  if (command.action === 'stage-review') return stageSavedReview(store, command);
  if (command.action === 'preview') return previewGraphImport(store, command);
  if (command.action === 'apply') {
    if (!store.state.organization?.preview?.graphProposal) throw new Error('Preview this graph import first.');
    return organize(store, { action: 'organization-apply', previewId: command.previewId });
  }
  throw new Error('Unknown graph import action.');
}


// Re-stage a completed, previously imported experiment through the normal review UI.
// The latest import is restored atomically with publication, retaining an undo snapshot.
export function stageSavedReview(store, command) {
  const history = store.state.organization?.history.find(h => h.id === command.undoId);
  if (!history?.graphProposal || history.appliedRevision !== store.state.datasetRevision) throw new Error('Only the latest graph import can be restaged.');
  const current = store.state.investigations.find(i => i.id === command.investigationId);
  if (!current || current.reviewFlow?.walkthroughs.length) throw new Error('Choose an investigation without an existing guided review.');
  if (store.state.investigations.some(i => i.status === 'running')) throw new Error('Pause running research before restaging its graph.');
  const investigation = structuredClone(current);
  for (const id of command.candidateIds || []) {
    const candidate = store.state.coordination?.candidates?.find(c => c.id === id && c.investigationId === current.id);
    if (!candidate || candidate.proposal.kind !== 'findings') throw new Error('A preserved findings candidate is required.');
    if (!investigation.proposals.some(p => p.id === id)) investigation.proposals.push({
      ...structuredClone(candidate.proposal), id, revision: investigation.proposals.length + 1,
      createdAt: candidate.receivedAt, status: 'pending', addressedAnnotationIds: current.annotations.filter(a => a.dispatchedAt).map(a => a.id),
      findings: candidate.proposal.findings.map(f => ({...structuredClone(f), status: 'pending'})),
    });
  }
  validateWalkthrough(investigation, command.walkthrough);
  const at = new Date().toISOString(), walkthroughId = randomUUID(), jobId = randomUUID(), graphReviewId = randomUUID(), undoId = randomUUID();
  const walkthrough = {...structuredClone(command.walkthrough), id: walkthroughId, revision: 1, createdAt: at};
  const graph = structuredClone(history.graphProposal), packet = structuredClone(command.packet);
  // Exact citations must agree with the already imported evidence, not a replacement capture.
  for (const ref of new Set([...graph.nodes.flatMap(n => n.evidenceRefs), ...graph.claims.flatMap(c => c.evidence.map(e => e.ref))])) {
    const saved = store.state.dataset.evidence?.find(e => e.id === ref);
    if (!saved || canonical(saved) !== canonical({...packet.evidence[ref], id: ref})) throw new Error(`Saved evidence differs: ${ref}`);
  }
  graph.baseGraphRevision = store.state.datasetRevision + 1;
  graph.researchRevision = walkthroughId;
  packet.baseGraphRevision = graph.baseGraphRevision; packet.researchRevision = walkthroughId; packet.walkthrough = walkthrough;
  const validation = validateProposal(graph, packet);
  if (!validation.valid || validation.warnings.length) throw new Error([...validation.errors, ...validation.warnings].join('\n'));
  const base = structuredClone(history.before);
  base.sources = structuredClone(store.state.dataset.sources || []);
  materializeGraph(base, graph, packet.evidence, packet.sources);
  const hash = graphHash(graph), tour = {...structuredClone(command.tour), graphSha256: hash};
  const checkedTour = validateTour(tour, graph, hash);
  if (!checkedTour.valid) throw new Error(checkedTour.errors.join('\n'));
  store.update(next => {
    const i = next.investigations.find(i => i.id === current.id);
    i.proposals = investigation.proposals;
    i.reviewFlow = {
      walkthroughs: [walkthrough],
      jobs: [{id: jobId, walkthroughId, status: 'published', engine: 'manual', progress: 'The saved graph and guided tour are ready.', createdAt: at, attempt: 0, updates: packet.updates, consumedUpdateSequence: graph.consumedUpdateSequence}],
      graphReviews: [{id: graphReviewId, jobId, walkthroughId, revision: 1, createdAt: at, graphSha256: hash, graph, tour, evidence: packet.evidence, sources: packet.sources, baseDataset: base, expectedGraphRevision: graph.baseGraphRevision, appliedGroupIds: [], rejectedGroupIds: [], status: 'pending', annotationIds: i.annotations.filter(a => a.dispatchedAt).map(a => a.id)}],
    };
    next.organization.history.push({id: undoId, at, reason: 'Restage the imported graph for guided review', before: next.dataset, appliedRevision: graph.baseGraphRevision});
    next.dataset = base; next.datasetRevision = graph.baseGraphRevision;
    delete next.organization.preview;
    i.events.push({at, message: 'Saved research walkthrough and graph tour opened for review. The previous graph import is preserved in organization history.'});
  });
  return {walkthroughId, graphReviewId, undoId, datasetRevision: store.state.datasetRevision};
}
