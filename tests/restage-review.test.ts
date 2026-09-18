// @vitest-environment node
import {describe,it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WorkspaceStore} from '../server/store.mjs';
import {graphImport} from '../server/graph-import.mjs';
import {graphPacket,flowCommand} from '../server/review-flow.mjs';
import {prepareResearch,emptyGraph,graphFor,tourFor} from './fixtures/guided-flow';
describe('saved experiment staging',()=>{
 it('restages only the latest import, preserves a rollback, and applies the reviewed graph once',()=>{
  const dir=mkdtempSync(join(tmpdir(),'fictional-restage-'));
  try {
   const store=new WorkspaceStore(dir,emptyGraph),r=prepareResearch(store);
   const packet=graphPacket(store.state,store.state.investigations[0],{...r.walkthrough,id:'trial'}),graph=graphFor(packet);
   const preview:any=graphImport(store,{action:'preview',graph,packet});
   const applied:any=graphImport(store,{action:'apply',previewId:preview.previewId});
   const command={action:'stage-review',investigationId:r.investigationId,undoId:applied.undoId,packet,walkthrough:r.walkthrough,tour:tourFor(graph)};
   const staged:any=graphImport(store,command);
   expect(store.state.dataset.contextEntities || []).toHaveLength(0);
   expect(store.state.investigations[0].status).toBe('paused');
   expect(store.state.organization.history.at(-1).before.contextEntities).toHaveLength(2);
   expect(()=>graphImport(store,command)).toThrow('latest');
   flowCommand(store,{action:'graph-apply',investigationId:r.investigationId,graphReviewId:staged.graphReviewId,groupIds:['place','factory']},'human');
   expect(store.state.dataset.claims).toHaveLength(1);
   expect(store.state.dataset.contextEntities).toHaveLength(2);
  } finally {rmSync(dir,{recursive:true,force:true});}
 });
});
