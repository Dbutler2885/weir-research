import { randomUUID } from 'node:crypto';
import { sourceLibrary } from '../src/domain/findings.ts';
import { acceptDraft, citedResearch } from '../src/domain/graph-delivery.ts';
import { graphBlocker, graphWorkFinished, validateDraftTour, feedbackAwaitingDraft } from '../src/domain/review-flow.ts';

const fail = (ok, message) => { if (!ok) throw new Error(message); };
const text = value => typeof value === 'string' && value.trim() && value.length <= 100_000;
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
// A graph update represents a batch's findings; a walkthrough, when one exists, adds its
// explanation. The graph itself travels as tables written into the builder's directory.
export function graphPacket(state, investigation, walkthrough, updates = []) {
  const proposalIds = walkthrough?.proposalIds || investigation.proposals.filter(p => p.kind === 'findings').map(p => p.id);
  const {evidence, findings} = evidenceRegistry(investigation, proposalIds);
  return {
    question: walkthrough?.question || [investigation.title, ...(investigation.questions || []).map(q => q.title)].join('\n'),
    walkthrough: walkthrough || null,
    researchRevision: walkthrough?.id || `batch:${investigation.id}:${proposalIds.join(',')}`,
    baseGraphRevision: state.datasetRevision, updates: structuredClone(updates), findings, evidence,
    sources: sourceLibrary(state),
    researcherReturns: investigation.proposals.filter(p => proposalIds.includes(p.id)),
    scope: investigation.scope, annotationIds: investigation.annotations.filter(a => a.dispatchedAt).map(a => a.id),
  };
}
export { graphBlocker };
export function flowCommand(store, command, actor = 'coordinator') {
  const i = store.state.investigations.find(i => i.id === command.investigationId);
  fail(i, 'Unknown investigation.');
  const action = command.action;
  const humanActions = ['request-walkthrough', 'request-graph', 'graph-job-pause', 'graph-job-resume', 'graph-resume-decision', 'graph-accept', 'graph-set-aside'];
  fail(actor === 'coordinator' ? !humanActions.includes(action) : humanActions.includes(action), 'This action belongs to the other review role.');
  if (action === 'inspect-flow') return structuredClone(i.reviewFlow || {walkthroughs: [], jobs: [], graphReviews: []});
  if (action === 'publish-walkthrough') {
    validateWalkthrough(i, command.walkthrough);
    fail(i.status !== 'paused', 'The investigation is paused. Request human approval before continuing.');
    const prior = i.reviewFlow?.walkthroughs.at(-1);
    fail(!prior || command.basedOnWalkthroughId === prior.id, 'A newer walkthrough exists. Inspect it before revising.');
    const id = randomUUID(), at = new Date().toISOString();
    store.update(next => {
      const investigation = next.investigations.find(x => x.id === i.id), flow = flowFor(investigation);
      flow.walkthroughs.push({...structuredClone(command.walkthrough), id, createdAt: at, revision: flow.walkthroughs.length + 1});
      delete investigation.walkthroughRequestedAt;
      investigation.events.push({at, message: `Walkthrough revision ${flow.walkthroughs.length} published.`});
    });
    return {walkthroughId: id};
  }
  if (action === 'request-walkthrough') {
    fail(!i.closedAt, 'This batch is closed.');
    fail(i.proposals.some(p => p.kind === 'findings'), 'This batch has no findings to explain yet.');
    store.update(next => {
      const inv = next.investigations.find(x => x.id === i.id);
      inv.walkthroughRequestedAt = new Date().toISOString();
      inv.events.push({at: inv.walkthroughRequestedAt, message: 'Walkthrough requested.'});
    });
    return {requested: true};
  }
  if (action === 'request-graph') {
    // A finished graph review ends the batch; later work belongs to a new one.
    fail(!graphWorkFinished(i), "This batch's graph update is finished. Open a new batch for later work.");
    fail(i.proposals.some(p => p.kind === 'findings'), 'This batch has no findings to represent yet.');
    const blocker = graphBlocker(store.state);
    fail(!blocker, blocker);
    const jobId = randomUUID(), at = new Date().toISOString(), engine = store.state.engine || 'manual';
    store.update(next => {
      const inv = next.investigations.find(x => x.id === i.id), flow = flowFor(inv), w = flow.walkthroughs.at(-1);
      flow.jobs.push({id: jobId, format: 'tables', ...(w ? {walkthroughId: w.id} : {}), status: 'queued', engine, progress: engine === 'manual' ? 'Waiting for the coordinator to assign a graph builder.' : 'Graph preparation is queued.', createdAt: at, attempt: 0, updates: [], consumedUpdateSequence: 0, packet: graphPacket(next, inv, w), baseDataset: structuredClone(next.dataset)});
      inv.events.push({at, message: 'Graph update requested.'});
    });
    return {jobId};
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
      // A draft the human is reviewing can go back for a revision; the builder continues from it.
      const underReview = job.status === 'published' && flow.graphReviews.some(r => r.jobId === job.id && r.status === 'pending');
      fail(!['paused','superseded'].includes(job.status) && (job.status !== 'published' || underReview), 'Create a new walkthrough revision for superseded or published work; paused work requires approval.');
      fail(text(command.message), 'Describe what changed and how it affects representation.');
      fail((command.annotationIds || []).every(id => i.annotations.some(a => a.id === id && a.dispatchedAt)), 'Only dispatched annotations are builder assignments.');
      if (command.walkthrough) validateWalkthrough(i, command.walkthrough);
    } else if (action === 'graph-job-pause') fail(['queued','running','returned'].includes(job.status), 'This graph task is not active.');
    else fail(job.status === 'paused', 'Only paused graph preparation can resume.');
    // Resuming a builder for a finished batch would rebuild a graph that is already accepted.
    if (['graph-job-resume', 'graph-update'].includes(action) || (action === 'graph-resume-decision' && command.decision === 'approve'))
      fail(!graphWorkFinished(i), "This batch's graph update is finished. Open a new batch for later work.");
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
        if (j.status === 'published') {
          // The draft stays readable, but it is no longer the one to decide on.
          for (const r of f.graphReviews) if (r.jobId === j.id && r.status === 'pending') r.revisingSince = update.at;
          j.status = 'queued';
        }
        if (j.status === 'returned') j.status = 'queued';
        j.progress = 'Revising the graph draft.';
      }
    });
    return {saved: true};
  }
  // The coordinator signs a draft off for the human, or sends it back with graph-update.
  if (action === 'publish-graph-review') {
    fail(job?.status === 'returned' && job.candidate, 'Inspect a completed graph draft first.');
    const candidate = job.candidate;
    fail(candidate.baseGraphRevision === store.state.datasetRevision, 'The accepted graph changed. Send a graph update so the builder redrafts against it.');
    fail(candidate.researchRevision === job.packet.researchRevision && candidate.consumedUpdateSequence === job.updates.length, 'The builder has not consumed the latest inputs.');
    const tour = validateDraftTour(command.tour, candidate, job.baseDataset);
    const undone = command.undone ?? [];
    fail(Array.isArray(undone) && undone.every(u => text(u?.instruction) && text(u?.reason)), 'List each instruction the draft leaves undone with the reason.');
    const cited = citedResearch(candidate.draft, job.packet.evidence, job.packet.sources);
    const id = randomUUID();
    store.update(next => {
      const f = flowFor(next.investigations.find(x => x.id === i.id)), j = f.jobs.find(x => x.id === job.id);
      for (const r of f.graphReviews) if (r.status === 'pending') r.status = 'superseded';
      f.graphReviews.push({
        id, jobId: j.id, walkthroughId: j.walkthroughId, revision: f.graphReviews.length + 1, createdAt: new Date().toISOString(),
        format: 'draft', draft: structuredClone(candidate.draft), diff: structuredClone(candidate.diff), summary: candidate.summary,
        questions: structuredClone(candidate.questions), notes: structuredClone(candidate.notes), undone: structuredClone(undone),
        tour, cited, baseDataset: structuredClone(j.baseDataset), expectedGraphRevision: candidate.baseGraphRevision, status: 'pending',
        annotationIds: [...new Set([...j.packet.annotationIds, ...j.updates.flatMap(u => u.annotationIds)])],
      });
      j.status = 'published'; j.progress = 'The draft is ready for your review.';
    });
    return {graphReviewId: id};
  }
  const review = flow.graphReviews.find(r => r.id === command.graphReviewId);
  fail(review, 'Graph review not found.');
  // A note that needs no change to the draft is answered in the conversation and no longer holds it.
  if (action === 'answer-draft-feedback') {
    fail(review.status === 'pending', 'This graph review is no longer pending.');
    const ids = command.annotationIds;
    fail(Array.isArray(ids) && ids.length && ids.every(id => i.annotations.some(a => a.id === id && a.dispatchedAt)), 'Name the sent notes this answers.');
    store.update(next => {
      const r = next.investigations.find(x => x.id === i.id).reviewFlow.graphReviews.find(r => r.id === review.id);
      r.annotationIds = [...new Set([...r.annotationIds, ...ids])];
    });
    return {saved: true};
  }
  if (action === 'graph-accept' || action === 'graph-set-aside') {
    fail(review.status === 'pending', 'This graph review is no longer pending.');
    fail(review.format === 'draft', 'This review was prepared in the old format. Ask for a revised draft.');
    if (action === 'graph-set-aside') {
      store.update(next => {
        const inv = next.investigations.find(x => x.id === i.id), r = inv.reviewFlow.graphReviews.find(r => r.id === review.id);
        r.status = 'set-aside'; r.decidedAt = new Date().toISOString();
        closeBatch(inv);
      });
      return {saved: true};
    }
    fail(!review.revisingSince, 'This draft is being revised. The new draft will replace it here.');
    fail(review.expectedGraphRevision === store.state.datasetRevision, 'The accepted graph changed since this draft was prepared. Ask for a revised draft.');
    fail(!feedbackAwaitingDraft(i, review), 'Your newer feedback on this draft has not reached the builder yet. Ask for a revised draft.');
    const dataset = acceptDraft(store.state.dataset, review.draft, review.cited, review.diff);
    const undoId = randomUUID(), at = new Date().toISOString();
    store.update(next => {
      const inv = next.investigations.find(x => x.id === i.id), r = inv.reviewFlow.graphReviews.find(r => r.id === review.id);
      next.organization ||= {history: []};
      next.organization.history.push({id: undoId, at, reason: `Accept the graph draft for ${inv.number ? `batch ${inv.number}` : inv.title}`, before: next.dataset, appliedRevision: next.datasetRevision + 1, graphReviewId: r.id});
      next.dataset = dataset; next.datasetRevision++;
      r.status = 'applied'; r.decidedAt = at; r.undoId = undoId;
      closeBatch(inv);
      (next.graphApplications ||= []).push({id: randomUUID(), at, investigationId: i.id, graphReviewId: r.id, datasetRevision: next.datasetRevision});
    });
    return {accepted: true, datasetRevision: store.state.datasetRevision, undoId};
  }
  throw new Error('Unknown guided review action.');
}

// A batch closes when its graph review is complete; later related work starts a new batch.
function closeBatch(inv) {
  inv.closedAt = new Date().toISOString();
  inv.events.push({at: inv.closedAt, message: 'Graph review completed; batch closed.'});
}

// Apply the human's automatic review preferences when a batch becomes ready.
export function autoReview(store, investigationId) {
  const settings = store.state.reviewSettings || {};
  const inv = store.state.investigations.find(i => i.id === investigationId);
  if (!inv || !inv.proposals.some(p => p.kind === 'findings')) return;
  if (settings.autoWalkthrough && !inv.reviewFlow?.walkthroughs.length) flowCommand(store, {action: 'request-walkthrough', investigationId}, 'human');
  if (settings.autoGraph && !graphBlocker(store.state)) flowCommand(store, {action: 'request-graph', investigationId}, 'human');
}

// A builder's draft becomes the coordinator's candidate once it holds together. A draft
// written before the latest coordinator update is kept but not offered for sign-off.
export function receiveDraft(store, investigationId, jobId, delivery, packet, submissionDirectory) {
  store.update(next => {
    const i = next.investigations.find(i => i.id === investigationId), j = i.reviewFlow.jobs.find(j => j.id === jobId);
    fail(j.status === 'running', 'This graph task no longer owns the assignment.');
    j.submissions ||= [];
    j.submissions.push({at: new Date().toISOString(), summary: delivery.summary, consumedUpdateSequence: delivery.consumedUpdateSequence, submissionDirectory});
    if (delivery.consumedUpdateSequence !== j.updates.length || packet.researchRevision !== j.packet.researchRevision) {
      j.status = 'queued'; j.progress = 'Saved a completed draft; incorporating newer context next.'; return;
    }
    j.candidate = {
      draft: delivery.draft, diff: delivery.diff, summary: delivery.summary, questions: delivery.questions, notes: delivery.notes,
      consumedUpdateSequence: delivery.consumedUpdateSequence, researchRevision: packet.researchRevision, baseGraphRevision: packet.baseGraphRevision, submissionDirectory,
    };
    j.status = 'returned';
    j.consumedUpdateSequence = delivery.consumedUpdateSequence;
    j.progress = 'Draft ready. The coordinator is checking it against your instructions.';
  });
}
