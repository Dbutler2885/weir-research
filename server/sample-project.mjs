import { WorkspaceStore } from './store.mjs';
import { flowCommand, receiveDraft } from './review-flow.mjs';
import { graphToTables } from '../src/domain/graph-csv.ts';
import { readDelivery } from '../src/domain/graph-delivery.ts';

// The sample project a visitor can open from setup: a finished batch of research
// on an invented family in an invented town, with its findings, a walkthrough and
// a draft graph waiting for review. Everything in it is fictional, and it is built
// through the app's own commands, so it always matches what the app makes.

const graph = {
  version: 2,
  title: 'Sample: the fictional Marrow family of Tidewell',
  initialFocusId: 'edith',
  people: [{id: 'edith', name: 'Edith Marrow', descriptor: 'Fictional sample person', biography: 'An invented person in the sample project.', sourceIds: []}],
  contextEntities: [],
  claims: [],
  sources: [],
};

const QUESTION = 'Who were Edith Marrow\'s parents, and where did they come from?';

const SOURCES = [
  {id: 'register', title: 'Tidewell parish register of baptisms (fictional)', access: 'full-text'},
  {id: 'census', title: 'Tidewell household list, 1881 (fictional)', access: 'full-text'},
  {id: 'gazette', title: 'The Tidewell Gazette, marriage notices (fictional)', access: 'full-text'},
];

const EVIDENCE = [
  {id: 'baptism', sourceId: 'register', quote: 'Edith, daughter of Thomas Marrow, net maker, and Ann his wife, baptised the 3rd of May.', context: 'An invented baptism entry for the sample.', locator: 'Page 14, entry 52', interpretation: 'Names both parents and the father\'s trade.', stance: 'supports'},
  {id: 'household', sourceId: 'census', quote: 'Thomas Marrow, head, 38, net maker, born Tidewell. Ann Marrow, wife, 34, born Saltmere. Edith, daughter, 9.', context: 'An invented household list for the sample.', locator: 'Harbour Row, household 7', interpretation: 'Places the family together and gives each parent\'s birthplace.', stance: 'supports'},
  {id: 'notice', sourceId: 'gazette', quote: 'At Saltmere, Thomas Marrow of Tidewell to Ann Holt, of this parish.', context: 'An invented marriage notice for the sample.', locator: 'Issue of the 12th of June, page 3', interpretation: 'Gives Ann\'s maiden name and places the marriage in Saltmere.', stance: 'supports'},
  {id: 'second-list', sourceId: 'census', quote: 'Thomas Marrow, 48, net maker, born Saltmere.', context: 'A later invented household list for the sample, which disagrees with the first.', locator: 'Harbour Row, household 9', interpretation: 'Gives a different birthplace for Thomas.', stance: 'challenges'},
];

const FINDINGS = [
  {id: 'parents', statement: 'Edith\'s parents were Thomas and Ann Marrow.', qualification: 'supported', explanation: 'The baptism names both parents, and the household list shows Edith living with them.', evidenceIds: ['baptism', 'household']},
  {id: 'trade', statement: 'Thomas Marrow was a net maker.', qualification: 'supported', explanation: 'Both the baptism and the household list give the same trade.', evidenceIds: ['baptism', 'household']},
  {id: 'maiden-name', statement: 'Ann was born Ann Holt, in Saltmere.', qualification: 'reported', explanation: 'The marriage notice names Ann Holt of Saltmere; the household list agrees on Saltmere.', evidenceIds: ['notice', 'household']},
  {id: 'birthplace', statement: 'Thomas was born in Tidewell or in Saltmere.', qualification: 'disputed', explanation: 'The two household lists disagree about where Thomas was born.', evidenceIds: ['household', 'second-list']},
];

// What a graph builder would draft from those findings: Edith's parents, the two
// towns, and each connection citing its evidence.
function draftFiles(job) {
  const ref = (id) => Object.keys(job.packet.evidence).find((key) => key.endsWith(`/${id}`));
  const tables = graphToTables(job.baseDataset);
  const nodes = [
    'thomas,person,Thomas Marrow,Net maker (fictional),,,,,,,register;census',
    'ann,person,Ann Marrow,Fictional sample person,,,,,Ann Holt,,census;gazette',
    'tidewell,place,Tidewell,A fictional harbour town,,,,,,,census',
    'saltmere,place,Saltmere,A fictional village,,,,,,,gazette',
  ];
  const edges = [
    `thomas-parent,thomas,parent_of,node,edith,supported,,The baptism names Thomas as Edith's father.,${ref('baptism')};${ref('household')},,,register;census`,
    `ann-parent,ann,parent_of,node,edith,supported,,The baptism names Ann as Edith's mother.,${ref('baptism')};${ref('household')},,,register;census`,
    `marriage,thomas,married_to,node,ann,reported,,The marriage notice records their marriage at Saltmere.,${ref('notice')},,,gazette`,
    `ann-born,ann,born_in,node,saltmere,reported,,The marriage notice and the household list both give Saltmere.,${ref('notice')};${ref('household')},,,gazette;census`,
    `thomas-born,thomas,born_in,node,tidewell,disputed,,One household list gives Tidewell and a later one Saltmere.,${ref('household')},${ref('second-list')},,census`,
    `family-home,thomas,lived_in,node,tidewell,supported,,The household list places the family on Harbour Row.,${ref('household')},,,census`,
  ];
  return {
    'nodes.csv': `${tables['nodes.csv']}${nodes.join('\n')}\n`,
    'edges.csv': `${tables['edges.csv']}${edges.join('\n')}\n`,
    'questions.csv': 'id,question,nodeIds,edgeIds,provisionalTreatment,requestedResearch\nthomas-birthplace,Where was Thomas Marrow born?,thomas,thomas-born,Kept as disputed with both lists cited.,Look for Thomas\'s own baptism in both parishes.\n',
    'submission.txt': 'done 0\n',
  };
}

// Builds the sample in a directory: a finished batch whose walkthrough and draft
// graph are ready for the visitor's review.
export function buildSample(directory) {
  const store = new WorkspaceStore(directory, graph);
  // The visitor's question, as it would have come in, and the coordinator's batch for it.
  store.command({type: 'send', text: 'I\'d like to know more about Edith\'s family.', annotation: {question: QUESTION, references: [{table: 'people', recordId: 'edith', label: 'Edith Marrow'}]}});
  const annotationId = store.state.conversation.at(-1).annotations[0].id;
  store.command({type: 'reply', text: 'I\'ll look for Edith\'s baptism first, then follow her parents through the household lists and any marriage notice.', references: []});
  const {investigationId} = store.command({type: 'open-batch', title: 'Edith\'s parents', brief: {purpose: 'Find who Edith Marrow\'s parents were and where they came from.', scope: 'Her parents and their birthplaces, not earlier generations.', direction: 'Start with the Tidewell baptisms.'}, questions: [{title: QUESTION, annotationIds: [annotationId]}]});
  const task = store.command({type: 'claim', investigationId, worker: 'Sample researcher'});
  const {proposalId} = store.command({type: 'propose', investigationId, token: task.investigation.lease.token, proposal: {
    kind: 'findings',
    title: 'Edith\'s parents and their two towns',
    summary: 'A baptism, two household lists and a marriage notice name Edith\'s parents, Thomas and Ann Marrow, and connect the family to Tidewell and Saltmere.',
    ambiguity: 'The household lists disagree about where Thomas was born.',
    changes: [],
    sources: SOURCES,
    evidence: EVIDENCE,
    findings: FINDINGS,
  }});
  store.command({type: 'batch-ready', investigationId, text: 'Batch 1 is ready: Edith\'s parents were Thomas and Ann Marrow, with one open question about where Thomas was born.'});
  flowCommand(store, {action: 'publish-walkthrough', investigationId, walkthrough: {
    proposalIds: [proposalId],
    title: 'Finding Edith\'s parents',
    question: QUESTION,
    journey: 'We started from Edith\'s baptism, then followed her parents into the household lists and a marriage notice.',
    answer: 'Edith\'s parents were Thomas Marrow, a net maker, and Ann Marrow, born Ann Holt in Saltmere. Where Thomas was born is still unsettled.',
    caveats: ['Every record here is invented for the sample.', 'The two household lists disagree about Thomas\'s birthplace.'],
    steps: [
      {id: 'baptism', title: 'The baptism names both parents', body: 'Edith\'s baptism names her father, Thomas Marrow, a net maker, and her mother, Ann.\n\nThat gives us both parents from a single entry.', evidenceRefs: [`${proposalId}/baptism`], transition: 'Next, the family at home.'},
      {id: 'household', title: 'The family at home', body: 'The household list shows Thomas, Ann and Edith together on Harbour Row, with a birthplace for each parent.', evidenceRefs: [`${proposalId}/household`], transition: 'Ann\'s birthplace leads to Saltmere.'},
      {id: 'marriage', title: 'Ann Holt of Saltmere', body: 'The marriage notice gives Ann\'s maiden name, Holt, and places the wedding in her home parish.', evidenceRefs: [`${proposalId}/notice`], transition: 'One question remains about Thomas.'},
      {id: 'disagreement', title: 'Two answers for Thomas', body: 'A later household list gives Saltmere as Thomas\'s birthplace, where the first gave Tidewell.\n\nWe keep both, rather than choosing one.', evidenceRefs: [`${proposalId}/household`, `${proposalId}/second-list`], transition: 'Let\'s see how this looks in the graph.'},
    ],
    closing: 'We have both parents, their marriage and their towns, and one open question about Thomas.',
  }});
  const {jobId} = flowCommand(store, {action: 'request-graph', investigationId}, 'human');
  store.update((next) => {
    next.investigations.find((i) => i.id === investigationId).reviewFlow.jobs.find((j) => j.id === jobId).status = 'running';
  });
  const job = store.state.investigations.find((i) => i.id === investigationId).reviewFlow.jobs.find((j) => j.id === jobId);
  const delivery = readDelivery(draftFiles(job), job.baseDataset, {evidenceIds: Object.keys(job.packet.evidence), sourceIds: job.packet.sources.map((s) => s.id)});
  if (delivery.problems?.length) throw new Error(`The sample draft is invalid: ${delivery.problems.join(' ')}`);
  receiveDraft(store, investigationId, jobId, delivery, job.packet, 'sample');
  flowCommand(store, {action: 'publish-graph-review', investigationId, jobId, tour: {
    introduction: 'Here is Edith with the parents and towns the research found.',
    steps: [
      {id: 'parents', title: 'Edith\'s parents', focusNodeIds: ['edith', 'thomas', 'ann'], focusClaimIds: ['thomas-parent', 'ann-parent', 'marriage'], explanation: 'Both parents come from the baptism and the household list; the marriage from the notice.', issueIds: [], transition: 'Now the towns.'},
      {id: 'towns', title: 'Two towns', focusNodeIds: ['tidewell', 'saltmere'], focusClaimIds: ['ann-born', 'thomas-born', 'family-home'], explanation: 'Thomas\'s birthplace stays disputed, with both household lists cited.', issueIds: ['thomas-birthplace'], transition: 'That is the whole draft.'},
    ],
  }});
  // The sample starts its coordinator only when the visitor first acts in it.
  store.update((next) => {
    next.sample = true;
  });
  return store;
}
