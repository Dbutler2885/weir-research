import "./styles.css";
import "./ui/weir-mark.css";
import { GraphModel } from "./domain/model";
import { emptyGraph } from "./domain/graph-schema";
import { projectAround } from "./domain/projection";
import type { GraphDataset } from "./domain/types";
import { layoutGraph } from "./layout/layout";
import { nodeView, statementView } from "./domain/node-view";
import { renderNodePanel, renderStatementPanel } from "./ui/details-panel";
import { GraphRenderer } from "./ui/graph-renderer";

import { mountResearchWorkspace } from "./research-workspace";
import type { ResearchState } from "./domain/research";
import { weirIcon, weirMark } from "./ui/logo";

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
  const dataset = researchState?.dataset ?? emptyGraph();
  let model = new GraphModel(dataset);
  const app = document.querySelector<HTMLElement>("#app");

  if (!app) {
    throw new Error("Application root was not found.");
  }

  const icon = document.createElement("link");
  icon.rel = "icon";
  icon.href = weirIcon;
  document.head.append(icon);
  app.innerHTML = `
  <div class="app-shell">
    <header class="app-header">
      <div class="brand-block">
        <span class="brand-name">${weirMark}<span>Weir</span></span>
        <div>
          <h1>${escapeHtml(dataset.title)}</h1>
          <p>Follow the evidence. Change the center of the story.</p>
        </div>
      </div>

      <div class="header-actions">
        <div class="search-control">
          <label for="person-search">Find anything in the graph</label>
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
          <strong>${model.nodesById.size}</strong>
          <span>nodes</span>
          <i></i>
          <strong>${model.connections.length}</strong>
          <span>relationships</span>
          <i></i>
          <strong>${model.sourcesById.size}</strong>
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

        <section class="graph-legend" aria-label="Graph legend"></section>

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
  // What the side panel shows: a node, or one statement opened from a node or a line.
  let detailsRecord:
    | { kind: "node"; id: string }
    | { kind: "statement"; id: string; from?: string }
    | undefined;
  let layoutRequestId = 0;

  const renderer = new GraphRenderer(graphContainer, {
    onSelectNode: (nodeId) => showNode(nodeId),
    onSelectEdge: (claimId) => openDetails({ kind: "statement", id: claimId }),
  });

  // A node becomes the focus and its panel opens.
  function showNode(nodeId: string): void {
    void focusNode(nodeId);
    openDetails({ kind: "node", id: nodeId });
  }

  function focusIdFromHash(): string | undefined {
    const parameters = new URLSearchParams(window.location.hash.slice(1));
    const focusId = parameters.get("node") ?? parameters.get("person");
    return focusId && model.hasNode(focusId) ? focusId : undefined;
  }

  function updateHash(personId: string, mode: "push" | "replace"): void {
    const url = new URL(window.location.href);
    url.hash = new URLSearchParams({ node: personId }).toString();
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

  async function focusNode(
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

    currentFocusId = personId;
    const person = model.getNode(personId);
    focusName.textContent = person.name;
    // The focus's name can be annotated as the record it names.
    focusName.setAttribute(
      "data-research-target",
      JSON.stringify({ table: "nodes", recordId: personId, label: person.name }),
    );
    focusStatus.textContent = "Recomputing relationships";
    document.title = `${person.name} · ${dataset.title} · Weir`;

    if (historyMode !== "none") {
      updateHash(personId, historyMode);
    }

    const requestId = ++layoutRequestId;
    setWorking(true);
    const projection = projectAround(model, personId);

    try {
      const layout = layoutGraph(model, projection);
      if (requestId !== layoutRequestId) {
        return;
      }
      renderer.render(layout, projection, model);
      const connections = model.connectionsFor(personId).length;
      focusStatus.textContent = `${person.type} · ${connections} connection${connections === 1 ? "" : "s"}`;

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

  const panelHandlers = {
    onClose: () => closeDetails(),
    onOpenNode: (nodeId: string) => showNode(nodeId),
    onOpenStatement: (claimId: string) =>
      openDetails({ kind: "statement", id: claimId, ...(detailsRecord?.kind === "node" ? { from: detailsRecord.id } : {}) }),
  };

  function openDetails(record: NonNullable<typeof detailsRecord>): void {
    detailsRecord = record;
    renderDetailsRecord();
    workspace.classList.add("details-open");
    detailsPanel.ariaHidden = "false";
    detailsPanel.scrollTop = 0;
    window.setTimeout(() => renderer.centerOn(currentFocusId), 360);
  }

  function renderDetailsRecord(): void {
    if (!detailsRecord) return;
    if (detailsRecord.kind === "node") {
      renderNodePanel(detailsPanel, nodeView(model, detailsRecord.id), panelHandlers);
      window.dispatchEvent(new CustomEvent("research:inspect", { detail: { id: detailsRecord.id } }));
      return;
    }
    const from = detailsRecord.from && model.hasNode(detailsRecord.from) ? model.getNode(detailsRecord.from) : undefined;
    renderStatementPanel(detailsPanel, statementView(model, detailsRecord.id), panelHandlers, from && { id: from.id, name: from.name });
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
    const matches = model
      .search(searchInput.value)
      .slice(0, 8)
      .map((node) => ({ id: node.id, name: node.name, context: [node.type, node.dates].filter(Boolean).join(" · ") }));
    searchResults.replaceChildren();

    if (matches.length === 0) {
      if (searchInput.value.trim()) {
        const empty = document.createElement("p");
        empty.className = "search-empty";
        empty.textContent = "Nothing in the graph matches.";
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
        showNode(match.id);
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
      const first = model.search(searchInput.value)[0];
      if (first) {
        event.preventDefault();
        showNode(first.id);
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
      void focusNode(stateFocus, "none");
    }
  });

  const empty = document.createElement("section");
  empty.className = "empty-research";
  empty.innerHTML = `<span class="eyebrow">A new investigation starts here</span><h2></h2><p>No findings yet. Start with a question or bring in sources you already have. What the research is about will appear here as you review and accept it.</p><div class="empty-actions"><button class="primary" type="button" data-ask-topic>Ask a research question</button><button type="button" data-open-sources>Add sources</button><button type="button" data-organize-project>Add a starting point</button></div>`;
  empty.querySelector("h2")!.textContent = dataset.title;
  empty.dataset.researchTarget = JSON.stringify({
    label: dataset.title,
    text: dataset.title,
  });
  graphContainer.after(empty);
  function showDataset() {
    const hasNodes = model.nodesById.size > 0;
    empty.hidden = hasNodes;
    requiredElement<HTMLElement>(".focus-banner").hidden = !hasNodes;
    requiredElement<HTMLElement>(".record-count").hidden = !hasNodes;
    graphContainer.hidden = !hasNodes;
    requiredElement<HTMLElement>(".graph-toolbar").hidden = !hasNodes;
    requiredElement<HTMLElement>(".graph-legend").hidden = !hasNodes;
    const counts =
      requiredElement<HTMLElement>(".record-count").querySelectorAll("strong");
    [
      model.nodesById.size,
      model.connections.length,
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
      focusName.removeAttribute("data-research-target");
      focusStatus.textContent = "No findings yet";
      document.title = `${model.dataset.title} · Weir`;
      const url = new URL(location.href);
      url.hash = "";
      history.replaceState({}, "", url);
      setWorking(false);
      return;
    }
    currentFocusId = model.hasNode(currentFocusId)
      ? currentFocusId
      : model.initialFocus!.id;
    const legend = requiredElement<HTMLElement>(".graph-legend");
    legend.innerHTML = [
      ...model.dataset.types
        .filter((type) => model.dataset.nodes.some((node) => node.type === type.name))
        .map((type) => `<div class="look-${model.schema.look({ type: type.name }).color}"><span class="legend-node legend-type"></span><span>${escapeHtml(type.name)}</span></div>`),
      '<div><span class="legend-line"></span><span>Established</span></div>',
      '<div><span class="legend-line legend-probable"></span><span>Probable</span></div>',
      '<div><span class="legend-line legend-disputed"></span><span>Disputed</span></div>',
    ].join("");
    const gone =
      detailsRecord &&
      (detailsRecord.kind === "node" ? !model.hasNode(detailsRecord.id) : !model.dataset.claims?.some((c) => c.id === detailsRecord!.id));
    if (gone) closeDetails();
    updateHash(currentFocusId, "replace");
    void focusNode(currentFocusId, "none");
  }
  currentFocusId = focusIdFromHash() ?? model.initialFocus?.id ?? "";
  showDataset();

  if (researchState)
    mountResearchWorkspace(researchState, (updated) => {
      model = new GraphModel(updated);
      showDataset();
    });
}
void startApplication().catch((error) => {
  const root = document.querySelector("#app");
  if (root) root.textContent = `Unable to open workspace: ${error.message}`;
  console.error(error);
});
