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
import {GraphBuilders} from '../server/graph-builders.mjs';
import {emptyGraph, prepareResearch, draftFiles, writeDraft, returnDraft, tourFor} from './fixtures/guided-flow';
import {graphToTables} from '../src/domain/graph-csv';
import type {GraphDataset} from '../src/domain/types';

const cleanup: (()=>void)[] = [];
afterEach(()=>cleanup.splice(0).reverse().forEach(fn=>fn()));
function fixture(engine = 'manual', graph: GraphDataset = emptyGraph) {
  const directory = mkdtempSync(join(tmpdir(),'fictional-guided-'));
  cleanup.push(()=>rmSync(directory,{recursive:true,force:true}));
  const store = new WorkspaceStore(directory, graph);
  const research = prepareResearch(store);
  const published: any = flowCommand(store, {action:'publish-walkthrough',...research});
  store.update((next: any)=>{next.engine=engine;});
  const opened: any = {...published, ...flowCommand(store, {action:'request-graph',investigationId:research.investigationId}, 'human')};
  // The coordinator briefs the builder before it starts.
  flowCommand(store, {action:'assign-graph',investigationId:research.investigationId,jobId:opened.jobId,brief:'Represent the batch\'s findings.'});
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
  const pool=new GraphBuilders(f.store,f.directory,resolve('.'),{launch:()=>child as any,findExecutable:()=>'/fake/claude'});
  cleanup.push(()=>pool.stop());
  pool.pump();
  return {child, pool, task: pool.active.get(f.jobId)!};
}

describe('reorganizing the graph',()=>{
  it('lets the coordinator start a reorganization with no new research, which the human decides on like any draft',()=>{
    const directory = mkdtempSync(join(tmpdir(),'fictional-reorganize-'));
    cleanup.push(()=>rmSync(directory,{recursive:true,force:true}));
    const graph: GraphDataset={...emptyGraph,initialFocusId:'works',nodes:[{id:'works',name:'Example Works',type:'facility'}],claims:[{id:'built',subjectId:'works',predicate:'built_in_year',object:{value:'1880'},qualification:'supported',time:null,reasoning:'Absorbs the former works-1880 edge.',evidence:[]}]};
    const store = new WorkspaceStore(directory, graph);
    // The human asks; the coordinator opens a batch for it.
    store.command({type:'send',text:'Please reorganize the graph.',annotation:{question:'Reorganize the graph with summaries.',references:[]}});
    const annotationId = store.state.conversation.at(-1).annotations[0].id;
    const {investigationId}: any = store.command({type:'open-batch',title:'Reorganize the graph',brief:{purpose:'Organize the graph as it stands.',scope:'The whole graph.',direction:'No new research.'},questions:[{title:'Reorganize the graph with summaries.',annotationIds:[annotationId]}]});
    expect(()=>flowCommand(store,{action:'reorganize-graph',investigationId,message:'x'},'human')).toThrow('other review role');
    expect(()=>flowCommand(store,{action:'reorganize-graph',investigationId,message:' '})).toThrow('Say what the human asked');
    expect(()=>flowCommand(store,{action:'reorganize-graph',investigationId,message:'Tidy the graph.'})).toThrow('only when the human asked for it');
    const messageId = store.state.conversation.at(-1).id;
    const {jobId}: any = flowCommand(store,{action:'reorganize-graph',investigationId,messageId,message:'The human asked for summaries and a timeline of names.'});
    const job = () => store.state.investigations.find((i: any)=>i.id===investigationId).reviewFlow.jobs[0];
    expect(job()).toMatchObject({reorganization:true,status:'queued',consumedUpdateSequence:0});
    expect(job().updates[0].message).toMatch(/^Reorganize the graph as it stands; there is no new research to add\..*\n\nThe human asked for summaries/s);
    expect(job().packet.findings).toEqual({});
    expect(()=>flowCommand(store,{action:'reorganize-graph',investigationId,message:'again'})).toThrow('already has graph work');
    // The builder writes a type with a field, files the fact under it, and summarizes the node.
    const files = graphToTables(job().baseDataset);
    files['fields.csv'] += 'facility,built,date\n';
    files['nodes.csv'] = files['nodes.csv'].replace('works,facility,Example Works,,,,', 'works,facility,Example Works,,An invented works built in 1880.,,');
    files['edges.csv'] = files['edges.csv'].replace('built,works,built_in_year,text,1880,supported,,Absorbs the former works-1880 edge.', 'built,works,built,text,1880,supported,,The register gives the year.');
    returnDraft(store, investigationId, {...files, 'submission.txt':'done 1\n'});
    expect(job().candidate.diff.vocabulary).toEqual(['The facility type records built.']);
    const {graphReviewId}: any = flowCommand(store,{action:'publish-graph-review',investigationId,jobId,tour:{introduction:'The graph, organized.',steps:[{id:'works',title:'The works',focusNodeIds:['works'],focusClaimIds:['built'],explanation:'Its year is now under Built.',issueIds:[],transition:'That is all.'}]}});
    flowCommand(store,{action:'graph-accept',investigationId,graphReviewId},'human');
    expect(store.state.dataset.nodes[0].summary).toBe('An invented works built in 1880.');
    expect(store.state.dataset.claims[0].predicate).toBe('built');
  });
});

describe('a graph update the human asked for',()=>{
  function asked() {
    const directory = mkdtempSync(join(tmpdir(),'fictional-asked-'));
    cleanup.push(()=>rmSync(directory,{recursive:true,force:true}));
    const store = new WorkspaceStore(directory, emptyGraph);
    const research = prepareResearch(store);
    flowCommand(store, {action:'publish-walkthrough',...research});
    store.update((next: any)=>{next.engine='claude';});
    const launched: string[] = [];
    const launch = () => { launched.push('builder'); return Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),exitCode:null,kill(){this.exitCode=1 as any;}}) as any; };
    const pool = new GraphBuilders(store, directory, resolve('.'), {launch, findExecutable:()=>'/fake/claude'});
    cleanup.push(()=>pool.stop());
    const job = () => store.state.investigations[0].reviewFlow.jobs.at(-1);
    return {store, pool, launched, job, investigationId: research.investigationId};
  }

  it('from Review, waits for the coordinator to brief the builder, which then follows the brief', async ()=>{
    const {nextAction} = await import('../src/domain/next-action');
    const a = asked();
    const {jobId}: any = flowCommand(a.store, {action:'request-graph',investigationId:a.investigationId}, 'human');
    a.pool.pump();
    expect(a.launched).toEqual([]);
    expect(a.job()).toMatchObject({status:'queued',awaitingBrief:true,progress:'Waiting for the coordinator to brief a graph builder.'});
    expect(nextAction(a.store.state, a.store.state.investigations[0])).toMatchObject({waitingOn:'coordinator',action:expect.stringContaining('brief a graph builder')});
    expect(()=>flowCommand(a.store, {action:'assign-graph',investigationId:a.investigationId,jobId})).toThrow('Give the graph builder a brief');
    flowCommand(a.store, {action:'assign-graph',investigationId:a.investigationId,jobId,brief:'Represent events through December 31, 1900 only.'});
    expect(a.job().awaitingBrief).toBeUndefined();
    expect(a.job().packet.brief).toBe('Represent events through December 31, 1900 only.');
    a.pool.pump();
    expect(a.launched).toEqual(['builder']);
    const work = a.pool.active.get(jobId)!.work;
    expect(JSON.parse(readFileSync(join(work,'packet.json'),'utf8')).brief).toBe('Represent events through December 31, 1900 only.');
    expect(readFileSync(join(work,'AGENTS.md'),'utf8')).toContain("packet.json's brief is the coordinator's brief for this job");
  });

  it('from the conversation, starts only for the human message the coordinator cites, with its brief', ()=>{
    const a = asked();
    a.store.command({type:'send',text:'Can you start the graph update for this batch, up to 1900?'});
    const human = a.store.state.conversation.at(-1).id;
    a.store.command({type:'reply',text:'I will.'});
    const reply = a.store.state.conversation.at(-1).id;
    const request = (data: any) => flowCommand(a.store, {action:'request-graph',investigationId:a.investigationId,brief:'Only through 1900.',...data});
    expect(()=>request({})).toThrow('only when the human asked for one');
    expect(()=>request({messageId:reply})).toThrow('only when the human asked for one');
    expect(()=>request({messageId:human,brief:' '})).toThrow('Give the graph builder a brief');
    request({messageId:human});
    expect(a.job()).toMatchObject({status:'queued',brief:'Only through 1900.',requestedIn:human});
    expect(a.job().awaitingBrief).toBeUndefined();
    expect(a.store.state.investigations[0].events.at(-1).message).toBe('Coordinator started the graph update you asked for: "Can you start the graph update for this batch, up to 1900?"');
    a.pool.pump();
    expect(a.launched).toEqual(['builder']);
    // One request starts one graph update.
    a.store.update((next: any)=>{next.investigations[0].reviewFlow.jobs.at(-1).status='superseded';});
    expect(()=>request({messageId:human})).toThrow('already started a graph update');
  });
});

describe('guided research flow',()=>{
  it('accepts a whole draft: the graph is replaced, research is copied in, and an undo is kept',()=>{
    const f=fixture();
    expect(f.job().status).toBe('queued');
    expect(f.store.state.investigations[0].proposals[0].findings[0].status).toBe('pending');
    const {graphReviewId}=publish(f);
    expect(f.review().summary).toBe('2 new nodes, 1 new edge, 1 evidence record added from the research.');
    expect(f.store.state.dataset.nodes).toEqual([]);
    const accepted: any=f.command('graph-accept',{graphReviewId},'human');
    expect(f.store.state.datasetRevision).toBe(1);
    expect(f.store.state.dataset.nodes.map((n: any)=>n.id)).toEqual(['bay','works']);
    expect(f.store.state.dataset.claims[0].qualification).toBe('reported');
    expect(f.store.state.dataset.evidence[0].quote).toBe('Example Works stood in Example Bay.');
    expect(f.store.state.dataset.sources.map((s: any)=>s.id)).toEqual(['register']);
    expect(f.review().status).toBe('applied');
    expect(f.store.state.investigations[0].closedAt).toBeTruthy();
    // A closed batch is not left looking like research is waiting on it.
    expect(f.store.state.investigations[0].status).toBe('closed');
    expect(()=>f.command('graph-accept',{graphReviewId},'human')).toThrow('no longer pending');
    expect(new WorkspaceStore(f.directory,emptyGraph).state.dataset.claims).toHaveLength(1);
    organize(f.store,{action:'organization-undo',undoId:accepted.undoId});
    expect(f.store.state.investigations[0].status).toBe('review');
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
    // Each stage is kept in the batch's history, which the activity list reads.
    const history=f.store.state.investigations[0].events.map((e: any)=>e.message);
    expect(history.filter((m: string)=>/graph|draft/i.test(m))).toEqual([
      'Graph update requested.',
      'Coordinator briefed the graph builder.',
      expect.stringMatching(/^Graph builder handed in a draft: /),
      'Coordinator signed off the graph draft; it is ready for your review.',
      'Coordinator sent the graph draft back to the builder.',
      expect.stringMatching(/^Graph builder handed in a draft: /),
      'Coordinator signed off the graph draft; it is ready for your review.',
      'Graph review completed; batch closed.',
    ]);
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
    expect(()=>flowCommand(store,{action:'request-graph',investigationId:research.investigationId})).toThrow('only when the human asked for one');
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
    // A published walkthrough is corrected through its file; only a requested rewrite replaces it.
    expect(()=>f.command('publish-walkthrough',{walkthrough:{...f.walkthrough,correction:'The answer has been qualified.'},basedOnWalkthroughId:f.walkthroughId})).toThrow(/edit walkthroughs\/batch-.*\.json/);
    f.command('request-walkthrough',{},'human');
    f.command('publish-walkthrough',{walkthrough:{...f.walkthrough,correction:'The answer has been qualified.'},basedOnWalkthroughId:f.walkthroughId});
    expect(f.store.state.investigations[0].reviewFlow.walkthroughs).toHaveLength(2);
    // Walkthroughs and graph updates are independent; a revision does not discard graph work.
    expect(f.job().status).toBe('queued');
    expect(f.store.publicState().investigations[0].reviewFlow.jobs[0].packet).toBeUndefined();
  });
  it('hands a builder the graph as tables, and reads its edits back as a candidate draft',()=>{
    const f=fixture('claude');
    const {child,task,pool}=builder(f);
    expect(readFileSync(join(task.work,'nodes.csv'),'utf8')).toBe('id,type,name,dates,summary,notes,sources\n');
    expect(readFileSync(join(task.work,'types.csv'),'utf8')).toBe('type,color,shape\nplace,,\nfacility,,\n');
    expect(readFileSync(join(task.work,'start','edges.csv'),'utf8')).toContain('id,from,name,targetType');
    expect(readFileSync(join(task.work,'AGENTS.md'),'utf8')).toContain('edit them in place');
    // Progress comes from the builder's stream; it is never asked to report it.
    expect(readFileSync(join(task.work,'AGENTS.md'),'utf8')).not.toContain('status.txt');
    writeFileSync(join(task.work,'status.txt'),'Halfway there.');
    const before=JSON.stringify(f.job());
    pool.pump();
    expect(JSON.stringify(f.job())).toBe(before);
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
    const works=(id: string,name: string)=>({id,name,type:'facility'});
    const edge=(id: string,from: string,name: string,object: any)=>({id,subjectId:from,predicate:name,object,qualification:'supported' as const,time:null,reasoning:'From the invented register.',evidence:[]});
    const graph: GraphDataset={...emptyGraph,initialFocusId:'works-old',nodes:[{id:'bay',name:'Example Bay',type:'place'},works('works-north','North Works'),works('works-old','The Old Works'),works('works-mill','Bay Mill')],claims:[
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
    expect(f.store.state.dataset.nodes.map((n: any)=>n.id)).toEqual(['bay','works-north']);
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
    const pool=new GraphBuilders(f.store,f.directory,resolve('.'));
    cleanup.push(()=>pool.stop());
    pool.prepare(f.jobId);
    expect(readFileSync(join(f.directory,'graph-builders',f.jobId,'proposal-format','nodes.csv'),'utf8')).toContain('existingId');
    expect(readFileSync(join(work,'nodes.csv'),'utf8')).toContain('id,type,name,dates');
  });
  it('keeps tables written before nodes had types aside, and starts again from the graph',()=>{
    const f=fixture();
    const work=join(f.directory,'graph-builders',f.jobId,'work');
    mkdirSync(work,{recursive:true});
    writeFileSync(join(work,'nodes.csv'),'id,kind,name,descriptor,biography,dates,born,died,alternateNames,notes,sources\nbay,place,Example Bay,,,,,,,,\n');
    writeFileSync(join(work,'edges.csv'),'id,from,name,targetType,target,qualification,time,reasoning,supports,challenges,context,sources\n');
    const pool=new GraphBuilders(f.store,f.directory,resolve('.'));
    cleanup.push(()=>pool.stop());
    pool.prepare(f.jobId);
    expect(readFileSync(join(f.directory,'graph-builders',f.jobId,'untyped-tables','nodes.csv'),'utf8')).toContain('Example Bay');
    expect(readFileSync(join(work,'nodes.csv'),'utf8')).toBe('id,type,name,dates,summary,notes,sources\n');
    expect(existsSync(join(work,'relationships.csv'))).toBe(true);
  });
  it('retains incomplete worker files and picks interrupted workers back up on restart',()=>{
    const f=fixture();
    const pool=new GraphBuilders(f.store,f.directory,resolve('.'));
    cleanup.push(()=>pool.stop());
    const task=pool.prepare(f.jobId);
    writeFileSync(join(task.work,'checkpoint.md'),'Saved research representation.');
    writeFileSync(join(task.work,'nodes.csv'),readFileSync(join(task.work,'nodes.csv'),'utf8')+'bay,place,Example Bay,,An invented bay.,,\n');
    const replacement=new GraphBuilders(f.store,f.directory,resolve('.'));
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

describe('a running builder', () => {
  it('hears the coordinator\'s update at its next step, and closes when its turn ends', async () => {
    const f = fixture('claude');
    const {child, pool} = builder(f);
    let input = '';
    child.stdin.on('data', (chunk: Buffer) => { input += chunk.toString(); });
    f.command('graph-update', {message: 'Fold the works into its site.'});
    pool.pump();
    await new Promise(done => setImmediate(done));
    const messages = input.trim().split('\n').map(l => JSON.parse(l));
    expect(messages.at(-1).message.content).toContain('The coordinator sent update 1: Fold the works into its site.');
    expect(messages.at(-1).message.content).toContain('write done 1 to submission.txt');
    expect(child.stdin.writableEnded).toBe(false);
    child.stdout.write(JSON.stringify({type: 'result', subtype: 'success'}) + '\n');
    expect(child.stdin.writableEnded).toBe(true);
  });
});

describe('a builder that reaches its usage limit', () => {
  it('pauses with the reason and keeps every attempt, rather than failing', async () => {
    const f = fixture('claude');
    const {child, pool} = builder(f);
    const before = {corrections: f.job().corrections || 0, attempt: f.job().attempt};
    // Recorded lines from a builder that hit its limit, with the reset moved into the future.
    const resetsAt = Math.floor(Date.now() / 1000) + 3600;
    for (const line of readFileSync(resolve('tests/fixtures/claude-quota.jsonl'), 'utf8').trim().split('\n')) {
      const event = JSON.parse(line);
      if (event.rate_limit_info) event.rate_limit_info.resetsAt = resetsAt;
      child.stdout.write(`${JSON.stringify(event)}\n`);
    }
    await new Promise(done => setImmediate(done));
    expect(f.job().status).toBe('running');
    expect(f.job().progress).toMatch(/^Paused: the usage limit is reached\. It carries on at /);
    expect({corrections: f.job().corrections || 0, attempt: f.job().attempt}).toEqual(before);
    expect(child.stdin.writableEnded).toBe(false);
    expect(f.store.state.investigations[0].events.at(-1).message).toMatch(/^Graph builder paused: the usage limit is reached/);
    // The time limit does not run out while it waits.
    pool.pump();
    expect(f.job().status).toBe('running');
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
    expect(f.store.state.investigations[0].events.map((e: any)=>e.message)).toEqual(expect.arrayContaining([
      'Graph builder started the draft.',
      'The app sent the draft back to the builder with 2 problems to fix.',
    ]));
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
    const pool = new GraphBuilders(f.store, f.directory, resolve('.'));
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
    const pool = new GraphBuilders(f.store, f.directory, resolve('.'));
    cleanup.push(() => pool.stop());
    expect(pool.retry(f.jobId)).toBe(true);
    expect(f.job().status).toBe('queued');
    expect(f.job().progress).toBe('Picking the graph draft back up (attempt 1 of 3).');
  });

  it('gives up after the attempt limit', () => {
    const f = fixture();
    const pool = new GraphBuilders(f.store, f.directory, resolve('.'));
    cleanup.push(() => pool.stop());
    for (let n = 0; n < 3; n++) expect(pool.retry(f.jobId)).toBe(true);
    expect(pool.retry(f.jobId)).toBe(false);
  });

  it('says it is writing a draft', () => {
    const f = fixture();
    const pool = new GraphBuilders(f.store, f.directory, resolve('.'));
    cleanup.push(() => pool.stop());
    pool.prepare(f.jobId);
    expect(f.job().progress).toBe('Writing the graph draft.');
    expect(existsSync(join(f.directory, 'graph-builders', f.jobId, 'work', 'graph-research.json'))).toBe(true);
  });
});
