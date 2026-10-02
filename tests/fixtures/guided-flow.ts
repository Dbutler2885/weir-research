import type { GraphTour, Walkthrough } from '../../src/domain/review-flow';
import { graphToTables } from '../../src/domain/graph-csv';
import { readDelivery } from '../../src/domain/graph-delivery';
import { receiveDraft } from '../../server/review-flow.mjs';
import type { GraphDataset } from '../../src/domain/types';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Explicitly fictional: an invented works in an imaginary bay.
export const emptyGraph: GraphDataset = {version: 3, title: 'Fictional workshop investigation', initialFocusId: null, nodes: [], types: [{name: 'place', fields: []}, {name: 'facility', fields: []}], relationships: []};

export function prepareResearch(store: any) {
  const {investigationId} = store.command({type: 'annotate', question: 'Where was Example Works?', dispatch: true});
  const task = store.command({type: 'claim', investigationId, worker: 'Fixture researcher'});
  const {proposalId} = store.command({type: 'propose', investigationId, token: task.assignment.lease.token, proposal: {
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

// What a builder writes for the fixture research: the works, its town, and the
// reported location, citing the registry passage by id.
export function draftFiles(job: {baseDataset: GraphDataset; packet: any; updates: unknown[]}) {
  const ref = Object.keys(job.packet.evidence)[0]!;
  const tables = graphToTables(job.baseDataset);
  return {
    ...tables,
    'nodes.csv': `${tables['nodes.csv']}bay,place,Example Bay,,An invented bay.,,\nworks,facility,Example Works,,An invented works.,,register\n`,
    'edges.csv': `${tables['edges.csv']}location,works,located_in,node,bay,reported,,The register identifies the town.,${ref},,,\n`,
    'questions.csv': 'id,question,nodeIds,edgeIds,provisionalTreatment,requestedResearch\nstreet,Which street was the works on?,works,location,Kept at town level.,Search the street directory.\n',
    'submission.txt': `done ${job.updates.length}\n`,
  };
}

export function writeDraft(directory: string, files: Record<string, string>) {
  for (const [name, text] of Object.entries(files)) writeFileSync(join(directory, name), text);
}

// Stand in for a builder finishing: its draft becomes the coordinator's candidate.
export function returnDraft(store: any, investigationId: string, files?: Record<string, string>) {
  store.update((next: any) => { next.investigations.find((i: any) => i.id === investigationId).reviewFlow.jobs.at(-1).status = 'running'; });
  const job = store.state.investigations.find((i: any) => i.id === investigationId).reviewFlow.jobs.at(-1);
  const delivery = readDelivery(files || draftFiles(job), job.baseDataset, {evidenceIds: Object.keys(job.packet.evidence), sourceIds: job.packet.sources.map((s: any) => s.id)});
  receiveDraft(store, investigationId, job.id, delivery, job.packet, 'fictional');
  return delivery;
}

export function tourFor(): GraphTour {
  return {introduction: 'Here are the works and the town named by the register.', steps: [{id: 'site', title: 'Keep the location attributed', focusNodeIds: ['works', 'bay'], focusClaimIds: ['location'], explanation: 'The connection preserves what the register reports. It does not claim an exact address.', issueIds: ['street'], transition: 'That is the whole draft.'}]};
}
