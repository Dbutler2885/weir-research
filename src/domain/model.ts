import type {
  Confidence,
  ContextConnectionRecord,
  ContextConnectionType,
  ContextEntityRecord,
  FamilyDataset,
  ParentLink,
  PersonRecord,
  RelationshipNeighbor,
  ResearchClaim,
  SourceRecord,
  UnionRecord,
} from "./types";
import { isCoupleEdge, isFamilyEdge, parentEdgeType } from "./family-edges.ts";

const DEFAULT_CONFIDENCE: Confidence = "established";

export const confidenceFor: Record<ResearchClaim["qualification"], Confidence> = {
  supported: "established",
  reported: "unknown",
  inferred: "probable",
  disputed: "disputed",
  unresolved: "unknown",
};

// Display grouping for a few common edge names. Any other name is an association.
const connectionTypes: Record<string, ContextConnectionType> = {
  located_in: "location",
  built_at: "location",
  established: "founding",
  built: "founding",
  operated: "management",
  partner_in: "partnership",
};

const target = (claim: ResearchClaim) => ("entityId" in claim.object ? claim.object.entityId : null);

// Every source an edge cites, directly or through its evidence.
export function claimSourceIds(dataset: FamilyDataset, claim: ResearchClaim): string[] {
  const evidence = new Map((dataset.evidence ?? []).map((e) => [e.id, e.sourceId]));
  return [
    ...new Set([
      ...claim.evidence.map((e) => evidence.get(e.ref)).filter((id): id is string => Boolean(id)),
      ...(claim.sourceIds ?? []),
    ]),
  ];
}

// Relationships drawn between nodes, rebuilt from the edges that point at nodes.
export function connectionsFromClaims(dataset: FamilyDataset): ContextConnectionRecord[] {
  return (dataset.claims ?? [])
    .filter((claim) => target(claim) && !isFamilyEdge(claim))
    .map((claim) => ({
      id: claim.id,
      fromId: claim.subjectId,
      toId: target(claim)!,
      type: connectionTypes[claim.predicate] ?? "association",
      label: claim.predicate.replaceAll("_", " "),
      ...(claim.time ? { date: claim.time } : {}),
      confidence: confidenceFor[claim.qualification] ?? "unknown",
      qualification: claim.qualification,
      sourceIds: claimSourceIds(dataset, claim),
    }));
}

// Couples, and the children both partners are recorded as parents of, grouped for
// the family layout. A couple is identified by its first couple edge.
function familyFromClaims(dataset: FamilyDataset): { unions: UnionRecord[]; parentLinks: ParentLink[] } {
  const claims = (dataset.claims ?? []).filter((c) => target(c));
  const pair = (a: string, b: string) => [a, b].sort().join("\u0000");
  const unions = new Map<string, UnionRecord>();
  for (const claim of claims.filter((c) => isCoupleEdge(c.predicate))) {
    const other = target(claim)!;
    if (other === claim.subjectId || unions.has(pair(claim.subjectId, other))) continue;
    unions.set(pair(claim.subjectId, other), {
      id: claim.id,
      partnerIds: [claim.subjectId, other],
      type: "marriage",
      ...(claim.time ? { date: claim.time } : {}),
      confidence: confidenceFor[claim.qualification] ?? DEFAULT_CONFIDENCE,
      sourceIds: claimSourceIds(dataset, claim),
    });
  }
  const parentEdges = claims.filter((c) => parentEdgeType(c.predicate) && target(c) !== c.subjectId);
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
      type: parentEdgeType(edge.predicate)!,
      confidence: confidenceFor[edge.qualification] ?? DEFAULT_CONFIDENCE,
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
    if (!record.id.trim()) {
      throw new Error(`${label} contains a blank identifier.`);
    }

    if (seen.has(record.id)) {
      throw new Error(`Duplicate ${label} identifier: ${record.id}`);
    }

    seen.add(record.id);
  }
}

function pushToMap<T>(map: Map<string, T[]>, key: string, value: T): void {
  const current = map.get(key);
  if (current) {
    current.push(value);
  } else {
    map.set(key, [value]);
  }
}

export class GenealogyModel {
  readonly dataset: FamilyDataset;
  readonly peopleById: ReadonlyMap<string, PersonRecord>;
  readonly unionsById: ReadonlyMap<string, UnionRecord>;
  readonly contextEntitiesById: ReadonlyMap<string, ContextEntityRecord>;
  readonly sourcesById: ReadonlyMap<string, SourceRecord>;
  readonly parentLinks: readonly ParentLink[];
  readonly contextConnections: readonly ContextConnectionRecord[];

  private readonly unionsForPersonIndex = new Map<string, UnionRecord[]>();
  private readonly parentLinksForChildIndex = new Map<string, ParentLink[]>();
  private readonly parentLinksForParentIndex = new Map<string, ParentLink[]>();
  private readonly contextConnectionsIndex = new Map<
    string,
    ContextConnectionRecord[]
  >();

  constructor(dataset: FamilyDataset) {
    this.dataset = dataset;
    assertUniqueIds(dataset.people, "person");
    assertUniqueIds(dataset.contextEntities ?? [], "context entity");
    assertUniqueIds(dataset.sources ?? [], "source");

    this.peopleById = new Map(
      dataset.people.map((person) => [person.id, person]),
    );
    const family = familyFromClaims(dataset);
    this.unionsById = new Map(family.unions.map((union) => [union.id, union]));
    this.contextConnections = connectionsFromClaims(dataset);
    this.contextEntitiesById = new Map(
      (dataset.contextEntities ?? []).map((entity) => [entity.id, entity]),
    );
    this.sourcesById = new Map(
      (dataset.sources ?? []).map((source) => [source.id, source]),
    );

    this.validateDataset();
    this.parentLinks = family.parentLinks;
    this.buildIndexes();
  }

  get initialFocus(): PersonRecord | ContextEntityRecord | undefined {
    const id = this.dataset.initialFocusId;
    return (
      (id
        ? (this.peopleById.get(id) ?? this.contextEntitiesById.get(id))
        : undefined) ??
      this.dataset.people[0] ??
      this.dataset.contextEntities?.[0]
    );
  }

  hasNode(id: string): boolean {
    return this.peopleById.has(id) || this.contextEntitiesById.has(id);
  }

  getPerson(personId: string): PersonRecord {
    const person = this.peopleById.get(personId);
    if (!person) {
      throw new Error(`Unknown person: ${personId}`);
    }
    return person;
  }

  // Parent links that are not part of a recorded couple.
  get directParentLinks(): readonly ParentLink[] {
    return this.parentLinks.filter((link) => !link.unionId);
  }

  getUnion(unionId: string): UnionRecord {
    const union = this.unionsById.get(unionId);
    if (!union) {
      throw new Error(`Unknown union: ${unionId}`);
    }
    return union;
  }

  getSource(sourceId: string): SourceRecord {
    const source = this.sourcesById.get(sourceId);
    if (!source) {
      throw new Error(`Unknown source: ${sourceId}`);
    }
    return source;
  }

  getContextEntity(entityId: string): ContextEntityRecord {
    const entity = this.contextEntitiesById.get(entityId);
    if (!entity) {
      throw new Error(`Unknown context entity: ${entityId}`);
    }
    return entity;
  }

  contextConnectionsFor(nodeId: string): readonly ContextConnectionRecord[] {
    if (!this.peopleById.has(nodeId) && !this.contextEntitiesById.has(nodeId)) {
      throw new Error(`Unknown context connection endpoint: ${nodeId}`);
    }
    return this.contextConnectionsIndex.get(nodeId) ?? [];
  }

  contextConnectionsForPerson(
    personId: string,
  ): readonly ContextConnectionRecord[] {
    this.getPerson(personId);
    return this.contextConnectionsFor(personId);
  }

  contextConnectionsForEntity(
    entityId: string,
  ): readonly ContextConnectionRecord[] {
    this.getContextEntity(entityId);
    return this.contextConnectionsFor(entityId);
  }

  contextNodeName(nodeId: string): string {
    return (
      this.peopleById.get(nodeId)?.name ??
      this.contextEntitiesById.get(nodeId)?.name ??
      nodeId
    );
  }

  unionsForPerson(personId: string): readonly UnionRecord[] {
    this.getPerson(personId);
    return this.unionsForPersonIndex.get(personId) ?? [];
  }

  parentsOf(personId: string): readonly ParentLink[] {
    this.getPerson(personId);
    return this.parentLinksForChildIndex.get(personId) ?? [];
  }

  childrenOf(personId: string): readonly ParentLink[] {
    this.getPerson(personId);
    return this.parentLinksForParentIndex.get(personId) ?? [];
  }

  spousesOf(personId: string): PersonRecord[] {
    const spouseIds = new Set<string>();
    for (const union of this.unionsForPerson(personId)) {
      for (const partnerId of union.partnerIds) {
        if (partnerId !== personId) {
          spouseIds.add(partnerId);
        }
      }
    }
    return [...spouseIds].map((id) => this.getPerson(id));
  }

  siblingsOf(personId: string): PersonRecord[] {
    const siblingIds = new Set<string>();
    for (const parent of this.parentsOf(personId)) {
      for (const siblingLink of this.childrenOf(parent.parentId)) {
        if (siblingLink.childId !== personId) {
          siblingIds.add(siblingLink.childId);
        }
      }
    }
    return [...siblingIds].map((id) => this.getPerson(id));
  }

  neighborsOf(personId: string): RelationshipNeighbor[] {
    const neighbors = new Map<string, RelationshipNeighbor>();
    const setNeighbor = (neighbor: RelationshipNeighbor): void => {
      const key = `${neighbor.kind}:${neighbor.personId}`;
      const existing = neighbors.get(key);
      if (
        !existing ||
        this.confidenceRank(neighbor.confidence) >
          this.confidenceRank(existing.confidence)
      ) {
        neighbors.set(key, neighbor);
      }
    };

    for (const link of this.parentsOf(personId)) {
      setNeighbor({
        personId: link.parentId,
        kind: "parent",
        confidence: link.confidence,
        throughId: link.unionId,
      });
    }

    for (const link of this.childrenOf(personId)) {
      setNeighbor({
        personId: link.childId,
        kind: "child",
        confidence: link.confidence,
        throughId: link.unionId,
      });
    }

    for (const union of this.unionsForPerson(personId)) {
      for (const partnerId of union.partnerIds) {
        if (partnerId !== personId) {
          setNeighbor({
            personId: partnerId,
            kind: "spouse",
            confidence: union.confidence ?? DEFAULT_CONFIDENCE,
            throughId: union.id,
          });
        }
      }
    }

    for (const sibling of this.siblingsOf(personId)) {
      setNeighbor({
        personId: sibling.id,
        kind: "sibling",
        confidence: DEFAULT_CONFIDENCE,
      });
    }

    return [...neighbors.values()];
  }

  search(query: string): PersonRecord[] {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) {
      return [];
    }

    return this.dataset.people
      .filter((person) => {
        const haystack = [
          person.name,
          ...(person.alternateNames ?? []),
          person.lifespan ?? "",
          person.descriptor ?? "",
        ]
          .join(" ")
          .toLocaleLowerCase();
        return haystack.includes(normalized);
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  searchContext(query: string): ContextEntityRecord[] {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) {
      return [];
    }

    return [...this.contextEntitiesById.values()]
      .filter((entity) => {
        const haystack = [
          entity.name,
          entity.kind,
          entity.activeDates ?? "",
          entity.descriptor ?? "",
        ]
          .join(" ")
          .toLocaleLowerCase();
        return haystack.includes(normalized);
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private validateDataset(): void {
    if (this.dataset.version !== 2) {
      throw new Error(`Unsupported dataset version: ${this.dataset.version}`);
    }

    assertUniqueIds(
      [...this.dataset.people, ...(this.dataset.contextEntities ?? [])],
      "graph node",
    );
    if (
      this.dataset.initialFocusId !== null &&
      !this.hasNode(this.dataset.initialFocusId)
    ) {
      throw new Error(
        `Initial focus references unknown node: ${this.dataset.initialFocusId}`,
      );
    }

    for (const node of [...this.dataset.people, ...(this.dataset.contextEntities ?? [])]) {
      this.validateSourceIds(node.sourceIds ?? [], `node ${node.id}`);
    }

    assertUniqueIds(this.dataset.claims ?? [], "claim");
    assertUniqueIds(this.dataset.evidence ?? [], "evidence");
    const evidenceIds = new Set((this.dataset.evidence ?? []).map(e => e.id));
    for (const evidence of this.dataset.evidence ?? []) this.validateSourceIds([evidence.sourceId], `evidence ${evidence.id}`);
    for (const claim of this.dataset.claims ?? []) {
      if (!this.hasNode(claim.subjectId) || ("entityId" in claim.object && !this.hasNode(claim.object.entityId))) throw new Error(`Claim ${claim.id} references an unknown node.`);
      if ("entityId" in claim.object && claim.object.entityId === claim.subjectId) throw new Error(`Claim ${claim.id} points at its own subject.`);
      if (claim.evidence.some(e => !evidenceIds.has(e.ref))) throw new Error(`Claim ${claim.id} references unknown evidence.`);
      this.validateSourceIds(claim.sourceIds ?? [], `claim ${claim.id}`);
    }
  }

  private isContextEndpoint(nodeId: string): boolean {
    return this.peopleById.has(nodeId) || this.contextEntitiesById.has(nodeId);
  }

  private validateSourceIds(sourceIds: string[], owner: string): void {
    for (const sourceId of sourceIds) {
      if (!this.sourcesById.has(sourceId)) {
        throw new Error(`${owner} references unknown source: ${sourceId}`);
      }
    }
  }

  private buildIndexes(): void {
    for (const union of this.unionsById.values()) {
      for (const partnerId of union.partnerIds) {
        pushToMap(this.unionsForPersonIndex, partnerId, union);
      }
    }

    for (const link of this.parentLinks) {
      pushToMap(this.parentLinksForChildIndex, link.childId, link);
      pushToMap(this.parentLinksForParentIndex, link.parentId, link);
    }

    for (const connection of this.contextConnections) {
      pushToMap(this.contextConnectionsIndex, connection.fromId, connection);
      pushToMap(this.contextConnectionsIndex, connection.toId, connection);
    }
  }

  private confidenceRank(confidence: Confidence): number {
    return {
      unknown: 0,
      disputed: 1,
      probable: 2,
      established: 3,
    }[confidence];
  }
}
