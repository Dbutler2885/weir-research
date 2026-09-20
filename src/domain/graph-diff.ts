// What a draft actually changes.
//
// The builder edits a copy of the graph and does not declare its changes, so the diff
// is computed here by comparing the draft to the accepted graph. A builder cannot
// misreport what it did, forget to mention a deletion, or claim a change it did not make.
import { canonical } from "./changes.ts";
import type { FamilyDataset, ResearchClaim } from "./types";

export interface NodeChange {
  id: string;
  kind: string;
  name: string;
}
export interface RenamedNode extends NodeChange {
  wasName: string;
}
export interface MergedNodes {
  // The nodes that are gone and the node their claims now point at.
  gone: NodeChange[];
  into: NodeChange;
}
export interface ClaimChange {
  id: string;
  subjectId: string;
  predicate: string;
  qualification: string;
}
export interface RequalifiedClaim extends ClaimChange {
  wasQualification: string;
}
export interface GraphDiff {
  addedNodes: NodeChange[];
  removedNodes: NodeChange[];
  renamedNodes: RenamedNode[];
  merges: MergedNodes[];
  addedClaims: ClaimChange[];
  removedClaims: ClaimChange[];
  changedClaims: ClaimChange[];
  requalifiedClaims: RequalifiedClaim[];
  addedEvidence: string[];
  removedEvidence: string[];
  addedSources: string[];
  removedSources: string[];
  unchanged: boolean;
}

type Node = { id: string; kind: string; name: string };

function nodesOf(dataset: FamilyDataset): Map<string, Node> {
  const entries: Node[] = [
    ...dataset.people.map((p) => ({ id: p.id, kind: "person", name: p.name })),
    ...(dataset.contextEntities || []).map((e) => ({ id: e.id, kind: e.kind as string, name: e.name })),
  ];
  return new Map(entries.map((n) => [n.id, n]));
}

const claimsOf = (dataset: FamilyDataset) => new Map((dataset.claims || []).map((c) => [c.id, c]));

const brief = (claim: ResearchClaim): ClaimChange => ({
  id: claim.id,
  subjectId: claim.subjectId,
  predicate: claim.predicate,
  qualification: claim.qualification as string,
});

const targetsOf = (claim: ResearchClaim): string[] =>
  [claim.subjectId, "entityId" in claim.object ? (claim.object as { entityId: string }).entityId : undefined].filter(
    Boolean,
  ) as string[];

export function diffGraphs(before: FamilyDataset, after: FamilyDataset): GraphDiff {
  const was = nodesOf(before);
  const now = nodesOf(after);
  const addedNodes: NodeChange[] = [];
  const removedNodes: NodeChange[] = [];
  const renamedNodes: RenamedNode[] = [];
  for (const [id, node] of now) {
    const prior = was.get(id);
    if (!prior) { addedNodes.push(node); continue; }
    if (prior.name !== node.name) renamedNodes.push({ ...node, wasName: prior.name });
  }
  for (const [id, node] of was) if (!now.has(id)) removedNodes.push(node);

  const priorClaims = claimsOf(before);
  const draftClaims = claimsOf(after);
  const addedClaims: ClaimChange[] = [];
  const removedClaims: ClaimChange[] = [];
  const changedClaims: ClaimChange[] = [];
  const requalifiedClaims: RequalifiedClaim[] = [];
  for (const [id, claim] of draftClaims) {
    const prior = priorClaims.get(id);
    if (!prior) { addedClaims.push(brief(claim)); continue; }
    if (canonical(prior as unknown as Record<string, unknown>) === canonical(claim as unknown as Record<string, unknown>)) continue;
    if (prior.qualification !== claim.qualification)
      requalifiedClaims.push({ ...brief(claim), wasQualification: prior.qualification as string });
    else changedClaims.push(brief(claim));
  }
  for (const [id, claim] of priorClaims) if (!draftClaims.has(id)) removedClaims.push(brief(claim));

  // A removed node whose claims now point somewhere else was merged, not deleted.
  // Report it that way, because "two nodes became one" is what the human decided.
  const merges: MergedNodes[] = [];
  const vanished = new Set(removedNodes.map((n) => n.id));
  const survivors = new Map<string, Set<string>>();
  if (vanished.size)
    for (const [id, prior] of priorClaims) {
      const draft = draftClaims.get(id);
      if (!draft) continue;
      const beforeTargets = targetsOf(prior);
      const afterTargets = targetsOf(draft);
      for (let at = 0; at < beforeTargets.length; at++) {
        const from = beforeTargets[at];
        const to = afterTargets[at];
        if (!from || !to || from === to || !vanished.has(from) || !now.has(to)) continue;
        survivors.set(to, (survivors.get(to) || new Set()).add(from));
      }
    }
  for (const [into, gone] of survivors) {
    const survivor = now.get(into);
    if (!survivor) continue;
    merges.push({ into: survivor, gone: [...gone].map((id) => was.get(id)!).filter(Boolean) });
  }
  const merged = new Set([...survivors.values()].flatMap((set) => [...set]));

  const ids = (list: { id: string }[] | undefined) => new Set((list || []).map((x) => x.id));
  const beforeEvidence = ids(before.evidence);
  const afterEvidence = ids(after.evidence);
  const beforeSources = ids(before.sources);
  const afterSources = ids(after.sources);

  const diff: GraphDiff = {
    addedNodes,
    // A merged node is accounted for by its merge, not listed again as a removal.
    removedNodes: removedNodes.filter((n) => !merged.has(n.id)),
    renamedNodes,
    merges,
    addedClaims,
    removedClaims,
    changedClaims,
    requalifiedClaims,
    addedEvidence: [...afterEvidence].filter((id) => !beforeEvidence.has(id)),
    removedEvidence: [...beforeEvidence].filter((id) => !afterEvidence.has(id)),
    addedSources: [...afterSources].filter((id) => !beforeSources.has(id)),
    removedSources: [...beforeSources].filter((id) => !afterSources.has(id)),
    unchanged: false,
  };
  diff.unchanged = !(
    diff.addedNodes.length ||
    diff.removedNodes.length ||
    diff.renamedNodes.length ||
    diff.merges.length ||
    diff.addedClaims.length ||
    diff.removedClaims.length ||
    diff.changedClaims.length ||
    diff.requalifiedClaims.length ||
    diff.addedEvidence.length ||
    diff.removedEvidence.length ||
    diff.addedSources.length ||
    diff.removedSources.length
  );
  return diff;
}

// One line a person can read, for the Review panel and the top of a tour.
export function describeDiff(diff: GraphDiff): string {
  if (diff.unchanged) return "No changes.";
  const counted = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const parts: string[] = [];
  if (diff.addedNodes.length) parts.push(`${counted(diff.addedNodes.length, "new node")}`);
  if (diff.merges.length) {
    const gone = diff.merges.reduce((total, m) => total + m.gone.length, 0);
    parts.push(
      diff.merges.length === 1
        ? `${counted(gone + 1, "node")} merged into one`
        : `${counted(diff.merges.length, "merge")} collapsing ${counted(gone + diff.merges.length, "node")}`,
    );
  }
  if (diff.removedNodes.length) parts.push(`${counted(diff.removedNodes.length, "node")} removed`);
  if (diff.renamedNodes.length) parts.push(`${counted(diff.renamedNodes.length, "rename")}`);
  if (diff.addedClaims.length) parts.push(`${counted(diff.addedClaims.length, "new claim")}`);
  if (diff.changedClaims.length) parts.push(`${counted(diff.changedClaims.length, "claim")} reworded`);
  if (diff.requalifiedClaims.length) parts.push(`${counted(diff.requalifiedClaims.length, "claim")} requalified`);
  if (diff.removedClaims.length) parts.push(`${counted(diff.removedClaims.length, "claim")} removed`);
  return `${parts.join(", ")}.`;
}
