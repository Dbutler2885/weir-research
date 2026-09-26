import type { Investigation, ResearchState, AnnotationTarget } from '../domain/research';
import type { Walkthrough, GraphReview, GraphJob } from '../domain/review-flow';
import { graphWorkFinished, feedbackAwaitingDraft } from '../domain/review-flow';
import { progressLine } from './review-view';
import { html, target } from './finding-review';
import { sourceLibrary } from '../domain/findings';
import { reviewGraph } from '../domain/graph-delivery';
import { GenealogyModel } from '../domain/model';
import { projectAround } from '../domain/projection';
import { layoutFamily } from '../layout/layout';
import { GraphRenderer } from './graph-renderer';
import { renderDetailsPanel, renderContextDetailsPanel } from './details-panel';

import {researchText as paragraphs, researchInline} from './research-text';
import { editPage, type EditDecision, type WalkthroughEdit } from '../domain/walkthrough-edits';

interface Progress { walkthroughId?: string; stage: 'reading' | 'graph'; step: number; graphReviewId?: string; stop: number; changes?: boolean; followLatest?: boolean }
interface Options {
  command: (data: Record<string, unknown>) => Promise<void>;
  source: (id: string, quote?: string) => void;
  error: (message: string) => void;
  // Opens on the batch's walkthrough or directly on its graph review.
  start?: 'reading' | 'graph';
  // Sends the note left when setting a draft aside, as new work for the coordinator.
  decline?: (note: string, reference: AnnotationTarget) => Promise<void>;
}
type Change = {label: string; ids: string[]; target: Partial<AnnotationTarget>};

// The difference between the accepted graph and a draft, as sections a person can read.
// Every line names real records, so it can be annotated and shown on the graph.
export function changeSections(r: GraphReview): {title: string; items: Change[]}[] {
  const names = new Map([...r.baseDataset.people, ...(r.baseDataset.contextEntities || []), ...r.draft.people, ...(r.draft.contextEntities || [])].map(n => [n.id, n.name]));
  const name = (id: string) => names.get(id) || id;
  const list = (items: string[]) => items.length < 3 ? items.join(' and ') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
  // An edge name reads as a phrase between two names: "Alex worked at the workshop".
  const phrase = (edgeName: string) => { const words = edgeName.replaceAll('_', ' '); return /^[A-Z][a-z]/.test(words) ? words.charAt(0).toLowerCase() + words.slice(1) : words; };
  const edge = (e: {from: string; name: string; target: string}) => `${name(e.from)} ${phrase(e.name)} ${name(e.target)}`;
  const node = (id: string, removed = false): Partial<AnnotationTarget> => ({table: r.draft.people.some(p => p.id === id) || r.baseDataset.people.some(p => p.id === id) ? 'people' : 'contextEntities', recordId: id, ...(removed ? {text: 'Removed by this draft'} : {})});
  const claim = (id: string, removed = false): Partial<AnnotationTarget> => ({table: 'claims', recordId: id, claimId: id, ...(removed ? {text: 'Removed by this draft'} : {})});
  const d = r.diff;
  return [
    {title: 'Merged', items: d.merges.map(m => ({label: `${list(m.gone.map(g => g.name))} merged into ${m.into.name}`, ids: [m.into.id, ...m.gone.map(g => g.id)], target: node(m.into.id)}))},
    {title: 'Removed nodes', items: d.removedNodes.map(n => ({label: n.edgesMovedTo.length ? `${n.name}, its edges moved to ${list(n.edgesMovedTo.map(t => t.name))}` : n.name, ids: [n.id], target: node(n.id, true)}))},
    {title: 'New nodes', items: d.addedNodes.map(n => ({label: n.name, ids: [n.id], target: node(n.id)}))},
    {title: 'Renamed', items: d.renamedNodes.map(n => ({label: `${n.wasName}, now ${n.name}`, ids: [n.id], target: node(n.id)}))},
    {title: 'Edited nodes', items: d.editedNodes.map(n => ({label: `${n.name}: ${n.fields.join(', ')}`, ids: [n.id], target: node(n.id)}))},
    {title: 'Moved edges', items: d.movedEdges.map(e => ({label: `${edge(e)}, was ${edge({...e, from: e.wasFrom, target: e.wasTarget})}`, ids: [e.id], target: claim(e.id)}))},
    {title: 'New edges', items: d.addedEdges.map(e => ({label: edge(e), ids: [e.id], target: claim(e.id)}))},
    {title: 'Requalified', items: d.requalifiedEdges.map(e => ({label: `${edge(e)}, now ${e.qualification}, was ${e.wasQualification}`, ids: [e.id], target: claim(e.id)}))},
    {title: 'Reworded', items: d.rewordedEdges.map(e => ({label: edge(e), ids: [e.id], target: claim(e.id)}))},
    {title: 'Citations changed', items: d.recitedEdges.map(e => ({label: edge(e), ids: [e.id], target: claim(e.id)}))},
    {title: 'Removed edges', items: d.removedEdges.map(e => ({label: edge(e), ids: [e.id], target: claim(e.id, true)}))},
  ].filter(section => section.items.length);
}
export class GuidedReview {
  private renderer?: GraphRenderer;
  private generation = 0;
  private progress: Progress;
  private key: string;
  private disposed = false;
  // The human's choices on the coordinator's suggested edits, kept until they send them.
  private decisions: Record<string, EditDecision> = {};
  private commenting?: string;
  private shownEdits = '';
  constructor(private host: HTMLElement, private state: ResearchState, private investigation: Investigation, private options: Options) {
    this.key = `guided-review:${location.origin}:${investigation.id}`;
    let saved;
    try { saved = JSON.parse(localStorage.getItem(this.key) || 'null'); } catch { /* Start at the briefing. */ }
    const flow = investigation.reviewFlow!;
    this.progress = saved || {walkthroughId: flow.walkthroughs.at(-1)?.id, stage: 'reading', step: 0, stop: -1};
    // A reader who just sent a review of edits goes on to the revision it made.
    if (this.progress.followLatest || !flow.walkthroughs.some(w => w.id === this.progress.walkthroughId)) this.progress.walkthroughId = flow.walkthroughs.at(-1)?.id;
    delete this.progress.followLatest;
    if (options.start === 'graph' || !this.progress.walkthroughId) {
      const latest = flow.graphReviews.at(-1);
      if (this.progress.graphReviewId !== latest?.id) this.progress.stop = -1;
      this.progress.stage = 'graph';
      this.progress.graphReviewId = latest?.id;
    } else if (options.start === 'reading') this.progress.stage = 'reading';
    host.addEventListener('click', this.click);
    host.addEventListener('change', this.change);
    this.loadDecisions();
    this.render();
  }
  destroy() { this.disposed = true; this.generation++; this.renderer?.destroy(); this.host.removeEventListener('click', this.click); this.host.removeEventListener('change', this.change); }
  update(state: ResearchState, investigation: Investigation) {
    const latest = this.investigation.reviewFlow!.walkthroughs.at(-1)?.id;
    this.state = state; this.investigation = investigation;
    // New or revised edits, or a revision made from them, show at once.
    if (JSON.stringify(investigation.reviewFlow?.edits || null) !== this.shownEdits) {
      if (this.progress.walkthroughId === latest) this.progress.walkthroughId = investigation.reviewFlow!.walkthroughs.at(-1)?.id;
      this.loadDecisions();
      if (this.progress.stage === 'reading') { this.render(); return; }
    }
    this.renderStatus();
  }
  // Suggested edits apply to the latest walkthrough, and show while it is open.
  private edits(): WalkthroughEdit[] {
    const pending = this.investigation.reviewFlow?.edits;
    return pending && pending.basedOnWalkthroughId === this.progress.walkthroughId ? pending.edits : [];
  }
  private decisionsKey() { return `${this.key}:edits:${this.investigation.reviewFlow?.edits?.suggestedAt || ''}`; }
  private loadDecisions() {
    this.shownEdits = JSON.stringify(this.investigation.reviewFlow?.edits || null);
    const ids = new Set(this.investigation.reviewFlow?.edits?.edits.map(e => e.id) || []);
    try { this.decisions = JSON.parse(localStorage.getItem(this.decisionsKey()) || '{}'); } catch { this.decisions = {}; }
    for (const id of Object.keys(this.decisions)) if (!ids.has(id)) delete this.decisions[id];
  }
  private saveDecisions() {
    try { localStorage.setItem(this.decisionsKey(), JSON.stringify(this.decisions)); } catch { /* Choices are kept for this page only. */ }
  }
  // A passage, or in its place the coordinator's suggested edit to it.
  private passage(id: string, shown: string): string {
    const e = this.edits().find(e => e.id === id);
    return e ? this.editBlock(e) : shown;
  }
  private editBlock(e: WalkthroughEdit): string {
    const d = this.decisions[e.id];
    const pressed = (kind: EditDecision['decision']) => d?.decision === kind ? 'aria-pressed="true"' : 'aria-pressed="false"';
    const writing = this.commenting === e.id;
    const controls = writing
      ? `<textarea data-edit-comment rows="3" placeholder="Your note to the coordinator about this passage…">${html(d?.comment || '')}</textarea><div class="walkthrough-edit-actions"><button class="primary" data-guided-edit-comment-save>Save comment</button><button data-guided-edit-comment-cancel>Cancel</button></div>`
      : `<div class="walkthrough-edit-actions"><button data-guided-edit="accept" ${pressed('accept')}>Yes</button><button data-guided-edit="decline" ${pressed('decline')}>No</button><button data-guided-edit="comment" ${pressed('comment')}>Comment</button><span class="walkthrough-edit-position">Edit ${this.edits().indexOf(e) + 1} of ${this.edits().length}</span></div>${d?.decision === 'comment' && d.comment ? `<p class="walkthrough-edit-note">Your comment, sent with your review: “${html(d.comment)}”</p>` : ''}`;
    return `<div class="walkthrough-edit${d ? ` is-${d.decision}` : ''}" data-edit-id="${html(e.id)}">
      <p class="walkthrough-edit-label">Suggested edit${e.earlier ? ', revised after your comment' : ''}</p>
      ${e.before ? `<div class="walkthrough-edit-before">${paragraphs(e.before)}</div>` : ''}
      ${e.after ? `<div class="walkthrough-edit-after">${paragraphs(e.after)}</div>` : '<p class="walkthrough-edit-note">Removes this passage.</p>'}
      ${e.earlier ? `<div class="walkthrough-edit-earlier"><span>It suggested before:</span>${paragraphs(e.earlier)}</div>` : ''}
      ${e.comment && !e.earlier ? `<p class="walkthrough-edit-note">You commented: “${html(e.comment)}”</p>` : ''}
      ${controls}
    </div>`;
  }
  // How far the human's review has got, with the way to send it.
  private editsBar(): string {
    const edits = this.edits();
    if (!edits.length) return '';
    const count = (kind: EditDecision['decision']) => edits.filter(e => this.decisions[e.id]?.decision === kind).length;
    const decided = edits.filter(e => this.decisions[e.id]).length;
    const summary = decided
      ? [count('accept') ? `${count('accept')} accepted` : '', count('decline') ? `${count('decline')} declined` : '', count('comment') ? `${count('comment')} with a comment` : '', decided < edits.length ? `${edits.length - decided} to decide` : ''].filter(Boolean).join(', ')
      : 'Decide each one where it appears, then send your review.';
    return `<div class="walkthrough-edits-bar"><div><strong>${edits.length} ${edits.length === 1 ? 'edit' : 'edits'} suggested by the coordinator</strong><span>${html(summary)}</span></div><button data-guided-edits-next>${decided < edits.length ? 'Next edit' : 'Show edits'}</button>${decided < edits.length ? '<button data-guided-edits-accept-all>Accept the rest</button>' : ''}<button class="primary" data-guided-edits-send ${decided ? '' : 'disabled'}>Send review</button></div>`;
  }
  private save() { localStorage.setItem(this.key, JSON.stringify(this.progress)); }
  private walkthrough(): Walkthrough | undefined { return this.investigation.reviewFlow!.walkthroughs.find(w => w.id === this.progress.walkthroughId); }
  // Graph work belongs to the batch, independent of which walkthrough revision is open.
  private review(): GraphReview | undefined {
    return this.investigation.reviewFlow!.graphReviews.find(r => r.id === this.progress.graphReviewId && r.status !== 'superseded')
      || this.investigation.reviewFlow!.graphReviews.at(-1);
  }
  private job(): GraphJob | undefined { return this.investigation.reviewFlow!.jobs.filter(j => j.status !== 'superseded').at(-1); }
  private reference(label: string, stepId?: string): AnnotationTarget { return {label, walkthroughId: this.progress.walkthroughId, stepId}; }
  private renderStatus() {
    const status = this.host.querySelector('[data-guided-status]');
    if (!status) return;
    const job = this.job(), review = this.review(), latest = this.investigation.reviewFlow!.walkthroughs.at(-1);
    // A batch whose graph review is finished takes no further graph work.
    const finished = graphWorkFinished(this.investigation);
    status.innerHTML = `${this.progress.stage === 'reading' ? this.editsBar() : ''}${latest && latest.id !== this.progress.walkthroughId ? `<div class="walkthrough-update">An updated explanation is ready. Your reading position is saved. <button data-guided-latest>Read the update</button></div>` : ''}
      <div class="guided-activity"><span>${html(review ? review.status === 'pending' ? this.pendingLine(review, job) : review.status === 'undone' ? 'This batch\'s accepted draft was undone.' : 'This batch\'s graph review is complete.' : job ? progressLine(job.progress) : 'No graph update has been requested for this batch.')}</span>
      ${review && this.progress.stage !== 'graph' ? '<button data-guided-graph>Explore the graph</button>' : ''}
      ${job && ['running','queued'].includes(job.status) ? '<button class="text-action" data-guided-pause>Pause graph preparation</button>' : ''}
      ${job?.status === 'paused' ? finished ? '<span class="muted">This batch\'s graph update is finished, so its paused preparation cannot resume. Later work belongs to a new batch.</span>' : job.resumeRequest?.status === 'pending' ? `<span>${html(job.resumeRequest.reason)}</span><button data-guided-resume="approve">Resume graph preparation</button><button data-guided-resume="decline">Keep paused</button>` : '<button data-guided-resume="resume">Resume graph preparation</button>' : ''}</div>`;
    const destination = this.host.querySelector('[data-guided-ending-destination]');
    if (destination) destination.innerHTML = review ? '<button class="primary" data-guided-graph>Open the graph review</button>' : `<p class="muted">${job ? 'Graph preparation is under way. Its progress appears above.' : 'Request a graph update from Review when you want this batch in the graph.'}</p>`;
  }
  private render() {
    this.renderer?.destroy(); this.renderer = undefined; this.generation++;
    this.save();
    const w = this.walkthrough();
    this.host.innerHTML = `<div class="guided-review" data-investigation-id="${html(this.investigation.id)}"><div data-guided-status aria-live="polite"></div><div data-guided-body></div></div>`;
    this.renderStatus();
    if ((this.progress.stage === 'graph' || !w) && this.review()) { void this.renderGraph().catch(error => this.options.error(error.message)); return; }
    if (!w) { this.host.querySelector('[data-guided-body]')!.innerHTML = '<p class="muted">Nothing to review for this batch yet.</p>'; return; }
    const index = Math.max(0, Math.min(w.steps.length + 1, this.progress.step));
    let body;
    if (index === 0) {
      const added = this.edits().filter(e => e.id.startsWith('caveats.') && Number(e.id.slice(8)) >= w.caveats.length);
      body = `<div class="guided-question" ${target(this.reference('Your research question', 'opening'))}><span class="eyebrow">You asked</span>${this.passage('question', paragraphs(w.question))}</div>${this.passage('title', `<h1>${html(w.title)}</h1>`)}
      ${w.correction ? `<div class="walkthrough-correction" ${target(this.reference('What changed', 'opening'))}><h2>What changed</h2>${this.passage('correction', paragraphs(w.correction))}</div>` : ''}
      <section ${target(this.reference('How we investigated', 'opening'))}><h2>How we got here</h2>${this.passage('journey', paragraphs(w.journey))}</section>
      <section ${target(this.reference('What we found', 'opening'))}><h2>What we found</h2>${this.passage('answer', paragraphs(w.answer))}</section>
      ${w.caveats.length || added.length ? `<section ${target(this.reference('What remains open', 'opening'))}><h2>What remains open</h2><ul>${w.caveats.map((c, n) => `<li>${this.passage(`caveats.${n}`, researchInline(c))}</li>`).join('')}${added.map(e => `<li>${this.editBlock(e)}</li>`).join('')}</ul></section>` : ''}
      <div class="guided-next"><p>We’ll walk through the evidence in ${w.steps.length} connected ${w.steps.length === 1 ? 'step' : 'steps'}. You can inspect sources and annotate anything along the way.</p><button class="primary" data-guided-next>Begin evidentiary review</button></div>`;
    } else if (index <= w.steps.length) {
      const step = w.steps[index - 1]!;
      const id = (key: string) => `steps.${step.id}.${key}`;
      body = `<div class="guided-step-position">Evidence ${index} of ${w.steps.length}</div><section ${target(this.reference(step.title, step.id))}>${this.passage(id('title'), `<h1>${html(step.title)}</h1>`)}${this.passage(id('body'), paragraphs(step.body))}</section>
      <div class="guided-evidence">${step.evidenceRefs.map(ref => this.evidence(ref, step.id)).join('')}</div>
      <div class="guided-next" ${target(this.reference('Where this leads', step.id))}>${this.passage(id('transition'), paragraphs(step.transition))}</div>
      <nav class="guided-navigation"><button data-guided-back>Back</button><button class="primary" data-guided-next>Continue</button><span>${index === w.steps.length ? 'Bringing it together' : html(w.steps[index]?.title)}</span></nav>`;
    } else {
      body = `<span class="eyebrow">Bringing it together</span><section ${target(this.reference('Research conclusion', 'closing'))}><h1>What we can build on</h1>${this.passage('closing', paragraphs(w.closing))}</section><nav class="guided-navigation"><button data-guided-back>Back</button><div data-guided-ending-destination></div></nav>`;
    }
    this.host.querySelector('[data-guided-body]')!.innerHTML = `<article class="guided-reading">${body}<details class="guided-originals"><summary>Research reports and walkthrough history</summary><p>The researchers’ original findings and evidence remain here alongside the coordinator’s explanation.</p>${w.proposalIds.map(id => {
      const p = this.investigation.proposals.find(p => p.id === id)!;
      return `<details><summary>${html(p.title)}</summary>${paragraphs(p.summary)}${(p.findings || []).map(f => `<section ${target({label: f.statement, proposalId: p.id, findingId: f.id})}><h3>${html(f.statement)}</h3><p class="muted">${html(f.qualification)}</p>${paragraphs(f.explanation)}${f.evidenceIds.map(e => this.evidence(`${p.id}/${e}`)).join('')}</section>`).join('')}</details>`;
    }).join('')}<label>Walkthrough revision <select data-guided-revision>${this.investigation.reviewFlow!.walkthroughs.map(v => `<option value="${html(v.id)}" ${v.id === w.id ? 'selected' : ''}>${v.revision}: ${html(v.title)}</option>`).join('')}</select></label></details></article>`;
    this.renderStatus();
  }
  private evidence(ref: string, stepId?: string): string {
    const p = this.investigation.proposals.find(p => ref.startsWith(`${p.id}/`));
    const e = p?.evidence.find(e => `${p.id}/${e.id}` === ref);
    if (!e) return '';
    const source = sourceLibrary(this.state).find(s => s.id === e.sourceId);
    return `<details class="guided-passage"><summary>${html(source?.title || e.sourceId)} · ${html(e.locator)}</summary><section ${target(this.reference(`Source passage: ${source?.title || e.sourceId}`, stepId))}><blockquote>${html(e.quote)}</blockquote><p class="preserve-lines">${html(e.interpretation)}</p><details><summary>Surrounding context</summary>${paragraphs(e.context)}</details><button data-guided-source="${html(e.sourceId)}">Inspect source</button></section></details>`;
  }
  // What is happening to a draft under review, in the reader's terms.
  private pendingLine(r: GraphReview, job?: GraphJob): string {
    if (r.revisingSince) return `Your draft is being revised. ${job ? progressLine(job.note || job.progress) : ''}`.trim();
    if (feedbackAwaitingDraft(this.investigation, r)) return 'Your note is with the coordinator, who will answer it or have the draft revised.';
    return 'A graph draft is ready for your review.';
  }
  // One decision for the whole draft, with a way to take it back while nothing has changed since.
  private decision(r: GraphReview, reference: AnnotationTarget): string {
    const undo = r.undoId && this.state.organization?.history.find(h => h.id === r.undoId);
    const undoable = undo && (undo as {appliedRevision?: number}).appliedRevision === this.state.datasetRevision;
    if (r.status === 'applied') return `<section class="draft-decision" data-draft-decision><p><strong>Accepted${r.decidedAt ? ` ${html(new Date(r.decidedAt).toLocaleDateString('en-US', {month: 'short', day: 'numeric'}))}` : ''}.</strong> This draft is now your graph.</p>${undoable ? `<button data-guided-undo="${html(r.undoId!)}">Undo accepting</button>` : ''}<p data-guided-error role="alert"></p></section>`;
    if (r.status === 'set-aside') return '<section class="draft-decision"><p><strong>Set aside.</strong> Your graph was not changed.</p></section>';
    if (r.status === 'undone') return '<section class="draft-decision"><p><strong>Accepted, then undone.</strong> Your graph is back as it was before this draft. You can request a revised draft from Review.</p></section>';
    if (r.status !== 'pending') return '<section class="draft-decision"><p>A newer draft replaced this one.</p></section>';
    // While a note is being handled, the draft can be read but not decided.
    if (r.revisingSince) return '<section class="draft-decision"><p><strong>Being revised.</strong> The builder is working on your notes. The new draft will replace this one here, and you can decide on it then.</p></section>';
    if (feedbackAwaitingDraft(this.investigation, r)) return '<section class="draft-decision"><p><strong>Your note is with the coordinator.</strong> It will answer your note, or send the draft back to be revised. You can decide once it has.</p></section>';
    return `<section class="draft-decision" data-draft-decision data-reference="${html(JSON.stringify(reference))}"><p>Accepting replaces your graph with this draft. Research records are kept, and you can undo it until the graph next changes.</p><div class="draft-decision-actions"><button class="primary" data-guided-accept>Accept this draft</button><button data-guided-set-aside>Set aside…</button></div><div class="draft-set-aside" hidden><label>What should change instead? <span class="muted">Optional; your note goes to the coordinator as new work.</span><textarea data-set-aside-note rows="3"></textarea></label><div class="draft-decision-actions"><button data-guided-set-aside-confirm>Set aside</button><button class="text-action" data-guided-set-aside-cancel>Cancel</button></div></div><p class="muted">To ask for changes instead, annotate anything in the draft and send it.</p><p data-guided-error role="alert"></p></section>`;
  }
  private changes(r: GraphReview): string {
    const sections = changeSections(r);
    const evidence = r.cited.evidence.length ? `<p class="muted">${r.cited.evidence.length} evidence ${r.cited.evidence.length === 1 ? 'record' : 'records'} from the research will be added.</p>` : '';
    return `<section class="draft-changes"><h2>What changed</h2>${sections.map(section => `<h3>${html(section.title)}</h3><ul>${section.items.map(item => `<li ${target({label: item.label, graphReviewId: r.id, ...item.target})}><button class="draft-change" data-guided-focus="${html(item.ids.join(' '))}">${html(item.label)}</button></li>`).join('')}</ul>`).join('') || '<p class="muted">This draft changes nothing.</p>'}${evidence}</section>`;
  }
  private commentary(r: GraphReview): string {
    const questions = r.questions.length ? `<section class="draft-questions"><h2>The builder's open questions</h2>${r.questions.map(q => `<details class="tour-issue" ${target({label: q.question, graphReviewId: r.id})}><summary>${html(q.question)}</summary>${paragraphs(q.provisionalTreatment)}${q.requestedResearch ? `<p>Further research: ${html(q.requestedResearch)}</p>` : ''}</details>`).join('')}</section>` : '';
    const undone = r.undone.length ? `<section class="draft-undone"><h2>Left undone</h2><ul>${r.undone.map(u => `<li ${target({label: u.instruction, graphReviewId: r.id})}><strong>${html(u.instruction)}</strong>${paragraphs(u.reason)}</li>`).join('')}</ul></section>` : '';
    return undone + questions;
  }
  private async renderGraph() {
    const r = this.review()!;
    this.progress.graphReviewId = r.id; this.save();
    const host = this.host.querySelector<HTMLElement>('[data-guided-body]')!;
    if (r.format !== 'draft') { host.innerHTML = '<p class="muted">This graph review was prepared in an older format and cannot be shown.</p>'; return; }
    const generation = this.generation;
    const view = reviewGraph(r);
    const model = new GenealogyModel(view.dataset);
    const shows = this.progress.changes ?? r.status === 'pending';
    host.innerHTML = `<section class="guided-graph-review" data-graph-review-id="${html(r.id)}"><header class="graph-review-heading">${this.walkthrough() ? '<button data-guided-reading>Back to the research</button>' : '<span></span>'}<span>${r.status === 'applied' ? 'Accepted draft' : 'Graph draft'} · Revision ${r.revision}</span><button data-guided-tour-home>Overview</button></header><div class="guided-graph-layout"><div class="guided-graph-stage${shows ? ' shows-changes' : ''}"><div class="guided-graph-controls"><button data-guided-fit>Fit all</button><button data-guided-zoom="1.3" aria-label="Zoom in">+</button><button data-guided-zoom="0.77" aria-label="Zoom out">−</button><label class="draft-toggle"><input type="checkbox" data-guided-changes ${shows ? 'checked' : ''}> Show changes</label></div><div class="guided-graph-canvas"></div></div><aside class="guided-graph-sidebar"><div data-tour-guidance></div><div data-tour-record></div></aside></div></section>`;
    const canvas = host.querySelector<HTMLElement>('.guided-graph-canvas')!;
    const record = host.querySelector<HTMLElement>('[data-tour-record]')!;
    const ref = (label: string, extras: Partial<AnnotationTarget> = {}) => ({label, graphReviewId: r.id, ...extras});
    const annotateRecords = (container: Element) => {
      for (const element of container.querySelectorAll<HTMLElement>('[data-research-target]')) {
        const original = JSON.parse(element.getAttribute('data-research-target')!) as AnnotationTarget;
        const removed = original.recordId && view.ghostIds.has(original.recordId);
        element.setAttribute('data-research-target', JSON.stringify({...original, graphReviewId: r.id, ...(original.table === 'claims' ? {claimId: original.recordId} : {}), ...(removed ? {text: 'Removed by this draft'} : {})}));
      }
    };
    const showRecord = (id: string) => {
      const options = {onClose: () => record.replaceChildren(), onNavigate: showRecord, onOpenContextEntity: showRecord};
      if (model.peopleById.has(id)) renderDetailsPanel(record, model, id, options);
      else if (model.contextEntitiesById.has(id)) renderContextDetailsPanel(record, model, id, options);
      if (view.ghostIds.has(id)) record.insertAdjacentHTML('afterbegin', '<p class="draft-ghost-note">This draft removes this record.</p>');
      annotateRecords(record);
    };
    this.renderer = new GraphRenderer(canvas, {
      onFocus: id => { this.renderer?.centerOn(id); showRecord(id); this.exploring(); },
      onOpenDetails: id => { showRecord(id); this.exploring(); },
      onOpenContextEntity: id => { this.renderer?.centerOn(id); showRecord(id); this.exploring(); },
    }, true);
    if (view.focusId) {
      const projection = projectAround(model, view.focusId);
      const layout = await layoutFamily(model, projection);
      if (this.disposed || generation !== this.generation) return;
      this.renderer.render(layout, projection, model);
      annotateRecords(canvas);
      markChanges(canvas, view);
    }
    const step = r.tour.steps[this.progress.stop];
    const guidance = host.querySelector<HTMLElement>('[data-tour-guidance]')!;
    if (this.progress.stop < 0 || !step) {
      this.progress.stop = -1;
      guidance.innerHTML = `<section ${target(ref('Graph draft overview'))}><span class="eyebrow">Graph draft</span><h1>${html(this.investigation.title)}</h1><p class="draft-summary">${html(r.summary)}</p>${paragraphs(r.tour.introduction)}${r.tour.steps.length ? '<button data-guided-tour-next>Walk through the changes</button>' : ''}</section>${this.decision(r, ref('Graph draft decision'))}${this.commentary(r)}${this.changes(r)}`;
    } else {
      guidance.innerHTML = `<section ${target(ref(step.title, {stepId: step.id}))}><span class="eyebrow">Change ${this.progress.stop + 1} of ${r.tour.steps.length}</span><h2>${html(step.title)}</h2>${paragraphs(step.explanation)}${step.issueIds.map(id => { const q = r.questions.find(x => x.id === id); return q ? `<details class="tour-issue"><summary>${html(q.question)}</summary>${paragraphs(q.provisionalTreatment)}${q.requestedResearch ? `<p>Further research: ${html(q.requestedResearch)}</p>` : ''}</details>` : ''; }).join('')}<div class="tour-transition">${paragraphs(step.transition)}</div></section><nav class="guided-navigation"><button data-guided-tour-back>Back</button><button class="primary" data-guided-tour-next>${this.progress.stop === r.tour.steps.length - 1 ? 'Finish' : 'Continue'}</button></nav><button class="text-action" data-guided-return hidden>Return to this change</button>`;
      // Ghosts are hidden while changes are off, so the camera frames only what can be seen.
      const visible = (id: string) => shows || !view.ghostIds.has(id);
      const focusIds = step.focusNodeIds.filter(visible);
      const focusEdges = step.focusClaimIds.filter(visible);
      const edge = view.dataset.claims!.find(c => focusEdges.includes(c.id));
      const recordId = focusIds[0] || edge?.subjectId;
      if (recordId) showRecord(recordId);
      window.requestAnimationFrame(() => { if (!this.disposed && generation === this.generation) this.renderer?.focusRegion(focusIds, focusEdges); });
    }
  }
  private editElement(id: string) { return [...this.host.querySelectorAll<HTMLElement>('[data-edit-id]')].find(e => e.dataset.editId === id); }
  // Yes, No and Comment on one edit, and the review as a whole.
  private editClick(b: HTMLElement): boolean {
    const id = b.closest<HTMLElement>('[data-edit-id]')?.dataset.editId;
    const edits = this.edits();
    if (id && b.dataset.guidedEdit) {
      const kind = b.dataset.guidedEdit as EditDecision['decision'];
      if (kind === 'comment') this.commenting = id;
      else if (this.decisions[id]?.decision === kind) delete this.decisions[id];
      else this.decisions[id] = {decision: kind};
    } else if (id && b.hasAttribute('data-guided-edit-comment-save')) {
      const comment = b.closest('[data-edit-id]')!.querySelector<HTMLTextAreaElement>('[data-edit-comment]')!.value.trim();
      if (comment) this.decisions[id] = {decision: 'comment', comment};
      else if (this.decisions[id]?.decision === 'comment') delete this.decisions[id];
      this.commenting = undefined;
    } else if (id && b.hasAttribute('data-guided-edit-comment-cancel')) {
      this.commenting = undefined;
    } else if (b.hasAttribute('data-guided-edits-accept-all')) {
      for (const e of edits) this.decisions[e.id] ||= {decision: 'accept'};
    } else if (b.hasAttribute('data-guided-edits-next')) {
      const w = this.walkthrough()!;
      const open = edits.filter(e => !this.decisions[e.id]);
      const pool = open.length ? open : edits;
      const here = this.host.querySelector<HTMLElement>('.walkthrough-edit');
      const after = pool.find(e => editPage(w, e.id) > this.progress.step) || pool.find(e => e.id !== here?.dataset.editId) || pool[0]!;
      this.progress.step = editPage(w, after.id);
      this.render();
      this.editElement(after.id)?.scrollIntoView({block: 'center'});
      return true;
    } else if (b.hasAttribute('data-guided-edits-send')) {
      b.setAttribute('disabled', '');
      const decisions = this.decisions;
      this.progress.followLatest = true;
      this.save();
      void this.options.command({action: 'review-walkthrough-edits', investigationId: this.investigation.id, decisions})
        .then(() => { try { localStorage.removeItem(this.decisionsKey()); } catch { /* Nothing kept. */ } })
        .catch(error => { b.removeAttribute('disabled'); delete this.progress.followLatest; this.save(); this.options.error(error.message); });
      return true;
    } else return false;
    this.saveDecisions();
    // Only the edit and the bar change; the reader keeps their place.
    const block = id ? this.editElement(id) : undefined;
    const edit = id ? edits.find(e => e.id === id) : undefined;
    if (block && edit) {
      block.outerHTML = this.editBlock(edit);
      if (this.commenting === id) this.editElement(id!)?.querySelector<HTMLTextAreaElement>('[data-edit-comment]')?.focus();
    } else this.render();
    this.renderStatus();
    return true;
  }
  private exploring() { const button = this.host.querySelector<HTMLElement>('[data-guided-return]'); if (button) button.hidden = false; }
  private change = (event: Event) => {
    const input = event.target as HTMLInputElement;
    if (input.hasAttribute('data-guided-revision')) { this.progress = {walkthroughId: input.value, stage: 'reading', step: 0, stop: -1}; this.render(); }
    // Showing changes only reveals what is already drawn, so nothing moves.
    if (input.hasAttribute('data-guided-changes')) { this.progress.changes = input.checked; this.save(); input.closest('.guided-graph-stage')?.classList.toggle('shows-changes', input.checked); }
  };
  private click = (event: Event) => {
    const b = (event.target as Element).closest<HTMLElement>('button');
    if (!b || ![...b.attributes].some(a => a.name.startsWith('data-guided-'))) return;
    event.stopPropagation();
    if (b.dataset.guidedSource) { this.options.source(b.dataset.guidedSource); return; }
    if (this.editClick(b)) return;
    if (b.hasAttribute('data-guided-pause') || b.dataset.guidedResume) {
      const action = b.hasAttribute('data-guided-pause') ? 'graph-job-pause' : b.dataset.guidedResume === 'resume' ? 'graph-job-resume' : 'graph-resume-decision';
      void this.options.command({action, investigationId: this.investigation.id, jobId: this.job()!.id, decision: b.dataset.guidedResume}).catch(e => this.options.error(e.message)); return;
    }
    const block = b.closest<HTMLElement>('[data-draft-decision]');
    if (block && (b.hasAttribute('data-guided-set-aside') || b.hasAttribute('data-guided-set-aside-cancel'))) {
      const form = block.querySelector<HTMLElement>('.draft-set-aside')!;
      form.hidden = b.hasAttribute('data-guided-set-aside-cancel');
      block.querySelector<HTMLElement>('.draft-decision-actions')!.hidden = !form.hidden;
      if (!form.hidden) block.querySelector<HTMLTextAreaElement>('[data-set-aside-note]')!.focus();
      return;
    }
    if (block && (b.hasAttribute('data-guided-accept') || b.hasAttribute('data-guided-set-aside-confirm') || b.dataset.guidedUndo)) {
      const r = this.review()!;
      const note = block.querySelector<HTMLTextAreaElement>('[data-set-aside-note]')?.value.trim() || '';
      b.setAttribute('disabled', '');
      void (async () => {
        if (b.dataset.guidedUndo) await this.options.command({action: 'organization-undo', undoId: b.dataset.guidedUndo});
        else if (b.hasAttribute('data-guided-accept')) await this.options.command({action: 'graph-accept', investigationId: this.investigation.id, graphReviewId: r.id});
        else {
          await this.options.command({action: 'graph-set-aside', investigationId: this.investigation.id, graphReviewId: r.id});
          if (note && this.options.decline) await this.options.decline(note, JSON.parse(block.dataset.reference!) as AnnotationTarget);
        }
      })().catch(e => { const error = block.querySelector('[data-guided-error]'); if (error) error.textContent = e.message; b.removeAttribute('disabled'); });
      return;
    }
    if (b.dataset.guidedFocus) {
      const ids = b.dataset.guidedFocus.split(' ');
      const nodes = ids.filter(id => this.host.querySelector(`.graph-node[data-person-id="${CSS.escape(id)}"], .graph-node[data-context-entity-id="${CSS.escape(id)}"]`));
      const stage = this.host.querySelector('.guided-graph-stage');
      if (stage && !stage.classList.contains('shows-changes')) { stage.classList.add('shows-changes'); this.progress.changes = true; this.save(); const toggle = this.host.querySelector<HTMLInputElement>('[data-guided-changes]'); if (toggle) toggle.checked = true; }
      this.renderer?.focusRegion(nodes, ids.filter(id => !nodes.includes(id)));
      return;
    }
    if (b.hasAttribute('data-guided-fit')) { this.renderer?.fitAll(); return; }
    if (b.dataset.guidedZoom) { this.renderer?.zoomBy(Number(b.dataset.guidedZoom)); return; }
    if (b.hasAttribute('data-guided-latest')) this.progress = {walkthroughId: this.investigation.reviewFlow!.walkthroughs.at(-1)!.id, stage: 'reading', step: 0, stop: -1};
    if (b.hasAttribute('data-guided-next')) this.progress.step++;
    if (b.hasAttribute('data-guided-back')) this.progress.step--;
    if (b.hasAttribute('data-guided-graph')) { this.progress.stage = 'graph'; this.progress.stop = -1; }
    if (b.hasAttribute('data-guided-reading')) this.progress.stage = 'reading';
    if (b.hasAttribute('data-guided-tour-next')) this.progress.stop++;
    if (b.hasAttribute('data-guided-tour-back')) this.progress.stop--;
    if (b.hasAttribute('data-guided-tour-home')) this.progress.stop = -1;
    this.render();
    this.host.scrollIntoView({block: 'start'});
  };
}

// Mark what a draft changes on the drawn graph: ghosts for removed records, and
// outlines for new ones. The marks show only while changes are shown.
function markChanges(canvas: Element, view: {ghostIds: Set<string>; addedIds: Set<string>; changedEdgeIds: Set<string>}) {
  for (const node of canvas.querySelectorAll('.graph-node')) {
    const id = node.getAttribute('data-person-id') || node.getAttribute('data-context-entity-id') || '';
    node.classList.toggle('is-ghost', view.ghostIds.has(id));
    node.classList.toggle('is-proposed', view.addedIds.has(id));
  }
  for (const edge of canvas.querySelectorAll('.graph-edge, .context-edge-label')) {
    let id = '';
    try { id = (JSON.parse(edge.getAttribute('data-research-target') || '{}') as AnnotationTarget).recordId || edge.getAttribute('data-connection-id') || ''; } catch { /* Unmarked. */ }
    edge.classList.toggle('is-ghost', view.ghostIds.has(id));
    edge.classList.toggle('is-proposed', view.addedIds.has(id));
    edge.classList.toggle('is-changed', view.changedEdgeIds.has(id));
  }
}
