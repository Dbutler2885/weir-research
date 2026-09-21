import {
  investigationSubject,
  feedbackView,
  settingsView,
} from "./ui/investigation-view";
import { evidenceCard } from "./ui/finding-review";
import { sourceLibrary } from "./domain/findings";
import { connectionsFromClaims } from "./domain/model";
import { GuidedReview } from "./ui/guided-review";
import { AnnotationsDrawer, type DrawerTab } from "./ui/annotations-drawer";
import type { Message } from "./domain/conversation";
import { findingsPage, type FindingsSection } from "./ui/findings-view";
import { reviewPage } from "./ui/review-view";
import "./review.css";
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
  let findingsSection: FindingsSection = "findings";
  let reviewTarget: { batchId: string; start: "reading" | "graph" } | undefined;
  const expandedReports = new Set<string>();
  let guidedReview: GuidedReview | undefined;
  let selectedSource: string | undefined;
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
    )}</div><div class="workspace-actions"><button type="button" data-view="feedback" class="feedback-destination">Feedback <span data-count="feedback"></span></button><button type="button" class="running-indicator" data-running hidden></button><span class="local-indicator" title="Saved on this computer">Saved</span><button type="button" data-organize-project>Organize</button><button type="button" data-add-instruction role="switch" aria-checked="false" aria-controls="notes-sidebar"><span class="annotation-switch" aria-hidden="true"></span>Annotations <span data-count="queue" title="Queued annotations"></span></button></div>`;
  shell.insertBefore(nav, graph);
  const surface = document.createElement("section");
  surface.className = "research-surface";
  surface.hidden = true;
  shell.append(surface);
  const notice = document.createElement("div");
  notice.className = "workspace-notice";
  notice.hidden = true;
  notice.setAttribute("role", "status");
  notice.innerHTML =
    '<i class="notice-dot"></i><div><strong></strong><span></span></div><button type="button" data-notice-open>Open</button><button type="button" class="notice-dismiss" data-notice-dismiss aria-label="Dismiss">×</button>';
  shell.append(notice);
  let noticeOpen: (() => void) | undefined;
  let noticeMessage: string | undefined;
  function showNotice(title: string, detail: string, action: string, open: () => void, messageId?: string) {
    notice.querySelector("strong")!.textContent = title;
    notice.querySelector("span")!.textContent = detail;
    notice.querySelector("[data-notice-open]")!.textContent = action;
    noticeOpen = open;
    noticeMessage = messageId;
    notice.hidden = false;
  }
  // Dismissing keeps the message unread in the conversation.
  function hideNotice() {
    notice.hidden = true;
    noticeOpen = undefined;
    noticeMessage = undefined;
  }
  const returnBar = document.createElement("button");
  returnBar.type = "button";
  returnBar.className = "return-bar";
  returnBar.hidden = true;
  shell.append(returnBar);
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
      .setAttribute("aria-checked", String(dialog.open));
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
  // True while the workspace service cannot be reached, so the UI can say so.
  let offline = false;
  function setOffline(next: boolean) {
    if (offline === next) return;
    offline = next;
    nav.querySelector(".local-indicator")!.textContent = next
      ? "Workspace connection interrupted"
      : "Saved on this computer";
    if (dialog.open) drawer?.render();
  }
  async function request(path: string, data?: unknown): Promise<any> {
    let response: Response;
    try {
      response = await fetch(
        path,
        data === undefined
          ? {}
          : {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(data),
            },
      );
    } catch {
      setOffline(true);
      throw new Error(
        "The workspace service is not responding. It may have restarted; reload the page to reconnect.",
      );
    }
    setOffline(false);
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error || "Unable to save research.");
    return result;
  }
  // Research the workspace is running right now, said where every tab can see it.
  function updateRunning() {
    const running = state.investigations.filter((i) => ["queued", "running"].includes(i.status)).length;
    const builders = state.investigations.flatMap((i) => i.reviewFlow?.jobs || [])
      .filter((j) => ["queued", "running", "returned"].includes(j.status)).length;
    const writing = state.investigations.filter((i) => i.walkthroughRequestedAt).length;
    const parts = [
      running ? `${running} ${running === 1 ? "researcher" : "researchers"} working` : "",
      builders ? `${builders} graph ${builders === 1 ? "update" : "updates"} building` : "",
      writing ? `${writing} ${writing === 1 ? "walkthrough" : "walkthroughs"} being written` : "",
    ].filter(Boolean);
    const indicator = nav.querySelector<HTMLButtonElement>("[data-running]")!;
    indicator.textContent = parts.join(" · ");
    indicator.hidden = !parts.length;
    indicator.title = "Open Investigations activity";
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
    // Batches waiting on the human: ready ones and pending graph reviews.
    const review = state.investigations.filter(
      (i) =>
        i.number &&
        !i.closedAt &&
        (i.readyAt || i.reviewFlow?.graphReviews.some((r) => r.status === "pending")),
    ).length;
    nav.querySelector('[data-count="work"]')!.textContent = work
      ? String(work)
      : "";
    nav.querySelector('[data-count="review"]')!.textContent = review
      ? String(review)
      : "";
    updateRunning();
  }
  async function refresh(render = true) {
    const fresh: ResearchState = await request("/api/state");
    const changed = state.datasetRevision !== fresh.datasetRevision;
    state = fresh;
    if (dialog.open) drawer?.render();
    updateCounts();
    if (render && !noticeMessage) hideNotice();
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
    if (dialog.open && drawer?.currentTab === "queue") drawer.render();
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
        ["data-union-id", "claims"],
        ["data-connection-id", "claims"],
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
  // The Annotations drawer is the switch: while it is open, the page can be annotated,
  // and anything selected is added to the note being written in the queue.
  function openDrawer(tab?: DrawerTab, reference?: AnnotationTarget) {
    if (!dialog.open) dialog.show();
    if (!annotate) setMode(true);
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
  // Where the human was before following a reference, so they can return to it.
  interface Place {
    view: string;
    investigation?: string;
    review?: typeof reviewTarget;
    source?: string;
    section: FindingsSection;
    hash: string;
    scroll: [string, number][];
    label: string;
    token: string;
  }
  let returnPlace: Place | undefined;
  const viewLabels: Record<string, string> = {
    research: "the graph",
    work: "Investigations",
    review: "Review",
    sources: "Sources",
    feedback: "Feedback",
    settings: "Research settings",
  };
  function here(): Place {
    const scroll: [string, number][] = [];
    if (surface.scrollTop) scroll.push(["", surface.scrollTop]);
    surface.querySelectorAll<HTMLElement>("[class]").forEach((e) => {
      if (e.scrollTop) scroll.push([`.${e.classList[0]}`, e.scrollTop]);
    });
    const review = view === "review" && reviewTarget;
    return {
      view,
      investigation: selectedInvestigation,
      review: reviewTarget,
      source: selectedSource,
      section: findingsSection,
      hash: location.hash,
      scroll,
      label: review
        ? `the ${review.start === "graph" ? "graph review" : "walkthrough"}`
        : viewLabels[view] || "where you were",
      token: crypto.randomUUID(),
    };
  }
  function restore(place: Place) {
    returnPlace = undefined;
    returnBar.hidden = true;
    selectedInvestigation = place.investigation;
    reviewTarget = place.review;
    selectedSource = place.source;
    findingsSection = place.section;
    if (place.view === "research" && location.hash !== place.hash)
      history.replaceState(history.state, "", place.hash || location.pathname + location.search);
    setView(place.view);
    requestAnimationFrame(() => {
      for (const [selector, top] of place.scroll) {
        const element = selector ? surface.querySelector<HTMLElement>(selector) : surface;
        if (element) element.scrollTop = top;
      }
    });
  }
  returnBar.addEventListener("click", () => history.back());
  // Only arriving back at the entry the human left restores it; hash changes also fire popstate.
  window.addEventListener("popstate", (event) => {
    if (returnPlace && event.state?.returnToken === returnPlace.token) restore(returnPlace);
  });
  // Following a reference keeps a browser history entry, so Back returns here.
  function navigate(reference: AnnotationTarget) {
    const owner = state.investigations.find(
      (i) =>
        i.proposals.some((p) => p.id === reference.proposalId) ||
        i.reviewFlow?.walkthroughs.some((w) => w.id === reference.walkthroughId) ||
        i.reviewFlow?.graphReviews.some((r) => r.id === reference.graphReviewId),
    );
    const source = reference.table === "sources" ? reference.recordId : undefined;
    if (!source && !reference.recordId && !owner) return;
    returnPlace = here();
    history.replaceState({ ...history.state, returnToken: returnPlace.token }, "");
    returnBar.textContent = `← Back to ${returnPlace.label}`;
    returnBar.hidden = false;
    if (source) {
      history.pushState(null, "", location.href);
      showSource(undefined, undefined, source);
    } else if (reference.recordId) {
      setView("research");
      window.location.hash = new URLSearchParams({ node: reference.recordId }).toString();
    } else {
      history.pushState(null, "", location.href);
      if (reference.walkthroughId || reference.graphReviewId)
        openReview(owner!.id, reference.graphReviewId ? "graph" : "reading");
      else openReport(reference.proposalId);
    }
  }
  drawer = new AnnotationsDrawer(dialog, {
    state: () => state,
    command: (data) => command(data, false),
    navigate,
    batchAction: (batchId, kind) => void requestReview(batchId, kind),
    offline: () => offline,
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
    ) {
      if (dialog.open) closeDrawer();
      else openDrawer();
    }
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
    if (button?.hasAttribute("data-running")) {
      findingsSection = "activity";
      setView("work");
      return;
    }
    if (button?.dataset.view) {
      // Choosing a tab starts somewhere new; the earlier place no longer applies.
      returnPlace = undefined;
      returnBar.hidden = true;
      setView(button.dataset.view);
    } else if (button?.hasAttribute("data-add-instruction")) {
      if (dialog.open) closeDrawer();
      else openDrawer();
    }
  });
  notice.querySelector("[data-notice-open]")!.addEventListener("click", () => {
    const open = noticeOpen;
    hideNotice();
    open?.();
  });
  notice.querySelector("[data-notice-dismiss]")!.addEventListener("click", hideNotice);
  function openActivity(batchId: string) {
    const flow = state.investigations.find((i) => i.id === batchId)?.reviewFlow;
    if (flow?.graphReviews.at(-1)?.status === "pending") openReview(batchId, "graph");
    else if (flow?.walkthroughs.length) openReview(batchId, "reading");
    else {
      selectedInvestigation = batchId;
      setView("work");
    }
  }
  // Announces a new coordinator message and opens the conversation at it.
  function announce(m: Message) {
    const batch = m.readyBatchId && state.investigations.find((i) => i.id === m.readyBatchId);
    const title = m.decision?.status === "pending"
      ? "Your coordinator needs a decision"
      : batch ? `Batch ${batch.number} is ready for review` : "Your coordinator replied";
    const detail = m.decision?.title || (m.text || "").split("\n")[0] || (batch ? batch.title : "");
    showNotice(title, detail, "Open", () => {
      openDrawer("conversation");
      drawer!.showMessage(m.id);
      updateCounts();
    }, m.id);
  }

  function heading(kicker: string, title: string, description: string) {
    return `<header class="surface-heading"><span class="eyebrow">${kicker}</span><h1>${title}</h1><p>${description}</p></header>`;
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
  // Review lists batches; opening one shows its walkthrough or graph review in place.
  function renderReview() {
    const batch = reviewTarget && state.investigations.find((i) => i.id === reviewTarget!.batchId);
    if (!batch?.reviewFlow || !reviewTarget) {
      reviewTarget = undefined;
      surface.classList.add("is-review");
      surface.innerHTML = reviewPage(state);
      return;
    }
    surface.innerHTML = `<div class="review-open" data-investigation-id="${escape(batch.id)}"><button type="button" class="text-action review-back" data-review-back>← Review</button><div data-guided-host></div></div>`;
    guidedReview = new GuidedReview(surface.querySelector<HTMLElement>("[data-guided-host]")!, state, batch, {
      start: reviewTarget.start,
      command: async (data) => {
        // Undoing an accepted draft is a graph organization step with its own snapshot.
        if (data.action === "organization-undo") await request("/api/organization", { action: "organization-undo", undoId: data.undoId });
        else await request("/api/review-flow", data);
        await refresh();
      },
      source: (id, quote) => showSource(undefined, quote, id),
      error: (text) => message(text),
      decline: async (note, reference) => {
        await request("/api/commands", {
          type: "send",
          annotation: { question: note, references: [reference] },
        });
        await refresh(false);
        message("Set aside. Your note went to the coordinator as new work.");
      },
    });
  }
  // Every report stays available in Findings; open it there.
  function openReport(proposalId?: string) {
    findingsSection = "findings";
    setView("work");
    const report = surface.querySelector<HTMLDetailsElement>(
      `.report[data-proposal-id="${CSS.escape(proposalId || "")}"]`,
    );
    if (report) {
      report.open = true;
      report.scrollIntoView({ block: "start" });
    }
  }
  function openReview(batchId: string, start: "reading" | "graph") {
    reviewTarget = { batchId, start };
    selectedInvestigation = batchId;
    setView("review");
  }
  async function requestReview(batchId: string, kind: "walkthrough" | "graph") {
    try {
      await request("/api/review-flow", {
        action: kind === "walkthrough" ? "request-walkthrough" : "request-graph",
        investigationId: batchId,
      });
      await refresh();
      message(
        kind === "walkthrough"
          ? "Walkthrough requested. Your coordinator will write it."
          : "Graph update requested. Its review will appear in Review.",
      );
    } catch (error) {
      message((error as Error).message);
    }
  }
  function renderView() {
    guidedReview?.destroy();
    guidedReview = undefined;
    if (view === "research") return;
    surface.classList.toggle("is-findings", view === "work");
    surface.classList.remove("is-review");
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
    if (view === "review") {
      renderReview();
      return;
    }
    if (view === "settings")
      surface.innerHTML = settingsView(state, currentInvestigation());
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
    if (b?.dataset.relatedReview) openReport(b.dataset.relatedProposal);
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
      ...connectionsFromClaims(state.dataset),
    ].filter((r) => r.sourceIds?.includes(sourceId || ""));
    surface.innerHTML = `<button data-source-list>Back to source library</button>${currentInvestigation()?.reviewFlow?.walkthroughs.length ? '<button data-open-review>Return to your walkthrough</button>' : ""}<article class="source-inspector" ${targetAttribute({ table: "sources", recordId: sourceId || documentId, label: String(source?.title || doc?.name || "Source") })}><span class="eyebrow">Source record</span><h1>${escape(source?.title || doc?.name || "Source")}</h1><p>${[source?.repository, source?.access || "Access not recorded"].filter(Boolean).map(escape).join(" · ")}</p><p class="preserve-lines">${escape(source?.note)}</p>${doc ? `<p>Preserved ${date(doc.importedAt)}</p><a href="/api/documents/${doc.id}" target="_blank" rel="noopener">Open preserved original</a>` : ""}<section class="source-content">${body}</section><h2>Findings from this source</h2>${related.map(({ i, p, f }) => `<section class="source-finding" data-investigation-id="${i.id}" ${targetAttribute({ label: f.statement, proposalId: p.id, findingId: f.id })}><span class="status-badge">${escape(f.status)} · ${escape(f.qualification)}</span><h3>${escape(f.statement)}</h3><p class="preserve-lines">${escape(f.explanation)}</p><button data-source-review="${i.id}" data-source-proposal="${p.id}">Open finding review</button></section>`).join("") || '<p class="muted">No structured findings recorded yet.</p>'}<h2>Accepted graph connections</h2>${subjects.map((r) => `<p ${targetAttribute({ label: "name" in r ? r.name : r.label || r.id, recordId: r.id })}>${escape("name" in r ? r.name : r.label || r.id)}</p>`).join("") || '<p class="muted">No accepted graph records cite this source yet.</p>'}<details><summary>Recorded passages and review history (${passages.length})</summary>${passages.map(({ i, p, e }) => `<section data-investigation-id="${i.id}"><p class="muted">Revision ${p.revision} · ${escape(p.status)}</p>${evidenceCard(state, p, e)}</section>`).join("")}</details></article>`;
    surface.querySelectorAll("[data-evidence]").forEach((b) => b.remove());
    surface.querySelector("mark")?.scrollIntoView({ block: "center" });
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
    if (button.hasAttribute("data-open-walkthrough") && owner) {
      openReview(owner, "reading");
      return;
    }
    if (button.dataset.reviewOpen && owner) {
      openReview(owner, button.dataset.reviewOpen as "reading" | "graph");
      return;
    }
    if (button.dataset.reviewRequest && owner) {
      void requestReview(owner, button.dataset.reviewRequest as "walkthrough" | "graph");
      return;
    }
    if (button.hasAttribute("data-review-back")) {
      reviewTarget = undefined;
      renderView();
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
      openReport(button.dataset.sourceProposal);
      return;
    }
    if (button.hasAttribute("data-add-question")) {
      openDrawer("queue");
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
    if (button.hasAttribute("data-go-research")) setView("research");
    else if (button.hasAttribute("data-open-review") && selectedInvestigation)
      openReview(selectedInvestigation, "reading");
    else if (button.dataset.command)
      void command({
        type: button.dataset.command as ResearchCommand["type"],
        investigationId: selectedInvestigation,
        requestId: button.dataset.resumeRequest,
        decision: button.dataset.resumeDecision,
      })
        .then(() => message("Research state saved."))
        .catch((error) => message(error.message));
    else if (button.dataset.rescan) void scanFolder(button.dataset.rescan);
    else if (button.dataset.document) showSource(button.dataset.document);
  };
  surface.addEventListener("click", handleContentClick);
  surface.addEventListener("change", (event) => {
    const e = event.target as HTMLInputElement;
    if (e.dataset.auto) {
      const read = (key: string) =>
        surface.querySelector<HTMLInputElement>(`[data-auto="${key}"]`)!.checked;
      void request("/api/review-settings", {
        autoWalkthrough: read("autoWalkthrough"),
        autoGraph: read("autoGraph"),
      })
        .then(() => refresh())
        .catch((error) => message(error.message));
      return;
    }
  });
  // Refresh activity without replacing an open walkthrough or its reading position.
  let polling = false;
  window.setInterval(async () => {
    if (polling || busy || document.hidden) return;
    polling = true;
    try {
      const revision = await request("/api/revision");
      if (revision.coordinator) {
        // Attaching or dropping does not change the revision, so refresh the drawer here.
        const wasConnected = state.coordinator?.connected;
        state.coordinator = revision.coordinator;
        if (dialog.open && wasConnected !== revision.coordinator.connected) drawer?.render();
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
        const seen = new Set((previous.conversation || []).map((m) => m.id));
        const arrived = (state.conversation || []).filter((m) => m.author === "coordinator" && !seen.has(m.id));
        const reading = dialog.open && drawer?.currentTab === "conversation";
        const shown = noticeMessage ? state.conversation?.find((m) => m.id === noticeMessage) : undefined;
        if (shown?.decision && shown.decision.status !== "pending") hideNotice();
        if (arrived.length && !reading)
          announce(arrived.find((m) => m.decision?.status === "pending") || arrived.at(-1)!);
        else if (changed && !noticeMessage && !(guidedReview && current?.id === changed.id)) {
          const job = changed.reviewFlow?.jobs.at(-1);
          const subject = investigationSubject(changed);
          const [title, action] = changed.reviewFlow?.graphReviews.at(-1)?.status === "pending"
            ? ["A graph update is ready for review", "Open review"]
            : job?.status === "paused" ? ["Graph preparation paused", "Open review"]
            : changed.reviewFlow?.walkthroughs.length ? ["A walkthrough is ready", "Open walkthrough"]
            : ["New research returned", "Open findings"];
          showNotice(title, subject, action, () => openActivity(changed.id));
        }
      }
    } catch {
      setOffline(true);
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
