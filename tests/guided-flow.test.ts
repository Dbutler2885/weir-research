// @vitest-environment node
import {describe, it, expect, afterEach} from 'vitest';
import {mkdtempSync, rmSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {WorkspaceStore} from '../server/store.mjs';
import {flowCommand, receiveGraph} from '../server/review-flow.mjs';
import {GraphBuilderPool} from '../server/graph-builders.mjs';
import {emptyGraph, prepareResearch, graphFor, tourFor, writeGraphCsv} from './fixtures/guided-flow';
const cleanup: (()=>void)[] = [];
afterEach(()=>cleanup.splice(0).reverse().forEach(fn=>fn()));
function fixture(engine = 'manual') {
  const directory = mkdtempSync(join(tmpdir(),'fictional-guided-'));
  cleanup.push(()=>rmSync(directory,{recursive:true,force:true}));
  const store = new WorkspaceStore(directory, emptyGraph);
  const research = prepareResearch(store);
  const opened: any = flowCommand(store, {action:'publish-walkthrough',...research,engine});
  const command = (action: string, data: any = {}, actor = 'coordinator') => flowCommand(store,{action,investigationId:research.investigationId,jobId:opened.jobId,...data},actor);
  const job = () => store.state.investigations[0].reviewFlow.jobs[0];
  return {directory,store,...research,...opened,command,job};
}
function publish(f: ReturnType<typeof fixture>) {
  f.store.update((next: any)=>{next.investigations[0].reviewFlow.jobs[0].status='running';});
  const graph = graphFor(f.job().packet);
  receiveGraph(f.store,f.investigationId,f.jobId,graph,f.job().packet,'fictional');
  return {...f.command('publish-graph-review',{tour:tourFor(graph)}) as any, graph};
}
describe('guided research flow',()=>{
  it('starts graph preparation without accepting findings and applies coherent groups separately',()=>{
    const f=fixture();
    expect(f.job().status).toBe('queued');
    expect(f.store.state.investigations[0].proposals[0].findings[0].status).toBe('pending');
    const {graphReviewId}=publish(f);
    expect(f.store.state.dataset.contextEntities).toBeUndefined();
    expect(()=>f.command('graph-apply',{graphReviewId,groupIds:['factory']},'human')).toThrow('required groups');
    f.command('graph-apply',{graphReviewId,groupIds:['place']},'human');
    f.command('graph-apply',{graphReviewId,groupIds:['factory']},'human');
    expect(f.store.state.dataset.contextEntities).toHaveLength(2);
    expect(f.store.state.dataset.claims[0].qualification).toBe('reported');
    expect(f.store.state.dataset.evidence[0].quote).toBe('Example Works stood in Example Bay.');
    expect(()=>f.command('graph-apply',{graphReviewId,groupIds:['factory']},'human')).toThrow();
    expect(new WorkspaceStore(f.directory,emptyGraph).state.investigations[0].reviewFlow.graphReviews[0].appliedGroupIds).toEqual(['place','factory']);
  });
  it('fences stale graphs and ties new feedback to exact graph revisions',()=>{
    const f=fixture(); const {graphReviewId}=publish(f);
    f.store.command({type:'annotate',investigationId:f.investigationId,question:'Reconsider the works',target:{label:'The works',graphReviewId,groupId:'factory'},dispatch:true});
    expect(()=>f.command('graph-apply',{graphReviewId,groupIds:['place','factory']},'human')).toThrow('New feedback');
    f.command('graph-apply',{graphReviewId,groupIds:['place']},'human');
    f.store.update((next: any)=>{next.datasetRevision++;});
    expect(()=>f.command('graph-apply',{graphReviewId,groupIds:['factory']},'human')).toThrow('accepted graph changed');
  });
  it('keeps paused work paused until a human resumes it and protects role boundaries',()=>{
    const f=fixture();
    f.command('graph-job-pause',{},'human');
    expect(()=>f.command('graph-job-resume')).toThrow('other review role');
    f.command('request-graph-resume',{reason:'Continue from the saved CSV files.'});
    expect(f.job().status).toBe('paused');
    f.command('graph-resume-decision',{decision:'decline'},'human');
    expect(f.job().status).toBe('paused');
    f.command('graph-job-resume',{},'human');
    expect(f.job().status).toBe('queued');
    expect(()=>f.command('publish-walkthrough',{walkthrough:f.walkthrough},'human')).toThrow('other review role');
  });
  it('preserves old walkthroughs and requeues completed drafts when later updates arrive',()=>{
    const f=fixture();
    const packet=structuredClone(f.job().packet), graph=graphFor(packet);
    f.store.update((next: any)=>{next.investigations[0].reviewFlow.jobs[0].status='running';});
    f.command('graph-update',{message:'The precise street remains unknown.'});
    receiveGraph(f.store,f.investigationId,f.jobId,graph,packet,'old-submission');
    expect(f.job().status).toBe('queued');
    expect(f.job().submissions).toHaveLength(1);
    expect(()=>f.command('publish-graph-review',{tour:tourFor(graph)})).toThrow('completed');
    f.command('publish-walkthrough',{walkthrough:{...f.walkthrough,correction:'The answer has been qualified.'},basedOnWalkthroughId:f.walkthroughId});
    expect(f.store.state.investigations[0].reviewFlow.walkthroughs).toHaveLength(2);
    expect(f.job().status).toBe('superseded');
    expect(f.store.publicState().investigations[0].reviewFlow.jobs[0].packet).toBeUndefined();
  });
  it('runs a file-writing builder, preserves streams, freezes CSVs and exposes a coordinator candidate',()=>{
    const f=fixture('claude');
    const child=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),exitCode:null,kill(){this.exitCode=1 as any;}});
    const pool=new GraphBuilderPool(f.store,f.directory,resolve('.'),{launch:()=>child as any,findExecutable:()=>'/fake/claude'});
    cleanup.push(()=>pool.stop());
    pool.pump();
    const task=pool.active.get(f.jobId)!;
    writeGraphCsv(task.work,graphFor(task.packet));
    writeFileSync(join(task.work,'checkpoint.md'),'The connected location is saved.');
    child.stdout.write('intermediate output\n');
    child.emit('close',0);
    expect(f.job().status).toBe('returned');
    expect(readFileSync(join(task.attempt,'stream.ndjson'),'utf8')).toContain('intermediate output');
    expect(readFileSync(join(task.directory,'submission-1','claims.csv'),'utf8')).toContain('located_in');
    writeFileSync(join(task.work,'claims.csv'),'changed working file');
    expect(f.job().candidate.graph.claims).toHaveLength(1);
    expect(f.store.state.datasetRevision).toBe(0);
  });
  it('retains incomplete worker files on failure and pauses interrupted workers on restart',()=>{
    const f=fixture();
    const pool=new GraphBuilderPool(f.store,f.directory,resolve('.'));
    cleanup.push(()=>pool.stop());
    const task=pool.prepare(f.jobId);
    writeFileSync(join(task.work,'checkpoint.md'),'Saved research representation.');
    const replacement=new GraphBuilderPool(f.store,f.directory,resolve('.'));
    cleanup.push(()=>replacement.stop());
    expect(f.job().status).toBe('paused');
    expect(readFileSync(join(task.work,'checkpoint.md'),'utf8')).toContain('Saved');
    expect(f.store.state.datasetRevision).toBe(0);
  });
});
