import { GenealogyModel } from './model.ts';
import { canonical } from './changes.ts';
import type { FamilyDataset, SourceRecord, ResearchEvidence } from './types';
import type { GraphDraft } from './review-flow';

const confidence = {supported: 'established', reported: 'unknown', inferred: 'probable', disputed: 'disputed', unresolved: 'unknown'} as const;
const types = {located_in: 'location', built_at: 'location', established: 'founding', built: 'founding', operated: 'management', partner_in: 'partnership'} as const;

export function selectedGraphGroups(graph: GraphDraft, ids: string[], applied: string[] = []): void {
  if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length) throw new Error('Choose groups to apply.');
  for (const id of ids) {
    const group = graph.groups.find(g => g.id === id);
    if (!group || applied.includes(id)) throw new Error('This group is unavailable or already applied.');
    if (group.dependsOn.some(d => !ids.includes(d) && !applied.includes(d))) throw new Error('Select the required groups too.');
    if (graph.issues.some(issue => issue.blocksGroupIds.includes(id))) throw new Error('This group has an unresolved blocking question.');
  }
}

export function materializeGraph(dataset: FamilyDataset, graph: GraphDraft, evidence: Record<string, ResearchEvidence>, sources: SourceRecord[], ids = graph.groups.map(g => g.id)): FamilyDataset {
  const data = structuredClone(dataset);
  const groups = graph.groups.filter(g => ids.includes(g.id));
  const nodeIds = new Set(groups.flatMap(g => g.nodeIds));
  const claimIds = new Set(groups.flatMap(g => g.claimIds));
  const aliases = new Map(graph.nodes.map(n => [n.id, n.existingId || n.id]));
  const mapped = (id: string) => aliases.get(id) || id;
  const existing = new Map([...data.people.map(n => ({...n, kind: 'person'})), ...(data.contextEntities || [])].map(n => [n.id, n]));
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
  data.contextEntities ||= [];
  for (const node of graph.nodes.filter(n => nodeIds.has(n.id))) {
    if (node.existingId) {
      const prior = existing.get(node.existingId);
      if (!prior || prior.kind !== node.kind) throw new Error(`Reused node is missing or has a different type: ${node.existingId}`);
      continue;
    }
    if (existing.has(node.id)) throw new Error(`Node already exists; record an explicit reuse decision: ${node.id}`);
    const record = {id: node.id, name: node.label, sourceIds: addEvidence(node.evidenceRefs)};
    if (node.kind === 'person') data.people.push(record);
    else data.contextEntities.push({...record, kind: node.kind as NonNullable<FamilyDataset['contextEntities']>[number]['kind']});
    existing.set(node.id, {...record, kind: node.kind});
  }
  data.contextConnections ||= [];
  data.claims ||= [];
  const taken = new Set([...data.claims, ...data.contextConnections].map(c => c.id));
  for (const claim of graph.claims.filter(c => claimIds.has(c.id))) {
    if (taken.has(claim.id) || existing.has(claim.id)) throw new Error(`Claim ID already exists: ${claim.id}`);
    const subjectId = mapped(claim.subjectId);
    const object = 'entityId' in claim.object ? {entityId: mapped(claim.object.entityId)} : claim.object;
    const sourceIds = addEvidence(claim.evidence.map(e => e.ref));
    data.claims.push({...structuredClone(claim), subjectId, object});
    if ('entityId' in object) data.contextConnections.push({
      id: claim.id, fromId: subjectId, toId: object.entityId,
      type: types[claim.predicate as keyof typeof types] || 'association', label: claim.predicate.replaceAll('_', ' '),
      ...(claim.time ? {date: claim.time} : {}), confidence: confidence[claim.qualification], qualification: claim.qualification, sourceIds,
    });
    taken.add(claim.id);
  }
  data.sources = [...sourceMap.values()];
  data.evidence = [...evidenceMap.values()];
  data.initialFocusId ||= [...data.people, ...data.contextEntities][0]?.id || null;
  new GenealogyModel(data);
  return data;
}
