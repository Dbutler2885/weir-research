// One-time conversion of a stored graph to nodes and edges.
//
// Unions, direct parentage and stored relationship rows become edges. Their
// identifiers are reused where one record becomes one edge, so annotations and
// history that name them still resolve. Nothing a record carried is dropped:
// dates become the edge's time, and labels, places and notes become its reasoning.
import { COUPLE_EDGE, PARENT_EDGE, parentEdgeName } from "./family-edges.ts";
import type { Confidence, FamilyDataset, LegacyDataset, ResearchClaim } from "./types";

const qualificationFor: Record<Confidence, ResearchClaim["qualification"]> = {
  established: "supported",
  probable: "inferred",
  disputed: "disputed",
  unknown: "unresolved",
};

// An edge name keeps the label's wording and capitals, with underscores for spaces.
const snake = (label: string) => label.trim().replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "") || "related_to";

const prose = (...parts: (string | undefined)[]) => parts.filter((p) => p && p.trim()).join("\n");

export function upgradeDataset(source: FamilyDataset | LegacyDataset): FamilyDataset {
  if (source.version === 2) return source as FamilyDataset;
  const { unions = [], directParentage = [], contextConnections = [], ...rest } = structuredClone(source as LegacyDataset);
  const claims: ResearchClaim[] = [...(rest.claims || [])];
  const taken = new Set(claims.map((c) => c.id));
  const add = (claim: ResearchClaim) => {
    let id = claim.id;
    for (let n = 2; taken.has(id); n++) id = `${claim.id}-${n}`;
    taken.add(id);
    claims.push({ ...claim, id });
  };
  const edge = (
    id: string,
    from: string,
    name: string,
    to: string,
    fields: { confidence?: Confidence; qualification?: ResearchClaim["qualification"]; time?: string; reasoning?: string; sourceIds?: string[] },
  ): ResearchClaim => ({
    id,
    subjectId: from,
    predicate: name,
    object: { entityId: to },
    qualification: fields.qualification || qualificationFor[fields.confidence || "established"],
    time: fields.time || null,
    reasoning: fields.reasoning || "",
    evidence: [],
    ...(fields.sourceIds?.length ? { sourceIds: [...fields.sourceIds] } : {}),
  });

  for (const union of unions) {
    const [first, ...others] = union.partnerIds;
    const fields = {
      confidence: union.confidence,
      time: union.date,
      reasoning: prose(union.label, union.place && `Place: ${union.place}`, ...(union.notes || [])),
      sourceIds: union.sourceIds,
    };
    const name = union.type === "partnership" ? "partner_of" : COUPLE_EDGE;
    if (first) others.forEach((other, index) => add(edge(index ? `${union.id}-${index + 1}` : union.id, first, name, other, fields)));
    for (const child of union.childIds || [])
      for (const parent of union.partnerIds)
        add(edge(`${union.id}-${PARENT_EDGE}-${parent}-${child}`, parent, PARENT_EDGE, child, { ...fields, time: undefined }));
  }

  for (const link of directParentage)
    add(
      edge(link.id, link.parentId, parentEdgeName(link.type), link.childId, {
        confidence: link.confidence,
        reasoning: prose(link.label, link.type === "unknown" ? "Kind of parentage unknown." : undefined),
        sourceIds: link.sourceIds,
      }),
    );

  // Relationship rows rebuilt from claims are already edges; the rest were stored on their own.
  for (const connection of contextConnections.filter((c) => !taken.has(c.id)))
    add(
      edge(connection.id, connection.fromId, snake(connection.label), connection.toId, {
        confidence: connection.confidence,
        qualification: connection.qualification,
        time: connection.date,
        reasoning: prose(...(connection.notes || [])),
        sourceIds: connection.sourceIds,
      }),
    );

  // Citations are listed by role, the order the edge table keeps them in.
  const rank = { supports: 0, challenges: 1, context: 2 };
  for (const claim of claims) claim.evidence = [...claim.evidence].sort((a, b) => rank[a.role] - rank[b.role]);
  return { ...rest, version: 2, claims } as FamilyDataset;
}

const legacyTables = new Set(["unions", "directParentage", "contextConnections"]);

// Annotations and history name records by table. Records that became edges kept
// their identifiers, so only the table name changes.
function retarget(value: unknown): void {
  if (Array.isArray(value)) return value.forEach(retarget);
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (typeof record.table === "string" && legacyTables.has(record.table) && typeof record.recordId === "string")
    record.table = "claims";
  Object.values(record).forEach(retarget);
}

type Upgradable = { dataset: FamilyDataset | LegacyDataset; organization?: { history?: { before?: FamilyDataset | LegacyDataset }[]; preview?: { dataset?: FamilyDataset | LegacyDataset } } };

export function needsGraphUpgrade(state: Upgradable): boolean {
  return state.dataset.version !== 2;
}

// Upgrade a whole workspace: the live graph, every undo snapshot, and the records
// that point into the graph.
export function upgradeGraphState<S extends Upgradable>(source: S): S {
  if (!needsGraphUpgrade(source)) return source;
  const state = structuredClone(source);
  retarget(state);
  state.dataset = upgradeDataset(state.dataset);
  for (const record of state.organization?.history || []) if (record.before) record.before = upgradeDataset(record.before);
  if (state.organization?.preview?.dataset) state.organization.preview.dataset = upgradeDataset(state.organization.preview.dataset);
  return state;
}
