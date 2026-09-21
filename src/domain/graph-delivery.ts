// What a graph builder hands back, and what accepting it does to the graph.
//
// A builder edits nodes.csv and edges.csv and writes its commentary beside them:
// open questions and representation notes. The draft is read back and checked in
// one pass, so every problem reaches the builder at once.
import { DraftError, graphFromTables, parseCsv, type Citable, type DraftFiles } from "./graph-csv.ts";
import { diffGraphs, describeDiff, type GraphDiff } from "./graph-diff.ts";
import { GenealogyModel } from "./model.ts";
import type { FamilyDataset, ResearchEvidence, SourceRecord } from "./types";

export interface DraftQuestion {
  id: string;
  question: string;
  nodeIds: string[];
  edgeIds: string[];
  provisionalTreatment: string;
  requestedResearch: string;
}
export interface DraftNote {
  id: string;
  nodeIds: string[];
  edgeIds: string[];
  decision: string;
  alternatives: string[];
  reason: string;
}
export interface Delivery {
  draft: FamilyDataset;
  diff: GraphDiff;
  summary: string;
  questions: DraftQuestion[];
  notes: DraftNote[];
  // The last coordinator update the builder says it incorporated.
  consumedUpdateSequence: number;
}

export const commentaryHeaders = {
  "questions.csv": ["id", "question", "nodeIds", "edgeIds", "provisionalTreatment", "requestedResearch"],
  "notes.csv": ["id", "nodeIds", "edgeIds", "decision", "alternatives", "reason"],
} as const;
export type DeliveryFiles = Partial<DraftFiles & Record<keyof typeof commentaryHeaders | "submission.txt", string>>;

const ids = (value: string) => value.split(";").map((id) => id.trim()).filter(Boolean);

function commentary<N extends keyof typeof commentaryHeaders>(name: N, text: string | undefined, problems: string[]) {
  if (text === undefined || !text.trim()) return [];
  const rows = parseCsv(text);
  const header = rows.shift() || [];
  const expected: readonly string[] = commentaryHeaders[name];
  if (header.length !== expected.length || header.some((h, i) => h.trim() !== expected[i])) {
    problems.push(`${name}: the first row must be exactly ${expected.join(",")}`);
    return [];
  }
  return rows
    .map((row, index) => ({ row, line: index + 2 }))
    .filter(({ row }) => row.some((cell) => cell.trim()))
    .flatMap(({ row, line }) => {
      if (row.length !== expected.length) {
        problems.push(`${name} row ${line} has ${row.length} columns, not ${expected.length}.`);
        return [];
      }
      return [{ ...(Object.fromEntries(expected.map((key, i) => [key, row[i]!])) as Record<(typeof commentaryHeaders)[N][number], string>), line }];
    });
}

// "done", optionally followed by the last update sequence incorporated.
export function submissionSequence(text: string | undefined): number | null {
  const match = /^done(?:\s+(\d+))?\s*$/.exec((text || "").trim());
  return match ? Number(match[1] || 0) : null;
}

export function readDelivery(files: DeliveryFiles, base: FamilyDataset, citable: Citable = {}): Delivery {
  const problems: string[] = [];
  const consumed = submissionSequence(files["submission.txt"]);
  if (consumed === null) problems.push('submission.txt must contain done, followed by the last update sequence you incorporated, such as "done 2".');
  let draft: FamilyDataset | null = null;
  try {
    draft = graphFromTables(files, base, citable);
  } catch (error) {
    if (!(error instanceof DraftError)) throw error;
    problems.push(...error.problems);
  }
  // Commentary can point at records the draft keeps or at ones it removed.
  const known = new Set([
    ...[...(draft?.people || []), ...(draft?.contextEntities || []), ...(draft?.claims || [])].map((r) => r.id),
    ...[...base.people, ...(base.contextEntities || []), ...(base.claims || [])].map((r) => r.id),
  ]);
  const refer = (list: string[], where: string) => {
    if (draft) for (const id of list) if (!known.has(id)) problems.push(`${where} names a node or edge that is not in the graph: ${id}`);
    return list;
  };
  const questions = commentary("questions.csv", files["questions.csv"], problems).map((q) => {
    const where = `questions.csv row ${q.line}`;
    if (!q.id.trim() || !q.question.trim()) problems.push(`${where} needs an id and a question.`);
    return {
      id: q.id.trim(),
      question: q.question,
      nodeIds: refer(ids(q.nodeIds), where),
      edgeIds: refer(ids(q.edgeIds), where),
      provisionalTreatment: q.provisionalTreatment,
      requestedResearch: q.requestedResearch,
    };
  });
  const notes = commentary("notes.csv", files["notes.csv"], problems).map((n) => {
    const where = `notes.csv row ${n.line}`;
    if (!n.id.trim() || !n.decision.trim()) problems.push(`${where} needs an id and a decision.`);
    return {
      id: n.id.trim(),
      nodeIds: refer(ids(n.nodeIds), where),
      edgeIds: refer(ids(n.edgeIds), where),
      decision: n.decision,
      alternatives: n.alternatives.split("\n").map((a) => a.trim()).filter(Boolean),
      reason: n.reason,
    };
  });
  for (const [what, list] of [["question", questions], ["note", notes]] as const) {
    const seen = new Set<string>();
    for (const item of list) {
      if (seen.has(item.id)) problems.push(`Two ${what}s share the id ${item.id}.`);
      seen.add(item.id);
    }
  }
  if (problems.length || !draft) throw new DraftError(problems);
  const diff = diffGraphs(base, draft);
  return { draft, diff, summary: describeDiff(diff), questions, notes, consumedUpdateSequence: consumed! };
}

// The research records a draft cites that the graph does not hold yet.
export function citedResearch(
  draft: FamilyDataset,
  registry: Record<string, ResearchEvidence>,
  library: SourceRecord[],
): { evidence: ResearchEvidence[]; sources: SourceRecord[] } {
  const heldEvidence = new Set((draft.evidence || []).map((e) => e.id));
  const heldSources = new Set((draft.sources || []).map((s) => s.id));
  const evidence = [...new Set((draft.claims || []).flatMap((c) => c.evidence.map((e) => e.ref)))]
    .filter((id) => !heldEvidence.has(id) && registry[id])
    .map((id) => ({ ...structuredClone(registry[id]!), id }));
  const wanted = new Set([
    ...evidence.map((e) => e.sourceId),
    ...[...draft.people, ...(draft.contextEntities || []), ...(draft.claims || [])].flatMap((r) => r.sourceIds || []),
  ]);
  const sources = library.filter((s) => wanted.has(s.id) && !heldSources.has(s.id));
  return { evidence, sources };
}

// Accepting replaces the graph with the draft. Evidence and sources are only ever
// added: a draft cannot remove or alter a research record.
export function acceptDraft(
  current: FamilyDataset,
  draft: FamilyDataset,
  cited: { evidence: ResearchEvidence[]; sources: SourceRecord[] },
  diff: GraphDiff,
): FamilyDataset {
  const merged = new Map(diff.merges.flatMap((m) => m.gone.map((g) => [g.id, m.into.id] as const)));
  const nodes = new Set([...draft.people, ...(draft.contextEntities || [])].map((n) => n.id));
  const focus = current.initialFocusId && (nodes.has(current.initialFocusId) ? current.initialFocusId : merged.get(current.initialFocusId));
  const evidence = new Map([...(current.evidence || []), ...cited.evidence].map((e) => [e.id, e]));
  const sources = new Map([...(current.sources || []), ...cited.sources].map((s) => [s.id, s]));
  const next: FamilyDataset = {
    version: 2,
    title: current.title,
    initialFocusId: focus || null,
    people: structuredClone(draft.people),
    contextEntities: structuredClone(draft.contextEntities || []),
    claims: structuredClone(draft.claims || []),
    evidence: [...evidence.values()],
    sources: [...sources.values()],
  };
  new GenealogyModel(next);
  return next;
}

// The graph a review draws: the draft, plus the records it removes as ghosts. Both
// are laid out together, so turning the changes on and off moves nothing.
export interface ReviewGraph {
  dataset: FamilyDataset;
  focusId: string | null;
  ghostIds: Set<string>;
  addedIds: Set<string>;
  changedEdgeIds: Set<string>;
}
export function reviewGraph(review: {
  draft: FamilyDataset;
  baseDataset: FamilyDataset;
  diff: GraphDiff;
  cited: { evidence: ResearchEvidence[]; sources: SourceRecord[] };
}): ReviewGraph {
  const { draft, baseDataset: base, diff } = review;
  const kept = new Set([...draft.people, ...(draft.contextEntities || [])].map((n) => n.id));
  const keptEdges = new Set((draft.claims || []).map((c) => c.id));
  const ghostPeople = base.people.filter((p) => !kept.has(p.id));
  const ghostEntities = (base.contextEntities || []).filter((e) => !kept.has(e.id));
  const ghostEdges = (base.claims || []).filter((c) => !keptEdges.has(c.id));
  const evidence = new Map([...(base.evidence || []), ...(draft.evidence || []), ...review.cited.evidence].map((e) => [e.id, e]));
  const sources = new Map([...(base.sources || []), ...(draft.sources || []), ...review.cited.sources].map((s) => [s.id, s]));
  const dataset: FamilyDataset = {
    version: 2,
    title: draft.title,
    initialFocusId: null,
    people: [...draft.people, ...ghostPeople],
    contextEntities: [...(draft.contextEntities || []), ...ghostEntities],
    claims: [...(draft.claims || []), ...ghostEdges],
    evidence: [...evidence.values()],
    sources: [...sources.values()],
  };
  const merged = new Map(diff.merges.flatMap((m) => m.gone.map((g) => [g.id, m.into.id] as const)));
  const start = base.initialFocusId && (kept.has(base.initialFocusId) ? base.initialFocusId : merged.get(base.initialFocusId));
  const focusId = start || diff.addedNodes[0]?.id || [...draft.people, ...(draft.contextEntities || [])][0]?.id || null;
  return {
    dataset,
    focusId,
    ghostIds: new Set([...ghostPeople, ...ghostEntities, ...ghostEdges].map((r) => r.id)),
    addedIds: new Set([...diff.addedNodes, ...diff.addedEdges].map((r) => r.id)),
    changedEdgeIds: new Set([...diff.movedEdges, ...diff.requalifiedEdges, ...diff.rewordedEdges, ...diff.recitedEdges].map((e) => e.id)),
  };
}
