// @vitest-environment jsdom
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {GuidedReview} from '../src/ui/guided-review';
import {initialState} from '../src/domain/research';
import {prepareResearch,emptyGraph,graphFor,tourFor} from './fixtures/guided-flow';
import {transition} from '../src/domain/research';
import {flowCommand,receiveGraph} from '../server/review-flow.mjs';
let view: GuidedReview;
// The tour's decisions are under test here, not the SVG graph renderer.
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
  flowCommand(f.store,{action:'publish-walkthrough',...f.research,basedOnWalkthroughId:old.id,walkthrough:{...f.research.walkthrough,title:'Corrected location',correction:'The town identification needs qualification.'},engine:'manual'});
  view.update(f.store.state,f.store.state.investigations[0]);
  expect(f.host.querySelector('h1')?.textContent).toBe('A town, but not a street');
  f.click('[data-guided-latest]');
  expect(f.host.querySelector('h1')?.textContent).toBe('Corrected location');
  expect(f.host.textContent).toContain('The town identification needs qualification.');
 });
});
describe('graph review',()=>{
 function graphReview(){
  const f=fixture();
  const id=f.research.investigationId;
  f.store.update((s:any)=>{s.investigations[0].reviewFlow.jobs[0].status='running';});
  const job=f.store.state.investigations[0].reviewFlow.jobs[0];
  const graph=graphFor(job.packet);
  receiveGraph(f.store,id,job.id,graph,job.packet,'fictional');
  flowCommand(f.store,{action:'publish-graph-review',investigationId:id,jobId:job.id,tour:tourFor(graph)});
  const decline=vi.fn(async()=>{});
  const open=()=>{view.destroy();view=new GuidedReview(f.host,f.store.state,f.store.state.investigations[0],{command:async(data:any)=>{flowCommand(f.store,data,'human');open();},source:vi.fn(),error:(m:string)=>{throw new Error('guided error: '+m);},decline,start:'graph'});};
  const ready=(selector:string)=>vi.waitFor(()=>expect(f.host.querySelector(selector)).not.toBeNull());
  const items=()=>[...f.host.querySelectorAll('.tour-decision li')].map(li=>li.textContent);
  const review=()=>f.store.state.investigations[0].reviewFlow.graphReviews[0];
  const start=async()=>{open(); await ready('[data-guided-tour-next]'); f.click('[data-guided-tour-next]'); await ready('.tour-decision');};
  return {...f,decline,ready,items,review,start};
 }
 it('approves a change together with the changes in its step that need it',async()=>{
  const f=graphReview();
  await f.start();
  expect(f.items()).toEqual(['The townWaiting for your decision','The works and reported locationNeeds The town first']);
  expect(f.host.querySelector('[data-guided-approve]')!.textContent).toBe('Approve these changes');
  f.click('[data-guided-approve]');
  await vi.waitFor(()=>expect(f.review().appliedGroupIds).toEqual(['place','factory']));
  await f.ready('.tour-decision');
  expect(f.items()).toEqual(['The townApproved','The works and reported locationApproved']);
  expect(f.store.state.investigations[0].closedAt).toBeTruthy();
 });
 it('declines a step with its dependents and passes the note on',async()=>{
  const f=graphReview();
  await f.start();
  f.click('[data-guided-decline]');
  f.host.querySelector<HTMLTextAreaElement>('[data-decline-note]')!.value='Keep the works, but without a location.';
  f.click('[data-guided-decline-confirm]');
  await vi.waitFor(()=>expect(f.decline).toHaveBeenCalled());
  const [note,reference]=f.decline.mock.calls[0] as any;
  expect(note).toBe('Keep the works, but without a location.');
  expect(reference).toMatchObject({graphReviewId:f.review().id,groupId:'place',stepId:'site'});
  expect(f.review().rejectedGroupIds).toEqual(['place','factory']);
  expect(f.store.state.investigations[0].closedAt).toBeTruthy();
  expect(f.host.querySelector('[data-guided-apply]')).toBeNull();
 });
});
