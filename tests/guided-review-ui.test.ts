// @vitest-environment jsdom
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {GuidedReview} from '../src/ui/guided-review';
import {initialState} from '../src/domain/research';
import {prepareResearch,emptyGraph} from './fixtures/guided-flow';
import {transition} from '../src/domain/research';
import {flowCommand} from '../server/review-flow.mjs';
let view: GuidedReview;
beforeEach(()=>{localStorage.clear(); Element.prototype.scrollIntoView=vi.fn();});
afterEach(()=>{view?.destroy();document.body.replaceChildren();});
function fixture() {
 const store:any={state:initialState(emptyGraph),command(c:any){const r=transition(this.state,c);this.state=r.state;return r.result;},update(fn:any){const next=structuredClone(this.state);fn(next);next.revision++;this.state=next;}};
 const research=prepareResearch(store);
 flowCommand(store,{action:'publish-walkthrough',...research,engine:'manual'});
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
