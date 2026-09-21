import { applyChanges } from "./changes.ts";
import type {
  ResearchState,
  Investigation,
  Proposal,
  Change,
  AnnotationTarget,
  Evidence,
} from "./research.ts";
import type { SourceRecord } from "./types.ts";

export interface FindingRef {
  proposalId: string;
  findingId: string;
}
export interface Finding {
  id: string;
  statement: string;
  qualification: "supported" | "reported" | "disputed" | "unresolved";
  explanation: string;
  evidenceIds: string[];
  replaces?: FindingRef;
  status?: "pending" | "kept" | "deferred" | "superseded";
  decidedAt?: string;
}
export interface GraphGroup {
  id: string;
  title: string;
  changeIndexes: number[];
  findingRefs: FindingRef[];
  dependsOn: string[];
  status?: "pending" | "accepted" | "rejected";
}
export const assert: (v: unknown, message: string) => asserts v = (
  v,
  message,
) => {
  if (!v) throw new Error(message);
};
export function sourceLibrary(state: ResearchState): SourceRecord[] {
  const sources = new Map<string, SourceRecord>();
  for (const i of state.investigations)
    for (const p of i.proposals) {
      for (const c of p.changes)
        if (c.table === "sources" && c.after)
          sources.set(c.recordId, c.after as unknown as SourceRecord);
      for (const s of p.sources || []) sources.set(s.id, s);
    }
  for (const s of [...(state.dataset.sources || []), ...(state.library || [])])
    sources.set(s.id, s);
  return [...sources.values()];
}
export function registeredSources(state: ResearchState): SourceRecord[] {
  return [
    ...new Map(
      [...(state.dataset.sources || []), ...(state.library || [])].map((s) => [
        s.id,
        s,
      ]),
    ).values(),
  ];
}
export function getFinding(
  i: Investigation,
  ref: FindingRef,
): Finding | undefined {
  return i.proposals
    .find((p) => p.id === ref.proposalId)
    ?.findings?.find((f) => f.id === ref.findingId);
}
export function requireKept(i: Investigation, refs: FindingRef[]) {
  assert(
    Array.isArray(refs) && refs.length > 0,
    "Select at least one kept finding.",
  );
  for (const ref of refs)
    assert(
      getFinding(i, ref)?.status === "kept",
      "A referenced finding is no longer kept. Review the findings and rebuild the graph proposal.",
    );
}
const sameRef = (a: FindingRef, b: FindingRef) =>
  a.proposalId === b.proposalId && a.findingId === b.findingId;
export function validatePhase(i: Investigation, p: Proposal) {
  if (!p.kind) return; // Historic proposals retain their original contract.
  assert(["findings", "graph"].includes(p.kind), "Unknown proposal phase.");
  if (p.kind === "findings") {
    assert(
      i.phase !== "graph",
      "Complete the requested graph pass, or return it for more research.",
    );
    assert(p.changes.length === 0, "Finding review does not change the graph.");
    assert(
      Array.isArray(p.findings) && p.findings.length > 0,
      "Return at least one finding, including unresolved outcomes.",
    );
    const ids = new Set<string>();
    for (const f of p.findings) {
      assert(
        typeof f.id === "string" && f.id && !ids.has(f.id),
        "Unique finding IDs are required.",
      );
      ids.add(f.id);
      assert(
        typeof f.statement === "string" &&
          f.statement.trim() &&
          typeof f.explanation === "string",
        "Finding statement and explanation required.",
      );
      assert(
        ["supported", "reported", "disputed", "unresolved"].includes(
          f.qualification,
        ),
        "Describe the finding qualification.",
      );
      assert(
        Array.isArray(f.evidenceIds) &&
          f.evidenceIds.every((id) => p.evidence.some((e) => e.id === id)),
        "Finding references unknown evidence.",
      );
      assert(
        f.evidenceIds.length > 0 || f.qualification === "unresolved",
        "A supported or attributed finding requires evidence.",
      );
      if (f.replaces)
        assert(
          getFinding(i, f.replaces),
          "Replacement finding does not exist.",
        );
      f.status = "pending";
      delete f.decidedAt;
    }
  } else {
    assert(
      i.phase === "graph" && i.graphRequest,
      "Request graph construction from kept findings first.",
    );
    assert(
      Array.isArray(p.groups) &&
        (p.groups.length > 0 || p.changes.length === 0),
      "Graph proposals require coherent review groups.",
    );
    assert(
      typeof p.omissions === "string" &&
        (p.groups.length > 0 || p.omissions.trim().length > 0),
      "Describe findings omitted from the graph, or state none.",
    );
    requireKept(i, i.graphRequest.refs);
    const groupIds = new Set(p.groups.map((g) => g.id));
    assert(groupIds.size === p.groups.length, "Duplicate graph group.");
    const assigned = new Set<number>();
    for (const g of p.groups) {
      assert(
        typeof g.id === "string" &&
          g.id &&
          typeof g.title === "string" &&
          g.title.trim(),
        "Graph group ID and title required.",
      );
      assert(
        Array.isArray(g.changeIndexes) && g.changeIndexes.length > 0,
        "A graph group requires changes.",
      );
      for (const n of g.changeIndexes) {
        assert(
          Number.isInteger(n) &&
            n >= 0 &&
            n < p.changes.length &&
            !assigned.has(n),
          "Each change must belong to exactly one group.",
        );
        assigned.add(n);
      }
      requireKept(i, g.findingRefs);
      assert(
        g.findingRefs.every((r) =>
          i.graphRequest!.refs.some((ref) => sameRef(ref, r)),
        ),
        "Graph group exceeds requested findings.",
      );
      assert(
        Array.isArray(g.dependsOn) &&
          g.dependsOn.every((id) => id !== g.id && groupIds.has(id)),
        "Unknown graph group dependency.",
      );
      g.status = "pending";
    }
    assert(
      assigned.size === p.changes.length,
      "Every graph change requires a review group.",
    );
    for (const g of p.groups) {
      const visit = (id: string, path: Set<string>) => {
        assert(!path.has(id), "Graph group dependencies cannot form a cycle.");
        const next = new Set([...path, id]);
        for (const d of p.groups!.find((x) => x.id === id)!.dependsOn)
          visit(d, next);
      };
      visit(g.id, new Set());
    }
  }
}
export function graphSelection(
  state: ResearchState,
  i: Investigation,
  p: Proposal,
  ids: string[],
): Change[] {
  assert(
    p.kind === "graph" && p.status === "pending",
    "This graph proposal is not awaiting review.",
  );
  assert(
    Array.isArray(ids) &&
      (ids.length > 0 || p.groups?.length === 0) &&
      new Set(ids).size === ids.length,
    "Select graph groups to apply.",
  );
  if (!p.groups?.length) {
    requireKept(i, i.graphRequest?.refs || []);
    assert(
      !i.annotations.some((a) => !p.addressedAnnotationIds.includes(a.id)),
      "Address new feedback before recording this graph outcome.",
    );
  }
  const groups = ids.map((id) => p.groups?.find((g) => g.id === id));
  for (const g of groups) {
    assert(
      g && g.status === "pending",
      "A selected group is no longer pending.",
    );
    requireKept(i, g.findingRefs);
    assert(
      g.dependsOn.every(
        (id) =>
          ids.includes(id) ||
          p.groups!.find((d) => d.id === id)?.status === "accepted",
      ),
      "Select the required groups as well; dependencies are never silently accepted.",
    );
    // Only feedback targeting this group or its findings blocks this decision.
    assert(
      !i.annotations.some(
        (a) =>
          !p.addressedAnnotationIds.includes(a.id) &&
          [a.target, ...(a.references || [])].some(
            (t) =>
              (t.proposalId === p.id && (!t.groupId || t.groupId === g.id)) ||
              g.findingRefs.some(
                (r) =>
                  t.proposalId === r.proposalId &&
                  (!t.findingId || t.findingId === r.findingId),
              ),
          ),
      ),
      "There is newer feedback on this graph group. Request a revised graph proposal.",
    );
  }
  const indexes = new Set(groups.flatMap((g) => g!.changeIndexes));
  const changes = p.changes.filter((_, n) => indexes.has(n));
  applyChanges(
    { ...state.dataset, sources: registeredSources(state) },
    changes,
  );
  return changes;
}
export function validateReferences(
  state: ResearchState,
  refs: AnnotationTarget[],
) {
  assert(
    Array.isArray(refs) && refs.length <= 30,
    "Use at most 30 annotation references.",
  );
  for (const r of refs) {
    assert(
      r && typeof r.label === "string" && r.label.length <= 1000,
      "Reference label required.",
    );
    if (r.walkthroughId || r.graphReviewId) {
      const flow = state.investigations.map(i => i.reviewFlow).find(f => f && (r.walkthroughId ? f.walkthroughs.some(w => w.id === r.walkthroughId) : f.graphReviews.some(g => g.id === r.graphReviewId)));
      assert(flow, "Referenced guided review no longer exists.");
      if (r.walkthroughId) {
        const w = flow.walkthroughs.find(w => w.id === r.walkthroughId)!;
        assert(!r.stepId || r.stepId === "opening" || r.stepId === "closing" || w.steps.some(s => s.id === r.stepId), "Walkthrough step does not exist.");
      }
      if (r.graphReviewId) {
        const g = flow.graphReviews.find(g => g.id === r.graphReviewId)!;
        // A note can concern an edge the draft keeps or one it removes.
        assert(!r.claimId || [...(g.draft.claims || []), ...(g.baseDataset.claims || [])].some(c => c.id === r.claimId), "Edge does not exist in this graph draft.");
      }
    }
    if (r.proposalId) {
      const p = state.investigations
        .flatMap((i) => i.proposals)
        .find((p) => p.id === r.proposalId);
      assert(
        p,
        "Referenced proposal must belong to an existing investigation.",
      );
      if (r.findingId)
        assert(
          p.findings?.some((f) => f.id === r.findingId),
          "Referenced finding does not exist.",
        );
      if (r.groupId)
        assert(
          p.groups?.some((g) => g.id === r.groupId),
          "Referenced graph group does not exist.",
        );
    }
  }
}
export function findingEvidence(
  i: Investigation,
  refs: FindingRef[],
): Evidence[] {
  const result = new Map<string, Evidence>();
  for (const r of refs) {
    const p = i.proposals.find((p) => p.id === r.proposalId)!;
    const f = getFinding(i, r)!;
    for (const e of p.evidence.filter((e) => f.evidenceIds.includes(e.id)))
      result.set(e.id, e);
  }
  return [...result.values()];
}
