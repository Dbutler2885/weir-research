// The graph as editable tables.
//
// A builder receives a copy of these files, edits them freely, and the accepted copy
// replaces the graph. Adding a record is a new row, merging two records is two rows
// becoming one, and removing a record is a row that is not there. Nothing needs a
// vocabulary for deletion because nothing is expressed as a difference.
//
// Relationship rows are not stored: every relationship is a claim whose object is
// another node, so they are rebuilt on read and cannot drift from the claims.
import type {
  FamilyDataset,
  ResearchClaim,
  ResearchEvidence,
  SourceRecord,
  ContextEntityRecord,
  PersonRecord,
} from "./types";

export const graphTables = [
  "graph.csv",
  "nodes.csv",
  "node-sources.csv",
  "claims.csv",
  "claim-evidence.csv",
  "evidence.csv",
  "sources.csv",
] as const;
export type GraphTable = (typeof graphTables)[number];
export type GraphFiles = Record<GraphTable, string>;

const headers = {
  "graph.csv": ["version", "title", "initialFocusId"],
  "nodes.csv": ["id", "kind", "name"],
  "node-sources.csv": ["nodeId", "sourceId"],
  "claims.csv": ["id", "subjectId", "predicate", "objectType", "objectValue", "qualification", "time", "reasoning"],
  "claim-evidence.csv": ["claimId", "evidenceRef", "role"],
  "evidence.csv": ["id", "sourceId", "locator", "quote", "context", "interpretation", "stance"],
  "sources.csv": ["id", "title", "author", "repository", "date", "url", "access", "accessedAt", "note", "originalSourceId"],
} as const satisfies Record<GraphTable, readonly string[]>;

// Rows carry exactly the columns their header names, so a field read is a string.
type RowOf<N extends GraphTable> = { [K in (typeof headers)[N][number]]: string };

const cell = (value: unknown): string => {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const row = (values: unknown[]): string => values.map(cell).join(",");

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
  if (quoted) throw new Error("Unterminated quoted field.");
  if (field.length || record.length) { record.push(field); rows.push(record); }
  return rows;
}

function table<N extends GraphTable>(name: N, files: Partial<GraphFiles>): RowOf<N>[] {
  const text = files[name];
  if (text === undefined) throw new Error(`Missing ${name}`);
  const rows = parseCsv(text);
  const header = rows.shift();
  const expected: readonly string[] = headers[name];
  if (!header || header.length !== expected.length || header.some((h, i) => h !== expected[i]))
    throw new Error(`${name}: expected header ${expected.join(",")}`);
  return rows
    .filter((r) => r.some((value) => value.length))
    .map((r) => {
      if (r.length !== expected.length) throw new Error(`${name}: row has the wrong number of columns`);
      return Object.fromEntries(expected.map((key, i) => [key, r[i] ?? ""])) as RowOf<N>;
    });
}

const blank = (value: string) => (value.length ? value : undefined);

export function graphToCsv(dataset: FamilyDataset): GraphFiles {
  const nodes = [
    ...dataset.people.map((p) => ({ id: p.id, kind: "person", name: p.name, sourceIds: p.sourceIds })),
    ...(dataset.contextEntities || []).map((e) => ({ id: e.id, kind: e.kind, name: e.name, sourceIds: e.sourceIds })),
  ];
  const claims = dataset.claims || [];
  return {
    "graph.csv": [row([...headers["graph.csv"]]), row([dataset.version, dataset.title, dataset.initialFocusId])].join("\n") + "\n",
    "nodes.csv": [row([...headers["nodes.csv"]]), ...nodes.map((n) => row([n.id, n.kind, n.name]))].join("\n") + "\n",
    "node-sources.csv":
      [row([...headers["node-sources.csv"]]), ...nodes.flatMap((n) => (n.sourceIds || []).map((s) => row([n.id, s])))].join("\n") + "\n",
    "claims.csv":
      [
        row([...headers["claims.csv"]]),
        ...claims.map((c) =>
          row([
            c.id,
            c.subjectId,
            c.predicate,
            "entityId" in c.object ? "entity" : "value",
            "entityId" in c.object ? c.object.entityId : c.object.value,
            c.qualification,
            c.time,
            c.reasoning,
          ]),
        ),
      ].join("\n") + "\n",
    "claim-evidence.csv":
      [
        row([...headers["claim-evidence.csv"]]),
        ...claims.flatMap((c) => (c.evidence || []).map((e) => row([c.id, e.ref, e.role]))),
      ].join("\n") + "\n",
    "evidence.csv":
      [
        row([...headers["evidence.csv"]]),
        ...(dataset.evidence || []).map((e) =>
          row([e.id, e.sourceId, e.locator, e.quote, e.context, e.interpretation, (e as { stance?: string }).stance]),
        ),
      ].join("\n") + "\n",
    "sources.csv":
      [
        row([...headers["sources.csv"]]),
        ...(dataset.sources || []).map((s) =>
          row([s.id, s.title, (s as { author?: string }).author, s.repository, s.date, s.url, s.access, s.accessedAt, s.note, s.originalSourceId]),
        ),
      ].join("\n") + "\n",
  };
}

const connectionTypes: Record<string, string> = {
  located_in: "location",
  built_at: "location",
  established: "founding",
  built: "founding",
  operated: "management",
  partner_in: "partnership",
};
const confidenceFor: Record<string, string> = {
  supported: "established",
  reported: "unknown",
  inferred: "probable",
  disputed: "disputed",
  unresolved: "unknown",
};

export function graphFromCsv(files: Partial<GraphFiles>): FamilyDataset {
  const [meta] = table("graph.csv", files);
  if (!meta || table("graph.csv", files).length !== 1) throw new Error("graph.csv must have exactly one row");
  const nodeSources = new Map<string, string[]>();
  for (const link of table("node-sources.csv", files))
    nodeSources.set(link.nodeId, [...(nodeSources.get(link.nodeId) || []), link.sourceId]);

  const people: PersonRecord[] = [];
  const contextEntities: ContextEntityRecord[] = [];
  const seen = new Set<string>();
  for (const node of table("nodes.csv", files)) {
    if (seen.has(node.id)) throw new Error(`Duplicate node: ${node.id}`);
    seen.add(node.id);
    const record = { id: node.id, name: node.name, sourceIds: nodeSources.get(node.id) || [] };
    if (node.kind === "person") people.push(record as PersonRecord);
    else contextEntities.push({ ...record, kind: node.kind } as ContextEntityRecord);
  }
  for (const id of nodeSources.keys()) if (!seen.has(id)) throw new Error(`node-sources.csv names a node that is not there: ${id}`);

  const links = new Map<string, { ref: string; role: string }[]>();
  for (const link of table("claim-evidence.csv", files))
    links.set(link.claimId, [...(links.get(link.claimId) || []), { ref: link.evidenceRef, role: link.role }]);

  const claims: ResearchClaim[] = [];
  const claimIds = new Set<string>();
  for (const claim of table("claims.csv", files)) {
    if (claimIds.has(claim.id)) throw new Error(`Duplicate claim: ${claim.id}`);
    claimIds.add(claim.id);
    if (!seen.has(claim.subjectId)) throw new Error(`Claim ${claim.id} has an unknown subject: ${claim.subjectId}`);
    if (claim.objectType !== "entity" && claim.objectType !== "value")
      throw new Error(`Claim ${claim.id} needs an objectType of entity or value`);
    if (claim.objectType === "entity" && !seen.has(claim.objectValue))
      throw new Error(`Claim ${claim.id} points at an unknown node: ${claim.objectValue}`);
    claims.push({
      id: claim.id,
      subjectId: claim.subjectId,
      predicate: claim.predicate,
      object: claim.objectType === "entity" ? { entityId: claim.objectValue } : { value: claim.objectValue },
      qualification: claim.qualification,
      time: claim.time.length ? claim.time : null,
      reasoning: claim.reasoning,
      evidence: links.get(claim.id) || [],
    } as ResearchClaim);
  }
  for (const id of links.keys()) if (!claimIds.has(id)) throw new Error(`claim-evidence.csv names a claim that is not there: ${id}`);

  const evidence: ResearchEvidence[] = table("evidence.csv", files).map((e) => ({
    id: e.id,
    sourceId: e.sourceId,
    locator: e.locator,
    quote: e.quote,
    context: e.context,
    interpretation: e.interpretation,
    ...(e.stance.length ? { stance: e.stance } : {}),
  })) as ResearchEvidence[];

  const sources: SourceRecord[] = table("sources.csv", files).map((s) => ({
    id: s.id,
    title: s.title,
    ...(blank(s.author) ? { author: s.author } : {}),
    ...(blank(s.repository) ? { repository: s.repository } : {}),
    ...(blank(s.date) ? { date: s.date } : {}),
    ...(blank(s.url) ? { url: s.url } : {}),
    ...(blank(s.access) ? { access: s.access } : {}),
    ...(blank(s.accessedAt) ? { accessedAt: s.accessedAt } : {}),
    ...(blank(s.note) ? { note: s.note } : {}),
    ...(blank(s.originalSourceId) ? { originalSourceId: s.originalSourceId } : {}),
  })) as SourceRecord[];

  const sourceIds = new Set(sources.map((s) => s.id));
  for (const record of evidence)
    if (!sourceIds.has(record.sourceId)) throw new Error(`Evidence ${record.id} names a source that is not there: ${record.sourceId}`);

  // Relationships follow from the claims rather than being stored beside them.
  const contextConnections = claims
    .filter((c) => "entityId" in c.object)
    .map((c) => {
      const to = (c.object as { entityId: string }).entityId;
      const refs = (c.evidence || []).map((e) => e.ref);
      const ids = [...new Set(refs.map((ref) => evidence.find((e) => e.id === ref)?.sourceId).filter(Boolean))] as string[];
      return {
        id: c.id,
        fromId: c.subjectId,
        toId: to,
        type: connectionTypes[c.predicate] || "association",
        label: c.predicate.replaceAll("_", " "),
        ...(c.time ? { date: c.time } : {}),
        confidence: confidenceFor[c.qualification] || "unknown",
        qualification: c.qualification,
        sourceIds: ids,
      };
    });

  return {
    version: Number(meta.version),
    title: meta.title,
    initialFocusId: blank(meta.initialFocusId) ?? null,
    people,
    unions: [],
    directParentage: [],
    contextEntities,
    contextConnections,
    sources,
    claims,
    evidence,
  } as FamilyDataset;
}
