import type { Investigation, ResearchState, AnnotationTarget } from '../domain/research';
import type { Walkthrough, GraphReview, GraphJob } from '../domain/review-flow';
import { html, target } from './finding-review';
import { sourceLibrary } from '../domain/findings';
import { materializeGraph } from '../domain/graph-draft';
import { GenealogyModel } from '../domain/model';
import { projectAround } from '../domain/projection';
import { layoutFamily } from '../layout/layout';
import { GraphRenderer } from './graph-renderer';
import { renderDetailsPanel, renderContextDetailsPanel } from './details-panel';

import {researchText as paragraphs, researchInline} from './research-text';

interface Progress { walkthroughId: string; stage: 'reading' | 'graph'; step: number; graphReviewId?: string; stop: number; groups?: string[] }
interface Options {
  command: (data: Record<string, unknown>) => Promise<void>;
  source: (id: string, quote?: string) => void;
  error: (message: string) => void;
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
    this.progress = saved || {walkthroughId: investigation.reviewFlow!.walkthroughs.at(-1)!.id, stage: 'reading', step: 0, stop: -1};
    if (!investigation.reviewFlow!.walkthroughs.some(w => w.id === this.progress.walkthroughId)) this.progress.walkthroughId = investigation.reviewFlow!.walkthroughs.at(-1)!.id;
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
  private walkthrough(): Walkthrough { return this.investigation.reviewFlow!.walkthroughs.find(w => w.id === this.progress.walkthroughId)!; }
  private review(): GraphReview | undefined {
    return this.investigation.reviewFlow!.graphReviews.find(r => r.id === this.progress.graphReviewId)
      || this.investigation.reviewFlow!.graphReviews.filter(r => r.walkthroughId === this.progress.walkthroughId).at(-1);
  }
  private job(): GraphJob | undefined { return this.investigation.reviewFlow!.jobs.filter(j => j.walkthroughId === this.progress.walkthroughId).at(-1); }
  private reference(label: string, stepId?: string): AnnotationTarget { return {label, walkthroughId: this.progress.walkthroughId, stepId}; }
  private renderStatus() {
    const status = this.host.querySelector('[data-guided-status]');
    if (!status) return;
    const job = this.job(), review = this.review(), latest = this.investigation.reviewFlow!.walkthroughs.at(-1)!;
    status.innerHTML = `${latest.id !== this.progress.walkthroughId ? `<div class="walkthrough-update">An updated explanation is ready. Your reading position is saved. <button data-guided-latest>Read the update</button></div>` : ''}
      <div class="guided-activity"><span>${html(review ? review.status === 'applied' ? 'This graph has been added to your research.' : 'Your proposed graph is ready.' : job?.progress || 'The research explanation is ready.')}</span>
      ${review && this.progress.stage !== 'graph' ? '<button data-guided-graph>Explore the graph</button>' : ''}
      ${job && ['running','queued'].includes(job.status) ? '<button class="text-action" data-guided-pause>Pause graph preparation</button>' : ''}
      ${job?.status === 'paused' ? job.resumeRequest?.status === 'pending' ? `<span>${html(job.resumeRequest.reason)}</span><button data-guided-resume="approve">Resume graph preparation</button><button data-guided-resume="decline">Keep paused</button>` : '<button data-guided-resume="resume">Resume graph preparation</button>' : ''}</div>`;
    const destination = this.host.querySelector('[data-guided-ending-destination]');
    if (destination) destination.innerHTML = review ? '<button class="primary" data-guided-graph>Explore the proposed graph</button>' : '<p class="muted">Graph preparation continues while you explore the research. Its progress appears above.</p>';
  }
  private render() {
    this.renderer?.destroy(); this.renderer = undefined; this.generation++;
    this.save();
    const w = this.walkthrough();
    this.host.innerHTML = `<div class="guided-review" data-investigation-id="${html(this.investigation.id)}"><div data-guided-status aria-live="polite"></div><div data-guided-body></div></div>`;
    this.renderStatus();
    if (this.progress.stage === 'graph' && this.review()) { void this.renderGraph().catch(error => this.options.error(error.message)); return; }
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
  private async renderGraph() {
    const r = this.review()!;
    this.progress.graphReviewId = r.id; this.save();
    const generation = this.generation;
    const data = materializeGraph(r.baseDataset, r.graph, r.evidence, r.sources);
    const model = new GenealogyModel(data);
    const mapped = (id: string) => r.graph.nodes.find(n => n.id === id)?.existingId || id;
    const fallbackFocus = data.initialFocusId;
    const host = this.host.querySelector<HTMLElement>('[data-guided-body]')!;
    host.innerHTML = `<section class="guided-graph-review" data-graph-review-id="${html(r.id)}"><header class="graph-review-heading"><button data-guided-reading>Back to the research</button><span>${r.status === 'applied' ? 'Applied graph' : 'Proposed graph'} · Revision ${r.revision}</span><button data-guided-tour-home>Tour overview</button></header><div class="guided-graph-layout"><div class="guided-graph-stage"><div class="guided-graph-controls"><button data-guided-fit>Fit all</button><button data-guided-zoom="1.3" aria-label="Zoom in">+</button><button data-guided-zoom="0.77" aria-label="Zoom out">−</button><span>Outlined records are proposed additions.</span></div><div class="guided-graph-canvas"></div></div><aside class="guided-graph-sidebar"><div data-tour-guidance></div><div data-tour-record></div></aside></div></section>`;
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
      guidance.innerHTML = `<section ${target(ref(step.title, {stepId: step.id}))}><span class="eyebrow">Graph stop ${this.progress.stop + 1} of ${r.tour.steps.length}</span><h2>${html(step.title)}</h2>${paragraphs(step.explanation)}${step.issueIds.map(id => { const issue = r.graph.issues.find(x => x.id === id)!; return `<details class="tour-issue"><summary>${html(issue.question)}</summary>${paragraphs(issue.provisionalTreatment)}${issue.requestedResearch ? `<p>Further research: ${html(issue.requestedResearch)}</p>` : ''}${issue.blocksGroupIds.length ? '<p>This question blocks the affected groups from application.</p>' : ''}</details>`; }).join('')}<div class="tour-transition">${paragraphs(step.transition)}</div></section><nav class="guided-navigation"><button data-guided-tour-back>Back</button><button class="primary" data-guided-tour-next>${this.progress.stop === r.tour.steps.length - 1 ? 'Review additions' : 'Continue'}</button></nav><button class="text-action" data-guided-return hidden>Return to this tour stop</button>`;
      const focusIds = step.focusNodeIds.map(mapped);
      const claimFocus = r.graph.claims.find(c => step.focusClaimIds.includes(c.id));
      const recordId = focusIds[0] || (claimFocus ? mapped(claimFocus.subjectId) : undefined);
      if (recordId) showRecord(recordId);
      window.requestAnimationFrame(() => { if (!this.disposed && generation === this.generation) this.renderer?.focusRegion(focusIds, step.focusClaimIds); });
    } else {
      const pending = r.graph.groups.filter(g => !r.appliedGroupIds.includes(g.id) && !r.rejectedGroupIds.includes(g.id));
      if (!this.progress.groups) this.progress.groups = pending.filter(g => !r.graph.issues.some(i => i.blocksGroupIds.includes(g.id))).map(g => g.id);
      guidance.innerHTML = `<section ${target(ref('Graph application'))}><span class="eyebrow">Your research graph</span><h2>${r.status === 'applied' ? 'Added to your graph' : 'Ready to bring these connections into your graph'}</h2><p>Applying adds these records, relationships, and their evidence. Reported, inferred, and unresolved statements retain those qualifications.</p>${r.graph.groups.map(g => {
        const applied = r.appliedGroupIds.includes(g.id), rejected = r.rejectedGroupIds.includes(g.id), blocked = r.graph.issues.some(i => i.blocksGroupIds.includes(g.id));
        return `<div class="guided-apply-group" ${target(ref(g.title, {groupId: g.id}))}><label><input type="checkbox" data-guided-group="${html(g.id)}" ${this.progress.groups!.includes(g.id) && !applied && !rejected ? 'checked' : ''} ${applied || rejected || blocked ? 'disabled' : ''}>${html(g.title)}</label>${applied || rejected || blocked ? `<span>${applied ? 'Applied' : rejected ? 'Set aside' : 'Waiting on a question'}</span>` : ''}${g.dependsOn.length ? `<p>Requires ${g.dependsOn.map(id => html(r.graph.groups.find(g => g.id === id)?.title)).join(', ')}.</p>` : ''}</div>`;
      }).join('')}${pending.length && r.status === 'pending' ? '<button class="primary" data-guided-apply>Apply selected groups</button><button class="text-action" data-guided-set-aside>Set selected groups aside</button>' : ''}<p data-guided-error role="alert"></p><details><summary>Research left outside the graph</summary>${r.graph.coverage.filter(c => !c.nodeIds.length && !c.claimIds.length).map(c => paragraphs(c.omissionReason || '')).join('') || '<p>All supplied findings are represented.</p>'}</details></section><button data-guided-tour-back>Back to the tour</button>`;
    }
  }
  private exploring() { const button = this.host.querySelector<HTMLElement>('[data-guided-return]'); if (button) button.hidden = false; }
  private change = (event: Event) => {
    const input = event.target as HTMLInputElement;
    if (input.hasAttribute('data-guided-revision')) { this.progress = {walkthroughId: input.value, stage: 'reading', step: 0, stop: -1}; this.render(); }
    if (input.dataset.guidedGroup) { const ids = new Set(this.progress.groups); if (input.checked) ids.add(input.dataset.guidedGroup); else ids.delete(input.dataset.guidedGroup); this.progress.groups = [...ids]; this.save(); }
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
    if (b.hasAttribute('data-guided-apply') || b.hasAttribute('data-guided-set-aside')) {
      const r = this.review()!;
      b.setAttribute('disabled','');
      void this.options.command({action: b.hasAttribute('data-guided-apply') ? 'graph-apply' : 'graph-set-aside', investigationId: this.investigation.id, graphReviewId: r.id, groupIds: (this.progress.groups || []).filter(id => !r.appliedGroupIds.includes(id) && !r.rejectedGroupIds.includes(id))}).catch(e => { const error = this.host.querySelector('[data-guided-error]'); if (error) error.textContent = e.message; b.removeAttribute('disabled'); }); return;
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
