// The graph as editable tables: its nodes and edges, and the project's vocabulary.
//
// A builder receives a copy of these files, edits them freely, and hands them back.
// Adding a record is a new row, merging two nodes is deleting one row and repointing
// the edges that named it, and removing a record is a row that is not there. Nothing
// needs a vocabulary for deletion because nothing is expressed as a difference.
//
// The vocabulary is three small tables: the project's types and their looks, the
// fields each type records, and how relationships read and arrange the graph.
//
// Evidence and sources are not in the tables. A builder cites them by identifier,
// and the reader checks every citation against the records it is allowed to cite.
import { normalizeName } from "./graph-schema.ts";
import { ARRANGEMENTS, LOOK_COLORS, LOOK_SHAPES, VALUE_KINDS } from "./types.ts";
import type { Arrangement, GraphDataset, GraphNode, LookColor, LookShape, NodeType, RelationshipRule, ResearchClaim, ValueKind } from "./types";

export const draftTables = ["nodes.csv", "edges.csv", "types.csv", "fields.csv", "relationships.csv"] as const;
export type DraftTable = (typeof draftTables)[number];
export type DraftFiles = Record<DraftTable, string>;

export const draftHeaders = {
  "nodes.csv": ["id", "type", "name", "dates", "summary", "notes", "sources"],
  "edges.csv": ["id", "from", "name", "targetType", "target", "qualification", "time", "reasoning", "supports", "challenges", "context", "sources"],
  "types.csv": ["type", "color", "shape"],
  "fields.csv": ["type", "field", "value"],
  "relationships.csv": ["name", "reverse", "arrangement"],
} as const satisfies Record<DraftTable, readonly string[]>;

const headers = draftHeaders;
type RowOf<N extends DraftTable> = { [K in (typeof headers)[N][number]]: string };

const qualifications: ResearchClaim["qualification"][] = ["supported", "reported", "inferred", "disputed", "unresolved"];
const roles = ["supports", "challenges", "context"] as const;

const cell = (value: unknown): string => {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};
const row = (values: unknown[]): string => values.map(cell).join(",");
const file = (name: DraftTable, rows: unknown[][]) => [row([...headers[name]]), ...rows.map(row)].join("\n") + "\n";

// Identifiers are joined with semicolons; text lists put one item per line.
const joinIds = (ids: readonly string[] | undefined) => (ids || []).join("; ");
const splitIds = (value: string) => value.split(";").map((id) => id.trim()).filter(Boolean);
const joinLines = (items: readonly string[] | undefined) => (items || []).join("\n");
const splitLines = (value: string) => value.split("\n").map((item) => item.trim()).filter(Boolean);

// A reader that understands quoted fields, embedded commas, newlines and doubled quotes.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  const source = text.replace(/^﻿/, "");
  for (let at = 0; at < source.length; at++) {
    const character = source[at];
    if (quoted) {
      if (character !== '"') { field += character; continue; }
      if (source[at + 1] === '"') { field += '"'; at++; continue; }
      quoted = false;
      continue;
    }
    if (character === '"') { quoted = true; continue; }
    if (character === ",") { record.push(field); field = ""; continue; }
    if (character === "\r") continue;
    if (character === "\n") { record.push(field); rows.push(record); record = []; field = ""; continue; }
    field += character;
  }
  if (quoted) throw new DraftError(["A quoted cell is never closed; check for an unbalanced quotation mark."]);
  if (field.length || record.length) { record.push(field); rows.push(record); }
  return rows;
}

// Every problem in a draft, so a builder can fix them all in one pass.
export class DraftError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(problems.join("\n"));
    this.problems = problems;
  }
}

function table<N extends DraftTable>(name: N, files: Partial<DraftFiles>, problems: string[]): (RowOf<N> & { line: number })[] {
  const text = files[name];
  if (text === undefined) { problems.push(`${name} is missing.`); return []; }
  const rows = parseCsv(text);
  const header = rows.shift();
  const expected: readonly string[] = headers[name];
  if (!header || header.length !== expected.length || header.some((h, i) => h.trim() !== expected[i])) {
    problems.push(`${name}: the first row must be exactly ${expected.join(",")}`);
    return [];
  }
  const result: (RowOf<N> & { line: number })[] = [];
  rows.forEach((r, index) => {
    const line = index + 2;
    if (!r.some((value) => value.trim().length)) return;
    if (r.length !== expected.length) {
      problems.push(`${name} row ${line} has ${r.length} columns, not ${expected.length}; a comma or quotation mark in free text is probably unquoted.`);
      return;
    }
    // Identifiers and keywords tolerate stray spaces; prose is kept exactly as written.
    const values = Object.fromEntries(expected.map((key, i) => [key, prose.has(key) ? r[i]! : r[i]!.trim()]));
    result.push({ ...(values as RowOf<N>), line });
  });
  return result;
}

const prose = new Set(["name", "summary", "dates", "notes", "time", "reasoning", "target", "reverse"]);

const optional = <K extends string, V>(key: K, value: V | undefined, keep: boolean) =>
  (keep ? { [key]: value } : {}) as Partial<Record<K, V>>;

export function graphToTables(dataset: GraphDataset): DraftFiles {
  const nodes = dataset.nodes.map((n) => [n.id, n.type, n.name, n.dates, n.summary, joinLines(n.notes), joinIds(n.sourceIds)]);
  const edges = (dataset.claims || []).map((c) => {
    const target = "entityId" in c.object ? c.object.entityId : c.object.value;
    const type = "entityId" in c.object ? "node" : typeof c.object.value === "number" ? "number" : "text";
    const cited = (role: (typeof roles)[number]) => joinIds(c.evidence.filter((e) => e.role === role).map((e) => e.ref));
    return [c.id, c.subjectId, c.predicate, type, target, c.qualification, c.time, c.reasoning, cited("supports"), cited("challenges"), cited("context"), joinIds(c.sourceIds)];
  });
  const types = dataset.types.map((t) => [t.name, t.color, t.shape]);
  const fields = dataset.types.flatMap((t) => t.fields.map((f) => [t.name, f.name, f.value]));
  const relationships = dataset.relationships.map((r) => [r.name, r.reverse, r.arrangement]);
  return {
    "nodes.csv": file("nodes.csv", nodes),
    "edges.csv": file("edges.csv", edges),
    "types.csv": file("types.csv", types),
    "fields.csv": file("fields.csv", fields),
    "relationships.csv": file("relationships.csv", relationships),
  };
}

// Records a draft may cite beyond those the graph already holds: the evidence
// registry and source library of the research it represents.
export interface Citable {
  evidenceIds?: Iterable<string>;
  sourceIds?: Iterable<string>;
}

// Read a builder's tables back into a graph. The accepted graph supplies what the
// builder does not edit: the title, the starting focus, evidence and sources.
export function graphFromTables(files: Partial<DraftFiles>, base: GraphDataset, citable: Citable = {}): GraphDataset {
  const problems: string[] = [];
  const evidenceIds = new Set([...(base.evidence || []).map((e) => e.id), ...(citable.evidenceIds || [])]);
  const sourceIds = new Set([...(base.sources || []).map((s) => s.id), ...(citable.sourceIds || [])]);
  const cite = (ids: string[], known: Set<string>, what: string, where: string) => {
    for (const id of ids) if (!known.has(id)) problems.push(`${where} cites ${what} that does not exist: ${id}`);
    return ids;
  };

  // The vocabulary first, so nodes and edges can be checked against it.
  const types = new Map<string, NodeType>();
  for (const row of table("types.csv", files, problems)) {
    const where = `types.csv row ${row.line}`;
    if (!row.type) { problems.push(`${where} has no type.`); continue; }
    if (types.has(normalizeName(row.type))) problems.push(`${where} repeats the type ${row.type}.`);
    if (row.color && !(LOOK_COLORS as readonly string[]).includes(row.color)) problems.push(`${where} has color "${row.color}"; use one of ${LOOK_COLORS.join(", ")}, or leave it empty.`);
    if (row.shape && !(LOOK_SHAPES as readonly string[]).includes(row.shape)) problems.push(`${where} has shape "${row.shape}"; use one of ${LOOK_SHAPES.join(", ")}, or leave it empty.`);
    types.set(normalizeName(row.type), {
      name: row.type,
      ...optional("color", row.color as LookColor, Boolean(row.color)),
      ...optional("shape", row.shape as LookShape, Boolean(row.shape)),
      fields: [],
    });
  }
  for (const row of table("fields.csv", files, problems)) {
    const where = `fields.csv row ${row.line}`;
    const type = types.get(normalizeName(row.type));
    if (!type) { problems.push(`${where} names a type that is not in types.csv: ${row.type}`); continue; }
    if (!row.field) { problems.push(`${where} has no field.`); continue; }
    if (type.fields.some((f) => normalizeName(f.name) === normalizeName(row.field))) problems.push(`${where} repeats the ${row.type} field ${row.field}.`);
    if (!(VALUE_KINDS as readonly string[]).includes(row.value)) problems.push(`${where} has value "${row.value}"; use one of ${VALUE_KINDS.join(", ")}.`);
    type.fields.push({ name: row.field, value: row.value as ValueKind });
  }
  const relationships: RelationshipRule[] = [];
  for (const row of table("relationships.csv", files, problems)) {
    const where = `relationships.csv row ${row.line}`;
    if (!row.name) { problems.push(`${where} has no name.`); continue; }
    if (relationships.some((r) => normalizeName(r.name) === normalizeName(row.name))) problems.push(`${where} repeats the relationship ${row.name}.`);
    const arrangement = row.arrangement || "free";
    if (!(ARRANGEMENTS as readonly string[]).includes(arrangement)) problems.push(`${where} has arrangement "${row.arrangement}"; use one of ${ARRANGEMENTS.join(", ")}.`);
    relationships.push({ name: row.name, ...optional("reverse", row.reverse, Boolean(row.reverse)), arrangement: arrangement as Arrangement });
  }

  // A node the accepted graph already holds without a summary may keep going without one.
  const unsummarized = new Set(base.nodes.filter((n) => !n.summary?.trim()).map((n) => n.id));
  const nodes: GraphNode[] = [];
  const nodeIds = new Set<string>();
  const typeOf = new Map<string, NodeType>();
  for (const node of table("nodes.csv", files, problems)) {
    const where = `nodes.csv row ${node.line} (${node.id || "no id"})`;
    if (!node.id) { problems.push(`${where} has no id.`); continue; }
    if (nodeIds.has(node.id)) problems.push(`${where} repeats the node id ${node.id}.`);
    nodeIds.add(node.id);
    if (!node.name.trim()) problems.push(`${where} has no name.`);
    const type = types.get(normalizeName(node.type));
    if (!node.type) problems.push(`${where} has no type.`);
    else if (!type) problems.push(`${where} has type "${node.type}", which is not in types.csv.`);
    else typeOf.set(node.id, type);
    if (!node.summary.trim() && !unsummarized.has(node.id))
      problems.push(`${where} has no summary; say what is known about it and why it is on the graph.`);
    const sources = cite(splitIds(node.sources), sourceIds, "a source", where);
    const notes = splitLines(node.notes);
    nodes.push({
      id: node.id,
      name: node.name,
      type: type?.name || node.type,
      ...optional("summary", node.summary.trim(), Boolean(node.summary.trim())),
      ...optional("dates", node.dates, Boolean(node.dates)),
      ...optional("notes", notes, notes.length > 0),
      ...optional("sourceIds", sources, sources.length > 0),
    });
  }

  const claims: ResearchClaim[] = [];
  const edgeIds = new Set<string>();
  for (const edge of table("edges.csv", files, problems)) {
    const where = `edges.csv row ${edge.line} (${edge.id || "no id"})`;
    if (!edge.id) { problems.push(`${where} has no id.`); continue; }
    if (edgeIds.has(edge.id) || nodeIds.has(edge.id)) problems.push(`${where} repeats the id ${edge.id}.`);
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.from)) problems.push(`${where} starts from a node that is not in nodes.csv: ${edge.from}`);
    if (!edge.name.trim()) problems.push(`${where} has no name.`);
    if (!(qualifications as string[]).includes(edge.qualification))
      problems.push(`${where} has qualification "${edge.qualification}"; use one of ${qualifications.join(", ")}.`);
    let object: ResearchClaim["object"] = { value: edge.target };
    if (edge.targetType === "node") {
      const to = edge.target.trim();
      if (!nodeIds.has(to)) problems.push(`${where} points at a node that is not in nodes.csv: ${to}`);
      else if (to === edge.from) problems.push(`${where} points at its own starting node; remove it or point it elsewhere.`);
      object = { entityId: to };
    } else if (edge.targetType === "number") {
      if (!edge.target.trim() || !Number.isFinite(Number(edge.target))) problems.push(`${where} is marked number but its target is not one: ${edge.target}`);
      object = { value: Number(edge.target) };
    } else if (edge.targetType === "text" && typeOf.get(edge.from)?.fields.some((f) => f.value === "number" && normalizeName(f.name) === normalizeName(edge.name)))
      problems.push(`${where} fills the number field ${edge.name}, so its targetType must be number.`);
    else if (edge.targetType !== "text") problems.push(`${where} has targetType "${edge.targetType}"; use node, text or number.`);
    const evidence = roles.flatMap((role) =>
      cite(splitIds(edge[role]), evidenceIds, "evidence", where).map((ref) => ({ ref, role })),
    );
    const sources = cite(splitIds(edge.sources), sourceIds, "a source", where);
    claims.push({
      id: edge.id,
      subjectId: edge.from,
      predicate: edge.name,
      object,
      qualification: edge.qualification as ResearchClaim["qualification"],
      time: edge.time || null,
      reasoning: edge.reasoning,
      evidence,
      ...optional("sourceIds", sources, sources.length > 0),
    });
  }
  if (problems.length) throw new DraftError(problems);

  return {
    version: 3,
    title: base.title,
    initialFocusId: base.initialFocusId && nodeIds.has(base.initialFocusId) ? base.initialFocusId : null,
    nodes,
    types: [...types.values()],
    relationships,
    claims,
    ...(base.evidence ? { evidence: structuredClone(base.evidence) } : {}),
    ...(base.sources ? { sources: structuredClone(base.sources) } : {}),
  };
}
