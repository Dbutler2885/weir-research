import { GenealogyModel } from "../domain/model";
import type {
  Confidence,
  ContextConnectionRecord,
  PersonRecord,
  SourceRecord,
  ResearchClaim,
} from "../domain/types";

export interface DetailsPanelHandlers {
  onClose: () => void;
  onNavigate: (personId: string) => void;
  onOpenContextEntity: (entityId: string) => void;
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  if (className) {
    element.className = className;
  }
  if (text) {
    element.textContent = text;
  }
  return element;
}

function appendRelationshipGroup(
  container: HTMLElement,
  title: string,
  people: PersonRecord[],
  onNavigate: (personId: string) => void,
): void {
  if (people.length === 0) {
    return;
  }

  const section = createElement(
    "section",
    "detail-section relationship-section",
  );
  section.append(createElement("h3", "detail-kicker", title));
  const list = createElement("div", "relationship-list");

  for (const person of people) {
    const button = createElement("button", "relationship-button");
    button.type = "button";
    button.dataset.lavishAction = "true";
    button.addEventListener("click", () => onNavigate(person.id));

    const identity = createElement("span", "relationship-identity");
    identity.append(createElement("strong", "", person.name));
    if (person.lifespan) {
      identity.append(createElement("small", "", person.lifespan));
    }
    button.append(identity, createElement("span", "relationship-arrow", "→"));
    list.append(button);
  }

  section.append(list);
  container.append(section);
}

function confidenceLabel(confidence: Confidence): string {
  return {
    established: "Established",
    probable: "Probable",
    disputed: "Disputed",
    unknown: "Unknown",
  }[confidence];
}

function appendClaimEvidence(container: HTMLElement, model: GenealogyModel, claim: ResearchClaim): void {
  const detail = createElement("details", "claim-evidence");
  detail.append(createElement("summary", "", "Evidence and explanation"));
  detail.append(createElement("p", "claim-explanation", claim.reasoning));
  for (const link of claim.evidence) {
    const evidence = model.dataset.evidence?.find(e => e.id === link.ref);
    if (!evidence) continue;
    const source = model.getSource(evidence.sourceId);
    const passage = createElement("section", "claim-passage");
    passage.append(createElement("small", "", `${link.role} · ${source.title}`));
    passage.append(createElement("blockquote", "", evidence.quote));
    passage.append(createElement("p", "source-meta", evidence.locator));
    if (evidence.context) {
      const context = createElement("details");
      context.append(createElement("summary", "", "Passage context"), createElement("p", "claim-explanation", evidence.context));
      passage.append(context);
    }
    const inspect = createElement("button", "source-inspect-button", "Inspect source");
    inspect.dataset.inspectSource = source.id;
    passage.append(inspect);
    detail.append(passage);
  }
  container.append(detail);
}

function appendResearchClaims(container: HTMLElement, model: GenealogyModel, nodeId: string): void {
  const claims = (model.dataset.claims || []).filter(c => c.subjectId === nodeId && "value" in c.object);
  if (!claims.length) return;
  const section = createElement("section", "detail-section research-claims");
  section.append(createElement("h3", "detail-kicker", "What the research says"));
  for (const claim of claims) {
    const row = createElement("article", "research-claim");
    row.dataset.claimId = claim.id;
    row.dataset.researchTarget = JSON.stringify({ table: model.peopleById.has(nodeId) ? "people" : "contextEntities", recordId: nodeId, label: claim.predicate.replaceAll("_", " ") });
    row.append(createElement("h4", "", claim.predicate.replaceAll("_", " ")));
    row.append(createElement("p", "claim-value", String("value" in claim.object ? claim.object.value : "")));
    row.append(createElement("small", "claim-qualification", [claim.qualification, claim.time].filter(Boolean).join(" · ")));
    appendClaimEvidence(row, model, claim);
    section.append(row);
  }
  container.append(section);
}

function appendSources(container: HTMLElement, sources: SourceRecord[]): void {
  if (sources.length === 0) {
    return;
  }

  const section = createElement("section", "detail-section sources-section");
  section.append(createElement("h3", "detail-kicker", "Sources"));
  const list = createElement("ol", "source-list");

  for (const source of sources) {
    const item = createElement("li", "source-item");
    item.dataset.researchTarget = JSON.stringify({
      table: "sources",
      recordId: source.id,
      label: source.title,
    });
    const title = source.url
      ? createElement("a", "source-link", source.title)
      : createElement("strong", "source-title", source.title);

    if (title instanceof HTMLAnchorElement && source.url) {
      title.href = source.url;
      title.target = "_blank";
      title.rel = "noreferrer";
      title.dataset.lavishAction = "true";
    }

    item.append(title);
    const inspect = createElement(
      "button",
      "source-inspect-button",
      "Inspect source and findings",
    );
    inspect.dataset.inspectSource = source.id;
    item.append(inspect);
    const metadata = [source.repository, source.date]
      .filter(Boolean)
      .join(" · ");
    if (metadata) {
      item.append(createElement("span", "source-meta", metadata));
    }
    if (source.note) {
      item.append(createElement("p", "source-note", source.note));
    }
    list.append(item);
  }

  section.append(list);
  container.append(section);
}

function uniquePeople(people: PersonRecord[]): PersonRecord[] {
  return [
    ...new Map(people.map((person) => [person.id, person])).values(),
  ].sort((a, b) => a.name.localeCompare(b.name));
}

function otherConnectionEndpoint(
  connection: ContextConnectionRecord,
  nodeId: string,
): string {
  return connection.fromId === nodeId ? connection.toId : connection.fromId;
}

function appendContextConnections(
  container: HTMLElement,
  model: GenealogyModel,
  nodeId: string,
  connections: readonly ContextConnectionRecord[],
  handlers: DetailsPanelHandlers,
): void {
  if (connections.length === 0) {
    return;
  }

  const section = createElement(
    "section",
    "detail-section relationship-section",
  );
  section.append(
    createElement("h3", "detail-kicker", "Historical connections"),
  );
  const list = createElement(
    "div",
    "relationship-list context-relationship-list",
  );

  for (const connection of connections) {
    const relatedId = otherConnectionEndpoint(connection, nodeId);
    const relatedPerson = model.peopleById.get(relatedId);
    const relatedEntity = model.contextEntitiesById.get(relatedId);
    const button = createElement(
      "button",
      "relationship-button context-relationship",
    );
    button.dataset.connectionId = connection.id;
    button.type = "button";
    button.dataset.lavishAction = "true";
    button.addEventListener("click", () => {
      if (relatedPerson) {
        handlers.onNavigate(relatedId);
      } else if (relatedEntity) {
        handlers.onOpenContextEntity(relatedId);
      }
    });

    const identity = createElement("span", "relationship-identity");
    identity.append(
      createElement("strong", "", model.contextNodeName(relatedId)),
      createElement(
        "small",
        "",
        `${connection.label} · ${connection.qualification ?? confidenceLabel(connection.confidence ?? "established")}${connection.date ? ` · ${connection.date}` : ""}`,
      ),
    );
    button.append(identity, createElement("span", "relationship-arrow", "→"));
    list.append(button);
    const claim = model.dataset.claims?.find(c => c.id === connection.id);
    if (claim) appendClaimEvidence(list, model, claim);
    for (const note of connection.notes ?? []) {
      const paragraph = createElement("p", "connection-note", note);
      paragraph.dataset.researchTarget = JSON.stringify({
        table: "contextConnections",
        recordId: connection.id,
        label: connection.label,
      });
      list.append(paragraph);
    }
  }

  section.append(list);
  container.append(section);
}

export function renderDetailsPanel(
  container: HTMLElement,
  model: GenealogyModel,
  personId: string,
  handlers: DetailsPanelHandlers,
): void {
  const person = model.getPerson(personId);
  container.replaceChildren();
  container.dataset.personId = personId;
  delete container.dataset.contextEntityId;

  const header = createElement("header", "detail-header");
  const headingWrap = createElement("div");
  headingWrap.append(
    createElement("span", "eyebrow", "Person record"),
    createElement("h2", "detail-title", person.name),
  );
  if (person.lifespan) {
    headingWrap.append(createElement("p", "detail-lifespan", person.lifespan));
  }

  const closeButton = createElement("button", "icon-button detail-close", "×");
  closeButton.type = "button";
  closeButton.ariaLabel = "Close biography";
  closeButton.dataset.lavishAction = "true";
  closeButton.addEventListener("click", handlers.onClose);
  header.append(headingWrap, closeButton);
  container.append(header);

  if (person.descriptor) {
    container.append(
      createElement("p", "detail-descriptor", person.descriptor),
    );
  }

  const facts = [
    person.born ? ["Born", person.born] : undefined,
    person.died ? ["Died", person.died] : undefined,
  ].filter((fact): fact is string[] => Boolean(fact));

  if (facts.length > 0) {
    const factGrid = createElement("dl", "fact-grid");
    for (const [label, value] of facts) {
      factGrid.append(
        createElement("dt", "", label),
        createElement("dd", "", value),
      );
    }
    container.append(factGrid);
  }

  const biographySection = createElement("section", "detail-section");
  biographySection.append(
    createElement("h3", "detail-kicker", "Biography"),
    createElement(
      "p",
      "biography-copy",
      person.biography ?? "No narrative biography has been added yet.",
    ),
  );
  if (person.biography || !model.dataset.claims?.some(c => c.subjectId === personId)) container.append(biographySection);
  appendResearchClaims(container, model, personId);

  const parents = uniquePeople(
    model.parentsOf(personId).map((link) => model.getPerson(link.parentId)),
  );
  const spouses = uniquePeople(model.spousesOf(personId));
  const children = uniquePeople(
    model.childrenOf(personId).map((link) => model.getPerson(link.childId)),
  );
  const siblings = uniquePeople(model.siblingsOf(personId));

  appendRelationshipGroup(container, "Parents", parents, handlers.onNavigate);
  appendRelationshipGroup(
    container,
    "Spouses and partners",
    spouses,
    handlers.onNavigate,
  );
  appendRelationshipGroup(container, "Children", children, handlers.onNavigate);
  appendRelationshipGroup(container, "Siblings", siblings, handlers.onNavigate);
  appendContextConnections(
    container,
    model,
    personId,
    model.contextConnectionsForPerson(personId),
    handlers,
  );

  const qualifiedRelationships = [
    ...model
      .parentsOf(personId)
      .filter((link) => link.confidence !== "established"),
    ...model
      .childrenOf(personId)
      .filter((link) => link.confidence !== "established"),
  ];
  if (qualifiedRelationships.length > 0) {
    const section = createElement("section", "detail-section");
    section.append(createElement("h3", "detail-kicker", "Relationship status"));
    for (const relationship of qualifiedRelationships) {
      const relatedId =
        relationship.childId === personId
          ? relationship.parentId
          : relationship.childId;
      const row = createElement("div", "confidence-row");
      const badge = createElement(
        "span",
        `confidence-badge confidence-${relationship.confidence}`,
        confidenceLabel(relationship.confidence),
      );
      row.append(
        badge,
        createElement(
          "span",
          "",
          `${model.getPerson(relatedId).name}${
            relationship.label ? `: ${relationship.label}` : ""
          }`,
        ),
      );
      section.append(row);
    }
    container.append(section);
  }

  if (person.researchNotes && person.researchNotes.length > 0) {
    const notesSection = createElement(
      "section",
      "detail-section research-notes",
    );
    notesSection.append(createElement("h3", "detail-kicker", "Research notes"));
    const notes = createElement("ul");
    for (const note of person.researchNotes) {
      notes.append(createElement("li", "", note));
    }
    notesSection.append(notes);
    container.append(notesSection);
  }

  const sourceIds = new Set(person.sourceIds ?? []);
  for (const relationship of [
    ...model.parentsOf(personId),
    ...model.childrenOf(personId),
  ]) {
    for (const sourceId of relationship.sourceIds) {
      sourceIds.add(sourceId);
    }
  }
  for (const union of model.unionsForPerson(personId)) {
    for (const sourceId of union.sourceIds ?? []) {
      sourceIds.add(sourceId);
    }
  }
  for (const connection of model.contextConnectionsForPerson(personId)) {
    for (const sourceId of connection.sourceIds ?? []) {
      sourceIds.add(sourceId);
    }
  }
  appendSources(
    container,
    [...sourceIds].map((sourceId) => model.getSource(sourceId)),
  );
}

export function renderContextDetailsPanel(
  container: HTMLElement,
  model: GenealogyModel,
  entityId: string,
  handlers: DetailsPanelHandlers,
): void {
  const entity = model.getContextEntity(entityId);
  container.replaceChildren();
  delete container.dataset.personId;
  container.dataset.contextEntityId = entityId;

  const header = createElement("header", "detail-header");
  const headingWrap = createElement("div");
  headingWrap.append(
    createElement(
      "span",
      "eyebrow",
      entity.kind === "family"
        ? "Family network"
        : entity.kind[0]!.toUpperCase() + entity.kind.slice(1),
    ),
    createElement("h2", "detail-title", entity.name),
  );
  if (entity.activeDates) {
    headingWrap.append(
      createElement("p", "detail-lifespan", entity.activeDates),
    );
  }

  const closeButton = createElement("button", "icon-button detail-close", "×");
  closeButton.type = "button";
  closeButton.ariaLabel = "Close historical context";
  closeButton.dataset.lavishAction = "true";
  closeButton.addEventListener("click", handlers.onClose);
  header.append(headingWrap, closeButton);
  container.append(header);

  if (entity.descriptor) {
    container.append(
      createElement("p", "detail-descriptor", entity.descriptor),
    );
  }

  const biographySection = createElement("section", "detail-section");
  biographySection.append(
    createElement("h3", "detail-kicker", "Historical context"),
    createElement(
      "p",
      "biography-copy",
      entity.biography ?? "No narrative context has been added yet.",
    ),
  );
  if (entity.biography || !model.dataset.claims?.some(c => c.subjectId === entityId)) container.append(biographySection);
  appendResearchClaims(container, model, entityId);

  const connections = model.contextConnectionsForEntity(entityId);
  appendContextConnections(container, model, entityId, connections, handlers);

  const sourceIds = new Set(entity.sourceIds ?? []);
  for (const connection of connections) {
    for (const sourceId of connection.sourceIds ?? []) {
      sourceIds.add(sourceId);
    }
  }
  appendSources(
    container,
    [...sourceIds].map((sourceId) => model.getSource(sourceId)),
  );
}
