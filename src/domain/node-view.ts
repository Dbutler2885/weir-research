// What a node's panel shows, and what a single statement's panel shows.
//
// The graph stores research as it was found: one edge per assertion, each citing
// its evidence. These views organize it for a reader: facts under the fields their
// type defines, in date order, with gaps where a field has nothing yet; connections
// grouped by how they read from this node; everything else recorded below. The
// panels only draw what these return.
import { readable } from "./graph-schema.ts";
import { claimSourceIds, GraphModel } from "./model.ts";
import type { GraphNode, LookColor, LookShape, ResearchClaim, SourceRecord } from "./types";

type Qualification = ResearchClaim["qualification"];

// One statement as a row: a fact's value or a connection's other end.
export interface StatementRow {
  claimId: string;
  label: string;
  value: string;
  // For a connection, the node at the other end.
  nodeId?: string;
  when?: string;
  // Only when the statement is not fully supported.
  qualification?: Exclude<Qualification, "supported">;
}

export interface FieldView {
  name: string;
  label: string;
  // Empty when nothing has been found yet: a gap.
  rows: StatementRow[];
}

export interface NodeView {
  id: string;
  name: string;
  type: string;
  look: { color: LookColor; shape: LookShape };
  dates?: string;
  summary?: string;
  fields: FieldView[];
  connections: StatementRow[];
  // Facts no field of the type defines.
  other: StatementRow[];
  notes: string[];
  sources: SourceRecord[];
}

export interface EvidenceView {
  id: string;
  role: "Supports" | "Challenges" | "Background";
  source?: SourceRecord;
  quote: string;
  locator: string;
  context: string;
}

// A statement in its own panel. The sentence names both ends of a connection, or
// the node and the value of a fact.
export interface StatementView {
  claimId: string;
  kind: "connection" | "fact";
  // A fact's field or label, or "Connection".
  heading: string;
  subject: { id: string; name: string };
  // The relationship's name, as it reads from the subject.
  verb: string;
  object: { id: string; name: string } | { value: string };
  when?: string;
  qualification: Qualification;
  reasoning: string;
  evidence: EvidenceView[];
  sources: SourceRecord[];
}

const qualificationOf = (claim: ResearchClaim) => (claim.qualification === "supported" ? {} : { qualification: claim.qualification });

// The first year a date mentions orders statements; undated ones come last.
const yearOf = (claim: ResearchClaim) => {
  const match = /\b(\d{3,4})\b/.exec(claim.time || "");
  return match ? Number(match[1]) : Infinity;
};
const byDate = (a: ResearchClaim, b: ResearchClaim) => yearOf(a) - yearOf(b);

const valueText = (claim: ResearchClaim) => ("value" in claim.object ? String(claim.object.value) : "");

export function nodeView(model: GraphModel, nodeId: string): NodeView {
  const node: GraphNode = model.getNode(nodeId);
  const schema = model.schema;
  const type = schema.typeOf(node);
  const facts = model.factsAbout(nodeId).sort(byDate);
  const factRow = (claim: ResearchClaim, label: string): StatementRow => ({
    claimId: claim.id,
    label,
    value: valueText(claim),
    ...(claim.time ? { when: claim.time } : {}),
    ...qualificationOf(claim),
  });

  const filed = new Set<string>();
  const fields = type.fields.map((field) => {
    const rows = facts
      .filter((claim) => schema.field(node, claim.predicate)?.name === field.name)
      .map((claim) => {
        filed.add(claim.id);
        return factRow(claim, readable(field.name));
      });
    return { name: field.name, label: readable(field.name), rows };
  });
  const other = facts
    .filter((claim) => !filed.has(claim.id))
    .map((claim) => factRow(claim, readable(claim.predicate)))
    .sort((a, b) => a.label.localeCompare(b.label));

  // Connections read from this node, grouped by that reading in the order each first appears.
  const rows = [...model.connectionsFor(nodeId)]
    .map((connection) => ({ connection, outgoing: connection.fromId === nodeId }))
    .sort((a, b) => byDate(a.connection.claim, b.connection.claim))
    .map(({ connection, outgoing }): StatementRow => {
      const other = outgoing ? connection.toId : connection.fromId;
      const claim = connection.claim;
      return {
        claimId: claim.id,
        label: schema.reading(claim.predicate, outgoing ? "source" : "target"),
        value: model.nodeName(other),
        nodeId: other,
        ...(claim.time ? { when: claim.time } : {}),
        ...qualificationOf(claim),
      };
    });
  const order = [...new Set(rows.map((row) => row.label))];
  const connections = order.flatMap((label) => rows.filter((row) => row.label === label));

  const sourceIds = new Set([
    ...(node.sourceIds || []),
    ...facts.flatMap((claim) => claimSourceIds(model.dataset, claim)),
    ...model.connectionsFor(nodeId).flatMap((c) => claimSourceIds(model.dataset, c.claim)),
  ]);
  return {
    id: node.id,
    name: node.name,
    type: type.name,
    look: schema.look(node),
    ...(node.dates ? { dates: node.dates } : {}),
    ...(node.summary?.trim() ? { summary: node.summary.trim() } : {}),
    fields,
    connections,
    other,
    notes: node.notes || [],
    sources: [...sourceIds].flatMap((id) => (model.sourcesById.has(id) ? [model.getSource(id)] : [])),
  };
}

const roleNames = { supports: "Supports", challenges: "Challenges", context: "Background" } as const;

export function statementView(model: GraphModel, claimId: string): StatementView {
  const claim = (model.dataset.claims || []).find((c) => c.id === claimId);
  if (!claim) throw new Error(`Unknown statement: ${claimId}`);
  const subject = model.getNode(claim.subjectId);
  const evidence = new Map((model.dataset.evidence || []).map((e) => [e.id, e]));
  const target = "entityId" in claim.object ? claim.object.entityId : undefined;
  const connection = target !== undefined;
  const field = connection ? undefined : model.schema.field(subject, claim.predicate);
  const cited = claim.evidence.flatMap(({ ref, role }): EvidenceView[] => {
    const record = evidence.get(ref);
    if (!record) return [];
    return [
      {
        id: ref,
        role: roleNames[role],
        ...(model.sourcesById.has(record.sourceId) ? { source: model.getSource(record.sourceId) } : {}),
        quote: record.quote,
        locator: record.locator,
        context: record.context,
      },
    ];
  });
  // Sources cited without a passage.
  const quoted = new Set(cited.map((e) => e.source?.id));
  const sources = (claim.sourceIds || []).filter((id) => !quoted.has(id) && model.sourcesById.has(id)).map((id) => model.getSource(id));
  return {
    claimId,
    kind: connection ? "connection" : "fact",
    heading: connection ? "Connection" : readable(field?.name || claim.predicate),
    subject: { id: subject.id, name: subject.name },
    verb: readable(claim.predicate).toLocaleLowerCase(),
    object: target !== undefined ? { id: target, name: model.nodeName(target) } : { value: valueText(claim) },
    ...(claim.time ? { when: claim.time } : {}),
    qualification: claim.qualification,
    reasoning: claim.reasoning,
    evidence: cited,
    sources,
  };
}
