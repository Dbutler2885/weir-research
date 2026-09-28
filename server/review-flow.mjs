import { randomUUID } from 'node:crypto';
import { sourceLibrary } from '../src/domain/findings.ts';
import { acceptDraft, citedResearch } from '../src/domain/graph-delivery.ts';
import { graphBlocker, graphWorkFinished, validateDraftTour, feedbackAwaitingDraft } from '../src/domain/review-flow.ts';
import { choose } from '../src/domain/dispatch.ts';
import { applyEdits, editsBetween } from '../src/domain/walkthrough-edits.ts';

const fail = (ok, message) => { if (!ok) throw new Error(message); };
const text = value => typeof value === 'string' && value.trim() && value.length <= 100_000;
// The agent, model and effort for a role: what was named, else the project's
// dispatch rules, else the older single engine preference.
function pick(state, role, command = {}) {
  if (command.engine) return {agent: command.engine, model: command.model ?? null, effort: command.effort ?? null};
  if (state.dispatch) return choose(state.dispatch, role);
  return ['claude', 'codex'].includes(state.engine) ? {agent: state.engine, model: null, effort: null} : null;
}
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

// What a reorganization asks of its builder, before the human's own words.
const REORGANIZATION = 'Reorganize the graph as it stands; there is no new research to add. Define the project\'s types and the fields each records, file every existing fact under its field, give each relationship the human sees from both ends a reverse reading, and write a summary for every node. Rewrite reasoning that mentions ids, tables or earlier versions of the graph so a reader can follow it. Keep every citation, qualification and time; do not add, remove or merge anything the research does not warrant.';
export function flowCommand(store, command, actor = 'coordinator') {
  const i = store.state.investigations.find(i => i.id === command.investigationId);
  fail(i, 'Unknown investigation.');
  const action = command.action;
  const humanActions = ['request-walkthrough', 'review-walkthrough-edits', 'request-graph', 'graph-job-pause', 'graph-job-resume', 'graph-resume-decision', 'graph-accept', 'graph-set-aside'];
  fail(actor === 'coordinator' ? !humanActions.includes(action) : humanActions.includes(action), 'This action belongs to the other review role.');
  if (action === 'inspect-flow') return structuredClone(i.reviewFlow || {walkthroughs: [], jobs: [], graphReviews: []});
  if (action === 'assign-walkthrough') {
    fail(i.walkthroughRequestedAt, 'The human has not asked for a walkthrough of this batch.');
    fail(i.proposals.some(p => p.kind === 'findings'), 'Publish the batch\'s findings before a walkthrough is written.');
    const choice = pick(store.state, 'walkthrough-writer', command);
    fail(['claude','codex'].includes(choice?.agent), 'Choose claude or codex for the walkthrough writer.');
    fail(text(command.brief), 'Give the walkthrough writer a brief.');
    fail(!['queued','running'].includes(i.reviewFlow?.writer?.status), 'A walkthrough writer is already assigned; send it instructions with walkthrough-update.');
    const id = randomUUID();
    store.update(next => {
      const inv = next.investigations.find(x => x.id === i.id);
      flowFor(inv).writer = {id, status: 'queued', engine: choice.agent, model: choice.model, effort: choice.effort, brief: command.brief, progress: 'Waiting to start.', attempt: 0, corrections: 0};
      inv.events.push({at: new Date().toISOString(), message: 'Coordinator assigned a walkthrough writer.'});
    });
    return {writerId: id};
  }
  // The coordinator's changes to a walkthrough's file, read by the app at the end of
  // its turn, become suggested edits for the human. A comment the coordinator has
  // answered by changing its suggestion keeps what it suggested before.
  if (action === 'suggest-walkthrough-edits') {
    const latest = i.reviewFlow?.walkthroughs.at(-1);
    fail(latest, 'This batch has no walkthrough to edit.');
    const found = editsBetween(latest, command.walkthrough);
    validateWalkthrough(i, {...latest, ...applyEdits(latest, found)});
    const previous = new Map((i.reviewFlow.edits?.edits || []).map(e => [e.id, e]));
    const edits = found.map(e => {
      const was = previous.get(e.id);
      if (!was) return e;
      if (was.after === e.after) return {...e, ...(was.comment ? {comment: was.comment} : {}), ...(was.earlier ? {earlier: was.earlier} : {})};
      return {...e, ...(was.comment ? {earlier: was.after} : {})};
    });
    const unchanged = JSON.stringify(edits) === JSON.stringify(i.reviewFlow.edits?.edits || []);
    if (unchanged) return {edits: edits.length};
    store.update(next => {
      const flow = flowFor(next.investigations.find(x => x.id === i.id));
      if (edits.length) flow.edits = {basedOnWalkthroughId: latest.id, suggestedAt: new Date().toISOString(), edits};
      else delete flow.edits;
      next.investigations.find(x => x.id === i.id).events.push({at: new Date().toISOString(), message: edits.length ? `Coordinator suggested ${edits.length} ${edits.length === 1 ? 'edit' : 'edits'} to the walkthrough.` : 'Coordinator withdrew its suggested walkthrough edits.'});
    });
    return {edits: edits.length};
  }
  // The human's review of the suggested edits, sent at once: accepted edits make the next
  // revision, declined ones go, and comments go to the coordinator with their edits kept open.
  if (action === 'review-walkthrough-edits') {
    const pending = i.reviewFlow?.edits;
    fail(pending, 'There are no suggested edits to review.');
    const latest = i.reviewFlow.walkthroughs.at(-1);
    fail(pending.basedOnWalkthroughId === latest.id, 'The walkthrough changed since these edits were suggested.');
    const decisions = command.decisions || {};
    const decided = (e, d) => decisions[e.id]?.decision === d;
    const accepted = pending.edits.filter(e => decided(e, 'accept'));
    const comments = pending.edits.filter(e => decided(e, 'comment') && text(decisions[e.id].comment));
    const open = pending.edits.filter(e => !decided(e, 'accept') && !decided(e, 'decline'));
    fail(accepted.length || comments.length || pending.edits.some(e => decided(e, 'decline')), 'Decide at least one edit before sending your review.');
    const at = new Date().toISOString();
    let walkthroughId;
    store.update(next => {
      const investigation = next.investigations.find(x => x.id === i.id), flow = flowFor(investigation);
      let kept = open.map(e => comments.includes(e) ? {...e, comment: decisions[e.id].comment.trim()} : e);
      if (accepted.length) {
        walkthroughId = randomUUID();
        const revised = {...structuredClone(latest), ...applyEdits(latest, accepted), id: walkthroughId, createdAt: at, revision: flow.walkthroughs.length + 1};
        flow.walkthroughs.push(revised);
        // The edits still open, found again against the new revision: an accepted
        // removal or addition moves the caveats after it.
        const was = new Map(kept.map(e => [`${e.before}\u0000${e.after}`, e]));
        kept = editsBetween(revised, applyEdits(latest, [...accepted, ...kept])).map(e => {
          const {comment, earlier} = was.get(`${e.before}\u0000${e.after}`) || {};
          return {...e, ...(comment ? {comment} : {}), ...(earlier ? {earlier} : {})};
        });
      }
      if (kept.length) flow.edits = {...pending, basedOnWalkthroughId: walkthroughId || latest.id, edits: kept};
      else delete flow.edits;
      const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
      const declined = pending.edits.length - accepted.length - open.length;
      investigation.events.push({at, message: `You reviewed the walkthrough edits: ${[accepted.length ? `${count(accepted.length, 'edit', 'edits')} accepted${walkthroughId ? ` as revision ${flow.walkthroughs.length}` : ''}` : '', declined ? `${declined} declined` : '', comments.length ? count(comments.length, 'comment', 'comments') + ' sent' : ''].filter(Boolean).join(', ')}.`});
    });
    if (comments.length) {
      const quote = s => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > 160 ? `${t.slice(0, 157)}...` : t; };
      store.command({type: 'send', text: `Comments on your suggested edits to batch ${i.number}'s walkthrough:\n\n${comments.map(e => `On "${quote(e.after || e.before)}" (${e.where}): ${decisions[e.id].comment.trim()}`).join('\n\n')}`});
    }
    return {walkthroughId: walkthroughId ?? null, open: open.length};
  }
  if (action === 'publish-walkthrough') {
    // Without a walkthrough, the draft the writer handed in is published as it stands.
    const writer = i.reviewFlow?.writer;
    if (!command.walkthrough && writer?.status === 'returned') command = {...command, walkthrough: writer.draft};
    validateWalkthrough(i, command.walkthrough);
    fail(i.status !== 'paused', 'The investigation is paused. Request human approval before continuing.');
    const prior = i.reviewFlow?.walkthroughs.at(-1);
    // A published walkthrough is corrected through its file, where the human reviews each
    // edit; only a walkthrough the human asked to have rewritten replaces it outright.
    fail(!prior || i.walkthroughRequestedAt, `Batch ${i.number} already has a walkthrough. To correct it, edit walkthroughs/batch-${i.number}.json in your folder; the human reviews each change.`);
    fail(!prior || command.basedOnWalkthroughId === prior.id, 'A newer walkthrough exists. Inspect it before revising.');
    const id = randomUUID(), at = new Date().toISOString();
    store.update(next => {
      const investigation = next.investigations.find(x => x.id === i.id), flow = flowFor(investigation);
      flow.walkthroughs.push({...structuredClone(command.walkthrough), id, createdAt: at, revision: flow.walkthroughs.length + 1});
      // A rewritten walkthrough replaces any edits suggested to the one before.
      delete flow.edits;
      delete investigation.walkthroughRequestedAt;
      if (flow.writer && flow.writer.status !== 'running') { flow.writer.status = 'published'; delete flow.writer.draft; }
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
    const choice = pick(store.state, 'graph-builder');
    const jobId = randomUUID(), at = new Date().toISOString(), engine = choice?.agent || 'manual';
    store.update(next => {
      const inv = next.investigations.find(x => x.id === i.id), flow = flowFor(inv), w = flow.walkthroughs.at(-1);
      flow.jobs.push({id: jobId, format: 'tables', ...(w ? {walkthroughId: w.id} : {}), status: 'queued', engine, model: choice?.model ?? null, effort: choice?.effort ?? null, progress: engine === 'manual' ? 'Waiting for the coordinator to assign a graph builder.' : 'Graph preparation is queued.', createdAt: at, attempt: 0, updates: [], consumedUpdateSequence: 0, packet: graphPacket(next, inv, w), baseDataset: structuredClone(next.dataset)});
      inv.events.push({at, message: 'Graph update requested.'});
    });
    return {jobId};
  }
  if (action === 'reorganize-graph') {
    // A reorganization represents no new research: a builder organizes the graph as it
    // stands, in the project's own types, with a summary for every node. The human
    // asked for it, and decides on the draft like any other.
    fail(!i.closedAt, 'This batch is closed.');
    fail(!(i.reviewFlow?.jobs || []).length, 'This batch already has graph work; open a new batch for the reorganization.');
    fail(text(command.message), 'Say what the human asked the reorganization to do.');
    const blocker = graphBlocker(store.state);
    fail(!blocker, blocker);
    const choice = pick(store.state, 'graph-builder');
    const jobId = randomUUID(), at = new Date().toISOString(), engine = choice?.agent || 'manual';
    store.update(next => {
      const inv = next.investigations.find(x => x.id === i.id), flow = flowFor(inv);
      const updates = [{id: randomUUID(), sequence: 1, message: `${REORGANIZATION}\n\n${command.message}`, annotationIds: [], at}];
      flow.jobs.push({id: jobId, format: 'tables', reorganization: true, status: 'queued', engine, model: choice?.model ?? null, effort: choice?.effort ?? null, progress: engine === 'manual' ? 'Waiting for the coordinator to assign a graph builder.' : 'Graph reorganization is queued.', createdAt: at, attempt: 0, updates, consumedUpdateSequence: 0, packet: graphPacket(next, inv, undefined, updates), baseDataset: structuredClone(next.dataset)});
      inv.events.push({at, message: 'Graph reorganization requested.'});
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
      fail(['codex','claude'].includes(command.engine), 'Choose claude or codex for the graph builder.');
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
      if (action === 'assign-graph') Object.assign(j, {engine: command.engine, model: command.model ?? null, effort: command.effort ?? null});
      if (action === 'graph-job-pause') { j.status = 'paused'; j.progress = 'Graph preparation paused. Saved work is retained.'; }
      if (action === 'request-graph-resume') j.resumeRequest = {reason: command.reason, status: 'pending'};
      if (action === 'graph-job-resume' || (action === 'graph-resume-decision' && command.decision === 'approve')) {
        j.status = 'queued'; j.progress = 'Resuming graph preparation from saved files.';
        if (j.resumeRequest) j.resumeRequest.status = 'approved';
      }
      if (action === 'graph-resume-decision' && command.decision === 'decline') j.resumeRequest.status = 'declined';
      if (action === 'graph-update') {
        const sentBack = j.status === 'published';
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
        inv.events.push({at: update.at, message: sentBack ? 'Coordinator sent the graph draft back to the builder.' : 'Coordinator sent the graph builder new instructions.'});
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
      next.investigations.find(x => x.id === i.id).events.push({at: f.graphReviews.at(-1).createdAt, message: 'Coordinator signed off the graph draft; it is ready for your review.'});
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
      next.investigations.find(x => x.id === i.id).events.push({at: new Date().toISOString(), message: 'Coordinator answered your note on the graph draft.'});
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
  // A closed batch takes no more work, so research queued on it is no longer waiting.
  inv.status = 'closed';
  delete inv.lease;
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
      j.status = 'queued'; j.progress = 'Saved a completed draft; incorporating newer context next.';
      i.events.push({at: j.submissions.at(-1).at, message: 'Graph builder handed in a draft; it is going back to take in newer instructions.'});
      return;
    }
    j.candidate = {
      draft: delivery.draft, diff: delivery.diff, summary: delivery.summary, questions: delivery.questions, notes: delivery.notes,
      consumedUpdateSequence: delivery.consumedUpdateSequence, researchRevision: packet.researchRevision, baseGraphRevision: packet.baseGraphRevision, submissionDirectory,
    };
    j.status = 'returned';
    j.consumedUpdateSequence = delivery.consumedUpdateSequence;
    j.progress = 'Draft ready. The coordinator is checking it against your instructions.';
    i.events.push({at: j.submissions.at(-1).at, message: `Graph builder handed in a draft: ${delivery.summary}`});
  });
}
