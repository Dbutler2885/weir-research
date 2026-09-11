import type {
  Confidence,
  ContextConnectionRecord,
  ContextEntityRecord,
  FamilyDataset,
  ParentLink,
  PersonRecord,
  RelationshipNeighbor,
  SourceRecord,
  UnionRecord,
} from "./types";

const DEFAULT_CONFIDENCE: Confidence = "established";

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
    assertUniqueIds(dataset.unions, "union");
    assertUniqueIds(dataset.directParentage ?? [], "direct parentage");
    assertUniqueIds(dataset.contextEntities ?? [], "context entity");
    assertUniqueIds(dataset.contextConnections ?? [], "context connection");
    assertUniqueIds(dataset.sources ?? [], "source");

    this.peopleById = new Map(
      dataset.people.map((person) => [person.id, person]),
    );
    this.unionsById = new Map(dataset.unions.map((union) => [union.id, union]));
    this.contextEntitiesById = new Map(
      (dataset.contextEntities ?? []).map((entity) => [entity.id, entity]),
    );
    this.sourcesById = new Map(
      (dataset.sources ?? []).map((source) => [source.id, source]),
    );

    this.validateDataset();
    this.parentLinks = this.buildParentLinks();
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
    if (this.dataset.version !== 1) {
      throw new Error(`Unsupported dataset version: ${this.dataset.version}`);
    }

    assertUniqueIds(
      [
        ...this.dataset.people,
        ...this.dataset.unions,
        ...(this.dataset.contextEntities ?? []),
      ],
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

    for (const person of this.dataset.people) {
      this.validateSourceIds(person.sourceIds ?? [], `person ${person.id}`);
    }

    for (const union of this.dataset.unions) {
      if (union.partnerIds.length === 0) {
        throw new Error(`Union ${union.id} has no partners.`);
      }
      if (new Set(union.partnerIds).size !== union.partnerIds.length) {
        throw new Error(`Union ${union.id} contains a duplicate partner.`);
      }
      for (const personId of [...union.partnerIds, ...(union.childIds ?? [])]) {
        if (!this.peopleById.has(personId)) {
          throw new Error(
            `Union ${union.id} references unknown person: ${personId}`,
          );
        }
      }
      for (const childId of union.childIds ?? []) {
        if (union.partnerIds.includes(childId)) {
          throw new Error(
            `Union ${union.id} lists a partner as a child: ${childId}`,
          );
        }
      }
      this.validateSourceIds(union.sourceIds ?? [], `union ${union.id}`);
    }

    for (const link of this.dataset.directParentage ?? []) {
      if (!this.peopleById.has(link.parentId)) {
        throw new Error(
          `Direct parentage ${link.id} references unknown parent: ${link.parentId}`,
        );
      }
      if (!this.peopleById.has(link.childId)) {
        throw new Error(
          `Direct parentage ${link.id} references unknown child: ${link.childId}`,
        );
      }
      if (link.parentId === link.childId) {
        throw new Error(`Direct parentage ${link.id} is self-referential.`);
      }
      this.validateSourceIds(
        link.sourceIds ?? [],
        `direct parentage ${link.id}`,
      );
    }

    for (const entity of this.dataset.contextEntities ?? []) {
      this.validateSourceIds(
        entity.sourceIds ?? [],
        `context entity ${entity.id}`,
      );
    }

    for (const connection of this.dataset.contextConnections ?? []) {
      if (!this.isContextEndpoint(connection.fromId)) {
        throw new Error(
          `Context connection ${connection.id} references unknown endpoint: ${connection.fromId}`,
        );
      }
      if (!this.isContextEndpoint(connection.toId)) {
        throw new Error(
          `Context connection ${connection.id} references unknown endpoint: ${connection.toId}`,
        );
      }
      if (connection.fromId === connection.toId) {
        throw new Error(
          `Context connection ${connection.id} is self-referential.`,
        );
      }
      this.validateSourceIds(
        connection.sourceIds ?? [],
        `context connection ${connection.id}`,
      );
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

  private buildParentLinks(): ParentLink[] {
    const links: ParentLink[] = [];

    for (const union of this.dataset.unions) {
      for (const childId of union.childIds ?? []) {
        for (const parentId of union.partnerIds) {
          links.push({
            parentId,
            childId,
            unionId: union.id,
            type: "biological",
            confidence: union.confidence ?? DEFAULT_CONFIDENCE,
            sourceIds: union.sourceIds ?? [],
          });
        }
      }
    }

    for (const link of this.dataset.directParentage ?? []) {
      links.push({
        parentId: link.parentId,
        childId: link.childId,
        type: link.type ?? "unknown",
        confidence: link.confidence ?? DEFAULT_CONFIDENCE,
        label: link.label,
        sourceIds: link.sourceIds ?? [],
      });
    }

    return links;
  }

  private buildIndexes(): void {
    for (const union of this.dataset.unions) {
      for (const partnerId of union.partnerIds) {
        pushToMap(this.unionsForPersonIndex, partnerId, union);
      }
    }

    for (const link of this.parentLinks) {
      pushToMap(this.parentLinksForChildIndex, link.childId, link);
      pushToMap(this.parentLinksForParentIndex, link.parentId, link);
    }

    for (const connection of this.dataset.contextConnections ?? []) {
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
