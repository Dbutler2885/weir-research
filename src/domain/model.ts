import type {
  Confidence,
  GraphDataset,
  GraphNode,
  ParentLink,
  ResearchClaim,
  SourceRecord,
  UnionRecord,
} from "./types";
import { GraphSchema } from "./graph-schema.ts";

export const confidenceFor: Record<ResearchClaim["qualification"], Confidence> = {
  supported: "established",
  reported: "unknown",
  inferred: "probable",
  disputed: "disputed",
  unresolved: "unknown",
};

const target = (claim: ResearchClaim) => ("entityId" in claim.object ? claim.object.entityId : null);

// Every source an edge cites, directly or through its evidence.
export function claimSourceIds(dataset: GraphDataset, claim: ResearchClaim): string[] {
  const evidence = new Map((dataset.evidence ?? []).map((e) => [e.id, e.sourceId]));
  return [
    ...new Set([
      ...claim.evidence.map((e) => evidence.get(e.ref)).filter((id): id is string => Boolean(id)),
      ...(claim.sourceIds ?? []),
    ]),
  ];
}

// An edge from one node to another.
export interface Connection {
  id: string;
  fromId: string;
  toId: string;
  claim: ResearchClaim;
  arrangement: "ranked" | "paired" | "free";
  confidence: Confidence;
}

// Couples are pairs joined by a paired edge. Children with both partners recorded
// as their ranked parents hang from the couple; any other ranked edge is a direct
// parent link. A couple is identified by its first paired edge.
function familyFromClaims(dataset: GraphDataset, schema: GraphSchema): { unions: UnionRecord[]; parentLinks: ParentLink[] } {
  const claims = (dataset.claims ?? []).filter((c) => target(c) && target(c) !== c.subjectId);
  const pair = (a: string, b: string) => [a, b].sort().join("\u0000");
  const unions = new Map<string, UnionRecord>();
  for (const claim of claims.filter((c) => schema.arrangement(c) === "paired")) {
    const other = target(claim)!;
    if (unions.has(pair(claim.subjectId, other))) continue;
    unions.set(pair(claim.subjectId, other), {
      id: claim.id,
      partnerIds: [claim.subjectId, other],
      type: "marriage",
      ...(claim.time ? { date: claim.time } : {}),
      confidence: confidenceFor[claim.qualification] ?? "established",
      sourceIds: claimSourceIds(dataset, claim),
    });
  }
  const parentEdges = claims.filter((c) => schema.arrangement(c) === "ranked");
  const parentsOf = new Map<string, string[]>();
  for (const edge of parentEdges) pushToMap(parentsOf, target(edge)!, edge.subjectId);
  const parentLinks: ParentLink[] = parentEdges.map((edge) => {
    const child = target(edge)!;
    const union = (parentsOf.get(child) ?? [])
      .filter((other) => other !== edge.subjectId)
      .map((other) => unions.get(pair(edge.subjectId, other)))
      .find(Boolean);
    return {
      id: edge.id,
      parentId: edge.subjectId,
      childId: child,
      ...(union ? { unionId: union.id } : {}),
      type: schema.parentage(edge.predicate),
      confidence: confidenceFor[edge.qualification] ?? "established",
      ...(edge.reasoning ? { label: edge.reasoning.split("\n")[0] } : {}),
      sourceIds: claimSourceIds(dataset, edge),
    };
  });
  for (const link of parentLinks) {
    const union = link.unionId && [...unions.values()].find((u) => u.id === link.unionId);
    if (union && !union.childIds?.includes(link.childId)) (union.childIds ??= []).push(link.childId);
  }
  return { unions: [...unions.values()], parentLinks };
}

function assertUniqueIds(records: Array<{ id: string }>, label: string): void {
  const seen = new Set<string>();
  for (const record of records) {
    if (!record.id.trim()) throw new Error(`${label} contains a blank identifier.`);
    if (seen.has(record.id)) throw new Error(`Duplicate ${label} identifier: ${record.id}`);
    seen.add(record.id);
  }
}

function pushToMap<T>(map: Map<string, T[]>, key: string, value: T): void {
  const current = map.get(key);
  if (current) current.push(value);
  else map.set(key, [value]);
}

export class GraphModel {
  readonly dataset: GraphDataset;
  readonly schema: GraphSchema;
  readonly nodesById: ReadonlyMap<string, GraphNode>;
  readonly unionsById: ReadonlyMap<string, UnionRecord>;
  readonly sourcesById: ReadonlyMap<string, SourceRecord>;
  readonly parentLinks: readonly ParentLink[];
  readonly connections: readonly Connection[];

  private readonly unionsForNodeIndex = new Map<string, UnionRecord[]>();
  private readonly parentLinksForChildIndex = new Map<string, ParentLink[]>();
  private readonly parentLinksForParentIndex = new Map<string, ParentLink[]>();
  private readonly connectionsIndex = new Map<string, Connection[]>();

  constructor(dataset: GraphDataset) {
    this.dataset = dataset;
    this.schema = new GraphSchema(dataset);
    assertUniqueIds(dataset.nodes, "graph node");
    assertUniqueIds(dataset.sources ?? [], "source");
    this.nodesById = new Map(dataset.nodes.map((node) => [node.id, node]));
    this.sourcesById = new Map((dataset.sources ?? []).map((source) => [source.id, source]));
    this.validateDataset();

    const family = familyFromClaims(dataset, this.schema);
    this.unionsById = new Map(family.unions.map((union) => [union.id, union]));
    this.parentLinks = family.parentLinks;
    this.connections = (dataset.claims ?? [])
      .filter((claim) => target(claim))
      .map((claim) => ({
        id: claim.id,
        fromId: claim.subjectId,
        toId: target(claim)!,
        claim,
        arrangement: this.schema.arrangement(claim),
        confidence: confidenceFor[claim.qualification] ?? "unknown",
      }));
    this.buildIndexes();
  }

  get initialFocus(): GraphNode | undefined {
    const id = this.dataset.initialFocusId;
    return (id ? this.nodesById.get(id) : undefined) ?? this.dataset.nodes[0];
  }

  hasNode(id: string): boolean {
    return this.nodesById.has(id);
  }

  getNode(id: string): GraphNode {
    const node = this.nodesById.get(id);
    if (!node) throw new Error(`Unknown node: ${id}`);
    return node;
  }

  nodeName(id: string): string {
    return this.nodesById.get(id)?.name ?? id;
  }

  getUnion(unionId: string): UnionRecord {
    const union = this.unionsById.get(unionId);
    if (!union) throw new Error(`Unknown union: ${unionId}`);
    return union;
  }

  getSource(sourceId: string): SourceRecord {
    const source = this.sourcesById.get(sourceId);
    if (!source) throw new Error(`Unknown source: ${sourceId}`);
    return source;
  }

  // Parent links that are not part of a recorded couple.
  get directParentLinks(): readonly ParentLink[] {
    return this.parentLinks.filter((link) => !link.unionId);
  }

  // Edges from or to a node that point at another node.
  connectionsFor(nodeId: string): readonly Connection[] {
    this.getNode(nodeId);
    return this.connectionsIndex.get(nodeId) ?? [];
  }

  // Edges from a node to a value: the facts recorded about it.
  factsAbout(nodeId: string): ResearchClaim[] {
    return (this.dataset.claims ?? []).filter((c) => c.subjectId === nodeId && "value" in c.object);
  }

  unionsFor(nodeId: string): readonly UnionRecord[] {
    return this.unionsForNodeIndex.get(nodeId) ?? [];
  }

  parentsOf(nodeId: string): readonly ParentLink[] {
    return this.parentLinksForChildIndex.get(nodeId) ?? [];
  }

  childrenOf(nodeId: string): readonly ParentLink[] {
    return this.parentLinksForParentIndex.get(nodeId) ?? [];
  }

  // Nodes whose name, type, dates, summary or recorded facts contain the query, those
  // matching by name first.
  search(query: string): GraphNode[] {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return [];
    const matches = (text: string | undefined) => (text ?? "").toLocaleLowerCase().includes(normalized);
    const facts = (node: GraphNode) => this.factsAbout(node.id).map((c) => ("value" in c.object ? String(c.object.value) : ""));
    return this.dataset.nodes
      .filter((node) => [node.name, node.type, node.dates, node.summary, ...facts(node)].some(matches))
      .sort((a, b) => Number(!matches(a.name)) - Number(!matches(b.name)) || a.name.localeCompare(b.name));
  }

  private validateDataset(): void {
    if (this.dataset.version !== 3) throw new Error(`Unsupported dataset version: ${this.dataset.version}`);
    if (this.dataset.initialFocusId !== null && !this.hasNode(this.dataset.initialFocusId))
      throw new Error(`Initial focus references unknown node: ${this.dataset.initialFocusId}`);
    for (const node of this.dataset.nodes) {
      if (!node.type?.trim()) throw new Error(`Node ${node.id} has no type.`);
      this.validateSourceIds(node.sourceIds ?? [], `node ${node.id}`);
    }
    assertUniqueIds(this.dataset.claims ?? [], "claim");
    assertUniqueIds(this.dataset.evidence ?? [], "evidence");
    const evidenceIds = new Set((this.dataset.evidence ?? []).map((e) => e.id));
    for (const evidence of this.dataset.evidence ?? []) this.validateSourceIds([evidence.sourceId], `evidence ${evidence.id}`);
    for (const claim of this.dataset.claims ?? []) {
      if (!this.hasNode(claim.subjectId) || ("entityId" in claim.object && !this.hasNode(claim.object.entityId)))
        throw new Error(`Claim ${claim.id} references an unknown node.`);
      if ("entityId" in claim.object && claim.object.entityId === claim.subjectId) throw new Error(`Claim ${claim.id} points at its own subject.`);
      if (claim.evidence.some((e) => !evidenceIds.has(e.ref))) throw new Error(`Claim ${claim.id} references unknown evidence.`);
      this.validateSourceIds(claim.sourceIds ?? [], `claim ${claim.id}`);
    }
  }

  private validateSourceIds(sourceIds: string[], owner: string): void {
    for (const sourceId of sourceIds)
      if (!this.sourcesById.has(sourceId)) throw new Error(`${owner} references unknown source: ${sourceId}`);
  }

  private buildIndexes(): void {
    for (const union of this.unionsById.values())
      for (const partnerId of union.partnerIds) pushToMap(this.unionsForNodeIndex, partnerId, union);
    for (const link of this.parentLinks) {
      pushToMap(this.parentLinksForChildIndex, link.childId, link);
      pushToMap(this.parentLinksForParentIndex, link.parentId, link);
    }
    for (const connection of this.connections) {
      pushToMap(this.connectionsIndex, connection.fromId, connection);
      pushToMap(this.connectionsIndex, connection.toId, connection);
    }
  }
}
