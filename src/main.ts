import "./styles.css";
import familyData from "./data/empty.json";
import { GenealogyModel } from "./domain/model";
import { projectAround } from "./domain/projection";
import type { FamilyDataset } from "./domain/types";
import { layoutFamily } from "./layout/layout";
import {
  renderContextDetailsPanel,
  renderDetailsPanel,
} from "./ui/details-panel";
import { GraphRenderer } from "./ui/graph-renderer";

import { mountResearchWorkspace } from "./research-workspace";
import type { ResearchState } from "./domain/research";

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

async function startApplication() {
  let researchState: ResearchState | undefined;
  if (window.location.protocol.startsWith("http")) {
    const response = await fetch("/api/state");
    if (
      response.ok &&
      response.headers.get("content-type")?.includes("application/json")
    )
      researchState = await response.json();
  }
  const dataset = researchState?.dataset ?? (familyData as FamilyDataset);
  let model = new GenealogyModel(dataset);
  const app = document.querySelector<HTMLElement>("#app");

  if (!app) {
    throw new Error("Application root was not found.");
  }

  app.innerHTML = `
  <div class="app-shell">
    <header class="app-header">
      <div class="brand-block">
        <span class="archive-label">Research workspace</span>
        <div>
          <h1>${escapeHtml(dataset.title)}</h1>
          <p>Follow the evidence. Change the center of the story.</p>
        </div>
      </div>

      <div class="header-actions">
        <div class="search-control">
          <label for="person-search">Find a person, place, or organization</label>
          <div class="search-input-wrap">
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="6"></circle>
              <path d="m16 16 4 4"></path>
            </svg>
            <input
              id="person-search"
              type="search"
              autocomplete="off"
              placeholder="Search the research graph"
              aria-controls="search-results"
              aria-expanded="false"
            />
          </div>
          <div id="search-results" class="search-results" role="listbox" hidden></div>
        </div>
        <div class="record-count" title="Records, relationships, and sources in this research graph">
          <strong>${model.peopleById.size}</strong>
          <span>nodes</span>
          <i></i>
          <strong>${model.unionsById.size}</strong>
          <span>relationships</span>
          <i></i>
          <strong>${model.contextEntitiesById.size}</strong>
          <span>sources</span>
        </div>
      </div>
    </header>

    <main class="workspace">
      <section class="graph-stage" aria-label="Research relationship explorer">
        <div class="focus-banner" aria-live="polite">
          <span class="focus-label">Current focus</span>
          <strong id="focus-name">${escapeHtml(model.initialFocus?.name ?? dataset.title)}</strong>
          <span id="focus-status">Preparing research context</span>
        </div>

        <nav class="graph-toolbar" aria-label="Graph controls">
          <button id="history-back" class="tool-button" type="button" title="Previous focus" data-lavish-action="true">
            <span aria-hidden="true">←</span>
            <span class="sr-only">Previous focus</span>
          </button>
          <button id="history-forward" class="tool-button" type="button" title="Next focus" data-lavish-action="true">
            <span aria-hidden="true">→</span>
            <span class="sr-only">Next focus</span>
          </button>
          <span class="toolbar-divider"></span>
          <button id="zoom-out" class="tool-button" type="button" title="Zoom out" data-lavish-action="true">
            <span aria-hidden="true">−</span>
            <span class="sr-only">Zoom out</span>
          </button>
          <button id="zoom-in" class="tool-button" type="button" title="Zoom in" data-lavish-action="true">
            <span aria-hidden="true">+</span>
            <span class="sr-only">Zoom in</span>
          </button>
          <button id="fit-network" class="tool-button tool-button-wide" type="button" data-lavish-action="true">
            Fit all
          </button>
          <button id="recenter-focus" class="tool-button tool-button-wide" type="button" data-lavish-action="true">
            Recenter
          </button>
        </nav>

        <div id="graph" class="graph-canvas"></div>

        <div id="layout-working" class="layout-working" role="status" hidden>
          <span class="working-mark"></span>
          Reorganizing relationships
        </div>

        <section class="graph-legend" aria-label="Graph legend">
          <div>
            <span class="legend-node legend-focus"></span>
            <span>Current focus</span>
          </div>
          <div>
            <span class="legend-node legend-near"></span>
            <span>Near connections</span>
          </div>
          <div>
            <span class="legend-line"></span>
            <span>Established</span>
          </div>
          <div>
            <span class="legend-line legend-probable"></span>
            <span>Probable</span>
          </div>
          <div>
            <span class="legend-line legend-disputed"></span>
            <span>Disputed</span>
          </div>
          <div>
            <span class="legend-node legend-context"></span>
            <span>Historical context</span>
          </div>
          <div>
            <span class="legend-line legend-context-line"></span>
            <span>Research connection</span>
          </div>
        </section>

      </section>

      <aside id="details-panel" class="details-panel" aria-label="Research details" aria-hidden="true"></aside>
    </main>
  </div>
`;

  const requiredElement = <T extends Element>(selector: string): T => {
    const element = document.querySelector<T>(selector);
    if (!element) {
      throw new Error(`Required interface element was not found: ${selector}`);
    }
    return element;
  };

  const workspace = requiredElement<HTMLElement>(".workspace");
  const graphContainer = requiredElement<HTMLElement>("#graph");
  const detailsPanel = requiredElement<HTMLElement>("#details-panel");
  const focusName = requiredElement<HTMLElement>("#focus-name");
  const focusStatus = requiredElement<HTMLElement>("#focus-status");
  const workingIndicator = requiredElement<HTMLElement>("#layout-working");
  const searchInput = requiredElement<HTMLInputElement>("#person-search");
  const searchResults = requiredElement<HTMLElement>("#search-results");

  let currentFocusId = model.initialFocus?.id ?? "";
  let detailsRecord:
    | { kind: "person"; id: string }
    | { kind: "context"; id: string }
    | undefined;
  let layoutRequestId = 0;

  const renderer = new GraphRenderer(graphContainer, {
    onFocus: (personId) => void focusPerson(personId),
    onOpenDetails: (personId) => openDetails(personId),
    onOpenContextEntity: (entityId) => {
      void focusPerson(entityId);
      openContextDetails(entityId);
    },
  });

  function focusIdFromHash(): string | undefined {
    const parameters = new URLSearchParams(window.location.hash.slice(1));
    const focusId = parameters.get("node") ?? parameters.get("person");
    return focusId && model.hasNode(focusId) ? focusId : undefined;
  }

  function updateHash(personId: string, mode: "push" | "replace"): void {
    const url = new URL(window.location.href);
    url.hash = new URLSearchParams(
      model.peopleById.has(personId)
        ? { person: personId }
        : { node: personId },
    ).toString();
    const state = { focusId: personId };
    if (mode === "push") {
      window.history.pushState(state, "", url);
    } else {
      window.history.replaceState(state, "", url);
    }
  }

  function setWorking(isWorking: boolean): void {
    workingIndicator.hidden = !isWorking;
    graphContainer.classList.toggle("is-working", isWorking);
  }

  async function focusPerson(
    personId: string,
    historyMode: "push" | "replace" | "none" = "push",
  ): Promise<void> {
    if (!model.hasNode(personId)) {
      return;
    }

    if (personId === currentFocusId && historyMode === "push") {
      renderer.centerOn(personId);
      return;
    }

    if (detailsRecord?.kind === "person" && detailsRecord.id !== personId) {
      closeDetails();
    }

    currentFocusId = personId;
    const person =
      model.peopleById.get(personId) ?? model.getContextEntity(personId);
    focusName.textContent = person.name;
    focusStatus.textContent = "Recomputing relationships";
    document.title = `${person.name} · ${dataset.title}`;

    if (historyMode !== "none") {
      updateHash(personId, historyMode);
    }

    const requestId = ++layoutRequestId;
    setWorking(true);
    const projection = projectAround(model, personId);

    try {
      const layout = await layoutFamily(model, projection);
      if (requestId !== layoutRequestId) {
        return;
      }
      renderer.render(layout, projection, model);
      focusStatus.textContent = model.peopleById.has(personId)
        ? `${model.parentsOf(personId).length} parent${
            model.parentsOf(personId).length === 1 ? "" : "s"
          } · ${model.spousesOf(personId).length} union partner${
            model.spousesOf(personId).length === 1 ? "" : "s"
          } · ${model.childrenOf(personId).length} child${
            model.childrenOf(personId).length === 1 ? "" : "ren"
          } · ${model.contextConnectionsForPerson(personId).length} historical connection${
            model.contextConnectionsForPerson(personId).length === 1 ? "" : "s"
          }`
        : `${model.getContextEntity(personId).kind} · ${model.contextConnectionsFor(personId).length} research connections`;

      if (detailsRecord) {
        renderDetailsRecord();
      }
    } catch (error) {
      focusStatus.textContent =
        error instanceof Error
          ? error.message
          : "Unable to lay out these relationships.";
      console.error(error);
    } finally {
      if (requestId === layoutRequestId) {
        setWorking(false);
      }
    }
  }

  function renderDetails(personId: string): void {
    renderDetailsPanel(detailsPanel, model, personId, {
      onClose: closeDetails,
      onNavigate: (relativeId) => {
        void focusPerson(relativeId);
        openDetails(relativeId);
      },
      onOpenContextEntity: openContextDetails,
    });
  }

  function openDetails(personId: string): void {
    detailsRecord = { kind: "person", id: personId };
    renderDetailsRecord();
    workspace.classList.add("details-open");
    detailsPanel.ariaHidden = "false";
    detailsPanel.scrollTop = 0;
    window.setTimeout(() => renderer.centerOn(currentFocusId), 360);
  }

  function openContextDetails(entityId: string): void {
    detailsRecord = { kind: "context", id: entityId };
    renderDetailsRecord();
    workspace.classList.add("details-open");
    detailsPanel.ariaHidden = "false";
    detailsPanel.scrollTop = 0;
    window.setTimeout(() => renderer.centerOn(currentFocusId), 360);
  }

  function renderDetailsRecord(): void {
    if (!detailsRecord) {
      return;
    }

    if (detailsRecord.kind === "person") {
      renderDetails(detailsRecord.id);
      window.dispatchEvent(
        new CustomEvent("research:inspect", {
          detail: { id: detailsRecord.id },
        }),
      );
      return;
    }

    renderContextDetailsPanel(detailsPanel, model, detailsRecord.id, {
      onClose: closeDetails,
      onNavigate: (personId) => {
        void focusPerson(personId);
        openDetails(personId);
      },
      onOpenContextEntity: openContextDetails,
    });
    window.dispatchEvent(
      new CustomEvent("research:inspect", { detail: { id: detailsRecord.id } }),
    );
  }

  function closeDetails(): void {
    detailsRecord = undefined;
    workspace.classList.remove("details-open");
    detailsPanel.ariaHidden = "true";
    window.setTimeout(() => renderer.centerOn(currentFocusId), 360);
  }

  function closeSearch(): void {
    searchResults.hidden = true;
    searchInput.ariaExpanded = "false";
  }

  function renderSearchResults(): void {
    const personMatches = model.search(searchInput.value).map((person) => ({
      id: person.id,
      name: person.name,
      context: [person.lifespan, person.descriptor].filter(Boolean).join(" · "),
      kind: "person" as const,
    }));
    const contextMatches = model
      .searchContext(searchInput.value)
      .map((entity) => ({
        id: entity.id,
        name: entity.name,
        context: [
          entity.kind === "family" ? "Family network" : entity.kind,
          entity.activeDates,
          entity.descriptor,
        ]
          .filter(Boolean)
          .join(" · "),
        kind: "context" as const,
      }));
    const matches = [...personMatches, ...contextMatches]
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 8);
    searchResults.replaceChildren();

    if (matches.length === 0) {
      if (searchInput.value.trim()) {
        const empty = document.createElement("p");
        empty.className = "search-empty";
        empty.textContent = "No matching people or organizations found.";
        searchResults.append(empty);
        searchResults.hidden = false;
        searchInput.ariaExpanded = "true";
      } else {
        closeSearch();
      }
      return;
    }

    for (const match of matches) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "search-result";
      button.role = "option";
      button.dataset.lavishAction = "true";
      const name = document.createElement("strong");
      name.textContent = match.name;
      const context = document.createElement("span");
      context.textContent = match.context;
      button.append(name, context);
      button.addEventListener("click", () => {
        if (match.kind === "person") {
          void focusPerson(match.id);
        } else {
          void focusPerson(match.id);
          openContextDetails(match.id);
        }
        searchInput.value = "";
        closeSearch();
        searchInput.focus();
      });
      searchResults.append(button);
    }

    searchResults.hidden = false;
    searchInput.ariaExpanded = "true";
  }

  searchInput.addEventListener("input", renderSearchResults);
  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeSearch();
    }
    if (event.key === "Enter") {
      const firstPerson = model.search(searchInput.value)[0];
      const firstContext = model.searchContext(searchInput.value)[0];
      if (firstPerson || firstContext) {
        event.preventDefault();
        if (firstPerson) {
          void focusPerson(firstPerson.id);
        } else if (firstContext) {
          void focusPerson(firstContext.id);
          openContextDetails(firstContext.id);
        }
        searchInput.value = "";
        closeSearch();
      }
    }
  });
  document.addEventListener("pointerdown", (event) => {
    const target = event.target;
    if (
      target instanceof Node &&
      !searchResults.contains(target) &&
      target !== searchInput
    ) {
      closeSearch();
    }
  });

  requiredElement<HTMLButtonElement>("#history-back").addEventListener(
    "click",
    () => window.history.back(),
  );
  requiredElement<HTMLButtonElement>("#history-forward").addEventListener(
    "click",
    () => window.history.forward(),
  );
  requiredElement<HTMLButtonElement>("#zoom-out").addEventListener(
    "click",
    () => renderer.zoomBy(0.78),
  );
  requiredElement<HTMLButtonElement>("#zoom-in").addEventListener("click", () =>
    renderer.zoomBy(1.28),
  );
  requiredElement<HTMLButtonElement>("#fit-network").addEventListener(
    "click",
    () => renderer.fitAll(),
  );
  requiredElement<HTMLButtonElement>("#recenter-focus").addEventListener(
    "click",
    () => renderer.centerOn(currentFocusId),
  );

  window.addEventListener("popstate", (event) => {
    const stateFocus =
      event.state &&
      typeof event.state === "object" &&
      "focusId" in event.state &&
      typeof event.state.focusId === "string"
        ? event.state.focusId
        : focusIdFromHash();
    if (stateFocus) {
      void focusPerson(stateFocus, "none");
    }
  });

  const empty = document.createElement("section");
  empty.className = "empty-research";
  empty.innerHTML = `<span class="eyebrow">A new investigation starts here</span><h2></h2><p>No findings yet. Start with a question or bring in sources you already have. People, places, and organizations will appear as you review and accept research.</p><div class="empty-actions"><button class="primary" type="button" data-ask-topic>Ask a research question</button><button type="button" data-open-sources>Add sources</button><button type="button" data-organize-project>Add a starting point</button></div>`;
  empty.querySelector("h2")!.textContent = dataset.title;
  empty.dataset.researchTarget = JSON.stringify({
    label: dataset.title,
    text: dataset.title,
  });
  graphContainer.after(empty);
  function showDataset() {
    const hasNodes = model.peopleById.size + model.contextEntitiesById.size > 0;
    empty.hidden = hasNodes;
    requiredElement<HTMLElement>(".focus-banner").hidden = !hasNodes;
    requiredElement<HTMLElement>(".record-count").hidden = !hasNodes;
    graphContainer.hidden = !hasNodes;
    requiredElement<HTMLElement>(".graph-toolbar").hidden = !hasNodes;
    requiredElement<HTMLElement>(".graph-legend").hidden = !hasNodes;
    const counts =
      requiredElement<HTMLElement>(".record-count").querySelectorAll("strong");
    [
      model.peopleById.size + model.contextEntitiesById.size,
      model.dataset.unions.length +
        (model.dataset.directParentage?.length ?? 0) +
        (model.dataset.contextConnections?.length ?? 0),
      model.dataset.sources?.length ?? 0,
    ].forEach((n, index) => {
      counts[index]!.textContent = String(n);
    });
    if (!hasNodes) {
      ++layoutRequestId;
      renderer.clear();
      closeDetails();
      currentFocusId = "";
      focusName.textContent = model.dataset.title;
      focusStatus.textContent = "No findings yet";
      document.title = model.dataset.title;
      const url = new URL(location.href);
      url.hash = "";
      history.replaceState({}, "", url);
      setWorking(false);
      return;
    }
    currentFocusId = model.hasNode(currentFocusId)
      ? currentFocusId
      : model.initialFocus!.id;
    if (detailsRecord && !model.hasNode(detailsRecord.id)) closeDetails();
    updateHash(currentFocusId, "replace");
    void focusPerson(currentFocusId, "none");
  }
  currentFocusId = focusIdFromHash() ?? model.initialFocus?.id ?? "";
  showDataset();

  if (researchState)
    mountResearchWorkspace(researchState, (updated) => {
      model = new GenealogyModel(updated);
      showDataset();
    });
}
void startApplication().catch((error) => {
  const root = document.querySelector("#app");
  if (root) root.textContent = `Unable to open workspace: ${error.message}`;
  console.error(error);
});
