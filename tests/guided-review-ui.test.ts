// @vitest-environment jsdom
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {GuidedReview} from '../src/ui/guided-review';
import {initialState} from '../src/domain/research';
import {prepareResearch,emptyGraph,returnDraft,tourFor} from './fixtures/guided-flow';
import {transition} from '../src/domain/research';
import {flowCommand} from '../server/review-flow.mjs';
import {organize} from '../server/organization.mjs';
import {walkthroughText} from '../src/domain/walkthrough-edits';
let view: GuidedReview;
// The review's content and decision are under test here, not the SVG graph renderer.
vi.mock('../src/ui/graph-renderer',()=>({GraphRenderer:class{render(){} centerOn(){} focusRegion(){} fitAll(){} zoomBy(){} destroy(){}}}));
beforeEach(()=>{localStorage.clear(); Element.prototype.scrollIntoView=vi.fn();});
afterEach(()=>{view?.destroy();document.body.replaceChildren();});
function fixture() {
 const store:any={state:initialState(emptyGraph),command(c:any){const r=transition(this.state,c);this.state=r.state;return r.result;},update(fn:any){const next=structuredClone(this.state);fn(next);next.revision++;this.state=next;}};
 const research=prepareResearch(store);
 flowCommand(store,{action:'publish-walkthrough',...research});
 flowCommand(store,{action:'request-graph',investigationId:research.investigationId},'human');
 const host=document.createElement('div');document.body.append(host);
 const options={command:vi.fn(),source:vi.fn(),error:vi.fn()};
 view=new GuidedReview(host,store.state,store.state.investigations[0],options);
 const click=(selector:string)=>host.querySelector<HTMLButtonElement>(selector)!.click();
 return {store,host,options,click,research};
}
describe('guided reading',()=>{
 it('connects the original question to the answer and preserves position through job updates and reopening',()=>{
  const f=fixture();
  expect(f.host.textContent).toContain('Where was Example Works?');
  expect(f.host.querySelector('[data-guided-apply]')).toBeNull();
  f.click('[data-guided-next]');
  expect(f.host.querySelector('h1')?.textContent).toBe('A town, but not a street');
  const body=f.host.querySelector('[data-guided-body]');
  f.store.update((s:any)=>{s.investigations[0].reviewFlow.jobs[0].progress='Saving connected records.';});
  view.update(f.store.state,f.store.state.investigations[0]);
  expect(f.host.querySelector('[data-guided-body]')).toBe(body);
  expect(f.host.textContent).toContain('Saving connected records.');
  f.click('[data-guided-source]');expect(f.options.source).toHaveBeenCalledWith('register');
  view.destroy();view=new GuidedReview(f.host,f.store.state,f.store.state.investigations[0],f.options);
  expect(f.host.querySelector('h1')?.textContent).toBe('A town, but not a street');
 });
 it('keeps the reader on their revision until they choose the corrected explanation',()=>{
  const f=fixture();f.click('[data-guided-next]');
  const old=f.store.state.investigations[0].reviewFlow.walkthroughs[0];
  flowCommand(f.store,{action:'request-walkthrough',investigationId:f.research.investigationId},'human');
  flowCommand(f.store,{action:'publish-walkthrough',...f.research,basedOnWalkthroughId:old.id,walkthrough:{...f.research.walkthrough,title:'Corrected location',correction:'The town identification needs qualification.'},engine:'manual'});
  view.update(f.store.state,f.store.state.investigations[0]);
  expect(f.host.querySelector('h1')?.textContent).toBe('A town, but not a street');
  f.click('[data-guided-latest]');
  expect(f.host.querySelector('h1')?.textContent).toBe('Corrected location');
  expect(f.host.textContent).toContain('The town identification needs qualification.');
 });
});
describe('suggested walkthrough edits',()=>{
 it('shows each edit in place, takes Yes, No and a comment, and sends them as one review',async()=>{
  const f=fixture();
  const w=f.store.state.investigations[0].reviewFlow.walkthroughs[0];
  const text=walkthroughText(w);
  text.answer='Example Works stood in the fictional town, on a street no record names.';
  text.steps[0]!.body=`${w.steps[0]!.body} The register gives no street.`;
  flowCommand(f.store,{action:'suggest-walkthrough-edits',investigationId:f.research.investigationId,walkthrough:text});
  view.update(f.store.state,f.store.state.investigations[0]);
  const bar=()=>f.host.querySelector('.walkthrough-edits-bar')!.textContent;
  expect(bar()).toContain('2 edits suggested by the coordinator');
  const answer=()=>f.host.querySelector('[data-edit-id="answer"]')!;
  // The passage reads once, with the words the edit removes and adds marked in it.
  const words=(tag:string)=>[...answer().querySelectorAll(tag)].map(e=>e.textContent).join(' | ');
  expect(words('del')).not.toBe('');
  expect(words('ins')).toContain('on a street no record names');
  expect(f.host.querySelector<HTMLButtonElement>('[data-guided-edits-send]')!.disabled).toBe(true);
  f.click('[data-edit-id="answer"] [data-guided-edit="accept"]');
  expect(answer().classList.contains('is-accept')).toBe(true);
  expect(bar()).toContain('1 accepted, 1 to decide');
  // The next edit is on the first step's page.
  f.click('[data-guided-edits-next]');
  expect(f.host.querySelector('h1')?.textContent).toBe(w.steps[0]!.title);
  const step=`[data-edit-id="steps.${w.steps[0]!.id}.body"]`;
  // A sentence added to the step marks only that sentence.
  expect([...f.host.querySelectorAll(`${step} ins`)].map(e=>e.textContent)).toEqual(['The register gives no street.']);
  expect(f.host.querySelectorAll(`${step} del`)).toHaveLength(0);
  f.click(`${step} [data-guided-edit="comment"]`);
  f.host.querySelector<HTMLTextAreaElement>(`${step} [data-edit-comment]`)!.value='Say which register.';
  f.click(`${step} [data-guided-edit-comment-save]`);
  expect(f.host.querySelector(step)!.textContent).toContain('Your comment, sent with your review: “Say which register.”');
  expect(bar()).toContain('1 accepted, 1 with a comment');
  // Choices survive the reader being opened again, until they are sent.
  view.destroy();view=new GuidedReview(f.host,f.store.state,f.store.state.investigations[0],f.options);
  expect(bar()).toContain('1 accepted, 1 with a comment');
  f.options.command.mockImplementation(async(data:any)=>{flowCommand(f.store,data,'human');});
  f.click('[data-guided-edits-send]');
  await vi.waitFor(()=>expect(f.options.command).toHaveBeenCalled());
  expect(f.options.command.mock.calls[0]![0]).toMatchObject({action:'review-walkthrough-edits',decisions:{answer:{decision:'accept'},[`steps.${w.steps[0]!.id}.body`]:{decision:'comment',comment:'Say which register.'}}});
  // The page rebuilds the reader after a command; it goes on to the revision the review made.
  view.destroy();view=new GuidedReview(f.host,f.store.state,f.store.state.investigations[0],f.options);
  expect(f.host.querySelector('[data-guided-latest]')).toBeNull();
  // The accepted edit is the new revision; the commented one stays open on it.
  expect(f.store.state.investigations[0].reviewFlow.walkthroughs.at(-1).answer).toBe(text.answer);
  expect(bar()).toContain('1 edit suggested by the coordinator');
  expect(f.host.querySelector(step)!.textContent).toContain('You commented: “Say which register.”');
 });
});
describe('graph review',()=>{
 function graphReview(){
  const f=fixture();
  const id=f.research.investigationId;
  returnDraft(f.store,id);
  const job=f.store.state.investigations[0].reviewFlow.jobs[0];
  flowCommand(f.store,{action:'publish-graph-review',investigationId:id,jobId:job.id,tour:tourFor(),undone:[{instruction:'Name the street.',reason:'The register gives only the town.'}]});
  const decline=vi.fn(async()=>{});
  const command=async(data:any)=>{ if(data.action==='organization-undo') organize(f.store,data); else flowCommand(f.store,data,'human'); open(); };
  const open=()=>{view.destroy();view=new GuidedReview(f.host,f.store.state,f.store.state.investigations[0],{command,source:vi.fn(),error:(m:string)=>{throw new Error('guided error: '+m);},decline,start:'graph'});};
  const ready=(selector:string)=>vi.waitFor(()=>expect(f.host.querySelector(selector)).not.toBeNull());
  const review=()=>f.store.state.investigations[0].reviewFlow.graphReviews[0];
  const start=async()=>{open(); await ready('.draft-decision');};
  return {...f,decline,ready,review,start};
 }
 it('shows the draft as one change: its summary, what changed, and what was left open',async()=>{
  const f=graphReview();
  await f.start();
  expect(f.host.querySelector('.draft-summary')?.textContent).toBe('2 new nodes, 1 new edge, 1 evidence record added from the research.');
  const changes=[...f.host.querySelectorAll('.draft-changes h3')].map(h=>h.textContent);
  expect(changes).toEqual(['New nodes','New edges']);
  expect([...f.host.querySelectorAll('.draft-changes li')].map(li=>li.textContent)).toEqual(['Example Bay','Example Works','Example Works located in Example Bay']);
  expect(f.host.textContent).toContain('Which street was the works on?');
  expect(f.host.querySelector('.draft-undone')?.textContent).toContain('Name the street.');
  // Every change can be annotated against the exact record it concerns.
  const edge=JSON.parse(f.host.querySelectorAll('.draft-changes li')[2]!.getAttribute('data-research-target')!);
  expect(edge).toMatchObject({graphReviewId:f.review().id,table:'claims',recordId:'location',claimId:'location'});
  expect(f.host.querySelector('[data-guided-accept]')).not.toBeNull();
  expect(f.host.querySelector('[data-guided-approve]')).toBeNull();
 });
 it('walks through the tour without asking for any decision',async()=>{
  const f=graphReview();
  await f.start();
  f.click('[data-guided-tour-next]');
  await f.ready('.tour-transition');
  expect(f.host.querySelector('h2')?.textContent).toBe('Keep the location attributed');
  expect(f.host.textContent).toContain('Which street was the works on?');
  expect(f.host.querySelector('[data-draft-decision]')).toBeNull();
 });
 it('accepts the whole draft, then offers to undo it',async()=>{
  const f=graphReview();
  await f.start();
  f.click('[data-guided-accept]');
  await vi.waitFor(()=>expect(f.review().status).toBe('applied'));
  await f.ready('[data-guided-undo]');
  expect(f.store.state.dataset.contextEntities.map((e:any)=>e.id)).toEqual(['bay','works']);
  expect(f.store.state.investigations[0].closedAt).toBeTruthy();
  f.click('[data-guided-undo]');
  await vi.waitFor(()=>expect(f.store.state.dataset.contextEntities ?? []).toEqual([]));
  // Undoing reopens the batch for a revised draft, and the review says what happened.
  expect(f.review().status).toBe('undone');
  expect(f.store.state.investigations[0].closedAt).toBeUndefined();
  await f.ready('.draft-decision');
  expect(f.host.querySelector('.draft-decision')!.textContent).toContain('Accepted, then undone.');
  expect(f.store.state.dataset.evidence.map((e:any)=>e.quote)).toEqual(['Example Works stood in Example Bay.']);
 });
 it('sets the draft aside and passes the note on',async()=>{
  const f=graphReview();
  await f.start();
  f.click('[data-guided-set-aside]');
  f.host.querySelector<HTMLTextAreaElement>('[data-set-aside-note]')!.value='Keep the works, but without a location.';
  f.click('[data-guided-set-aside-confirm]');
  await vi.waitFor(()=>expect(f.decline).toHaveBeenCalled());
  const [note,reference]=f.decline.mock.calls[0] as any;
  expect(note).toBe('Keep the works, but without a location.');
  expect(reference).toMatchObject({graphReviewId:f.review().id});
  expect(f.review().status).toBe('set-aside');
  expect(f.store.state.datasetRevision).toBe(0);
 });
 it('holds the decision while a note is waiting, and while the draft is revised',async()=>{
  const f=graphReview();
  f.store.command({type:'annotate',investigationId:f.research.investigationId,question:'Were these one firm?',target:{label:'The works',graphReviewId:f.review().id},dispatch:true});
  await f.start();
  expect(f.host.querySelector('[data-guided-accept]')).toBeNull();
  expect(f.host.querySelector('.draft-decision')!.textContent).toContain('Your note is with the coordinator.');
  const job=f.store.state.investigations[0].reviewFlow.jobs[0];
  flowCommand(f.store,{action:'graph-update',investigationId:f.research.investigationId,jobId:job.id,message:'Revise the agent.'});
  await f.start();
  expect(f.host.querySelector('[data-guided-accept]')).toBeNull();
  expect(f.host.querySelector('.draft-decision')!.textContent).toContain('Being revised.');
  expect(f.host.querySelector('.guided-activity')!.textContent).toContain('Your draft is being revised.');
 });
 it('shows changes on the graph without redrawing it',async()=>{
  const f=graphReview();
  await f.start();
  const stage=f.host.querySelector('.guided-graph-stage')!;
  expect(stage.classList.contains('shows-changes')).toBe(true);
  const toggle=f.host.querySelector<HTMLInputElement>('[data-guided-changes]')!;
  toggle.checked=false; toggle.dispatchEvent(new Event('change',{bubbles:true}));
  expect(f.host.querySelector('.guided-graph-stage')).toBe(stage);
  expect(stage.classList.contains('shows-changes')).toBe(false);
 });
});
