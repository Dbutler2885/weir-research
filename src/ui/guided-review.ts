import type { Investigation, ResearchState, AnnotationTarget } from '../domain/research';
import type { Walkthrough, GraphReview, GraphJob } from '../domain/review-flow';
import { graphWorkFinished } from '../domain/review-flow';
import { progressLine } from './review-view';
import { html, target } from './finding-review';
import { sourceLibrary } from '../domain/findings';
import { materializeGraph, approvableTogether, declinedWithDependents } from '../domain/graph-draft';
import { GenealogyModel } from '../domain/model';
import { projectAround } from '../domain/projection';
import { layoutFamily } from '../layout/layout';
import { GraphRenderer } from './graph-renderer';
import { renderDetailsPanel, renderContextDetailsPanel } from './details-panel';

import {researchText as paragraphs, researchInline} from './research-text';

interface Progress { walkthroughId?: string; stage: 'reading' | 'graph'; step: number; graphReviewId?: string; stop: number; groups?: string[] }
interface Options {
  command: (data: Record<string, unknown>) => Promise<void>;
  source: (id: string, quote?: string) => void;
  error: (message: string) => void;
  // Opens on the batch's walkthrough or directly on its graph review.
  start?: 'reading' | 'graph';
  // Sends the note left when declining graph changes, as new work for the coordinator.
  decline?: (note: string, reference: AnnotationTarget) => Promise<void>;
}
type Group = GraphReview['graph']['groups'][number];

// The change groups a tour step shows, and whether each can be decided now.
export function stepGroups(r: GraphReview, step: GraphReview['tour']['steps'][number]): Group[] {
  const focus = new Set([...step.focusNodeIds, ...step.focusClaimIds]);
  return r.graph.groups.filter(g => [...g.nodeIds, ...g.claimIds].some(id => focus.has(id)));
}
export function groupState(r: GraphReview, g: Group): {label: string; actionable: boolean} {
  if (r.appliedGroupIds.includes(g.id)) return {label: 'Approved', actionable: false};
  if (r.rejectedGroupIds.includes(g.id)) return {label: 'Declined', actionable: false};
  if (r.graph.issues.some(i => i.blocksGroupIds.includes(g.id))) return {label: 'Waiting on a question', actionable: false};
  if (g.dependsOn.some(d => r.rejectedGroupIds.includes(d))) return {label: 'Depends on a declined change', actionable: false};
  const missing = g.dependsOn.filter(d => !r.appliedGroupIds.includes(d)).map(d => r.graph.groups.find(x => x.id === d)?.title || d);
  if (missing.length) return {label: `Needs ${missing.join(', ')} first`, actionable: false};
  return {label: 'Waiting for your decision', actionable: true};
}
export class GuidedReview {
  private renderer?: GraphRenderer;
  private generation = 0;
  private progress: Progress;
  private key: string;
  private disposed = false;
  constructor(private host: HTMLElement, private state: ResearchState, private investigation: Investigation, private options: Options) {
    this.key = `guided-review:${location.origin}:${investigation.id}`;
    let saved;
    try { saved = JSON.parse(localStorage.getItem(this.key) || 'null'); } catch { /* Start at the briefing. */ }
    const flow = investigation.reviewFlow!;
    this.progress = saved || {walkthroughId: flow.walkthroughs.at(-1)?.id, stage: 'reading', step: 0, stop: -1};
    if (!flow.walkthroughs.some(w => w.id === this.progress.walkthroughId)) this.progress.walkthroughId = flow.walkthroughs.at(-1)?.id;
    if (options.start === 'graph' || !this.progress.walkthroughId) {
      const latest = flow.graphReviews.at(-1);
      if (this.progress.graphReviewId !== latest?.id) this.progress.stop = -1;
      this.progress.stage = 'graph';
      this.progress.graphReviewId = latest?.id;
    } else if (options.start === 'reading') this.progress.stage = 'reading';
    host.addEventListener('click', this.click);
    host.addEventListener('change', this.change);
    this.render();
  }
  destroy() { this.disposed = true; this.generation++; this.renderer?.destroy(); this.host.removeEventListener('click', this.click); this.host.removeEventListener('change', this.change); }
  update(state: ResearchState, investigation: Investigation) {
    this.state = state; this.investigation = investigation;
    this.renderStatus();
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
    status.innerHTML = `${latest && latest.id !== this.progress.walkthroughId ? `<div class="walkthrough-update">An updated explanation is ready. Your reading position is saved. <button data-guided-latest>Read the update</button></div>` : ''}
      <div class="guided-activity"><span>${html(review ? review.status === 'pending' ? 'A graph update is ready for your review.' : 'This batch\'s graph review is complete.' : job ? progressLine(job.progress) : 'No graph update has been requested for this batch.')}</span>
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
      body = `<div class="guided-question" ${target(this.reference('Your research question', 'opening'))}><span class="eyebrow">You asked</span>${paragraphs(w.question)}</div><h1>${html(w.title)}</h1>
      ${w.correction ? `<div class="walkthrough-correction" ${target(this.reference('What changed', 'opening'))}><h2>What changed</h2>${paragraphs(w.correction)}</div>` : ''}
      <section ${target(this.reference('How we investigated', 'opening'))}><h2>How we got here</h2>${paragraphs(w.journey)}</section>
      <section ${target(this.reference('What we found', 'opening'))}><h2>What we found</h2>${paragraphs(w.answer)}</section>
      ${w.caveats.length ? `<section ${target(this.reference('What remains open', 'opening'))}><h2>What remains open</h2><ul>${w.caveats.map(c => `<li>${researchInline(c)}</li>`).join('')}</ul></section>` : ''}
      <div class="guided-next"><p>We’ll walk through the evidence in ${w.steps.length} connected ${w.steps.length === 1 ? 'step' : 'steps'}. You can inspect sources and annotate anything along the way.</p><button class="primary" data-guided-next>Begin evidentiary review</button></div>`;
    } else if (index <= w.steps.length) {
      const step = w.steps[index - 1]!;
      body = `<div class="guided-step-position">Evidence ${index} of ${w.steps.length}</div><section ${target(this.reference(step.title, step.id))}><h1>${html(step.title)}</h1>${paragraphs(step.body)}</section>
      <div class="guided-evidence">${step.evidenceRefs.map(ref => this.evidence(ref, step.id)).join('')}</div>
      <div class="guided-next" ${target(this.reference('Where this leads', step.id))}>${paragraphs(step.transition)}</div>
      <nav class="guided-navigation"><button data-guided-back>Back</button><button class="primary" data-guided-next>Continue</button><span>${index === w.steps.length ? 'Bringing it together' : html(w.steps[index]?.title)}</span></nav>`;
    } else {
      body = `<span class="eyebrow">Bringing it together</span><section ${target(this.reference('Research conclusion', 'closing'))}><h1>What we can build on</h1>${paragraphs(w.closing)}</section><nav class="guided-navigation"><button data-guided-back>Back</button><div data-guided-ending-destination></div></nav>`;
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
  private decision(r: GraphReview, groups: Group[], reference: AnnotationTarget): string {
    if (!groups.length) return '';
    const states = groups.map(g => ({g, ...groupState(r, g)}));
    const pending = r.status === 'pending';
    const declinable = pending ? groups.filter(g => ![...r.appliedGroupIds, ...r.rejectedGroupIds].includes(g.id)).map(g => g.id) : [];
    const approvable = pending ? approvableTogether(r.graph, declinable, r.appliedGroupIds, r.rejectedGroupIds) : [];
    const dependents = declinedWithDependents(r.graph, declinable, [...r.appliedGroupIds, ...r.rejectedGroupIds]).length - declinable.length;
    const actions = `${approvable.length ? `<button class="primary" data-guided-approve>Approve ${approvable.length === 1 ? 'this change' : approvable.length === declinable.length ? 'these changes' : `${approvable.length} of these changes`}</button>` : ''}<button data-guided-decline>Decline${declinable.length > 1 ? ' these' : ''}…</button>`;
    const cascade = dependents ? `<p class="muted">This also declines ${dependents === 1 ? 'a later change that depends' : `${dependents} later changes that depend`} on ${declinable.length === 1 ? 'it' : 'them'}.</p>` : '';
    return `<section class="tour-decision" data-tour-decision data-approve-ids="${html(approvable.join(' '))}" data-decline-ids="${html(declinable.join(' '))}" data-reference="${html(JSON.stringify(reference))}"><h3>${groups.length === 1 ? 'The change in this step' : 'Changes in this step'}</h3><ul>${states.map(s => `<li ${target({...reference, label: s.g.title, groupId: s.g.id})}><span>${html(s.g.title)}</span><span class="tour-decision-state">${html(s.label)}</span></li>`).join('')}</ul>${declinable.length ? `<div class="tour-decision-actions">${actions}</div><div class="tour-decline" hidden>${cascade}<label>What should change instead? <span class="muted">Optional; your note goes to the coordinator as new work.</span><textarea data-decline-note rows="3"></textarea></label><div class="tour-decision-actions"><button data-guided-decline-confirm>Decline</button><button class="text-action" data-guided-decline-cancel>Cancel</button></div></div>` : ''}<p data-guided-error role="alert"></p></section>`;
  }
  private async renderGraph() {
    const r = this.review()!;
    this.progress.graphReviewId = r.id; this.save();
    const generation = this.generation;
    const data = materializeGraph(r.baseDataset, r.graph, r.evidence, r.sources);
    const model = new GenealogyModel(data);
    const mapped = (id: string) => r.graph.nodes.find(n => n.id === id)?.existingId || id;
    const fallbackFocus = data.initialFocusId;
    const host = this.host.querySelector<HTMLElement>('[data-guided-body]')!;
    host.innerHTML = `<section class="guided-graph-review" data-graph-review-id="${html(r.id)}"><header class="graph-review-heading">${this.walkthrough() ? '<button data-guided-reading>Back to the research</button>' : '<span></span>'}<span>${r.status === 'applied' ? 'Applied graph' : 'Proposed graph'} · Revision ${r.revision}</span><button data-guided-tour-home>Tour overview</button></header><div class="guided-graph-layout"><div class="guided-graph-stage"><div class="guided-graph-controls"><button data-guided-fit>Fit all</button><button data-guided-zoom="1.3" aria-label="Zoom in">+</button><button data-guided-zoom="0.77" aria-label="Zoom out">−</button><span>Outlined records are proposed additions.</span></div><div class="guided-graph-canvas"></div></div><aside class="guided-graph-sidebar"><div data-tour-guidance></div><div data-tour-record></div></aside></div></section>`;
    const canvas = host.querySelector<HTMLElement>('.guided-graph-canvas')!;
    const record = host.querySelector<HTMLElement>('[data-tour-record]')!;
    const ref = (label: string, extras: Partial<AnnotationTarget> = {}) => ({label, graphReviewId: r.id, ...extras});
    const annotateRecords = (container: Element) => {
      for (const element of container.querySelectorAll<HTMLElement>('[data-research-target]')) {
        const original = JSON.parse(element.getAttribute('data-research-target')!);
        const claim = r.graph.claims.find(c => c.id === original.recordId);
        const group = r.graph.groups.find(g => g.claimIds.includes(original.recordId) || g.nodeIds.some(id => mapped(id) === original.recordId));
        element.setAttribute('data-research-target', JSON.stringify({...original, graphReviewId: r.id, groupId: group?.id, claimId: claim?.id}));
      }
    };
    const showRecord = (id: string) => {
      id = mapped(id);
      const options = {onClose: () => record.replaceChildren(), onNavigate: showRecord, onOpenContextEntity: showRecord};
      if (model.peopleById.has(id)) renderDetailsPanel(record, model, id, options);
      else if (model.contextEntitiesById.has(id)) renderContextDetailsPanel(record, model, id, options);
      annotateRecords(record);
    };
    this.renderer = new GraphRenderer(canvas, {
      onFocus: id => { this.renderer?.centerOn(id); showRecord(id); this.exploring(); },
      onOpenDetails: id => { showRecord(id); this.exploring(); },
      onOpenContextEntity: id => { this.renderer?.centerOn(id); showRecord(id); this.exploring(); },
    }, true);
    if (fallbackFocus) {
      const projection = projectAround(model, fallbackFocus);
      const layout = await layoutFamily(model, projection);
      if (this.disposed || generation !== this.generation) return;
      this.renderer.render(layout, projection, model);
      annotateRecords(canvas);
      const additions = new Set(r.graph.nodes.filter(n => !n.existingId).map(n => n.id));
      for (const node of canvas.querySelectorAll('.graph-node')) if (additions.has(node.getAttribute('data-person-id') || node.getAttribute('data-context-entity-id') || '')) node.classList.add('is-proposed');
    }
    const step = r.tour.steps[this.progress.stop];
    const guidance = host.querySelector<HTMLElement>('[data-tour-guidance]')!;
    if (this.progress.stop < 0) {
      guidance.innerHTML = `<section ${target(ref('Graph overview'))}><span class="eyebrow">Organizing what we learned</span><h1>${html(r.graph.title)}</h1>${paragraphs(r.tour.introduction)}<p>${r.graph.nodes.filter(n => !n.existingId).length} new records · ${r.graph.claims.filter(c => 'entityId' in c.object).length} connections</p><button class="primary" data-guided-tour-next>Begin graph walkthrough</button><p class="muted">Explore freely. The tour will be here when you return.</p></section>`;
    } else if (step) {
      guidance.innerHTML = `<section ${target(ref(step.title, {stepId: step.id}))}><span class="eyebrow">Graph stop ${this.progress.stop + 1} of ${r.tour.steps.length}</span><h2>${html(step.title)}</h2>${paragraphs(step.explanation)}${step.issueIds.map(id => { const issue = r.graph.issues.find(x => x.id === id)!; return `<details class="tour-issue"><summary>${html(issue.question)}</summary>${paragraphs(issue.provisionalTreatment)}${issue.requestedResearch ? `<p>Further research: ${html(issue.requestedResearch)}</p>` : ''}${issue.blocksGroupIds.length ? '<p>This question blocks the affected groups from application.</p>' : ''}</details>`; }).join('')}${this.decision(r, stepGroups(r, step), ref(step.title, {stepId: step.id}))}<div class="tour-transition">${paragraphs(step.transition)}</div></section><nav class="guided-navigation"><button data-guided-tour-back>Back</button><button class="primary" data-guided-tour-next>${this.progress.stop === r.tour.steps.length - 1 ? 'Finish' : 'Continue'}</button></nav><button class="text-action" data-guided-return hidden>Return to this tour stop</button>`;
      const focusIds = step.focusNodeIds.map(mapped);
      const claimFocus = r.graph.claims.find(c => step.focusClaimIds.includes(c.id));
      const recordId = focusIds[0] || (claimFocus ? mapped(claimFocus.subjectId) : undefined);
      if (recordId) showRecord(recordId);
      window.requestAnimationFrame(() => { if (!this.disposed && generation === this.generation) this.renderer?.focusRegion(focusIds, step.focusClaimIds); });
    } else {
      const covered = new Set(r.tour.steps.flatMap(st => stepGroups(r, st).map(g => g.id)));
      const outside = r.graph.groups.filter(g => !covered.has(g.id));
      const decided = r.appliedGroupIds.length + r.rejectedGroupIds.length;
      guidance.innerHTML = `<section ${target(ref('Graph review summary'))}><span class="eyebrow">Your research graph</span><h2>${r.status === 'pending' ? `${decided} of ${r.graph.groups.length} changes decided` : 'This graph review is complete'}</h2><p>${r.appliedGroupIds.length} approved and added to your graph, ${r.rejectedGroupIds.length} declined. Approved changes keep their reported, inferred, and unresolved qualifications.</p>${r.status === 'pending' && decided < r.graph.groups.length ? '<p>Go back through the tour to decide the remaining changes.</p>' : ''}${this.decision(r, outside, ref('Changes outside the tour'))}<details><summary>Research left outside the graph</summary>${r.graph.coverage.filter(c => !c.nodeIds.length && !c.claimIds.length).map(c => paragraphs(c.omissionReason || '')).join('') || '<p>All supplied findings are represented.</p>'}</details></section><button data-guided-tour-back>Back to the tour</button>`;
    }
  }
  private exploring() { const button = this.host.querySelector<HTMLElement>('[data-guided-return]'); if (button) button.hidden = false; }
  private change = (event: Event) => {
    const input = event.target as HTMLInputElement;
    if (input.hasAttribute('data-guided-revision')) { this.progress = {walkthroughId: input.value, stage: 'reading', step: 0, stop: -1}; this.render(); }
  };
  private click = (event: Event) => {
    const b = (event.target as Element).closest<HTMLElement>('button');
    if (!b || ![...b.attributes].some(a => a.name.startsWith('data-guided-'))) return;
    event.stopPropagation();
    if (b.dataset.guidedSource) { this.options.source(b.dataset.guidedSource); return; }
    if (b.hasAttribute('data-guided-pause') || b.dataset.guidedResume) {
      const action = b.hasAttribute('data-guided-pause') ? 'graph-job-pause' : b.dataset.guidedResume === 'resume' ? 'graph-job-resume' : 'graph-resume-decision';
      void this.options.command({action, investigationId: this.investigation.id, jobId: this.job()!.id, decision: b.dataset.guidedResume}).catch(e => this.options.error(e.message)); return;
    }
    const block = b.closest<HTMLElement>('[data-tour-decision]');
    if (block && (b.hasAttribute('data-guided-decline') || b.hasAttribute('data-guided-decline-cancel'))) {
      const form = block.querySelector<HTMLElement>('.tour-decline')!;
      form.hidden = b.hasAttribute('data-guided-decline-cancel');
      block.querySelector<HTMLElement>('.tour-decision-actions')!.hidden = !form.hidden;
      if (!form.hidden) block.querySelector<HTMLTextAreaElement>('[data-decline-note]')!.focus();
      return;
    }
    if (block && (b.hasAttribute('data-guided-approve') || b.hasAttribute('data-guided-decline-confirm'))) {
      const approve = b.hasAttribute('data-guided-approve');
      const r = this.review()!, groupIds = block.dataset[approve ? 'approveIds' : 'declineIds']!.split(' ').filter(Boolean);
      const note = block.querySelector<HTMLTextAreaElement>('[data-decline-note]')?.value.trim() || '';
      const reference = JSON.parse(block.dataset.reference!) as AnnotationTarget;
      b.setAttribute('disabled', '');
      void (async () => {
        await this.options.command({action: approve ? 'graph-apply' : 'graph-set-aside', investigationId: this.investigation.id, graphReviewId: r.id, groupIds});
        if (!approve && note && this.options.decline) await this.options.decline(note, {...reference, groupId: groupIds[0]});
      })().catch(e => { const error = block.querySelector('[data-guided-error]'); if (error) error.textContent = e.message; b.removeAttribute('disabled'); });
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
