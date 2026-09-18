import type { GraphDraft, GraphTour, Walkthrough } from '../../src/domain/review-flow';
import { graphHash } from '../../server/review-flow.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
export const emptyGraph = {version: 1, title: 'Fictional workshop investigation', initialFocusId: null, people: [], unions: []};
export function prepareResearch(store: any) {
  const {investigationId} = store.command({type: 'annotate', question: 'Where was Example Works?', dispatch: true});
  const task = store.command({type: 'claim', investigationId, worker: 'Fixture researcher'});
  const {proposalId} = store.command({type: 'propose', investigationId, token: task.investigation.lease.token, proposal: {
    kind: 'findings', title: 'The fictional location', summary: 'A register reports the works in Example Bay.', ambiguity: 'The precise site is unknown.', changes: [],
    sources: [{id: 'register', title: 'Fictional register', access: 'full-text'}],
    evidence: [{id: 'passage', sourceId: 'register', quote: 'Example Works stood in Example Bay.', context: 'Fictional source.', locator: 'Page 1', interpretation: 'Reported location.', stance: 'supports'}],
    findings: [{id: 'location', statement: 'The works were reported in Example Bay.', qualification: 'reported', explanation: 'The register identifies the town, but not a street.', evidenceIds: ['passage']}],
  }});
  const walkthrough: Omit<Walkthrough, 'id' | 'revision' | 'createdAt'> = {
    proposalIds: [proposalId], title: 'Locating Example Works', question: 'Where was Example Works?', journey: 'We compared the fictional register with the supplied question.', answer: 'The register places the works in Example Bay.', caveats: ['The street address remains unknown.'],
    steps: [{id: 'location', title: 'A town, but not a street', body: 'The entry locates the works in Example Bay.\n\nThat gives us a place to connect without inventing an exact site.', evidenceRefs: [`${proposalId}/passage`], transition: 'Let’s bring this qualified location into the graph.'}], closing: 'We have a reported town and an open question about the site. Let’s organize what we have.',
  };
  return {investigationId, proposalId, walkthrough};
}
export function graphFor(packet: any): GraphDraft {
  const ref = Object.keys(packet.evidence)[0]!;
  return {
    schemaVersion: 1, baseGraphRevision: packet.baseGraphRevision, researchRevision: packet.researchRevision, consumedUpdateSequence: packet.updates.at(-1)?.sequence || 0,
    title: 'Example Works and its town', summary: 'A reported location with its evidence.',
    nodes: [{id: 'bay', kind: 'place', label: 'Example Bay', existingId: null, evidenceRefs: [ref]}, {id: 'works', kind: 'facility', label: 'Example Works', existingId: null, evidenceRefs: [ref]}],
    claims: [{id: 'location', subjectId: 'works', predicate: 'located_in', object: {entityId: 'bay'}, qualification: 'reported', time: null, reasoning: 'The register identifies the town.', evidence: [{ref, role: 'supports'}]}],
    groups: [{id: 'place', title: 'The town', nodeIds: ['bay'], claimIds: [], dependsOn: []}, {id: 'factory', title: 'The works and reported location', nodeIds: ['works'], claimIds: ['location'], dependsOn: ['place']}],
    identityDecisions: [], issues: [], representationNotes: [], coverage: Object.keys(packet.findings).map(findingRef => ({findingRef, nodeIds: ['works'], claimIds: ['location'], omissionReason: ''})),
  };
}
export function tourFor(graph: GraphDraft): GraphTour {
  return {graphSha256: graphHash(graph), introduction: 'Here are the works and the town named by the register.', steps: [{id: 'site', title: 'Keep the location attributed', focusNodeIds: ['works','bay'], focusClaimIds: ['location'], explanation: 'The connection preserves what the register reports. It does not claim an exact address.', issueIds: [], transition: 'These two groups can now be added with their evidence.'}]};
}
export function writeGraphCsv(directory: string, graph: GraphDraft) {
  const table = (name: string, header: string, rows: unknown[][] = []) => writeFileSync(join(directory, `${name}.csv`), [header, ...rows.map(row => row.map(v => `"${String(v ?? '').replaceAll('"','""')}"`).join(','))].join('\n') + '\n');
  table('proposal','schemaVersion,baseGraphRevision,researchRevision,consumedUpdateSequence,title,summary',[[graph.schemaVersion,graph.baseGraphRevision,graph.researchRevision,graph.consumedUpdateSequence,graph.title,graph.summary]]);
  table('nodes','id,kind,label,existingId',graph.nodes.map(n=>[n.id,n.kind,n.label,n.existingId]));
  table('node-evidence','nodeId,evidenceRef',graph.nodes.flatMap(n=>n.evidenceRefs.map(ref=>[n.id,ref])));
  table('claims','id,subjectId,predicate,objectType,objectValue,qualification,time,reasoning',graph.claims.map(c=>[c.id,c.subjectId,c.predicate,'entityId' in c.object ? 'entity' : typeof c.object.value === 'number' ? 'number' : 'text','entityId' in c.object ? c.object.entityId : c.object.value,c.qualification,c.time,c.reasoning]));
  table('claim-evidence','claimId,evidenceRef,role',graph.claims.flatMap(c=>c.evidence.map(e=>[c.id,e.ref,e.role])));
  table('groups','id,title,nodeIds,claimIds,dependsOn',graph.groups.map(g=>[g.id,g.title,g.nodeIds.join('|'),g.claimIds.join('|'),g.dependsOn.join('|')]));
  table('coverage','findingRef,nodeIds,claimIds,omissionReason',graph.coverage.map(c=>[c.findingRef,c.nodeIds.join('|'),c.claimIds.join('|'),c.omissionReason]));
  table('identities','nodeIds,decision,reason,evidenceRefs');
  table('issues','id,kind,question,nodeIds,claimIds,evidenceRefs,provisionalTreatment,requestedResearch,blocksGroupIds');
  table('representation-notes','id,nodeIds,claimIds,issueIds,decision,alternatives,reason');
  writeFileSync(join(directory,'submission.txt'),'done\n');
}
