import { randomUUID, createHash } from 'node:crypto';
import { canonical } from '../src/domain/changes.ts';
import { sourceLibrary } from '../src/domain/findings.ts';
import { materializeGraph, selectedGraphGroups } from '../src/domain/graph-draft.ts';
import { validateProposal } from '../skills/prepare-research-graph/scripts/validate-proposal.mjs';
import { validateTour } from '../skills/prepare-research-graph/scripts/validate-tour.mjs';

const fail = (ok, message) => { if (!ok) throw new Error(message); };
const text = value => typeof value === 'string' && value.trim() && value.length <= 100_000;
export const graphHash = graph => createHash('sha256').update(canonical(graph)).digest('hex');
const flowFor = i => i.reviewFlow ||= {walkthroughs: [], jobs: [], graphReviews: []};
export function evidenceRegistry(i, proposalIds) {
  const evidence = {}, findings = {};
  for (const id of proposalIds) {
    const p = i.proposals.find(p => p.id === id);
    fail(p?.kind === 'findings', 'Walkthrough inputs must be preserved research findings.');
    for (const e of p.evidence) evidence[`${p.id}/${e.id}`] = {...e, id: `${p.id}/${e.id}`};
    for (const f of p.findings) findings[`${p.id}/${f.id}`] = {...f, evidenceIds: f.evidenceIds.map(id => `${p.id}/${id}`)};
  }
  return {evidence, findings};
}
export function validateWalkthrough(i, input) {
  fail(input && ['title','question','journey','answer','closing'].every(k => text(input[k])), 'A walkthrough needs a question, journey, answer, title, and closing.');
  fail(Array.isArray(input.proposalIds) && input.proposalIds.length && new Set(input.proposalIds).size === input.proposalIds.length, 'Choose the research reports explained by this walkthrough.');
  const registry = evidenceRegistry(i, input.proposalIds);
  fail(Array.isArray(input.caveats) && input.caveats.every(text), 'Caveats must be text.');
  fail(Array.isArray(input.steps) && input.steps.length, 'A walkthrough needs evidence steps.');
  if (input.correction !== undefined) fail(text(input.correction), 'Describe the material correction.');
  const ids = new Set();
  for (const step of input.steps) {
    fail(['id','title','body','transition'].every(k => text(step[k])) && !ids.has(step.id), 'Each evidence step needs a unique ID, title, explanation, and transition.');
    ids.add(step.id);
    fail(Array.isArray(step.evidenceRefs) && step.evidenceRefs.every(id => registry.evidence[id]), 'Walkthrough refers to unknown evidence.');
  }
  return registry;
}
export function graphPacket(state, investigation, walkthrough, updates = []) {
  const {evidence, findings} = evidenceRegistry(investigation, walkthrough.proposalIds);
  const data = state.dataset;
  return {
    question: walkthrough.question, walkthrough, researchRevision: walkthrough.id,
    baseGraphRevision: state.datasetRevision, updates: structuredClone(updates), findings, evidence,
    sources: sourceLibrary(state),
    researcherReturns: investigation.proposals.filter(p => walkthrough.proposalIds.includes(p.id)),
    existingGraph: {
      complete: true,
      nodes: [...data.people.map(n => ({...n, kind: 'person', label: n.name})), ...(data.contextEntities || []).map(n => ({...n, label: n.name}))],
      claims: data.claims || [], relationships: data.contextConnections || [], unions: data.unions, directParentage: data.directParentage || [],
      evidence: data.evidence || [],
    },
    retrieval: 'The complete graph snapshot is in graph-snapshot.json. Use node graph-query.mjs search WORDS, inspect ID, neighborhood ID, or evidence CLAIM_ID [offset]. Files can also be inspected with Read and Grep. Updates are in updates.json; consume every supplied sequence before completion.',
    scope: investigation.scope, annotationIds: investigation.annotations.filter(a => a.dispatchedAt).map(a => a.id),
  };
}
export function flowCommand(store, command, actor = 'coordinator') {
  const i = store.state.investigations.find(i => i.id === command.investigationId);
  fail(i, 'Unknown investigation.');
  const action = command.action;
  const humanActions = ['graph-job-pause', 'graph-job-resume', 'graph-resume-decision', 'graph-apply', 'graph-set-aside'];
  fail(actor === 'coordinator' ? !humanActions.includes(action) : humanActions.includes(action), 'This action belongs to the other review role.');
  if (action === 'inspect-flow') return structuredClone(i.reviewFlow || {walkthroughs: [], jobs: [], graphReviews: []});
  if (action === 'publish-walkthrough') {
    validateWalkthrough(i, command.walkthrough);
    fail(i.status !== 'paused', 'The investigation is paused. Request human approval before continuing.');
    const prior = i.reviewFlow?.walkthroughs.at(-1);
    fail(!prior || command.basedOnWalkthroughId === prior.id, 'A newer walkthrough exists. Inspect it before revising.');
    const engine = command.engine || store.state.engine || 'manual';
    fail(['manual','codex','claude'].includes(engine), 'Choose an available graph-builder provider.');
    const id = randomUUID(), jobId = randomUUID(), at = new Date().toISOString();
    store.update(next => {
      const investigation = next.investigations.find(x => x.id === i.id), flow = flowFor(investigation);
      const w = {...structuredClone(command.walkthrough), id, createdAt: at, revision: flow.walkthroughs.length + 1};
      flow.walkthroughs.push(w);
      for (const job of flow.jobs) if (['queued','running','returned'].includes(job.status)) job.status = 'superseded';
      flow.jobs.push({id: jobId, walkthroughId: id, status: 'queued', engine, progress: engine === 'manual' ? 'Waiting for the coordinator to assign a graph builder.' : 'Graph preparation is queued.', createdAt: at, attempt: 0, updates: [], consumedUpdateSequence: 0, packet: graphPacket(next, investigation, w), baseDataset: structuredClone(next.dataset)});
      investigation.events.push({at, message: 'Research walkthrough published; graph preparation queued.'});
    });
    return {walkthroughId: id, jobId};
  }
  const flow = i.reviewFlow;
  fail(flow, 'This investigation has no guided review yet.');
  const job = flow.jobs.find(j => j.id === command.jobId);
  if (['assign-graph','graph-update','graph-job-pause','graph-job-resume','request-graph-resume','graph-resume-decision'].includes(action)) {
    fail(job, 'Unknown graph preparation.');
    if (action === 'assign-graph') {
      fail(job.status === 'queued', 'Only queued graph work can be assigned.');
      fail(['codex','claude','manual'].includes(command.engine), 'Choose a graph-builder provider.');
    } else if (action === 'graph-update') {
      fail(!['paused','superseded','published'].includes(job.status), 'Create a new walkthrough revision for superseded or published work; paused work requires approval.');
      fail(text(command.message), 'Describe what changed and how it affects representation.');
      fail((command.annotationIds || []).every(id => i.annotations.some(a => a.id === id && a.dispatchedAt)), 'Only dispatched annotations are builder assignments.');
      if (command.walkthrough) {
        validateWalkthrough(i, command.walkthrough);
        fail(flow.walkthroughs.at(-1).id === job.walkthroughId, 'A newer walkthrough exists. Update its graph job instead.');
      }
    } else if (action === 'graph-job-pause') fail(['queued','running','returned'].includes(job.status), 'This graph task is not active.');
    else fail(job.status === 'paused', 'Only paused graph preparation can resume.');
    if (action === 'request-graph-resume') fail(text(command.reason), 'Explain why graph preparation should resume.');
    if (action === 'graph-resume-decision') fail(job.resumeRequest?.status === 'pending' && ['approve','decline'].includes(command.decision), 'No matching resume request.');
    store.update(next => {
      const inv = next.investigations.find(x => x.id === i.id), f = flowFor(inv), j = f.jobs.find(x => x.id === job.id);
      if (action === 'assign-graph') j.engine = command.engine;
      if (action === 'graph-job-pause') { j.status = 'paused'; j.progress = 'Graph preparation paused. Saved work is retained.'; }
      if (action === 'request-graph-resume') j.resumeRequest = {reason: command.reason, status: 'pending'};
      if (action === 'graph-job-resume' || (action === 'graph-resume-decision' && command.decision === 'approve')) {
        j.status = 'queued'; j.progress = 'Resuming graph preparation from saved files.';
        j.engine = next.engine || j.engine;
        if (j.resumeRequest) j.resumeRequest.status = 'approved';
      }
      if (action === 'graph-resume-decision' && command.decision === 'decline') j.resumeRequest.status = 'declined';
      if (action === 'graph-update') {
        const update = {id: randomUUID(), sequence: j.updates.length + 1, message: command.message, annotationIds: command.annotationIds || [], at: new Date().toISOString()};
        j.updates.push(update);
        let w = f.walkthroughs.find(w => w.id === j.walkthroughId);
        if (command.walkthrough) {
          w = {...structuredClone(command.walkthrough), id: randomUUID(), revision: f.walkthroughs.length + 1, createdAt: update.at};
          f.walkthroughs.push(w); j.walkthroughId = w.id;
        }
        j.packet = graphPacket(next, inv, w, j.updates);
        j.baseDataset = structuredClone(next.dataset);
        if (j.status === 'returned') j.status = 'queued';
        j.progress = 'New context supplied to the graph builder.';
      }
    });
    return {saved: true};
  }
  if (action === 'publish-graph-review') {
    fail(job?.status === 'returned' && job.candidate, 'Inspect a completed graph-builder submission first.');
    const {graph, packet} = job.candidate;
    fail(graph.baseGraphRevision === store.state.datasetRevision, 'The accepted graph changed. Send a graph update and rebuild.');
    fail(graph.researchRevision === job.packet.researchRevision && graph.consumedUpdateSequence === job.updates.length, 'The builder has not consumed the latest inputs.');
    const hash = graphHash(graph);
    const result = validateTour(command.tour, {...graph, nodes: [...graph.nodes, ...packet.existingGraph.nodes]}, hash);
    fail(result.valid, result.errors.join('\n'));
    materializeGraph(store.state.dataset, graph, packet.evidence, packet.sources);
    const id = randomUUID();
    store.update(next => {
      const f = flowFor(next.investigations.find(x => x.id === i.id)), j = f.jobs.find(x => x.id === job.id);
      f.graphReviews.push({id, jobId: j.id, walkthroughId: j.walkthroughId, revision: f.graphReviews.length + 1, createdAt: new Date().toISOString(), graphSha256: hash, graph: structuredClone(graph), tour: structuredClone(command.tour), evidence: structuredClone(packet.evidence), sources: structuredClone(packet.sources), baseDataset: structuredClone(next.dataset), expectedGraphRevision: next.datasetRevision, appliedGroupIds: [], rejectedGroupIds: [], status: 'pending', annotationIds: [...new Set([...packet.annotationIds, ...j.updates.flatMap(u => u.annotationIds)])]});
      j.status = 'published'; j.progress = 'Proposed graph and guided tour are ready.';
    });
    return {graphReviewId: id};
  }
  const review = flow.graphReviews.find(r => r.id === command.graphReviewId);
  fail(review, 'Graph review not found.');
  if (action === 'graph-apply' || action === 'graph-set-aside') {
    fail(review.status === 'pending', 'This graph review is no longer pending.');
    const ids = command.groupIds;
    fail(Array.isArray(ids) && ids.length && ids.every(id => review.graph.groups.some(g => g.id === id) && !review.appliedGroupIds.includes(id) && !review.rejectedGroupIds.includes(id)), 'Choose pending groups.');
    if (action === 'graph-set-aside') {
      store.update(next => {
        const r = next.investigations.find(x => x.id === i.id).reviewFlow.graphReviews.find(r => r.id === review.id);
        r.rejectedGroupIds.push(...ids);
        if (r.appliedGroupIds.length + r.rejectedGroupIds.length === r.graph.groups.length) r.status = 'set-aside';
      });
      return {saved: true};
    }
    fail(review.expectedGraphRevision === store.state.datasetRevision, 'The accepted graph changed. Ask for an updated proposal before applying.');
    fail(flow.walkthroughs.at(-1).id === review.walkthroughId, 'A newer research explanation is available. Review the updated graph first.');
    selectedGraphGroups(review.graph, ids, review.appliedGroupIds);
    const selected = review.graph.groups.filter(g => ids.includes(g.id));
    const touched = new Set(selected.flatMap(g => [...g.nodeIds, ...g.claimIds]));
    fail(!i.annotations.some(a => a.dispatchedAt && !review.annotationIds.includes(a.id) && [a.target,...(a.references || [])].some(t => t.graphReviewId === review.id && (t.stepId ? review.tour.steps.some(s => s.id === t.stepId && [...s.focusNodeIds, ...s.focusClaimIds].some(id => touched.has(id))) : !t.groupId && !t.recordId && !t.claimId || ids.includes(t.groupId) || touched.has(t.recordId) || touched.has(t.claimId)))), 'New feedback affects these groups. Ask for a revised proposal.');
    const dataset = materializeGraph(store.state.dataset, review.graph, review.evidence, review.sources, ids);
    store.update(next => {
      const r = next.investigations.find(x => x.id === i.id).reviewFlow.graphReviews.find(r => r.id === review.id);
      next.dataset = dataset; next.datasetRevision++;
      r.appliedGroupIds.push(...ids); r.expectedGraphRevision = next.datasetRevision;
      if (r.appliedGroupIds.length + r.rejectedGroupIds.length === r.graph.groups.length) r.status = 'applied';
      (next.graphApplications ||= []).push({id: randomUUID(), at: new Date().toISOString(), investigationId: i.id, graphReviewId: r.id, groupIds: ids, datasetRevision: next.datasetRevision});
    });
    return {applied: ids, datasetRevision: store.state.datasetRevision};
  }
  throw new Error('Unknown guided review action.');
}

export function receiveGraph(store, investigationId, jobId, graph, packet, submissionDirectory) {
  const validation = validateProposal(graph, packet);
  fail(validation.valid && !validation.warnings?.length, [...validation.errors, ...(validation.warnings || [])].join('\n'));
  store.update(next => {
    const i = next.investigations.find(i => i.id === investigationId), j = i.reviewFlow.jobs.find(j => j.id === jobId);
    fail(j.status === 'running', 'This graph task no longer owns the assignment.');
    j.submissions ||= [];
    j.submissions.push({graph: structuredClone(graph), packet: structuredClone(packet), submissionDirectory});
    if (graph.consumedUpdateSequence !== j.updates.length || graph.researchRevision !== j.packet.researchRevision) {
      j.status = 'queued'; j.progress = 'Saved a completed draft; incorporating newer context next.'; return;
    }
    materializeGraph(j.baseDataset, graph, packet.evidence, packet.sources);
    j.candidate = {...j.submissions.at(-1), graphSha256: graphHash(graph)}; j.status = 'returned';
    j.consumedUpdateSequence = graph.consumedUpdateSequence; j.issues = graph.issues;
    j.progress = 'Graph built. The coordinator is preparing its guided tour.';
  });
}
