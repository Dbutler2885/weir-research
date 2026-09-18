import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function validateProposal(p, packet) {
  const errors = [];
  const warnings = [];
  const check = (ok, message) => { if (!ok) errors.push(message); };
  const text = x => typeof x === 'string' && x.trim().length > 0;
  const list = (obj, key) => { check(Array.isArray(obj?.[key]), `${key} must be an array`); return Array.isArray(obj?.[key]) ? obj[key] : []; };
  if (!p || typeof p !== 'object') return {valid:false, errors:['Proposal must be an object']};
  check(p.schemaVersion === 1, 'schemaVersion must be 1');
  check(p.baseGraphRevision === packet.baseGraphRevision, 'Stale graph revision');
  check(p.researchRevision === packet.researchRevision, 'Stale research revision');
  check(p.consumedUpdateSequence === (packet.updates.at(-1)?.sequence ?? 0), 'Updates not fully incorporated');
  check(text(p.title) && text(p.summary), 'Title and summary required');
  const nodes = list(p,'nodes'), claims = list(p,'claims'), groups = list(p,'groups');
  const issues = list(p,'issues'), notes = list(p,'representationNotes'), coverage = list(p,'coverage'), identities = list(p,'identityDecisions');
  const ids = (rows, type) => { const set = new Set(); for (const r of rows) { check(text(r.id) && !set.has(r.id), `Invalid or duplicate ${type} ID: ${r.id}`); set.add(r.id); } return set; };
  const nodeIds = ids(nodes,'node'), claimIds = ids(claims,'claim'), groupIds = ids(groups,'group'), issueIds = ids(issues,'issue');
  ids(notes,'representation note');
  const existingNodes = new Set(packet.existingGraph.nodes.map(n=>n.id));
  const allNodes = new Set([...nodeIds,...existingNodes]);
  const evidenceIds = new Set(Object.keys(packet.evidence));
  const refs = (obj, field, allowed) => { for (const id of list(obj,field)) check(allowed.has(id), `${field} references unknown ID: ${id}`); };
  for (const n of nodes) {
    check(['person','organization','facility','place','event','observation'].includes(n.kind), `Unknown node kind ${n.kind}`);
    check(text(n.label), `Node ${n.id} needs a label`);
    check(n.existingId === null || existingNodes.has(n.existingId), `Invalid existingId for ${n.id}`);
    refs(n,'evidenceRefs',evidenceIds);
    check(n.evidenceRefs?.length > 0, `Node ${n.id} lacks evidence`);
  }
  for (const c of claims) {
    check(allNodes.has(c.subjectId), `Unknown subject ${c.subjectId}`);
    check(text(c.predicate) && text(c.reasoning), `Claim ${c.id} needs predicate and reasoning`);
    check(['supported','reported','inferred','disputed','unresolved'].includes(c.qualification), `Invalid qualification ${c.qualification}`);
    check(c.time === null || text(c.time), `Invalid temporal scope ${c.id}`);
    const keys = Object.keys(c.object || {});
    check(keys.length === 1 && ['entityId','value'].includes(keys[0]), `Invalid claim object ${c.id}`);
    if(keys[0] === 'entityId') check(allNodes.has(c.object.entityId), `Unknown object ${c.object.entityId}`);
    if(keys[0] === 'value') check(text(c.object.value) || typeof c.object.value === 'number', `Invalid literal ${c.id}`);
    const links = list(c,'evidence');
    check(links.length > 0 || c.qualification === 'unresolved', `Claim ${c.id} lacks evidence`);
    for(const e of links) {
      check(evidenceIds.has(e.ref), `Unknown evidence ${e.ref}`);
      check(['supports','challenges','context'].includes(e.role), `Invalid evidence role ${e.role}`);
    }
  }
  const owners = new Map();
  for(const g of groups) {
    check(text(g.title), `Group ${g.id} needs title`);
    refs(g,'nodeIds',nodeIds); refs(g,'claimIds',claimIds); refs(g,'dependsOn',groupIds);
    for(const id of [...(g.nodeIds || []),...(g.claimIds || [])]) { check(!owners.has(id), `Multiple groups own ${id}`); owners.set(id,g.id); }
  }
  for(const id of [...nodeIds,...claimIds]) check(owners.has(id), `Ungrouped record ${id}`);
  const visiting = new Set(), done = new Set();
  const visit = id => { if(visiting.has(id)) {check(false,`Group dependency cycle at ${id}`);return;} if(done.has(id))return; visiting.add(id); for(const d of groups.find(g=>g.id===id)?.dependsOn || [])visit(d); visiting.delete(id); done.add(id); };
  groups.forEach(g=>visit(g.id));
  const depends = (id,target,seen=new Set()) => {if(seen.has(id))return false;seen.add(id);return (groups.find(g=>g.id===id)?.dependsOn || []).some(d=>d===target || depends(d,target,seen));};
  for(const c of claims) for(const n of [c.subjectId,c.object?.entityId].filter(id=>nodeIds.has(id))) {
    const owner=owners.get(c.id), required=owners.get(n);
    check(owner === required || depends(owner,required), `Group ${owner} needs dependency on ${required} for ${c.id}`);
  }
  const seenCoverage = new Set();
  for(const c of coverage) {
    check(Object.hasOwn(packet.findings,c.findingRef) && !seenCoverage.has(c.findingRef), `Invalid or duplicate finding coverage ${c.findingRef}`);
    seenCoverage.add(c.findingRef);refs(c,'nodeIds',allNodes);refs(c,'claimIds',claimIds);
    check((c.nodeIds?.length || c.claimIds?.length) || text(c.omissionReason), `Missing omission reason ${c.findingRef}`);
  }
  for(const id of Object.keys(packet.findings))check(seenCoverage.has(id),`Unaccounted finding ${id}`);
  for(const d of identities) {refs(d,'nodeIds',allNodes);refs(d,'evidenceRefs',evidenceIds);check(['reuse','distinct','possible-match'].includes(d.decision) && text(d.reason),'Invalid identity decision');}
  for(const i of issues) {
    check(['research','context','representation'].includes(i.kind) && text(i.question) && text(i.provisionalTreatment),`Incomplete issue ${i.id}`);
    check(i.requestedResearch === null || text(i.requestedResearch),`Invalid research request ${i.id}`);
    refs(i,'nodeIds',allNodes);refs(i,'claimIds',claimIds);refs(i,'evidenceRefs',evidenceIds);refs(i,'blocksGroupIds',groupIds);
  }
  for(const n of notes) {
    refs(n,'nodeIds',allNodes);refs(n,'claimIds',claimIds);refs(n,'issueIds',issueIds);
    check(text(n.decision) && text(n.reason), `Incomplete representation note ${n.id}`);
    check(list(n,'alternatives').every(text), `Invalid alternatives ${n.id}`);
  }
  if (Array.isArray(packet.sources)) {
    const sourceIds = new Set(packet.sources.map(source => source.id));
    const usedEvidence = new Set([...nodes.flatMap(node => node.evidenceRefs || []), ...claims.flatMap(claim => (claim.evidence || []).map(link => link.ref))]);
    for (const ref of usedEvidence) {
      const evidence = packet.evidence[ref];
      if (evidence && !sourceIds.has(evidence.sourceId)) warnings.push(`Evidence ${ref} references a source missing from the supplied registry: ${evidence.sourceId ?? '(unspecified)'}`);
    }
  }
  return {valid:errors.length===0,errors,warnings,counts:{nodes:nodes.length,claims:claims.length,relationships:claims.filter(c=>c.object?.entityId).length,groups:groups.length,issues:issues.length,representationNotes:notes.length,coveredFindings:seenCoverage.size}};
}

if(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result=validateProposal(JSON.parse(readFileSync(process.argv[2],'utf8')),JSON.parse(readFileSync(process.argv[3],'utf8')));
  console.log(JSON.stringify(result,null,2));process.exitCode=result.valid?0:1;
}
