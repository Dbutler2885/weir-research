import { WorkspaceStore } from './store.mjs';
import { flowCommand, receiveDraft } from './review-flow.mjs';
import { graphToTables } from '../src/domain/graph-csv.ts';
import { readDelivery } from '../src/domain/graph-delivery.ts';
import { defaultRelationships } from '../src/domain/graph-schema.ts';

// The sample project a visitor can open from setup: a finished batch of research
// on an invented family in an invented town, with its findings, a walkthrough and
// a draft graph waiting for review. Everything in it is fictional, and it is built
// through the app's own commands, so it always matches what the app makes.

const graph = {
  version: 3,
  title: 'Sample: the fictional Marrow family of Tidewell',
  initialFocusId: 'edith',
  nodes: [
    {id: 'edith', name: 'Edith Marrow', type: 'person', dates: '1872-1954', summary: 'A net finisher who lived on Harbour Row and worked at Tidewell Net Works.', sourceIds: ['works-ledger']},
    {id: 'ruth', name: 'Ruth Bell', type: 'person', dates: '1869-1938', summary: 'A twine spinner recorded alongside Edith at Tidewell Net Works.', sourceIds: ['works-ledger']},
    {id: 'isaac', name: 'Isaac Shaw', type: 'person', dates: '1858-1901', summary: 'The Tidewell mariner recorded as master of the Morning Star.', sourceIds: ['harbour-register']},
    {id: 'net-works', name: 'Tidewell Net Works', type: 'organization', dates: 'founded 1864', summary: 'A small waterfront works that made and repaired fishing nets for Tidewell vessels.', sourceIds: ['works-ledger', 'gazette-shipping']},
    {id: 'morning-star', name: 'Morning Star', type: 'vessel', dates: '1887-1901', summary: 'A two-masted fishing schooner registered at Tidewell and lost at North Shoal.', sourceIds: ['harbour-register', 'warden-report']},
    {id: 'tidewell', name: 'Tidewell', type: 'place', summary: 'A fictional harbour town whose net works and fishing fleet connect the people in this sample.', sourceIds: ['works-ledger', 'harbour-register']},
    {id: 'north-shoal', name: 'North Shoal', type: 'place', summary: 'A fictional shoal outside Tidewell harbour where the Morning Star was lost in 1901.', sourceIds: ['warden-report']},
  ],
  types: [
    {name: 'person', color: 'sea', shape: 'rounded', fields: [{name: 'born', value: 'date'}, {name: 'occupation', value: 'text'}]},
    {name: 'organization', color: 'rust', shape: 'square', fields: [{name: 'founded', value: 'date'}]},
    {name: 'vessel', color: 'gold', shape: 'rounded', fields: [{name: 'launched', value: 'date'}, {name: 'registry_number', value: 'text'}]},
    {name: 'place', color: 'moss', shape: 'round', fields: []},
  ],
  relationships: [
    ...defaultRelationships(),
    {name: 'worked_at', reverse: 'employed', arrangement: 'free'},
    {name: 'lived_in', reverse: 'home of', arrangement: 'free'},
    {name: 'located_in', reverse: 'location of', arrangement: 'free'},
    {name: 'supplied', reverse: 'supplied by', arrangement: 'free'},
    {name: 'home_port', reverse: 'home port of', arrangement: 'free'},
    {name: 'captained', reverse: 'captained by', arrangement: 'free'},
    {name: 'wrecked_at', reverse: 'wreck site of', arrangement: 'free'},
  ],
  claims: [
    {id: 'edith-trade', subjectId: 'edith', predicate: 'occupation', object: {value: 'Net finisher'}, qualification: 'supported', time: '1890', reasoning: 'The employment ledger names Edith and her job.', evidence: [{ref: 'accepted/edith-ledger', role: 'supports'}], sourceIds: ['works-ledger']},
    {id: 'edith-work', subjectId: 'edith', predicate: 'worked_at', object: {entityId: 'net-works'}, qualification: 'supported', time: '1890', reasoning: 'The employment ledger records Edith at the works.', evidence: [{ref: 'accepted/edith-ledger', role: 'supports'}], sourceIds: ['works-ledger']},
    {id: 'edith-home', subjectId: 'edith', predicate: 'lived_in', object: {entityId: 'tidewell'}, qualification: 'supported', time: '1890', reasoning: 'The ledger gives Edith an address on Harbour Row in Tidewell.', evidence: [{ref: 'accepted/edith-ledger', role: 'supports'}], sourceIds: ['works-ledger']},
    {id: 'ruth-trade', subjectId: 'ruth', predicate: 'occupation', object: {value: 'Twine spinner'}, qualification: 'supported', time: '1890', reasoning: 'The employment ledger names Ruth and her job.', evidence: [{ref: 'accepted/ruth-ledger', role: 'supports'}], sourceIds: ['works-ledger']},
    {id: 'ruth-work', subjectId: 'ruth', predicate: 'worked_at', object: {entityId: 'net-works'}, qualification: 'supported', time: '1890', reasoning: 'The employment ledger records Ruth at the works.', evidence: [{ref: 'accepted/ruth-ledger', role: 'supports'}], sourceIds: ['works-ledger']},
    {id: 'works-founded', subjectId: 'net-works', predicate: 'founded', object: {value: '1864'}, qualification: 'reported', time: '1864', reasoning: 'The surviving ledger labels itself volume 14 and says the works opened in 1864.', evidence: [{ref: 'accepted/works-heading', role: 'supports'}], sourceIds: ['works-ledger']},
    {id: 'works-place', subjectId: 'net-works', predicate: 'located_in', object: {entityId: 'tidewell'}, qualification: 'supported', time: null, reasoning: 'The ledger identifies the works as standing at East Wharf, Tidewell.', evidence: [{ref: 'accepted/works-heading', role: 'supports'}], sourceIds: ['works-ledger']},
    {id: 'works-supplied-ship', subjectId: 'net-works', predicate: 'supplied', object: {entityId: 'morning-star'}, qualification: 'reported', time: '1896', reasoning: 'A shipping notice records new nets supplied to the schooner.', evidence: [{ref: 'accepted/supply-notice', role: 'supports'}], sourceIds: ['gazette-shipping']},
    {id: 'ship-port', subjectId: 'morning-star', predicate: 'home_port', object: {entityId: 'tidewell'}, qualification: 'supported', time: '1896', reasoning: 'The harbour register lists Tidewell as the vessel\'s port.', evidence: [{ref: 'accepted/vessel-register', role: 'supports'}], sourceIds: ['harbour-register']},
    {id: 'ship-launched', subjectId: 'morning-star', predicate: 'launched', object: {value: '1887'}, qualification: 'supported', time: '1887', reasoning: 'The harbour register gives the vessel\'s launch year.', evidence: [{ref: 'accepted/vessel-register', role: 'supports'}], sourceIds: ['harbour-register']},
    {id: 'ship-number', subjectId: 'morning-star', predicate: 'registry_number', object: {value: 'TW-184'}, qualification: 'supported', time: null, reasoning: 'The harbour register gives the vessel\'s registry number.', evidence: [{ref: 'accepted/vessel-register', role: 'supports'}], sourceIds: ['harbour-register']},
    {id: 'isaac-captain', subjectId: 'isaac', predicate: 'captained', object: {entityId: 'morning-star'}, qualification: 'supported', time: '1896', reasoning: 'The harbour register names Isaac Shaw as master.', evidence: [{ref: 'accepted/vessel-register', role: 'supports'}], sourceIds: ['harbour-register']},
    {id: 'isaac-home', subjectId: 'isaac', predicate: 'lived_in', object: {entityId: 'tidewell'}, qualification: 'reported', time: '1896', reasoning: 'The register describes Isaac as being of Tidewell.', evidence: [{ref: 'accepted/vessel-register', role: 'supports'}], sourceIds: ['harbour-register']},
    {id: 'ship-wreck', subjectId: 'morning-star', predicate: 'wrecked_at', object: {entityId: 'north-shoal'}, qualification: 'supported', time: '1901', reasoning: 'The coast warden\'s report places the loss at North Shoal.', evidence: [{ref: 'accepted/wreck-report', role: 'supports'}], sourceIds: ['warden-report']},
  ],
  evidence: [
    {id: 'accepted/edith-ledger', sourceId: 'works-ledger', quote: 'Edith Marrow, finisher, Harbour Row; entered 4 March 1890.', context: 'An invented employee entry for the sample.', locator: 'Page 22, line 8', interpretation: 'Records Edith\'s occupation, employer and Tidewell address.'},
    {id: 'accepted/ruth-ledger', sourceId: 'works-ledger', quote: 'Ruth Bell, twine spinner; entered 17 January 1888.', context: 'An invented employee entry for the sample.', locator: 'Page 19, line 3', interpretation: 'Records Ruth\'s occupation and employer.'},
    {id: 'accepted/works-heading', sourceId: 'works-ledger', quote: 'Tidewell Net Works, East Wharf. Established 1864. Employment ledger, volume 14.', context: 'An invented ledger heading for the sample.', locator: 'Front leaf', interpretation: 'Names the works, its location and its reported founding year.'},
    {id: 'accepted/supply-notice', sourceId: 'gazette-shipping', quote: 'The schooner Morning Star has taken aboard new herring nets from the Tidewell Net Works.', context: 'An invented shipping notice for the sample.', locator: 'Issue of 18 April 1896, page 2', interpretation: 'Connects the works to the vessel.'},
    {id: 'accepted/vessel-register', sourceId: 'harbour-register', quote: 'TW-184 Morning Star, two-masted schooner, launched 1887; port Tidewell; master Isaac Shaw of Tidewell.', context: 'An invented harbour register entry for the sample.', locator: '1896 register, folio 31', interpretation: 'Records the vessel, its home port, launch year and captain.'},
    {id: 'accepted/wreck-report', sourceId: 'warden-report', quote: 'Morning Star, Isaac Shaw master, lost on North Shoal during the gale of 6 February 1901.', context: 'An invented coast warden entry for the sample.', locator: '1901 losses, entry 4', interpretation: 'Places the vessel\'s loss at North Shoal.'},
  ],
  sources: [
    {id: 'works-ledger', title: 'Tidewell Net Works employment ledger (fictional)', access: 'full-text'},
    {id: 'harbour-register', title: 'Tidewell harbour register, 1896 (fictional)', access: 'full-text'},
    {id: 'gazette-shipping', title: 'The Tidewell Gazette, shipping notices (fictional)', access: 'full-text'},
    {id: 'warden-report', title: 'Tidewell coast warden annual report, 1901 (fictional)', access: 'full-text'},
  ],
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
    'thomas,person,Thomas Marrow,,"Edith\'s father, a net maker on Harbour Row in Tidewell. The household lists disagree about where he was born.",,register;census',
    'ann,person,Ann Marrow,,"Edith\'s mother, born Ann Holt in Saltmere, who married Thomas there.",,census;gazette',
    'saltmere,place,Saltmere,,"A fictional village, Ann\'s home parish and where she married Thomas.",,gazette',
  ];
  const edges = [
    `thomas-parent,thomas,parent_of,node,edith,supported,,The baptism names Thomas as Edith's father.,${ref('baptism')};${ref('household')},,,register;census`,
    `ann-parent,ann,parent_of,node,edith,supported,,The baptism names Ann as Edith's mother.,${ref('baptism')};${ref('household')},,,register;census`,
    `marriage,thomas,married_to,node,ann,reported,,The marriage notice records their marriage at Saltmere.,${ref('notice')},,,gazette`,
    `ann-born,ann,born_in,node,saltmere,reported,,The marriage notice and the household list both give Saltmere.,${ref('notice')};${ref('household')},,,gazette;census`,
    `thomas-born,thomas,born_in,node,tidewell,disputed,,One household list gives Tidewell and a later one Saltmere.,${ref('household')},${ref('second-list')},,census`,
    `family-home,thomas,lived_in,node,tidewell,supported,,The household list places the family on Harbour Row.,${ref('household')},,,census`,
    `thomas-trade,thomas,occupation,text,Net maker,supported,,The baptism and the household list give the same trade.,${ref('baptism')};${ref('household')},,,register;census`,
    `ann-maiden-name,ann,also_known_as,text,Ann Holt,reported,,The marriage notice gives her maiden name.,${ref('notice')},,,gazette`,
  ];
  return {
    'nodes.csv': `${tables['nodes.csv']}${nodes.join('\n')}\n`,
    'edges.csv': `${tables['edges.csv']}${edges.join('\n')}\n`,
    'types.csv': tables['types.csv'],
    'fields.csv': `${tables['fields.csv']}person,also_known_as,text\n`,
    'relationships.csv': `${tables['relationships.csv']}born_in,birthplace of,free\n`,
    'questions.csv': 'id,question,nodeIds,edgeIds,provisionalTreatment,requestedResearch\nthomas-birthplace,Where was Thomas Marrow born?,thomas,thomas-born,Kept as disputed with both lists cited.,Look for Thomas\'s own baptism in both parishes.\n',
    'submission.txt': 'done 0\n',
  };
}

// Builds the sample in a directory: a finished batch whose walkthrough and draft
// graph are ready for the visitor's review.
export function buildSample(directory) {
  const store = new WorkspaceStore(directory, graph);
  // The visitor's question, as it would have come in, and the coordinator's batch for it.
  store.command({type: 'send', text: 'I\'d like to know more about Edith\'s family.', annotation: {question: QUESTION, references: [{table: 'nodes', recordId: 'edith', label: 'Edith Marrow'}]}});
  store.command({type: 'reply', text: 'I\'ll look for Edith\'s baptism first, then follow her parents through the household lists and any marriage notice.', references: []});
  const {investigationId} = store.command({type: 'open-batch', title: 'Edith\'s parents', brief: {purpose: 'Find who Edith Marrow\'s parents were and where they came from.', scope: 'Her parents and their birthplaces, not earlier generations.', direction: 'Start with the Tidewell baptisms.'}, assignments: [{title: QUESTION, brief: 'Find Edith Marrow\'s baptism in the Tidewell register, then follow her parents through the household lists and any marriage notice. Say where the lists disagree.'}]});
  const assignmentId = store.state.investigations.find(i => i.id === investigationId).assignments[0].id;
  const task = store.command({type: 'claim', investigationId, assignmentId, worker: 'Sample researcher'});
  const {proposalId} = store.command({type: 'propose', investigationId, token: task.assignment.lease.token, proposal: {
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
