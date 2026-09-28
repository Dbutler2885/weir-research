// One-time conversions of a stored graph to the current shape.
//
// Version 1 stored unions, direct parentage and relationship rows as records of their
// own; they became edges. Version 2 kept people and other things in separate lists
// with fixed kinds; they became one list of nodes, each with a type the project
// defines. Identifiers are reused throughout, so annotations and history that name a
// record still resolve, and nothing a record carried is dropped.
import { COUPLE_EDGE, PARENT_EDGE, defaultRelationships } from "./graph-schema.ts";
import type { Confidence, GraphDataset, GraphNode, LookColor, LookShape, NodeType, ParentageType, ResearchClaim } from "./types";
import type { ContextEntityRecord, LegacyDataset, NodesEdgesDataset, PersonRecord } from "./legacy-types.ts";
import { convertLegacyReviews, hasLegacyReviews } from "./legacy-graph-review.ts";

const parentEdgeName = (type: ParentageType | undefined) =>
  !type || type === "biological" || type === "unknown" ? PARENT_EDGE : `${type}_${PARENT_EDGE}`;

const qualificationFor: Record<Confidence, ResearchClaim["qualification"]> = {
  established: "supported",
  probable: "inferred",
  disputed: "disputed",
  unknown: "unresolved",
};

// An edge name keeps the label's wording and capitals, with underscores for spaces.
const snake = (label: string) => label.trim().replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "") || "related_to";

const prose = (...parts: (string | undefined)[]) => parts.filter((p) => p && p.trim()).join("\n");

function toNodesAndEdges(source: LegacyDataset): NodesEdgesDataset {
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
  return { ...rest, version: 2, claims } as NodesEdgesDataset;
}

// How each kind a version 2 graph could hold looks, now that kinds are the project's own types.
const oldKindLooks: Record<string, { color: LookColor; shape: LookShape }> = {
  person: { color: "sea", shape: "rounded" },
  family: { color: "gold", shape: "rounded" },
  organization: { color: "rust", shape: "square" },
  facility: { color: "clay", shape: "square" },
  place: { color: "moss", shape: "round" },
  vessel: { color: "sky", shape: "rounded" },
  event: { color: "plum", shape: "rounded" },
  observation: { color: "slate", shape: "rounded" },
};

const CARRIED_OVER = "Carried over from the node's earlier record, which kept it without evidence.";

// A descriptor and a biography were two tellings of the same thing; the summary keeps both.
const summaryOf = (record: { descriptor?: string; biography?: string }) => {
  const descriptor = record.descriptor?.trim();
  const biography = record.biography?.trim();
  if (!descriptor || !biography) return descriptor || biography || undefined;
  return biography.includes(descriptor) ? biography : `${descriptor.replace(/[.\s]+$/, "")}.\n\n${biography}`;
};

function toProjectTypes(source: NodesEdgesDataset): GraphDataset {
  const { people, contextEntities = [], ...rest } = structuredClone(source);
  const claims: ResearchClaim[] = [...(rest.claims || [])];
  const taken = new Set([...claims.map((c) => c.id), ...people.map((p) => p.id), ...contextEntities.map((e) => e.id)]);
  const fact = (node: string, name: string, value: string) => {
    let id = `${node}-${name}`;
    for (let n = 2; taken.has(id); n++) id = `${node}-${name}-${n}`;
    taken.add(id);
    claims.push({ id, subjectId: node, predicate: name, object: { value }, qualification: "reported", time: null, reasoning: CARRIED_OVER, evidence: [] });
  };
  const node = (record: PersonRecord | ContextEntityRecord, type: string, dates: string | undefined, notes?: string[]): GraphNode => {
    const summary = summaryOf(record);
    return {
      id: record.id,
      name: record.name,
      type,
      ...(summary ? { summary } : {}),
      ...(dates ? { dates } : {}),
      ...(notes?.length ? { notes } : {}),
      ...(record.sourceIds?.length ? { sourceIds: record.sourceIds } : {}),
    };
  };
  const nodes: GraphNode[] = [];
  for (const person of people) {
    nodes.push(node(person, "person", person.lifespan, person.researchNotes));
    if (person.born) fact(person.id, "born", person.born);
    if (person.died) fact(person.id, "died", person.died);
    for (const name of person.alternateNames || []) fact(person.id, "also_known_as", name);
  }
  for (const entity of contextEntities) nodes.push(node(entity, entity.kind, entity.activeDates));
  const used = [...new Set(nodes.map((n) => n.type))];
  const types: NodeType[] = used.map((name) => ({
    name,
    ...(oldKindLooks[name] || {}),
    fields:
      name === "person"
        ? [
            { name: "born", value: "date" },
            { name: "died", value: "date" },
            { name: "also_known_as", value: "text" },
          ]
        : [],
  }));
  return { ...rest, version: 3, nodes, types, relationships: defaultRelationships(), claims };
}

export function upgradeDataset(source: GraphDataset | NodesEdgesDataset | LegacyDataset): GraphDataset {
  if (source.version === 3) return source as GraphDataset;
  const nodesAndEdges = source.version === 2 ? (source as NodesEdgesDataset) : toNodesAndEdges(source as LegacyDataset);
  return toProjectTypes(nodesAndEdges);
}

const edgeTables = new Set(["unions", "directParentage", "contextConnections"]);
const nodeTables = new Set(["people", "contextEntities"]);

// Annotations, history and proposals name records by table. Records that became edges
// or nodes kept their identifiers, so only the table name changes, and a proposal's
// copies of a person or entity become copies of the node.
function retarget(value: unknown): void {
  if (Array.isArray(value)) return value.forEach(retarget);
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (typeof record.table === "string" && typeof record.recordId === "string") {
    if (edgeTables.has(record.table)) record.table = "claims";
    else if (nodeTables.has(record.table)) {
      const kind = record.table === "people" ? "person" : undefined;
      for (const key of ["before", "after"])
        if (record[key] && typeof record[key] === "object") {
          const old = record[key] as PersonRecord & ContextEntityRecord;
          record[key] = toProjectTypes({ version: 2, title: "", initialFocusId: null, people: kind ? [old] : [], contextEntities: kind ? [] : [old] }).nodes[0];
        }
      record.table = "nodes";
    }
  }
  Object.values(record).forEach(retarget);
}

const isOldDataset = (value: Record<string, unknown>) => value.version !== 3 && Array.isArray(value.people) && typeof value.title === "string";

// Every stored graph, wherever the workspace keeps one: the live graph, undo
// snapshots, and the graphs that graph work started from or produced.
function upgradeEverywhere(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(upgradeEverywhere);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  if (isOldDataset(record)) return upgradeDataset(record as unknown as LegacyDataset);
  for (const [key, child] of Object.entries(record)) record[key] = upgradeEverywhere(child);
  return record;
}

type Upgradable = { dataset: GraphDataset | NodesEdgesDataset | LegacyDataset };

export function needsGraphUpgrade(state: Upgradable): boolean {
  return state.dataset.version !== 3 || hasLegacyReviews(state as never);
}

// Upgrade a whole workspace, and the records that point into the graph.
export function upgradeGraphState<S extends Upgradable>(source: S): S {
  if (!needsGraphUpgrade(source)) return source;
  let state = structuredClone(source);
  retarget(state);
  state = upgradeEverywhere(state) as S;
  // Reviews and candidates prepared as proposals become drafts of the graph they were built against.
  state = convertLegacyReviews(state as never) as S;
  return state;
}
