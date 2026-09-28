// What a draft actually changes.
//
// The builder edits a copy of the graph and does not declare its changes, so the diff
// is computed here by comparing the draft to the accepted graph. A builder cannot
// misreport what it did, forget to mention a deletion, or claim a change it did not make.
// This is the only place that decides what counts as a merge, so the panel, the tour
// and the review all describe the same change.
import { canonical } from "./changes.ts";
import { normalizeName, readable } from "./graph-schema.ts";
import type { GraphDataset, RelationshipRule, ResearchClaim } from "./types";

export interface NodeChange {
  id: string;
  kind: string;
  name: string;
}
export interface RenamedNode extends NodeChange {
  wasName: string;
}
export interface EditedNode extends NodeChange {
  fields: string[];
}
// A node that is gone. When its edges moved to other nodes, they are named here.
export interface RemovedNode extends NodeChange {
  edgesMovedTo: NodeChange[];
}
export interface MergedNodes {
  // The nodes that are gone and the one node all of their moved edges now use.
  gone: NodeChange[];
  into: NodeChange;
}
export interface EdgeChange {
  id: string;
  from: string;
  name: string;
  target: string;
  qualification: string;
}
export interface MovedEdge extends EdgeChange {
  wasFrom: string;
  wasTarget: string;
}
export interface RequalifiedEdge extends EdgeChange {
  wasQualification: string;
}
export interface GraphDiff {
  addedNodes: NodeChange[];
  removedNodes: RemovedNode[];
  renamedNodes: RenamedNode[];
  editedNodes: EditedNode[];
  merges: MergedNodes[];
  addedEdges: EdgeChange[];
  removedEdges: EdgeChange[];
  movedEdges: MovedEdge[];
  requalifiedEdges: RequalifiedEdge[];
  rewordedEdges: EdgeChange[];
  recitedEdges: EdgeChange[];
  // Changes to the project's types and relationship rules, in words.
  vocabulary: string[];
  // Evidence the draft cites that the graph does not hold yet; accepting copies it in.
  evidenceToCopy: string[];
  unchanged: boolean;
}

type Node = NodeChange & { record: Record<string, unknown> };

function nodesOf(dataset: GraphDataset): Map<string, Node> {
  const entries: Node[] = dataset.nodes.map((n) => ({ id: n.id, kind: n.type, name: n.name, record: n as unknown as Record<string, unknown> }));
  return new Map(entries.map((n) => [n.id, n]));
}

// What changed in the project's vocabulary: types, their fields and looks, and
// relationship rules. Each change is one sentence a person can read.
function vocabularyChanges(before: GraphDataset, after: GraphDataset): string[] {
  const changes: string[] = [];
  const byName = <T extends { name: string }>(list: T[] | undefined) => new Map((list || []).map((item) => [normalizeName(item.name), item]));
  const typesWere = byName(before.types);
  const typesNow = byName(after.types);
  for (const [key, type] of typesNow) {
    const prior = typesWere.get(key);
    if (!prior) {
      const fields = type.fields.map((f) => readable(f.name).toLocaleLowerCase());
      changes.push(`New type: ${type.name}${fields.length ? `, recording ${fields.join(", ")}` : ""}.`);
      continue;
    }
    const fieldsWere = byName(prior.fields);
    const fieldsNow = byName(type.fields);
    for (const [name, field] of fieldsNow) {
      const old = fieldsWere.get(name);
      if (!old) changes.push(`The ${type.name} type records ${readable(field.name).toLocaleLowerCase()}.`);
      else if (old.value !== field.value) changes.push(`The ${type.name} type records ${readable(field.name).toLocaleLowerCase()} as a ${field.value}, not a ${old.value}.`);
    }
    for (const [name, field] of fieldsWere) if (!fieldsNow.has(name)) changes.push(`The ${type.name} type no longer records ${readable(field.name).toLocaleLowerCase()}.`);
    if (prior.color !== type.color || prior.shape !== type.shape) changes.push(`The ${type.name} type looks different.`);
  }
  for (const [key, type] of typesWere) if (!typesNow.has(key)) changes.push(`The ${type.name} type is gone.`);
  const rulesWere = byName(before.relationships);
  const rulesNow = byName(after.relationships);
  const describe = (rule: RelationshipRule) =>
    `${readable(rule.name)}${rule.reverse ? ` (read back as "${rule.reverse}")` : ""} ${rule.arrangement === "ranked" ? "is drawn in rows" : rule.arrangement === "paired" ? "is drawn side by side" : "is drawn freely"}`;
  for (const [key, rule] of rulesNow) {
    const prior = rulesWere.get(key);
    if (!prior) changes.push(`New relationship: ${describe(rule)}.`);
    else if (prior.arrangement !== rule.arrangement || (prior.reverse || "") !== (rule.reverse || "")) changes.push(`Changed relationship: ${describe(rule)}.`);
  }
  for (const [key, rule] of rulesWere) if (!rulesNow.has(key)) changes.push(`${readable(rule.name)} has no rule any more.`);
  return changes;
}

const plain = ({ id, kind, name }: NodeChange): NodeChange => ({ id, kind, name });
const edgesOf = (dataset: GraphDataset) => new Map((dataset.claims || []).map((c) => [c.id, c]));
const targetOf = (claim: ResearchClaim) => ("entityId" in claim.object ? claim.object.entityId : String(claim.object.value));
const brief = (claim: ResearchClaim): EdgeChange => ({
  id: claim.id,
  from: claim.subjectId,
  name: claim.predicate,
  target: targetOf(claim),
  qualification: claim.qualification,
});
// A missing list and an empty one are the same record.
const same = (a: unknown, b: unknown) =>
  canonical(Array.isArray(a) && !a.length ? undefined : a) === canonical(Array.isArray(b) && !b.length ? undefined : b);
const citations = (claim: ResearchClaim) => ({
  evidence: ["supports", "challenges", "context"].map((role) => claim.evidence.filter((e) => e.role === role).map((e) => e.ref).sort()),
  sources: [...(claim.sourceIds || [])].sort(),
});
const ends = (claim: ResearchClaim) => [claim.subjectId, "entityId" in claim.object ? claim.object.entityId : undefined];

export function diffGraphs(before: GraphDataset, after: GraphDataset): GraphDiff {
  const was = nodesOf(before);
  const now = nodesOf(after);
  const addedNodes: NodeChange[] = [];
  const renamedNodes: RenamedNode[] = [];
  const editedNodes: EditedNode[] = [];
  for (const [id, node] of now) {
    const prior = was.get(id);
    if (!prior) { addedNodes.push(plain(node)); continue; }
    if (prior.name !== node.name) renamedNodes.push({ ...plain(node), wasName: prior.name });
    const fields = [...new Set([...Object.keys(prior.record), ...Object.keys(node.record)])].filter(
      (key) => key !== "id" && key !== "name" && !same(prior.record[key], node.record[key]),
    );
    if (fields.length || prior.kind !== node.kind) editedNodes.push({ ...plain(node), fields: prior.kind !== node.kind ? ["kind", ...fields] : fields });
  }
  const gone = [...was.values()].filter((n) => !now.has(n.id));

  const priorEdges = edgesOf(before);
  const draftEdges = edgesOf(after);
  const addedEdges: EdgeChange[] = [];
  const removedEdges: EdgeChange[] = [];
  const movedEdges: MovedEdge[] = [];
  const requalifiedEdges: RequalifiedEdge[] = [];
  const rewordedEdges: EdgeChange[] = [];
  const recitedEdges: EdgeChange[] = [];
  // Where each vanished node's edges went.
  const destinations = new Map<string, Set<string>>();
  for (const [id, edge] of draftEdges) {
    const prior = priorEdges.get(id);
    if (!prior) { addedEdges.push(brief(edge)); continue; }
    const [fromWas, toWas] = ends(prior);
    const [fromNow, toNow] = ends(edge);
    if (fromWas !== fromNow || toWas !== toNow) {
      movedEdges.push({ ...brief(edge), wasFrom: prior.subjectId, wasTarget: targetOf(prior) });
      for (const [old, current] of [[fromWas, fromNow], [toWas, toNow]])
        if (old && current && old !== current && !now.has(old) && now.has(current))
          destinations.set(old, (destinations.get(old) || new Set()).add(current));
    } else if (prior.qualification !== edge.qualification)
      requalifiedEdges.push({ ...brief(edge), wasQualification: prior.qualification });
    else if (["predicate", "object", "time", "reasoning"].some((key) => !same(prior[key as keyof ResearchClaim], edge[key as keyof ResearchClaim])))
      rewordedEdges.push(brief(edge));
    else if (!same(citations(prior), citations(edge))) recitedEdges.push(brief(edge));
  }
  for (const [id, edge] of priorEdges) if (!draftEdges.has(id)) removedEdges.push(brief(edge));

  // A vanished node whose moved edges all went to one node was merged into it.
  // One whose edges went to several nodes was removed, and says where they went.
  const merges = new Map<string, MergedNodes>();
  const removedNodes: RemovedNode[] = [];
  for (const node of gone) {
    const targets = [...(destinations.get(node.id) || [])].map((id) => plain(now.get(id)!));
    if (targets.length === 1) {
      const into = targets[0]!;
      const merge = merges.get(into.id) || { into, gone: [] };
      merge.gone.push(plain(node));
      merges.set(into.id, merge);
    } else removedNodes.push({ ...plain(node), edgesMovedTo: targets });
  }

  const held = new Set((before.evidence || []).map((e) => e.id));
  const cited = new Set((after.claims || []).flatMap((c) => c.evidence.map((e) => e.ref)));
  const diff: GraphDiff = {
    addedNodes,
    removedNodes,
    renamedNodes,
    editedNodes,
    merges: [...merges.values()],
    addedEdges,
    removedEdges,
    movedEdges,
    requalifiedEdges,
    rewordedEdges,
    recitedEdges,
    vocabulary: vocabularyChanges(before, after),
    evidenceToCopy: [...cited].filter((id) => !held.has(id)),
    unchanged: false,
  };
  diff.unchanged = Object.values(diff).every((value) => !Array.isArray(value) || value.length === 0);
  return diff;
}

// One line a person can read, for the Review panel and the top of a tour.
export function describeDiff(diff: GraphDiff): string {
  if (diff.unchanged) return "No changes.";
  const counted = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const parts: string[] = [];
  const merged = diff.merges.reduce((total, m) => total + m.gone.length, 0);
  if (diff.merges.length === 1) parts.push(`${merged + 1} nodes merged into one`);
  else if (diff.merges.length) parts.push(`${diff.merges.length} merges folding ${counted(merged, "node")} into others`);
  if (diff.addedNodes.length) parts.push(counted(diff.addedNodes.length, "new node"));
  if (diff.removedNodes.length) parts.push(`${counted(diff.removedNodes.length, "node")} removed`);
  if (diff.renamedNodes.length) parts.push(counted(diff.renamedNodes.length, "node renamed", "nodes renamed"));
  if (diff.editedNodes.length) parts.push(counted(diff.editedNodes.length, "node edited", "nodes edited"));
  if (diff.addedEdges.length) parts.push(counted(diff.addedEdges.length, "new edge"));
  if (diff.movedEdges.length) parts.push(`${counted(diff.movedEdges.length, "edge")} moved`);
  if (diff.rewordedEdges.length) parts.push(`${counted(diff.rewordedEdges.length, "edge")} reworded`);
  if (diff.requalifiedEdges.length) parts.push(`${counted(diff.requalifiedEdges.length, "edge")} requalified`);
  if (diff.recitedEdges.length) parts.push(`${counted(diff.recitedEdges.length, "edge")} with changed citations`);
  if (diff.removedEdges.length) parts.push(`${counted(diff.removedEdges.length, "edge")} removed`);
  if (diff.vocabulary?.length) parts.push(counted(diff.vocabulary.length, "change to types and relationships", "changes to types and relationships"));
  if (diff.evidenceToCopy.length) parts.push(`${counted(diff.evidenceToCopy.length, "evidence record")} added from the research`);
  const line = parts.join(", ");
  return `${line.charAt(0).toUpperCase()}${line.slice(1)}.`;
}
