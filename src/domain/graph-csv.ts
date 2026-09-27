// The graph as two editable tables: nodes and edges.
//
// A builder receives a copy of these files, edits them freely, and hands them back.
// Adding a record is a new row, merging two nodes is deleting one row and repointing
// the edges that named it, and removing a record is a row that is not there. Nothing
// needs a vocabulary for deletion because nothing is expressed as a difference.
//
// Evidence and sources are not in the tables. A builder cites them by identifier,
// and the reader checks every citation against the records it is allowed to cite.
import type { ContextEntityKind, ContextEntityRecord, FamilyDataset, PersonRecord, ResearchClaim } from "./types";

export const draftTables = ["nodes.csv", "edges.csv"] as const;
export type DraftTable = (typeof draftTables)[number];
export type DraftFiles = Record<DraftTable, string>;

const headers = {
  "nodes.csv": ["id", "kind", "name", "descriptor", "biography", "dates", "born", "died", "alternateNames", "notes", "sources"],
  "edges.csv": ["id", "from", "name", "targetType", "target", "qualification", "time", "reasoning", "supports", "challenges", "context", "sources"],
} as const satisfies Record<DraftTable, readonly string[]>;

type RowOf<N extends DraftTable> = { [K in (typeof headers)[N][number]]: string };

const entityKinds: ContextEntityKind[] = ["facility", "observation", "organization", "family", "place", "vessel", "event"];
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

const prose = new Set(["name", "descriptor", "biography", "dates", "born", "died", "alternateNames", "notes", "time", "reasoning", "target"]);

const optional = <K extends string, V>(key: K, value: V | undefined, keep: boolean) =>
  (keep ? { [key]: value } : {}) as Partial<Record<K, V>>;

export function graphToTables(dataset: FamilyDataset): DraftFiles {
  const people = dataset.people.map((p) => [
    p.id, "person", p.name, p.descriptor, p.biography, p.lifespan, p.born, p.died, joinLines(p.alternateNames), joinLines(p.researchNotes), joinIds(p.sourceIds),
  ]);
  const entities = (dataset.contextEntities || []).map((e) => [
    e.id, e.kind, e.name, e.descriptor, e.biography, e.activeDates, "", "", "", "", joinIds(e.sourceIds),
  ]);
  const edges = (dataset.claims || []).map((c) => {
    const target = "entityId" in c.object ? c.object.entityId : c.object.value;
    const type = "entityId" in c.object ? "node" : typeof c.object.value === "number" ? "number" : "text";
    const cited = (role: (typeof roles)[number]) => joinIds(c.evidence.filter((e) => e.role === role).map((e) => e.ref));
    return [c.id, c.subjectId, c.predicate, type, target, c.qualification, c.time, c.reasoning, cited("supports"), cited("challenges"), cited("context"), joinIds(c.sourceIds)];
  });
  return { "nodes.csv": file("nodes.csv", [...people, ...entities]), "edges.csv": file("edges.csv", edges) };
}

// Records a draft may cite beyond those the graph already holds: the evidence
// registry and source library of the research it represents.
export interface Citable {
  evidenceIds?: Iterable<string>;
  sourceIds?: Iterable<string>;
}

// Read a builder's tables back into a graph. The accepted graph supplies what the
// builder does not edit: the title, the starting focus, evidence and sources.
export function graphFromTables(files: Partial<DraftFiles>, base: FamilyDataset, citable: Citable = {}): FamilyDataset {
  const problems: string[] = [];
  const evidenceIds = new Set([...(base.evidence || []).map((e) => e.id), ...(citable.evidenceIds || [])]);
  const sourceIds = new Set([...(base.sources || []).map((s) => s.id), ...(citable.sourceIds || [])]);
  const cite = (ids: string[], known: Set<string>, what: string, where: string) => {
    for (const id of ids) if (!known.has(id)) problems.push(`${where} cites ${what} that does not exist: ${id}`);
    return ids;
  };

  const people: PersonRecord[] = [];
  const contextEntities: ContextEntityRecord[] = [];
  const nodeIds = new Set<string>();
  for (const node of table("nodes.csv", files, problems)) {
    const where = `nodes.csv row ${node.line} (${node.id || "no id"})`;
    if (!node.id) { problems.push(`${where} has no id.`); continue; }
    if (nodeIds.has(node.id)) problems.push(`${where} repeats the node id ${node.id}.`);
    nodeIds.add(node.id);
    if (!node.name.trim()) problems.push(`${where} has no name.`);
    const sources = cite(splitIds(node.sources), sourceIds, "a source", where);
    const shared = {
      id: node.id,
      name: node.name,
      ...optional("descriptor", node.descriptor, Boolean(node.descriptor)),
      ...optional("biography", node.biography, Boolean(node.biography)),
      ...optional("sourceIds", sources, sources.length > 0),
    };
    if (node.kind === "person") {
      const names = splitLines(node.alternateNames);
      const notes = splitLines(node.notes);
      people.push({
        ...shared,
        ...optional("lifespan", node.dates, Boolean(node.dates)),
        ...optional("born", node.born, Boolean(node.born)),
        ...optional("died", node.died, Boolean(node.died)),
        ...optional("alternateNames", names, names.length > 0),
        ...optional("researchNotes", notes, notes.length > 0),
      });
    } else if ((entityKinds as string[]).includes(node.kind)) {
      for (const column of ["born", "died", "alternateNames", "notes"] as const)
        if (node[column]) problems.push(`${where} fills ${column}, which only applies to a person.`);
      contextEntities.push({ ...shared, kind: node.kind as ContextEntityKind, ...optional("activeDates", node.dates, Boolean(node.dates)) });
    } else problems.push(`${where} has kind "${node.kind}"; use person or one of ${entityKinds.join(", ")}.`);
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
    } else if (edge.targetType !== "text") problems.push(`${where} has targetType "${edge.targetType}"; use node, text or number.`);
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
    version: 2,
    title: base.title,
    initialFocusId: base.initialFocusId && nodeIds.has(base.initialFocusId) ? base.initialFocusId : null,
    people,
    contextEntities,
    claims,
    ...(base.evidence ? { evidence: structuredClone(base.evidence) } : {}),
    ...(base.sources ? { sources: structuredClone(base.sources) } : {}),
  };
}
