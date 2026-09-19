import {
  investigationSubject,
  feedbackView,
  settingsView,
} from "./ui/investigation-view";
import { findingReview, evidenceCard } from "./ui/finding-review";
import {
  sourceLibrary,
  graphSelection,
  registeredSources,
} from "./domain/findings";
import { applyChanges } from "./domain/research";
import { GenealogyModel } from "./domain/model";
import { projectAround } from "./domain/projection";
import { layoutFamily } from "./layout/layout";
import { GraphRenderer } from "./ui/graph-renderer";
import { GuidedReview } from "./ui/guided-review";
import { AnnotationsDrawer, type DrawerTab } from "./ui/annotations-drawer";
import { findingsPage, type FindingsSection } from "./ui/findings-view";
import "./findings.css";
import "./annotations-drawer.css";
import "./guided-review.css";
import { mountOrganizationPanel } from "./ui/organization-panel";
import type {
  AnnotationTarget,
  Investigation,
  Proposal,
  ResearchCommand,
  ResearchState,
} from "./domain/research";
import type { FamilyDataset } from "./domain/types";
import {
  createArtifactSdk,
  deriveLavishQueueKey,
} from "./vendor/lavish/artifact-sdk.js";
import "./workspace.css";
import "./investigation.css";

const escape = (value: unknown): string =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const safeUrl = (url?: string): string =>
  url && /^https?:\/\//i.test(url) ? escape(url) : "";
const date = (value: string): string =>
  new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
const targetAttribute = (target: AnnotationTarget): string =>
  `data-research-target="${escape(JSON.stringify(target))}"`;

export function mountResearchWorkspace(
  initial: ResearchState,
  onDataset: (dataset: FamilyDataset) => void,
): void {
  let state = initial;
  const destination = new URLSearchParams(location.search);
  let view = ['review','work','sources'].includes(destination.get('view') || '') ? destination.get('view')! : 'research';
  let selectedInvestigation: string | undefined = initial.investigations.some(i => i.id === destination.get('investigation')) ? destination.get('investigation')! : undefined;
  let selectedProposal: string | undefined;
  let readingMode = "cards";
  let findingsSection: FindingsSection = "findings";
  const expandedReports = new Set<string>();
  let cardIndex = 0;
  let previewRenderer: GraphRenderer | undefined;
  let guidedReview: GuidedReview | undefined;
  let activityDestination: string | undefined;
  let selectedSource: string | undefined;
  const selectedGroups = new Map<string, Set<string>>();
  let previewGeneration = 0;
  let annotate = false;
  let busy = false;
  let drawer: AnnotationsDrawer | undefined;
  const shell = document.querySelector<HTMLElement>(".app-shell")!;
  const graph = document.querySelector<HTMLElement>("main.workspace")!;
  shell.classList.add("research-app");
  shell.dataset.workspaceView = "research";
  const projectHeading = shell.querySelector<HTMLElement>(".brand-block h1");
  if (projectHeading) projectHeading.title = initial.dataset.title;
  const nav = document.createElement("nav");
  nav.className = "workspace-nav";
  nav.ariaLabel = "Research workspace";
  nav.innerHTML = `<div class="workspace-tabs">${[
    ["research", "Graph"],
    ["work", "Investigations"],
    ["review", "Review"],
    ["sources", "Sources"],
  ]
    .map(
      ([id, label]) =>
        `<button type="button" data-view="${id}" ${id === "research" ? 'aria-current="page"' : ""}>${label}<span data-count="${id}"></span></button>`,
    )
    .join(
      "",
    )}</div><div class="workspace-actions"><button type="button" data-view="feedback" class="feedback-destination">Feedback <span data-count="feedback"></span></button><span class="local-indicator" title="Saved on this computer">Saved</span><button type="button" data-organize-project>Organize</button><button type="button" data-add-instruction aria-expanded="false" aria-controls="notes-sidebar">Annotations <span data-count="queue" title="Queued annotations"></span></button></div>`;
  shell.insertBefore(nav, graph);
  const surface = document.createElement("section");
  surface.className = "research-surface";
  surface.hidden = true;
  shell.append(surface);
  const notice = document.createElement("div");
  notice.className = "workspace-notice";
  notice.hidden = true;
  notice.innerHTML =
    '<span>New research activity is available.</span><button type="button">Load updates</button>';
  shell.append(notice);
  const toast = document.createElement("div");
  toast.className = "research-toast";
  toast.setAttribute("role", "status");
  toast.hidden = true;
  document.body.append(toast);
  const dialog = document.createElement("dialog");
  dialog.className = "annotation-dialog";
  dialog.id = "notes-sidebar";
  dialog.setAttribute("aria-label", "Annotations");
  dialog.setAttribute("data-lavish-ui", "research-composer");
  const composerColumn = document.createElement("aside");
  composerColumn.className = "composer-column";
  composerColumn.setAttribute("aria-label", "Annotation and selected details");
  shell.append(composerColumn);
  composerColumn.append(dialog);
  const nodeInspector = graph.querySelector<HTMLElement>(".details-panel");
  function syncComposer() {
    shell.classList.toggle("composing", dialog.open);
    nav
      .querySelector("[data-add-instruction]")!
      .setAttribute("aria-expanded", String(dialog.open));
    if (nodeInspector) {
      if (dialog.open && view === "research")
        composerColumn.prepend(nodeInspector);
      else graph.append(nodeInspector);
    }
  }

  let toastTimer: number;
  function message(text: string, action?: { label: string; run: () => void }) {
    toast.textContent = text;
    if (action) {
      const button = document.createElement("button");
      button.textContent = action.label;
      button.addEventListener("click", () => {
        action.run();
        toast.hidden = true;
      });
      toast.append(button);
    }
    toast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast.hidden = true;
    }, 6000);
  }
  async function request(path: string, data?: unknown): Promise<any> {
    const response = await fetch(
      path,
      data === undefined
        ? {}
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
          },
    );
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error || "Unable to save research.");
    return result;
  }
  function updateCounts() {
    // Unread coordinator messages stay visible until the conversation is read.
    const unread = dialog.open && drawer?.currentTab === "conversation" ? 0 : drawer?.unread() || 0;
    const badge = nav.querySelector<HTMLElement>('[data-count="queue"]')!;
    badge.textContent = unread ? String(unread) : "";
    badge.classList.toggle("alert", unread > 0);
    nav.querySelector('[data-count="feedback"]')!.textContent = String(
      state.interfaceFeedback?.length || 0,
    );
    const work = state.investigations.filter((i) =>
      ["draft", "queued", "running", "paused"].includes(i.status),
    ).length;
    const review = state.investigations.filter((i) =>
      i.reviewFlow?.walkthroughs.length || i.proposals.some((p) => p.status === "pending"),
    ).length;
    nav.querySelector('[data-count="work"]')!.textContent = work
      ? String(work)
      : "";
    nav.querySelector('[data-count="review"]')!.textContent = review
      ? String(review)
      : "";
  }
  async function refresh(render = true) {
    const fresh: ResearchState = await request("/api/state");
    const changed = state.datasetRevision !== fresh.datasetRevision;
    state = fresh;
    if (dialog.open) drawer?.render();
    updateCounts();
    if (render) notice.hidden = true;
    if (changed) onDataset(state.dataset);
    if (render) renderView();
  }
  async function command(data: ResearchCommand, rerender = true) {
    if (busy) return;
    busy = true;
    try {
      const response = await request("/api/commands", data);
      await refresh(rerender);
      return response.result;
    } finally {
      busy = false;
    }
  }
  function currentInvestigation(): Investigation | undefined {
    return state.investigations.find((i) => i.id === selectedInvestigation);
  }
  function setView(next: string) {
    view = next;
    shell.dataset.workspaceView = next;
    graph.hidden = view !== "research";
    surface.hidden = view === "research";
    nav.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((b) => {
      if (b.dataset.view === next) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
    syncComposer();
    renderView();
  }
  function setMode(enabled: boolean) {
    annotate = enabled;
    document.body.classList.toggle("research-annotating", annotate);
    window.postMessage(
      { type: "lavish:setAnnotationMode", enabled: annotate },
      window.location.origin,
    );
    if (enabled) openDrawer("queue");
    else if (dialog.open && drawer?.currentTab === "queue") drawer.render();
  }
  function resolveTarget(context: any): {
    target: AnnotationTarget;
    investigationId?: string;
  } {
    let element: Element | null = null;
    try {
      element = document.querySelector(context.selector);
    } catch {
      /* A stale selection still carries its captured text. */
    }
    const semantic = element?.closest("[data-research-target]");
    let target: AnnotationTarget = semantic
      ? JSON.parse(semantic.getAttribute("data-research-target")!)
      : { label: context.text || "Selected research" };
    const node = element?.closest(
      "[data-person-id], [data-context-entity-id], [data-union-id], [data-connection-id]",
    );
    if (!semantic && node) {
      const names: [string, AnnotationTarget["table"]][] = [
        ["data-person-id", "people"],
        ["data-context-entity-id", "contextEntities"],
        ["data-union-id", "unions"],
        ["data-connection-id", "contextConnections"],
      ];
      for (const [attr, table] of names)
        if (node.hasAttribute(attr)) {
          target = {
            table,
            recordId: node.getAttribute(attr)!,
            label: node.getAttribute("data-lavish-label") || context.text,
          };
          break;
        }
    }
    const proposal =
      element?.closest<HTMLElement>("[data-proposal-id]")?.dataset.proposalId;
    if (proposal) target.proposalId = proposal;
    const graphReviewId = element?.closest<HTMLElement>("[data-graph-review-id]")?.dataset.graphReviewId;
    if (graphReviewId) target.graphReviewId = graphReviewId;
    return {
      target: {
        ...target,
        selector: context.selector,
        text: context.text,
        anchor: context.target,
      },
      investigationId: element?.closest<HTMLElement>("[data-investigation-id]")
        ?.dataset.investigationId,
    };
  }
  function openDrawer(tab?: DrawerTab, reference?: AnnotationTarget) {
    if (!dialog.open) dialog.show();
    // Lay the drawer out first so the conversation can scroll to its end.
    syncComposer();
    if (reference) drawer!.addReference(reference);
    else drawer!.show(tab || drawer!.currentTab);
  }
  function closeDrawer() {
    setMode(false);
    dialog.close();
    syncComposer();
    updateCounts();
  }
  // Following a reference keeps a browser history entry, so Back returns here.
  function navigate(reference: AnnotationTarget) {
    if (reference.table === "sources" && reference.recordId) {
      showSource(undefined, undefined, reference.recordId);
      return;
    }
    if (reference.recordId) {
      setView("research");
      window.location.hash = new URLSearchParams({ node: reference.recordId }).toString();
      return;
    }
    const owner = state.investigations.find(
      (i) =>
        i.proposals.some((p) => p.id === reference.proposalId) ||
        i.reviewFlow?.walkthroughs.some((w) => w.id === reference.walkthroughId) ||
        i.reviewFlow?.graphReviews.some((r) => r.id === reference.graphReviewId),
    );
    if (!owner) return;
    selectedInvestigation = owner.id;
    setView(reference.walkthroughId || reference.graphReviewId ? "review" : "work");
  }
  drawer = new AnnotationsDrawer(dialog, {
    state: () => state,
    command: (data) => command(data, false),
    navigate,
    batchAction: (batchId) => {
      selectedInvestigation = batchId;
      setView("review");
    },
    setSelecting: (enabled) => setMode(enabled),
    selecting: () => annotate,
    changed: () => updateCounts(),
  });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeDrawer();
  });
  dialog.addEventListener("click", (event) => {
    if ((event.target as Element).closest("[data-close]")) closeDrawer();
  });
  (window as any).lavishUnifiedFeedback = {
    selectReference: (context: any) => {
      openDrawer("queue", resolveTarget(context).target);
    },
  };
  createArtifactSdk(deriveLavishQueueKey);
  setMode(false);
  window.addEventListener("message", (event) => {
    if (
      event.source === window &&
      event.data?.type === "lavish:toggleAnnotationMode"
    )
      setMode(!annotate);
  });
  // D3 starts gestures on mousedown; stop those gestures only while selecting annotations.
  shell.addEventListener(
    "mousedown",
    (event) => {
      if (annotate && (event.target as Element).closest("svg"))
        event.stopPropagation();
    },
    true,
  );
  nav.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>(
      "button",
    );
    if (button?.dataset.view) setView(button.dataset.view);
    else if (button?.hasAttribute("data-add-instruction")) {
      if (dialog.open) closeDrawer();
      else openDrawer();
    }
  });
  notice
    .querySelector("button")!
    .addEventListener(
      "click",
      () => {
        if (activityDestination) {
          selectedInvestigation = activityDestination;
          selectedProposal = undefined;
          setView(state.investigations.find(i => i.id === activityDestination)?.reviewFlow?.walkthroughs.length ? "review" : "work");
          notice.hidden = true;
        } else void refresh().catch((error) => message(error.message));
      },
    );

  function heading(kicker: string, title: string, description: string) {
    return `<header class="surface-heading"><span class="eyebrow">${kicker}</span><h1>${title}</h1><p>${description}</p></header>`;
  }
  function empty(title: string, detail: string) {
    return `<div class="workspace-empty"><span class="empty-symbol" aria-hidden="true">⌖</span><h2>${title}</h2><p>${detail}</p><button type="button" data-go-research>Explore the research graph</button></div>`;
  }
  function renderFindings() {
    const scroller = surface.querySelector<HTMLElement>(".findings-scroll");
    const top = scroller?.scrollTop || 0;
    surface.innerHTML = findingsPage(state, findingsSection, expandedReports);
    const next = surface.querySelector<HTMLElement>(".findings-scroll");
    if (next) next.scrollTop = top;
    markContents();
  }
  // Highlight the question being read in the contents.
  function markContents() {
    const scroller = surface.querySelector<HTMLElement>(".findings-scroll");
    if (!scroller) return;
    const edge = scroller.getBoundingClientRect().top + 80;
    let current: string | undefined;
    for (const section of scroller.querySelectorAll<HTMLElement>(".batch-question[id]"))
      if (section.getBoundingClientRect().top <= edge) current = section.id;
    surface
      .querySelectorAll<HTMLElement>(".findings-toc [data-toc]")
      .forEach((a) => a.classList.toggle("current", a.dataset.toc === current));
  }
  surface.addEventListener(
    "scroll",
    (event) => {
      if ((event.target as Element).matches?.(".findings-scroll")) markContents();
    },
    true,
  );
  function renderView() {
    guidedReview?.destroy();
    guidedReview = undefined;
    previewGeneration++;
    previewRenderer?.destroy();
    previewRenderer = undefined;
    if (view === "research") return;
    surface.classList.toggle("is-findings", view === "work");
    if (view === "work") {
      renderFindings();
      return;
    }
    if (view === "sources") {
      renderSources();
      return;
    }
    if (view === "feedback") {
      surface.innerHTML = feedbackView(state);
      return;
    }
    const items = [...state.investigations]
      .reverse()
      .filter((i) => view !== "review" || i.proposals.length > 0 || i.reviewFlow?.walkthroughs.length);
    if (!items.some((i) => i.id === selectedInvestigation)) {
      selectedInvestigation = items[0]?.id;
      selectedProposal = undefined;
    }
    const investigation = currentInvestigation();
    if (view === "settings")
      surface.innerHTML = settingsView(state, investigation);
    else {
      const picker =
        items.length > 1
          ? `<label class="investigation-picker">Investigation <select data-investigation-picker>${items.map((i) => `<option value="${i.id}" ${i.id === selectedInvestigation ? "selected" : ""}>${escape(investigationSubject(i))}</option>`).join("")}</select></label>`
          : "";
      surface.innerHTML = `<div class="investigation-desk"><div class="desk-tools">${picker}<button class="text-action" data-open-settings>Research settings</button></div>${investigation ? `<article class="investigation-detail" data-investigation-id="${investigation.id}">${reviewDetail(investigation)}</article>` : empty("No findings are ready for review yet", "Saved research notes remain in Investigations while findings are being prepared.")}</div>`;
      if (view === "review" && investigation?.reviewFlow?.walkthroughs.length) {
        guidedReview = new GuidedReview(surface.querySelector<HTMLElement>("[data-guided-host]")!, state, investigation, {
          command: async data => {
            await request("/api/review-flow", data);
            await refresh();
          },
          source: (id, quote) => showSource(undefined, quote, id),
          error: text => message(text),
        });
      }
    }
    surface
      .querySelector("#research-time-limit-mode")
      ?.addEventListener("change", () => {
        const limited =
          surface.querySelector<HTMLSelectElement>("#research-time-limit-mode")!
            .value === "limited";
        surface.querySelector<HTMLElement>(".time-limit-value")!.hidden =
          !limited;
        surface.querySelector<HTMLInputElement>(
          "#research-time-limit",
        )!.disabled = !limited;
      });
    surface
      .querySelector("#time-limit-form")
      ?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const limited =
          surface.querySelector<HTMLSelectElement>("#research-time-limit-mode")!
            .value === "limited";
        const minutes = limited
          ? surface.querySelector<HTMLInputElement>("#research-time-limit")!
              .valueAsNumber
          : null;
        if (limited && (!Number.isSafeInteger(minutes) || minutes! < 1)) {
          message("Enter a positive whole number of minutes.");
          return;
        }
        try {
          await request("/api/research-settings", {
            timeLimitMinutes: minutes,
          });
          await refresh();
          message(
            minutes === null
              ? "Time limit removed for new research passes."
              : `New research passes will have a ${minutes}-minute limit.`,
          );
        } catch (error) {
          message((error as Error).message);
        }
      });
    surface
      .querySelector("#engine-form")
      ?.addEventListener("submit", async (event) => {
        event.preventDefault();
        try {
          await request("/api/engine", {
            engine:
              surface.querySelector<HTMLSelectElement>("#research-engine")!
                .value,
          });
          await refresh();
          message("Researcher preference saved.");
        } catch (error) {
          message((error as Error).message);
        }
      });
  }
  function recordFields(record: Record<string, unknown> | null): string {
    if (!record) return '<p class="muted">Not present</p>';
    const name = (id: unknown) =>
      [
        ...state.dataset.people,
        ...(state.dataset.contextEntities ?? []),
        ...(state.dataset.sources ?? []),
      ].find((r) => r.id === id);
    const display = (value: unknown): string => {
      const record = name(value);
      if (record) return "name" in record ? record.name : record.title;
      return typeof value === "object" ? JSON.stringify(value) : String(value);
    };
    const labels: Record<string, string> = {
      fromId: "From",
      toId: "To",
      parentId: "Parent",
      childId: "Child",
      sourceIds: "Sources",
      partnerIds: "Partners",
      childIds: "Children",
      researchNotes: "Research notes",
    };
    return `<dl class="record-fields">${Object.entries(record)
      .filter(([key]) => key !== "id")
      .map(
        ([key, value]) =>
          `<div><dt>${escape(labels[key] || key.replace(/([A-Z])/g, " $1"))}</dt><dd>${escape(Array.isArray(value) ? value.map(display).join(" · ") : display(value))}</dd></div>`,
      )
      .join("")}</dl>`;
  }
  function reviewDetail(i: Investigation): string {
    if (i.reviewFlow?.walkthroughs.length) return '<div data-guided-host></div>';
    const p =
      i.proposals.find((p) => p.id === selectedProposal) ||
      i.proposals.filter((p) => p.status === "pending").at(-1) ||
      i.proposals.at(-1)!;
    if (!p) return empty("Research is being prepared", "The coordinator will publish an explanation here when the evidence is ready.");
    selectedProposal = p.id;
    if (p.kind)
      return findingReview(
        state,
        i,
        p,
        readingMode,
        cardIndex,
        selectedGroups.get(p.id),
      );
    const outstanding = i.annotations.some(
      (a) => !p.addressedAnnotationIds.includes(a.id),
    );
    const sourceTitle = (id: string) =>
      state.dataset.sources?.find((s) => s.id === id)?.title ||
      p.changes.find((c) => c.table === "sources" && c.recordId === id)?.after
        ?.title ||
      id;
    return `<div data-proposal-id="${p.id}" ${targetAttribute({ label: p.title, proposalId: p.id })}><div class="detail-topline"><span class="status-badge status-${p.status}">${escape(p.status)}</span><span class="muted">Revision ${p.revision} · ${date(p.createdAt)}</span></div><div class="origin-question"><span class="eyebrow">Your investigation</span><p>${escape(i.annotations[0]?.question)}</p></div><h2>${escape(p.title)}</h2><p class="proposal-summary">${escape(p.summary)}</p><div class="revision-choices" aria-label="Proposal revisions">${i.proposals.map((version) => `<button type="button" data-proposal="${version.id}" aria-pressed="${version.id === p.id}">Revision ${version.revision}</button>`).join("")}</div>${outstanding ? '<div class="activity-callout">New feedback belongs to this investigation. Open Annotations, then Queued, to send queued annotations, then review the revised proposal before accepting.</div>' : ""}<section class="review-section"><span class="eyebrow">Evidence and interpretation</span><h3>What the sources actually support</h3>${p.evidence.map((e) => `<article class="evidence-card" ${targetAttribute({ label: `Evidence: ${sourceTitle(e.sourceId)}`, proposalId: p.id })}><div class="detail-topline"><span class="status-badge">${escape(e.stance)}</span><span class="muted">${escape(e.locator)}</span></div><h4>${escape(sourceTitle(e.sourceId))}</h4><blockquote>${escape(e.quote)}</blockquote><div class="interpretation" ${targetAttribute({ label: "Interpretation of evidence", proposalId: p.id })}><span class="eyebrow">Interpretation</span><p>${escape(e.interpretation)}</p></div><details><summary>Surrounding context</summary><p class="preserve-lines">${escape(e.context)}</p></details><button type="button" data-evidence="${escape(e.id)}">View source in context ↗</button></article>`).join("") || '<p class="muted">No source passages were found. This outcome records an open question.</p>'}</section>${p.ambiguity ? `<section class="ambiguity-card" ${targetAttribute({ label: "Remaining ambiguity", proposalId: p.id })}><span class="eyebrow">Still open</span><h3>Uncertainty worth preserving</h3><p class="preserve-lines">${escape(p.ambiguity)}</p></section>` : ""}<section class="review-section"><span class="eyebrow">Proposed model changes</span><h3>${p.changes.length ? `${p.changes.length} change${p.changes.length === 1 ? "" : "s"} to review together` : "Preserve an unresolved outcome"}</h3>${p.changes.map((c) => `<article class="change-card" ${targetAttribute({ table: c.table, recordId: c.recordId, label: String(c.after?.name || c.after?.label || c.before?.name || c.recordId), proposalId: p.id })}><h4>${escape(c.after?.name || c.after?.label || c.before?.name || c.recordId)}</h4><p>${escape(c.reason)}</p><div class="change-comparison"><section><span class="eyebrow">Accepted now</span>${recordFields(c.before)}</section><section><span class="eyebrow">Proposed</span>${recordFields(c.after)}</section></div></article>`).join("")}</section><footer class="review-decision">${p.status === "pending" ? `<p>${p.changes.length ? "Accepting applies these exact changes together and preserves this review." : "Recording this outcome preserves the ambiguity without changing the graph."}</p><div><button class="primary" data-command="accept" ${outstanding || i.status !== "review" ? "disabled" : ""}>${p.changes.length ? "Accept proposal" : "Record unresolved outcome"}</button><button data-command="reject" ${outstanding || i.status !== "review" ? "disabled" : ""}>Reject proposal</button><button data-followup>Request further research</button></div>` : `<p>${p.status === "accepted" ? "Accepted and preserved in the research history." : p.status === "superseded" ? "A later research pass superseded this proposal. It remains available for inspection." : "Rejected. The accepted research was unchanged."}</p><button data-followup>Continue this investigation</button>`}</footer></div>`;
  }
  function renderSources() {
    if (selectedSource) {
      showSource(undefined, undefined, selectedSource);
      return;
    }
    const library = sourceLibrary(state);
    surface.innerHTML =
      heading(
        "Research materials",
        "Sources & access",
        "Choose where researchers can look. Preserve the documents behind their conclusions.",
      ) +
      `<section class="source-library"><div class="section-heading"><h2>Research source library</h2><span class="count-label">${library.length}</span></div>${library.length ? library.map((s) => `<button class="document-row" data-open-source="${escape(s.id)}"><span><strong>${escape(s.title)}</strong><small>${escape(s.repository || s.url || "Recorded source")}</small></span><span class="capability">${escape(s.access || "Access not recorded")}</span></button>`).join("") : '<p class="source-empty">Sources gathered by researchers will appear here before graph acceptance.</p>'}</section><div class="sources-layout"><section><div class="section-heading"><h2>Available collections</h2><span class="count-label">${state.collections.length}</span></div>${state.collections.map((c) => `<article class="collection-card"><div class="collection-icon" aria-hidden="true">${c.kind === "web" ? "◎" : "▤"}</div><div><h3>${escape(c.name)}</h3><p>${escape(c.description)}</p><span class="capability">${c.kind === "web" ? "Requires a researcher with web access" : `${state.documents.filter((d) => d.collectionId === c.id).length} preserved documents`}</span>${c.path ? `<p class="folder-path">${escape(c.path)}</p><button type="button" data-rescan="${escape(c.path)}">Re-scan folder</button>` : ""}</div></article>`).join("")}<div class="section-heading"><h2>Preserved documents</h2></div>${state.documents.length ? `<div class="document-list">${state.documents.map((d) => `<button class="document-row" type="button" data-document="${d.id}"><span><strong>${escape(d.name)}</strong><small>${escape(state.collections.find((c) => c.id === d.collectionId)?.name)} · ${Math.ceil(d.size / 1024)} KB</small></span><span class="capability">${d.text !== undefined ? "Readable text" : "Original PDF · extraction not enabled"}</span></button>`).join("")}</div>` : '<div class="source-empty">Add documents or a local folder to give your research a starting collection.</div>'}</section><aside class="source-controls"><section class="source-add-card"><span class="eyebrow">Add research materials</span><h2>Bring your own collection</h2><p>Import PDFs, text, Markdown, or CSV. Original copies are retained for evidence review.</p><label class="upload-label">Choose documents<input id="source-upload" type="file" accept=".pdf,.txt,.md,.csv" multiple></label><p class="muted">Up to 10 MB per document.</p><hr><form id="folder-form"><label for="folder-path">Local folder</label><input id="folder-path" placeholder="/Users/you/Documents/Research" required><button type="submit">Add folder</button></form><p class="muted">Scans up to 100 supported files, four folders deep. Changes to originals do not alter preserved copies.</p><p id="source-result" role="status"></p></section><section class="access-note"><h3>Subscription collections</h3><p>JSTOR and other subscription services need a supported access adapter. No account connection is enabled yet. You can import documents you already have.</p></section></aside></div>`;
    surface
      .querySelector<HTMLInputElement>("#source-upload")!
      .addEventListener("change", async (event) => {
        const files = [...((event.target as HTMLInputElement).files || [])];
        try {
          for (const file of files) {
            if (file.size > 10_000_000)
              throw new Error(`${file.name} exceeds 10 MB.`);
            const content = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () =>
                resolve(String(reader.result).split(",")[1]!);
              reader.onerror = reject;
              reader.readAsDataURL(file);
            });
            await request("/api/import", { name: file.name, content });
          }
          await refresh();
          message(
            `Imported ${files.length} document${files.length === 1 ? "" : "s"}. Originals are preserved.`,
          );
        } catch (error) {
          message((error as Error).message);
          await refresh();
        }
      });
    surface
      .querySelector("#folder-form")!
      .addEventListener("submit", (event) => {
        event.preventDefault();
        void scanFolder(
          surface.querySelector<HTMLInputElement>("#folder-path")!.value,
        );
      });
  }
  async function scanFolder(path: string) {
    try {
      const result = await request("/api/folders", { path });
      await refresh();
      const output = surface.querySelector("#source-result");
      if (output)
        output.textContent = `Inspected ${result.inspected} supported files. ${result.skipped.length ? `Skipped: ${result.skipped.join("; ")}` : "All supported files preserved."}`;
    } catch (error) {
      message((error as Error).message);
    }
  }
  shell.addEventListener("click", (event) => {
    const b = (event.target as Element).closest<HTMLElement>(
      "[data-inspect-source],[data-related-review]",
    );
    if (b?.dataset.inspectSource)
      showSource(undefined, undefined, b.dataset.inspectSource);
    if (b?.dataset.relatedReview) {
      selectedInvestigation = b.dataset.relatedReview;
      selectedProposal = b.dataset.relatedProposal;
      cardIndex = 0;
      setView("review");
    }
  });
  window.addEventListener("research:inspect", (event) => {
    const id = (event as CustomEvent).detail.id;
    nodeInspector?.querySelector(".related-findings")?.remove();
    const mapped = state.investigations.flatMap((i) =>
      i.proposals.flatMap((p) =>
        (p.groups || [])
          .filter(
            (g) =>
              g.status === "accepted" &&
              g.changeIndexes.some((n) => {
                const c = p.changes[n];
                return (
                  c?.recordId === id ||
                  [c?.before, c?.after].some(
                    (r) =>
                      r &&
                      Object.values(r).some(
                        (v) => v === id || (Array.isArray(v) && v.includes(id)),
                      ),
                  )
                );
              }),
          )
          .flatMap((g) =>
            g.findingRefs.map((r) => ({
              i,
              p: i.proposals.find((p) => p.id === r.proposalId)!,
              f: i.proposals
                .find((p) => p.id === r.proposalId)
                ?.findings?.find((f) => f.id === r.findingId),
            })),
          ),
      ),
    );
    if (!mapped.length) return;
    const section = document.createElement("section");
    section.className = "detail-section related-findings";
    section.innerHTML = `<h3 class="detail-kicker">Research behind this record</h3>${mapped.map(({ i, p, f }) => `<article data-investigation-id="${i.id}" ${targetAttribute({ label: f?.statement || "Finding", proposalId: p.id, findingId: f?.id })}><p>${escape(f?.statement)}</p><span class="status-badge">${escape(f?.qualification)} · ${escape(f?.status)}</span>${f?.status !== "kept" ? '<p class="muted">This finding has changed since the graph was accepted. Review its replacement before updating the graph.</p>' : ""}<button data-related-review="${i.id}" data-related-proposal="${p.id}">Review finding</button></article>`).join("")}`;
    nodeInspector?.append(section);
  });
  function showSource(
    documentId?: string,
    quote?: string,
    sourceId?: string,
    proposal?: Proposal,
  ) {
    const doc = state.documents.find((d) => d.id === (documentId || sourceId));
    const source =
      sourceLibrary(state).find((s) => s.id === sourceId) ||
      proposal?.changes.find(
        (c) => c.table === "sources" && c.recordId === sourceId,
      )?.after;
    let body: string;
    if (doc?.text !== undefined) {
      const index = quote ? doc.text.indexOf(quote) : -1;
      body = `<pre class="original-text">${index >= 0 ? `${escape(doc.text.slice(0, index))}<mark>${escape(quote)}</mark>${escape(doc.text.slice(index + quote!.length))}` : escape(doc.text)}</pre>`;
    } else if (doc)
      body = `<p class="muted">Original PDF. Use the cited page or locator to inspect the passage; automatic PDF highlighting is not enabled.</p><iframe title="Original PDF" src="/api/documents/${doc.id}"></iframe>`;
    else
      body = `<p>The original document has not been preserved in this workspace.</p>${source && safeUrl(String(source.url || "")) ? `<a class="primary source-external" href="${safeUrl(String(source.url))}" target="_blank" rel="noopener noreferrer">Open original source ↗</a>` : '<p class="muted">No accessible source URL is recorded. Import the original or annotate the evidence to request a precise source.</p>'}`;
    selectedSource = sourceId;
    view = "sources";
    shell.dataset.workspaceView = view;
    graph.hidden = true;
    surface.hidden = false;
    syncComposer();
    nav.querySelectorAll("[data-view]").forEach((b) => {
      if ((b as HTMLElement).dataset.view === "sources")
        b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
    const passages = state.investigations.flatMap((i) =>
      i.proposals.flatMap((p) =>
        p.evidence
          .filter(
            (e) =>
              e.sourceId === sourceId ||
              (documentId && e.documentId === documentId),
          )
          .map((e) => ({ i, p, e })),
      ),
    );
    const related = state.investigations.flatMap((i) =>
      i.proposals.flatMap((p) =>
        (p.findings || [])
          .filter((f) =>
            f.evidenceIds.some((id) =>
              p.evidence.some((e) => e.id === id && e.sourceId === sourceId),
            ),
          )
          .map((f) => ({ i, p, f })),
      ),
    );
    const subjects = [
      ...state.dataset.people,
      ...(state.dataset.contextEntities || []),
      ...(state.dataset.contextConnections || []),
    ].filter((r) => r.sourceIds?.includes(sourceId || ""));
    surface.innerHTML = `<button data-source-list>Back to source library</button>${currentInvestigation()?.reviewFlow?.walkthroughs.length ? '<button data-open-review>Return to your walkthrough</button>' : ""}<article class="source-inspector" ${targetAttribute({ table: "sources", recordId: sourceId || documentId, label: String(source?.title || doc?.name || "Source") })}><span class="eyebrow">Source record</span><h1>${escape(source?.title || doc?.name || "Source")}</h1><p>${[source?.repository, source?.access || "Access not recorded"].filter(Boolean).map(escape).join(" · ")}</p><p class="preserve-lines">${escape(source?.note)}</p>${doc ? `<p>Preserved ${date(doc.importedAt)}</p><a href="/api/documents/${doc.id}" target="_blank" rel="noopener">Open preserved original</a>` : ""}<section class="source-content">${body}</section><h2>Findings from this source</h2>${related.map(({ i, p, f }) => `<section class="source-finding" data-investigation-id="${i.id}" ${targetAttribute({ label: f.statement, proposalId: p.id, findingId: f.id })}><span class="status-badge">${escape(f.status)} · ${escape(f.qualification)}</span><h3>${escape(f.statement)}</h3><p class="preserve-lines">${escape(f.explanation)}</p><button data-source-review="${i.id}" data-source-proposal="${p.id}">Open finding review</button></section>`).join("") || '<p class="muted">No structured findings recorded yet.</p>'}<h2>Accepted graph connections</h2>${subjects.map((r) => `<p ${targetAttribute({ label: "name" in r ? r.name : r.label || r.id, recordId: r.id })}>${escape("name" in r ? r.name : r.label || r.id)}</p>`).join("") || '<p class="muted">No accepted graph records cite this source yet.</p>'}<details><summary>Recorded passages and review history (${passages.length})</summary>${passages.map(({ i, p, e }) => `<section data-investigation-id="${i.id}"><p class="muted">Revision ${p.revision} · ${escape(p.status)}</p>${evidenceCard(state, p, e)}</section>`).join("")}</details></article>`;
    surface.querySelectorAll("[data-evidence]").forEach((b) => b.remove());
    surface.querySelector("mark")?.scrollIntoView({ block: "center" });
  }
  async function previewGroups() {
    const i = currentInvestigation()!;
    const p = i.proposals.find((p) => p.id === selectedProposal)!;
    const ids = [...(selectedGroups.get(p.id) || [])];
    const changes = graphSelection(state, i, p, ids);
    const dataset = applyChanges(
      { ...state.dataset, sources: registeredSources(state) },
      changes,
    );
    const host = surface.querySelector<HTMLElement>("#graph-review-preview")!;
    previewRenderer?.destroy();
    const generation = ++previewGeneration;
    host.innerHTML = `<h3>Proposed graph</h3><p>Outlined nodes and edges are changed by this selection. Your accepted graph remains unchanged.</p>${changes
      .filter((c) => !c.after)
      .map(
        (c) =>
          `<p class="removal-note">Remove: ${escape(c.before?.name || c.before?.label || c.recordId)}</p>`,
      )
      .join(
        "",
      )}<div class="proposal-graph"></div><div class="preview-details"></div><button class="primary" data-apply-preview>${ids.length ? `Apply these ${ids.length} groups` : "Record outcome without graph changes"}</button>`;
    const model = new GenealogyModel(dataset);
    const focus =
      dataset.initialFocusId ||
      dataset.people[0]?.id ||
      dataset.contextEntities?.[0]?.id;
    const container = host.querySelector<HTMLElement>(".proposal-graph")!;
    const inspect = (id: string) => {
      const c = changes.find((c) => c.recordId === id);
      const r = [...dataset.people, ...(dataset.contextEntities || [])].find(
        (r) => r.id === id,
      );
      const group = p.groups!.find((g) =>
        g.changeIndexes.some((n) => p.changes[n]!.recordId === id),
      );
      host.querySelector(".preview-details")!.innerHTML =
        `<section ${targetAttribute({ label: r?.name || id, recordId: id, proposalId: p.id, groupId: group?.id })}><h4>${escape(r?.name || id)}</h4>${recordFields((r as unknown as Record<string, unknown>) || null)}${c ? `<p>${escape(c.reason)}</p>` : ""}</section>`;
    };
    const renderer = new GraphRenderer(
      container,
      {
        onFocus: inspect,
        onOpenDetails: inspect,
        onOpenContextEntity: inspect,
      },
      true,
    );
    previewRenderer = renderer;
    if (focus) {
      const projection = projectAround(model, focus);
      const layout = await layoutFamily(model, projection);
      if (generation !== previewGeneration) return;
      renderer.render(layout, projection, model);
      renderer.fitAll(false);
    }
    const changedIds = new Set(changes.map((c) => c.recordId));
    container
      .querySelectorAll<HTMLElement>(
        "[data-person-id],[data-context-entity-id],[data-connection-id]",
      )
      .forEach((el) => {
        const id =
          el.dataset.personId ||
          el.dataset.contextEntityId ||
          el.dataset.connectionId;
        if (id && changedIds.has(id)) el.classList.add("proposed-change");
        const group = p.groups!.find((g) =>
          g.changeIndexes.some((n) => p.changes[n]!.recordId === id),
        );
        if (group)
          el.setAttribute(
            "data-research-target",
            JSON.stringify({
              label: group.title,
              recordId: id,
              proposalId: p.id,
              groupId: group.id,
            }),
          );
      });
    host
      .querySelector("[data-apply-preview]")!
      .addEventListener("click", () => {
        void command({
          type: "apply-groups",
          investigationId: i.id,
          proposalId: p.id,
          groupIds: ids,
        })
          .then(() => {
            selectedGroups.delete(p.id);
            message("Selected graph groups applied.");
          })
          .catch((e) => message(e.message));
      });
  }

  const handleContentClick = (event: Event) => {
    const link = (event.target as Element).closest<HTMLElement>("[data-toc]");
    if (link) {
      event.preventDefault();
      document
        .getElementById(link.dataset.toc!)
        ?.scrollIntoView({ block: "start", behavior: "smooth" });
      return;
    }
    const button = (event.target as Element).closest<HTMLButtonElement>(
      "button",
    );
    if (!button) return;
    // Actions inside a batch card act on that batch.
    const owner = button.closest<HTMLElement>("[data-investigation-id]")?.dataset
      .investigationId;
    if (owner) selectedInvestigation = owner;
    if (button.hasAttribute("data-open-walkthrough")) {
      selectedProposal = undefined;
      setView("review");
      return;
    }
    if (button.dataset.moreFindings) {
      expandedReports.add(button.dataset.moreFindings);
      renderFindings();
      return;
    }
    if (button.hasAttribute("data-open-settings")) {
      setView("settings");
      return;
    }
    if (button.hasAttribute("data-view-work")) {
      setView("work");
      return;
    }
    if (button.hasAttribute("data-new-interface-note")) {
      openDrawer("queue");
      return;
    }
    if (button.dataset.investigationSection) {
      findingsSection = button.dataset.investigationSection as FindingsSection;
      renderView();
      return;
    }
    if (button.dataset.sourceReview) {
      selectedInvestigation = button.dataset.sourceReview;
      selectedProposal = button.dataset.sourceProposal;
      cardIndex = 0;
      setView("review");
      return;
    }
    if (button.hasAttribute("data-add-question")) {
      openDrawer("queue");
      return;
    }
    if (button.dataset.readingMode) {
      readingMode = button.dataset.readingMode;
      renderView();
      return;
    }
    if (button.dataset.cardStep) {
      cardIndex = Math.max(0, cardIndex + Number(button.dataset.cardStep));
      renderView();
      return;
    }
    if (button.dataset.keepFinding || button.dataset.deferFinding) {
      void command({
        type: "finding-decision",
        investigationId: selectedInvestigation,
        proposalId: selectedProposal,
        findingId: button.dataset.keepFinding || button.dataset.deferFinding,
        decision: button.dataset.keepFinding ? "kept" : "deferred",
      }).catch((e) => message(e.message));
      return;
    }
    if (button.dataset.questionFinding || button.dataset.questionGroup) {
      openDrawer("queue", {
        label: button.dataset.questionFinding
          ? "Question this finding"
          : "Question this graph representation",
        proposalId: selectedProposal,
        findingId: button.dataset.questionFinding,
        groupId: button.dataset.questionGroup,
      });
      return;
    }
    if (button.hasAttribute("data-build-graph")) {
      const refs = [
        ...surface.querySelectorAll<HTMLInputElement>(
          "[data-build-ref]:checked",
        ),
      ].map((e) => JSON.parse(e.dataset.buildRef!));
      void command({
        type: "build-graph",
        investigationId: selectedInvestigation,
        refs,
      })
        .then(() => setView("work"))
        .catch((e) => message(e.message));
      return;
    }
    if (button.hasAttribute("data-preview-groups")) {
      void previewGroups().catch((e) => message(e.message));
      return;
    }
    if (button.dataset.openSource) {
      showSource(undefined, undefined, button.dataset.openSource);
      return;
    }
    if (button.hasAttribute("data-source-list")) {
      selectedSource = undefined;
      setView("sources");
      return;
    }
    if (button.dataset.selectInvestigation) {
      selectedInvestigation = button.dataset.selectInvestigation;
      selectedProposal = undefined;
      cardIndex = 0;
      renderView();
    } else if (button.hasAttribute("data-go-research")) setView("research");
    else if (button.hasAttribute("data-open-review")) setView("review");
    else if (button.dataset.proposal) {
      selectedProposal = button.dataset.proposal;
      cardIndex = 0;
      renderView();
    } else if (button.dataset.command)
      void command({
        type: button.dataset.command as ResearchCommand["type"],
        investigationId: selectedInvestigation,
        proposalId: selectedProposal,
        requestId: button.dataset.resumeRequest,
        decision: button.dataset.resumeDecision,
      })
        .then(() => message("Research state saved."))
        .catch((error) => message(error.message));
    else if (button.hasAttribute("data-followup"))
      openDrawer("queue", {
        label: currentInvestigation()!.title,
        proposalId: selectedProposal,
      });
    else if (button.dataset.rescan) void scanFolder(button.dataset.rescan);
    else if (button.dataset.document) showSource(button.dataset.document);
    else if (button.dataset.evidence) {
      const p = currentInvestigation()!.proposals.find(
        (p) => p.id === selectedProposal,
      )!;
      const e = p.evidence.find((e) => e.id === button.dataset.evidence)!;
      showSource(e.documentId, e.quote, e.sourceId, p);
    }
  };
  surface.addEventListener("click", handleContentClick);
  surface.addEventListener("change", (event) => {
    const e = event.target as HTMLInputElement;
    if (e.hasAttribute("data-investigation-picker")) {
      selectedInvestigation = e.value;
      selectedProposal = undefined;
      cardIndex = 0;
      renderView();
      return;
    }
    if (e.dataset.graphGroup && selectedProposal) {
      const ids = selectedGroups.get(selectedProposal) || new Set<string>();
      if (e.checked) ids.add(e.dataset.graphGroup);
      else ids.delete(e.dataset.graphGroup);
      selectedGroups.set(selectedProposal, ids);
      previewGeneration++;
      previewRenderer?.destroy();
      previewRenderer = undefined;
      surface.querySelector("#graph-review-preview")?.replaceChildren();
    }
    if (e.hasAttribute("data-card-jump")) {
      cardIndex = Number(e.value);
      renderView();
    }
  });
  // Refresh activity without replacing an open walkthrough or its reading position.
  let polling = false;
  window.setInterval(async () => {
    if (polling || busy || document.hidden) return;
    polling = true;
    try {
      const revision = await request("/api/revision");
      nav.querySelector(".local-indicator")!.textContent =
        "Saved on this computer";
      if (revision.coordinator) {
        state.coordinator = revision.coordinator;
        const status = surface.querySelector("[data-coordinator-status]");
        const description = surface.querySelector(
          "[data-coordinator-description]",
        );
        if (status)
          status.textContent = revision.coordinator.connected
            ? "Coordinator connected"
            : revision.coordinator.enabled
              ? "Waiting for your coordinator"
              : "Agent-led research available";
        if (description)
          description.textContent = revision.coordinator.connected
            ? `${revision.coordinator.name} is supervising research and preparing proposals.`
            : "Research and findings are saved. Open an agent in the research repository to continue.";
      }
      if (revision.revision !== state.revision) {
        const previous = state;
        await refresh(false);
        const current = currentInvestigation();
        if (guidedReview && current) guidedReview.update(state, current);
        const changed = [...state.investigations].reverse().find(i => {
          const prior = previous.investigations.find(p => p.id === i.id);
          return i.reviewFlow?.walkthroughs.at(-1)?.id !== prior?.reviewFlow?.walkthroughs.at(-1)?.id
            || i.reviewFlow?.graphReviews.at(-1)?.id !== prior?.reviewFlow?.graphReviews.at(-1)?.id
            || i.reviewFlow?.jobs.at(-1)?.status !== prior?.reviewFlow?.jobs.at(-1)?.status
            || i.proposals.length !== prior?.proposals.length;
        });
        if (changed && !(guidedReview && current?.id === changed.id)) {
          activityDestination = changed.id;
          const job = changed.reviewFlow?.jobs.at(-1);
          notice.querySelector("span")!.textContent = changed.reviewFlow?.graphReviews.at(-1)
            ? `Proposed graph ready: ${investigationSubject(changed)}`
            : job?.status === "paused" ? `Graph preparation paused: ${investigationSubject(changed)}`
            : changed.reviewFlow?.walkthroughs.length ? `Research walkthrough ready: ${investigationSubject(changed)}`
            : `Research activity: ${investigationSubject(changed)}`;
          notice.querySelector("button")!.textContent = changed.reviewFlow?.walkthroughs.length ? "Open review" : "Open investigation";
          notice.hidden = false;
        }
      }
    } catch {
      nav.querySelector(".local-indicator")!.textContent =
        "Workspace connection interrupted";
    } finally {
      polling = false;
    }
  }, 2500);
  mountOrganizationPanel(
    () => state,
    request,
    () => refresh(),
    message,
  );
  document
    .querySelector("[data-ask-topic]")
    ?.addEventListener("click", () =>
      openDrawer("queue", { label: state.dataset.title, text: state.dataset.title }),
    );
  document
    .querySelector("[data-open-sources]")
    ?.addEventListener("click", () => setView("sources"));
  updateCounts();
  if (view !== "research") setView(view);
}
