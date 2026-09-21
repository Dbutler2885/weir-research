// @vitest-environment node
import {describe, it, expect, afterEach} from 'vitest';
import {mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {WorkspaceStore} from '../server/store.mjs';
import {flowCommand} from '../server/review-flow.mjs';
import {organize} from '../server/organization.mjs';
import {GraphBuilderPool} from '../server/graph-builders.mjs';
import {emptyGraph, prepareResearch, draftFiles, writeDraft, returnDraft, tourFor} from './fixtures/guided-flow';
import type {FamilyDataset} from '../src/domain/types';

const cleanup: (()=>void)[] = [];
afterEach(()=>cleanup.splice(0).reverse().forEach(fn=>fn()));
function fixture(engine = 'manual', graph: FamilyDataset = emptyGraph) {
  const directory = mkdtempSync(join(tmpdir(),'fictional-guided-'));
  cleanup.push(()=>rmSync(directory,{recursive:true,force:true}));
  const store = new WorkspaceStore(directory, graph);
  const research = prepareResearch(store);
  const published: any = flowCommand(store, {action:'publish-walkthrough',...research});
  store.update((next: any)=>{next.engine=engine;});
  const opened: any = {...published, ...flowCommand(store, {action:'request-graph',investigationId:research.investigationId}, 'human')};
  const command = (action: string, data: any = {}, actor = 'coordinator') => flowCommand(store,{action,investigationId:research.investigationId,jobId:opened.jobId,...data},actor);
  const job = () => store.state.investigations[0].reviewFlow.jobs[0];
  const review = () => store.state.investigations[0].reviewFlow.graphReviews.at(-1);
  return {directory,store,...research,...opened,command,job,review};
}
function publish(f: ReturnType<typeof fixture>, extra: any = {}) {
  returnDraft(f.store, f.investigationId);
  return f.command('publish-graph-review',{tour:tourFor(),...extra}) as any;
}
function builder(f: ReturnType<typeof fixture>) {
  const child=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),exitCode:null,kill(){this.exitCode=1 as any;}});
  const pool=new GraphBuilderPool(f.store,f.directory,resolve('.'),{launch:()=>child as any,findExecutable:()=>'/fake/claude'});
  cleanup.push(()=>pool.stop());
  pool.pump();
  return {child, pool, task: pool.active.get(f.jobId)!};
}

describe('guided research flow',()=>{
  it('accepts a whole draft: the graph is replaced, research is copied in, and an undo is kept',()=>{
    const f=fixture();
    expect(f.job().status).toBe('queued');
    expect(f.store.state.investigations[0].proposals[0].findings[0].status).toBe('pending');
    const {graphReviewId}=publish(f);
    expect(f.review().summary).toBe('2 new nodes, 1 new edge, 1 evidence record added from the research.');
    expect(f.store.state.dataset.contextEntities).toBeUndefined();
    const accepted: any=f.command('graph-accept',{graphReviewId},'human');
    expect(f.store.state.datasetRevision).toBe(1);
    expect(f.store.state.dataset.contextEntities.map((e: any)=>e.id)).toEqual(['bay','works']);
    expect(f.store.state.dataset.claims[0].qualification).toBe('reported');
    expect(f.store.state.dataset.evidence[0].quote).toBe('Example Works stood in Example Bay.');
    expect(f.store.state.dataset.sources.map((s: any)=>s.id)).toEqual(['register']);
    expect(f.review().status).toBe('applied');
    expect(f.store.state.investigations[0].closedAt).toBeTruthy();
    expect(()=>f.command('graph-accept',{graphReviewId},'human')).toThrow('no longer pending');
    expect(new WorkspaceStore(f.directory,emptyGraph).state.dataset.claims).toHaveLength(1);
    organize(f.store,{action:'organization-undo',undoId:accepted.undoId});
    expect(f.store.state.dataset.claims ?? []).toEqual([]);
    expect(f.store.state.datasetRevision).toBe(2);
  });
  it('refuses more graph work once a batch\'s draft is decided',()=>{
    const f=fixture(); const {graphReviewId}=publish(f);
    f.command('graph-accept',{graphReviewId},'human');
    expect(()=>f.command('request-graph',{},'human')).toThrow('Open a new batch');
    // Converted projects can hold a finished review on a batch left open.
    f.store.update((next: any)=>{delete next.investigations[0].closedAt;});
    expect(()=>f.command('request-graph',{},'human')).toThrow('Open a new batch');
  });
  it('will not resume a builder for a batch whose draft is decided',()=>{
    const f=fixture();
    const {graphReviewId}=publish(f);
    f.store.update((next: any)=>{next.investigations[0].reviewFlow.jobs.push({id:'stranded',status:'paused',engine:'claude',progress:'Stopped.',updates:[],attempt:1,createdAt:new Date().toISOString(),consumedUpdateSequence:0,resumeRequest:{reason:'Continue the saved graph.',status:'pending'}});});
    f.command('graph-accept',{graphReviewId},'human');
    expect(()=>f.command('graph-resume-decision',{jobId:'stranded',decision:'approve'},'human')).toThrow('Open a new batch');
    expect(()=>f.command('graph-job-resume',{jobId:'stranded'},'human')).toThrow('Open a new batch');
  });
  it('sets a whole draft aside without touching the graph',()=>{
    const f=fixture(); const {graphReviewId}=publish(f);
    f.command('graph-set-aside',{graphReviewId},'human');
    expect(f.review().status).toBe('set-aside');
    expect(f.store.state.datasetRevision).toBe(0);
    expect(f.store.state.investigations[0].closedAt).toBeTruthy();
  });
  it('leaves only the latest draft open',()=>{
    const f=fixture(); const first=publish(f);
    const second=publish(f);
    const reviews=f.store.state.investigations[0].reviewFlow.graphReviews;
    expect(reviews.map((r: any)=>[r.id,r.status])).toEqual([[first.graphReviewId,'superseded'],[second.graphReviewId,'pending']]);
    expect(()=>f.command('graph-accept',{graphReviewId:first.graphReviewId},'human')).toThrow('no longer pending');
  });
  it('refuses a draft that is stale, or that newer feedback has not reached',()=>{
    const f=fixture(); const {graphReviewId}=publish(f);
    f.store.command({type:'annotate',investigationId:f.investigationId,question:'Reconsider the works',target:{label:'The works',graphReviewId,claimId:'location'},dispatch:true});
    expect(()=>f.command('graph-accept',{graphReviewId},'human')).toThrow('newer feedback');
    const fresh=fixture(); const later=publish(fresh);
    fresh.store.update((next: any)=>{next.datasetRevision++;});
    expect(()=>fresh.command('graph-accept',{graphReviewId:later.graphReviewId},'human')).toThrow('accepted graph changed');
  });
  it('signs a draft off only against the current graph, with a tour that names real records',()=>{
    const f=fixture();
    returnDraft(f.store,f.investigationId);
    expect(()=>f.command('publish-graph-review',{tour:{...tourFor(),steps:[{...tourFor().steps[0],focusNodeIds:['nowhere']}]}})).toThrow('neither in the draft nor the graph: nowhere');
    expect(()=>f.command('publish-graph-review',{tour:tourFor(),undone:[{instruction:'Fold the firm into its site.'}]})).toThrow('undone');
    const undone=[{instruction:'Fold the firm into its site.',reason:'No evidence the firm ran only one site.'}];
    f.command('publish-graph-review',{tour:tourFor(),undone});
    expect(f.review().undone).toEqual(undone);
    expect(f.review().questions[0].question).toBe('Which street was the works on?');
    const stale=fixture();
    returnDraft(stale.store,stale.investigationId);
    stale.store.update((next: any)=>{next.datasetRevision++;});
    expect(()=>stale.command('publish-graph-review',{tour:tourFor()})).toThrow('accepted graph changed');
  });
  it('sends a draft under review back for a revision, and holds the decision until the new draft arrives',()=>{
    const f=fixture(); const {graphReviewId}=publish(f);
    f.store.command({type:'annotate',investigationId:f.investigationId,question:'Were these one firm?',target:{label:'The works',graphReviewId,claimId:'location'},dispatch:true});
    const note={annotationId:f.store.state.investigations[0].annotations.at(-1).id};
    expect(()=>f.command('graph-accept',{graphReviewId},'human')).toThrow('newer feedback');
    f.command('graph-update',{message:'Settle the agent from the 1880 list.',annotationIds:[note.annotationId]});
    expect(f.job().status).toBe('queued');
    expect(f.job().progress).toBe('Revising the graph draft.');
    expect(f.review().revisingSince).toBeTruthy();
    expect(()=>f.command('graph-accept',{graphReviewId},'human')).toThrow('being revised');
    const revised=publish(f);
    expect(f.store.state.investigations[0].reviewFlow.graphReviews.map((r: any)=>r.status)).toEqual(['superseded','pending']);
    f.command('graph-accept',{graphReviewId:revised.graphReviewId},'human');
    expect(f.review().status).toBe('applied');
  });
  it('lets the coordinator answer a note on a draft without a rebuild',()=>{
    const f=fixture(); const {graphReviewId}=publish(f);
    f.store.command({type:'annotate',investigationId:f.investigationId,question:'Are these the same node?',target:{label:'The works',graphReviewId},dispatch:true});
    const note={annotationId:f.store.state.investigations[0].annotations.at(-1).id};
    expect(()=>f.command('graph-accept',{graphReviewId},'human')).toThrow('newer feedback');
    f.command('answer-draft-feedback',{graphReviewId,annotationIds:[note.annotationId]});
    f.command('graph-accept',{graphReviewId},'human');
    expect(f.review().status).toBe('applied');
  });
  it('publishes walkthroughs without starting graph work, and runs one graph update at a time',()=>{
    const directory = mkdtempSync(join(tmpdir(),'fictional-guided-'));
    cleanup.push(()=>rmSync(directory,{recursive:true,force:true}));
    const store = new WorkspaceStore(directory, emptyGraph);
    const research = prepareResearch(store);
    flowCommand(store,{action:'request-walkthrough',investigationId:research.investigationId},'human');
    expect(store.state.investigations[0].walkthroughRequestedAt).toBeTruthy();
    flowCommand(store,{action:'publish-walkthrough',...research});
    expect(store.state.investigations[0].walkthroughRequestedAt).toBeUndefined();
    expect(store.state.investigations[0].reviewFlow.jobs).toHaveLength(0);
    const {jobId}: any = flowCommand(store,{action:'request-graph',investigationId:research.investigationId},'human');
    expect(store.state.investigations[0].reviewFlow.jobs[0].packet.walkthrough.title).toBe('Locating Example Works');
    expect(()=>flowCommand(store,{action:'request-graph',investigationId:research.investigationId},'human')).toThrow('still in preparation');
    expect(()=>flowCommand(store,{action:'request-graph',investigationId:research.investigationId})).toThrow('other review role');
    expect(jobId).toBeTruthy();
  });
  it('builds a graph from a batch without a walkthrough and closes the batch when its draft is decided',()=>{
    const directory = mkdtempSync(join(tmpdir(),'fictional-guided-'));
    cleanup.push(()=>rmSync(directory,{recursive:true,force:true}));
    const store = new WorkspaceStore(directory, emptyGraph);
    const research = prepareResearch(store);
    const {jobId}: any = flowCommand(store,{action:'request-graph',investigationId:research.investigationId},'human');
    const job = () => store.state.investigations[0].reviewFlow.jobs[0];
    expect(job().packet.walkthrough).toBeNull();
    expect(Object.keys(job().packet.findings)).toEqual([`${research.proposalId}/location`]);
    returnDraft(store,research.investigationId);
    const {graphReviewId}: any = flowCommand(store,{action:'publish-graph-review',investigationId:research.investigationId,jobId,tour:tourFor()});
    expect(()=>flowCommand(store,{action:'request-graph',investigationId:research.investigationId},'human')).toThrow('Finish the graph review');
    flowCommand(store,{action:'graph-set-aside',investigationId:research.investigationId,graphReviewId},'human');
    expect(store.state.investigations[0].closedAt).toBeTruthy();
    expect(()=>flowCommand(store,{action:'request-graph',investigationId:research.investigationId},'human')).toThrow('Open a new batch');
  });
  it('keeps paused work paused until a human resumes it and protects role boundaries',()=>{
    const f=fixture();
    f.command('graph-job-pause',{},'human');
    expect(()=>f.command('graph-job-resume')).toThrow('other review role');
    f.command('request-graph-resume',{reason:'Continue from the saved tables.'});
    expect(f.job().status).toBe('paused');
    f.command('graph-resume-decision',{decision:'decline'},'human');
    expect(f.job().status).toBe('paused');
    f.command('graph-job-resume',{},'human');
    expect(f.job().status).toBe('queued');
    expect(()=>f.command('publish-walkthrough',{walkthrough:f.walkthrough},'human')).toThrow('other review role');
    expect(()=>f.command('graph-accept',{graphReviewId:'x'})).toThrow('other review role');
  });
  it('requeues a draft written before the latest coordinator update, and preserves old walkthroughs',()=>{
    const f=fixture();
    const before=draftFiles(f.job());
    f.command('graph-update',{message:'The precise street remains unknown.'});
    returnDraft(f.store,f.investigationId,before);
    expect(f.job().status).toBe('queued');
    expect(f.job().submissions).toHaveLength(1);
    expect(()=>f.command('publish-graph-review',{tour:tourFor()})).toThrow('completed');
    f.command('publish-walkthrough',{walkthrough:{...f.walkthrough,correction:'The answer has been qualified.'},basedOnWalkthroughId:f.walkthroughId});
    expect(f.store.state.investigations[0].reviewFlow.walkthroughs).toHaveLength(2);
    // Walkthroughs and graph updates are independent; a revision does not discard graph work.
    expect(f.job().status).toBe('queued');
    expect(f.store.publicState().investigations[0].reviewFlow.jobs[0].packet).toBeUndefined();
  });
  it('hands a builder the graph as tables, and reads its edits back as a candidate draft',()=>{
    const f=fixture('claude');
    const {child,task}=builder(f);
    expect(readFileSync(join(task.work,'nodes.csv'),'utf8')).toBe('id,kind,name,descriptor,biography,dates,born,died,alternateNames,notes,sources\n');
    expect(readFileSync(join(task.work,'start','edges.csv'),'utf8')).toContain('id,from,name,targetType');
    expect(readFileSync(join(task.work,'AGENTS.md'),'utf8')).toContain('edit them in place');
    writeDraft(task.work,draftFiles(f.job()));
    writeFileSync(join(task.work,'checkpoint.md'),'The connected location is saved.');
    child.stdout.write('intermediate output\n');
    child.emit('close',0);
    expect(f.job().status).toBe('returned');
    expect(f.job().progress).toBe('Draft ready. The coordinator is checking it against your instructions.');
    expect(readFileSync(join(task.attempt,'stream.ndjson'),'utf8')).toContain('intermediate output');
    expect(readFileSync(join(task.directory,'submission-1','edges.csv'),'utf8')).toContain('located_in');
    expect(readFileSync(join(task.directory,'submission-1','checkpoint.md'),'utf8')).toContain('saved');
    writeFileSync(join(task.work,'edges.csv'),'changed working file');
    expect(f.job().candidate.draft.claims).toHaveLength(1);
    expect(f.job().candidate.summary).toBe('2 new nodes, 1 new edge, 1 evidence record added from the research.');
    expect(f.store.state.datasetRevision).toBe(0);
  });
  it('lets a builder merge three nodes into one, and accepting leaves one node',()=>{
    const works=(id: string,name: string)=>({id,name,kind:'facility' as const});
    const edge=(id: string,from: string,name: string,object: any)=>({id,subjectId:from,predicate:name,object,qualification:'supported' as const,time:null,reasoning:'From the invented register.',evidence:[]});
    const graph: FamilyDataset={...emptyGraph,initialFocusId:'works-old',contextEntities:[{id:'bay',name:'Example Bay',kind:'place'},works('works-north','North Works'),works('works-old','The Old Works'),works('works-mill','Bay Mill')],claims:[
      edge('c1','works-north','located_in',{entityId:'bay'}),edge('c2','works-old','located_in',{entityId:'bay'}),edge('c3','works-old','built',{value:1880}),
      edge('c4','works-mill','built',{value:1902}),edge('c5','works-old','same_site_as',{entityId:'works-north'}),edge('c6','works-mill','adjoins',{entityId:'works-old'}),
    ]};
    const f=fixture('claude',graph);
    const {child,task}=builder(f);
    const nodes=readFileSync(join(task.work,'nodes.csv'),'utf8').split('\n').filter(l=>!l.startsWith('works-old,')&&!l.startsWith('works-mill,')).join('\n');
    const edges=readFileSync(join(task.work,'edges.csv'),'utf8').split('\n')
      .filter(l=>!l.startsWith('c5,')&&!l.startsWith('c6,'))
      .map(l=>l.replace(/^(c[234]),works-(old|mill),/,'$1,works-north,')).join('\n');
    writeDraft(task.work,{'nodes.csv':nodes,'edges.csv':edges,'submission.txt':'done 0\n'});
    child.emit('close',0);
    expect(f.job().candidate.summary).toBe('3 nodes merged into one, 3 edges moved, 2 edges removed.');
    const {graphReviewId}: any=f.command('publish-graph-review',{tour:{introduction:'Three works were one building.',steps:[{id:'merge',title:'One building',focusNodeIds:['works-north','works-old','works-mill'],focusClaimIds:['c5'],explanation:'The Old Works and Bay Mill stood on the North Works site.',issueIds:[],transition:'That is all.'}]}});
    f.command('graph-accept',{graphReviewId},'human');
    expect(f.store.state.dataset.contextEntities.map((e: any)=>e.id)).toEqual(['bay','works-north']);
    expect(f.store.state.dataset.claims.map((c: any)=>[c.id,c.subjectId])).toEqual([['c1','works-north'],['c2','works-north'],['c3','works-north'],['c4','works-north']]);
    // The focus followed the building into the node it merged into.
    expect(f.store.state.dataset.initialFocusId).toBe('works-north');
  });
  it('keeps files from the old proposal format aside rather than reading them as a draft',()=>{
    const f=fixture();
    f.store.update((next: any)=>{delete next.investigations[0].reviewFlow.jobs[0].format;});
    const work=join(f.directory,'graph-builders',f.jobId,'work');
    mkdirSync(work,{recursive:true});
    writeFileSync(join(work,'nodes.csv'),'id,kind,label,existingId\n');
    const pool=new GraphBuilderPool(f.store,f.directory,resolve('.'));
    cleanup.push(()=>pool.stop());
    pool.prepare(f.jobId);
    expect(readFileSync(join(f.directory,'graph-builders',f.jobId,'proposal-format','nodes.csv'),'utf8')).toContain('existingId');
    expect(readFileSync(join(work,'nodes.csv'),'utf8')).toContain('id,kind,name,descriptor');
  });
  it('retains incomplete worker files and picks interrupted workers back up on restart',()=>{
    const f=fixture();
    const pool=new GraphBuilderPool(f.store,f.directory,resolve('.'));
    cleanup.push(()=>pool.stop());
    const task=pool.prepare(f.jobId);
    writeFileSync(join(task.work,'checkpoint.md'),'Saved research representation.');
    writeFileSync(join(task.work,'nodes.csv'),readFileSync(join(task.work,'nodes.csv'),'utf8')+'bay,place,Example Bay,,,,,,,,\n');
    const replacement=new GraphBuilderPool(f.store,f.directory,resolve('.'));
    cleanup.push(()=>replacement.stop());
    expect(f.job().status).toBe('queued');
    expect(f.job().progress).toContain('Picking the graph draft back up');
    // A later attempt continues from the builder's own edits.
    const retry=replacement.prepare(f.jobId);
    expect(readFileSync(join(retry.work,'nodes.csv'),'utf8')).toContain('Example Bay');
    expect(readFileSync(join(task.work,'checkpoint.md'),'utf8')).toContain('Saved');
    expect(f.store.state.datasetRevision).toBe(0);
  });
});

describe('validation feedback', () => {
  it('sends a draft that does not hold together back to the builder with every problem', () => {
    const f = fixture('claude');
    const {child, pool, task} = builder(f);
    writeDraft(task.work, {...draftFiles(f.job()), 'edges.csv': 'id,from,name,targetType,target,qualification,time,reasoning,supports,challenges,context,sources\nlocation,works,located_in,node,nowhere,certain,,,,,,\n'});
    child.emit('close', 0);
    // The builder is started again straight away, with the problems beside its draft.
    expect(f.job().corrections).toBe(1);
    expect(f.job().attempt).toBe(2);
    expect(f.job().progress).toBe('Fixing the graph draft.');
    const report = readFileSync(join(task.work, 'validation.txt'), 'utf8');
    expect(report).toContain('not in nodes.csv: nowhere');
    expect(report).toContain('qualification "certain"');
    const retry = pool.active.get(f.jobId)!;
    expect(retry.prompt).toContain('validation.txt');
    expect(readFileSync(join(retry.work, 'AGENTS.md'), 'utf8')).toContain('correct the CSV files in place');
    // The builder's broken edits are kept for it to fix, not replaced with a fresh copy.
    expect(readFileSync(join(retry.work, 'edges.csv'), 'utf8')).toContain('nowhere');
  });

  it('stops asking the builder after the correction limit', () => {
    const f = fixture();
    const pool = new GraphBuilderPool(f.store, f.directory, resolve('.'));
    cleanup.push(() => pool.stop());
    pool.prepare(f.jobId);
    for (let n = 0; n < 3; n++) {
      expect(pool.correct(f.jobId, 'Edge a points nowhere\nEdge b points nowhere')).toBe(true);
      pool.prepare(f.jobId);
    }
    expect(pool.correct(f.jobId, 'Edge a points nowhere\nEdge b points nowhere')).toBe(false);
  });
});

describe('unfinished builders', () => {
  it('picks a stopped builder back up instead of asking the human', () => {
    const f = fixture();
    const pool = new GraphBuilderPool(f.store, f.directory, resolve('.'));
    cleanup.push(() => pool.stop());
    expect(pool.retry(f.jobId)).toBe(true);
    expect(f.job().status).toBe('queued');
    expect(f.job().progress).toBe('Picking the graph draft back up (attempt 1 of 3).');
  });

  it('gives up after the attempt limit', () => {
    const f = fixture();
    const pool = new GraphBuilderPool(f.store, f.directory, resolve('.'));
    cleanup.push(() => pool.stop());
    for (let n = 0; n < 3; n++) expect(pool.retry(f.jobId)).toBe(true);
    expect(pool.retry(f.jobId)).toBe(false);
  });

  it('says it is writing a draft', () => {
    const f = fixture();
    const pool = new GraphBuilderPool(f.store, f.directory, resolve('.'));
    cleanup.push(() => pool.stop());
    pool.prepare(f.jobId);
    expect(f.job().progress).toBe('Writing the graph draft.');
    expect(existsSync(join(f.directory, 'graph-builders', f.jobId, 'work', 'graph-research.json'))).toBe(true);
  });
});
