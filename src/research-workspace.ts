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
const statusLabel = (status: string): string =>
  ({
    draft: "Queued notes",
    queued: "Awaiting researcher",
    running: "Investigating",
    review: "Ready to review",
    paused: "Paused",
    closed: "Recorded",
  })[status] ?? status;
const targetAttribute = (target: AnnotationTarget): string =>
  `data-research-target="${escape(JSON.stringify(target))}"`;

export function mountResearchWorkspace(
  initial: ResearchState,
  onDataset: (dataset: FamilyDataset) => void,
): void {
  let state = initial;
  let view = "research";
  let selectedInvestigation: string | undefined;
  let selectedProposal: string | undefined;
  let readingMode = "cards";
  let cardIndex = 0;
  let previewRenderer: GraphRenderer | undefined;
  let selectedSource: string | undefined;
  const selectedGroups = new Map<string, Set<string>>();
  let previewGeneration = 0;
  let references: AnnotationTarget[] = [];
  let editingAnnotation: string | undefined;
  let editingInvestigation: string | undefined;
  let draftScope: string[] | undefined;
  let amendingAnnotation: string | undefined;
  let annotate = false;
  let busy = false;
  let pendingTarget: AnnotationTarget | undefined;
  let pendingInvestigation: string | undefined;
  const shell = document.querySelector<HTMLElement>(".app-shell")!;
  const graph = document.querySelector<HTMLElement>("main.workspace")!;
  shell.classList.add("research-app");
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
    )}</div><div class="workspace-actions"><button type="button" data-add-instruction>Add question</button><span class="local-indicator">Saved on this computer</span><button type="button" data-organize-project>Organize</button><button type="button" id="annotation-mode" aria-pressed="false" title="Toggle annotation (Command or Control + I)"><span aria-hidden="true">⌖</span> Annotate <kbd>⌘ I</kbd></button></div>`;
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
  dialog.setAttribute("data-lavish-ui", "research-composer");
  dialog.innerHTML = `<form id="annotation-form"><div class="dialog-heading"><span class="eyebrow">Research annotation</span><button type="button" data-close aria-label="Close annotation">×</button></div><h2 id="annotation-label"></h2><div id="annotation-selection"></div><p class="muted">Use Annotate to add references, or send without a selection.</p><label>Destination<select id="annotation-destination"><option value="research">Research investigation</option><option value="interface">Interface feedback</option></select></label><label for="annotation-question">What needs investigating?</label><textarea id="annotation-question" required rows="4" placeholder="Question the evidence, resolve an identity, or follow a connection…"></textarea><details class="annotation-options"><summary>Investigation and sources</summary><div id="annotation-belongs"></div><fieldset id="annotation-scope"><legend>Where to look</legend></fieldset></details><div class="dialog-actions"><button type="submit" name="dispatch" value="queue">Queue annotation</button><button class="primary" type="submit" name="dispatch" value="now">Send now</button></div><p class="form-error" role="alert"></p></form>`;
  const composerColumn = document.createElement("aside");
  composerColumn.className = "composer-column";
  composerColumn.setAttribute("aria-label", "Annotation and selected details");
  shell.append(composerColumn);
  composerColumn.append(dialog);
  const nodeInspector = graph.querySelector<HTMLElement>(".details-panel");
  function syncComposer() {
    shell.classList.toggle("composing", dialog.open);
    if (nodeInspector) {
      if (dialog.open && view === "research")
        composerColumn.prepend(nodeInspector);
      else graph.append(nodeInspector);
    }
  }

  let toastTimer: number;
  function message(text: string) {
    toast.textContent = text;
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
    const work = state.investigations.filter((i) =>
      ["draft", "queued", "running", "paused"].includes(i.status),
    ).length;
    const review = state.investigations.filter((i) =>
      i.proposals.some((p) => p.status === "pending"),
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
    updateCounts();
    notice.hidden = true;
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
    nav
      .querySelector("#annotation-mode")!
      .setAttribute("aria-pressed", String(annotate));
    window.postMessage(
      { type: "lavish:setAnnotationMode", enabled: annotate },
      window.location.origin,
    );
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
  const draftKey = `research-draft:${window.location.origin}`;
  function saveDraft() {
    localStorage.setItem(
      draftKey,
      JSON.stringify({
        references,
        question: dialog.querySelector<HTMLTextAreaElement>("textarea")!.value,
        investigationId: pendingInvestigation,
        editingAnnotation,
        editingInvestigation,
        scope: draftScope,
        amendingAnnotation,
        destination: dialog.querySelector<HTMLSelectElement>(
          "#annotation-destination",
        )!.value,
      }),
    );
  }
  function closeComposer() {
    saveDraft();
    dialog.close();
    syncComposer();
  }
  function clearDraft() {
    references = [];
    pendingInvestigation = undefined;
    pendingTarget = undefined;
    editingAnnotation = undefined;
    editingInvestigation = undefined;
    draftScope = undefined;
    amendingAnnotation = undefined;
    dialog.querySelector<HTMLSelectElement>("#annotation-destination")!.value =
      "research";
    dialog.querySelector<HTMLTextAreaElement>("textarea")!.value = "";
    localStorage.removeItem(draftKey);
  }
  function renderReferences() {
    dialog.querySelector("#annotation-selection")!.innerHTML =
      references
        .map(
          (r, n) =>
            `<div class="reference-chip"><span>${escape(r.text || r.label)}</span><button type="button" data-remove-ref="${n}" aria-label="Remove reference">×</button></div>`,
        )
        .join("") || '<p class="muted">No selected references</p>';
  }
  function openAnnotation(target?: AnnotationTarget, investigationId?: string) {
    if (
      !dialog.open &&
      !references.length &&
      !dialog.querySelector<HTMLTextAreaElement>("textarea")!.value
    ) {
      try {
        const draft = JSON.parse(localStorage.getItem(draftKey) || "null");
        if (draft) {
          references = draft.references || [];
          pendingInvestigation = draft.investigationId;
          editingAnnotation = draft.editingAnnotation;
          editingInvestigation = draft.editingInvestigation;
          draftScope = draft.scope;
          amendingAnnotation = draft.amendingAnnotation;
          dialog.querySelector<HTMLTextAreaElement>("textarea")!.value =
            draft.question || "";
          dialog.querySelector<HTMLSelectElement>(
            "#annotation-destination",
          )!.value = draft.destination || "research";
        }
      } catch {
        /* Invalid local drafts do not affect saved research. */
      }
    }
    pendingInvestigation ||= investigationId;
    if (
      target &&
      !references.some((r) => JSON.stringify(r) === JSON.stringify(target))
    )
      references.push(target);
    pendingTarget = references[0] || { label: state.dataset.title };
    dialog.querySelector("#annotation-label")!.textContent = editingAnnotation
      ? "Edit queued annotation"
      : amendingAnnotation
        ? "Amend sent instruction"
        : "Question or instruction";
    renderReferences();
    const belongs = dialog.querySelector("#annotation-belongs")!;
    belongs.innerHTML = `<label>Investigation<select id="annotation-investigation"><option value="">Start a new investigation</option>${state.investigations.map((i) => `<option value="${i.id}" ${i.id === pendingInvestigation ? "selected" : ""}>${escape(i.title)}</option>`).join("")}</select></label>`;
    belongs.querySelector("select")!.addEventListener("change", (event) => {
      pendingInvestigation =
        (event.target as HTMLSelectElement).value || undefined;
      renderScope();
      saveDraft();
    });
    renderScope();
    dialog.querySelector(".form-error")!.textContent = "";
    if (!dialog.open) dialog.show();
    syncDestination();
    syncComposer();
    saveDraft();
  }
  function renderScope() {
    const existing = state.investigations.find(
      (i) => i.id === pendingInvestigation,
    );
    const scope = existing?.scope || draftScope || ["web", "imports"];
    dialog.querySelector("#annotation-scope")!.innerHTML =
      `<legend>Where to look${existing ? " (investigation scope)" : ""}</legend>${state.collections.map((c) => `<label class="scope-option"><input type="checkbox" value="${c.id}" ${scope.includes(c.id) ? "checked" : ""} ${existing ? "disabled" : ""}>${escape(c.name)}</label>`).join("")}`;
  }
  function syncDestination() {
    const feedback =
      dialog.querySelector<HTMLSelectElement>("#annotation-destination")!
        .value === "interface";
    dialog.querySelector('label[for="annotation-question"]')!.textContent =
      feedback ? "What should change?" : "What needs investigating?";
    dialog.querySelector<HTMLElement>(".annotation-options")!.hidden = feedback;
    dialog.querySelector<HTMLButtonElement>('button[value="queue"]')!.hidden =
      feedback;
    dialog.querySelector('button[value="now"]')!.textContent = feedback
      ? "Save feedback"
      : "Send now";
  }
  dialog.addEventListener("change", () => {
    draftScope = [
      ...dialog.querySelectorAll<HTMLInputElement>(
        "#annotation-scope input:checked",
      ),
    ].map((e) => e.value);
    syncDestination();
    saveDraft();
  });
  dialog.addEventListener("input", saveDraft);
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeComposer();
  });
  dialog.addEventListener("click", (event) => {
    const b = (event.target as Element).closest<HTMLElement>(
      "[data-remove-ref]",
    );
    if (b) {
      references.splice(Number(b.dataset.removeRef), 1);
      pendingTarget = references[0] || { label: state.dataset.title };
      renderReferences();
      saveDraft();
    }
  });
  dialog
    .querySelector("[data-close]")!
    .addEventListener("click", () => closeComposer());
  dialog.querySelector("form")!.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitter = (event as SubmitEvent).submitter as HTMLButtonElement;
    const dispatch = submitter?.value === "now";
    const investigationId =
      pendingInvestigation ||
      dialog.querySelector<HTMLSelectElement>("#annotation-investigation")
        ?.value ||
      undefined;
    try {
      const result = await command(
        {
          type:
            dialog.querySelector<HTMLSelectElement>("#annotation-destination")!
              .value === "interface"
              ? "interface-feedback"
              : editingAnnotation
                ? "edit-annotation"
                : "annotate",
          annotationId: editingAnnotation,
          amends: amendingAnnotation,
          references,
          investigationId: editingInvestigation || investigationId,
          destinationInvestigationId: editingAnnotation
            ? investigationId || null
            : undefined,
          target:
            pendingTarget?.proposalId &&
            !state.investigations
              .find((i) => i.id === investigationId)
              ?.proposals.some((p) => p.id === pendingTarget!.proposalId)
              ? { label: state.dataset.title }
              : pendingTarget,
          question:
            dialog.querySelector<HTMLTextAreaElement>("textarea")!.value,
          dispatch,
          scope: [
            ...dialog.querySelectorAll<HTMLInputElement>(
              "#annotation-scope input:checked",
            ),
          ].map((i) => i.value),
        },
        false,
      );
      if (!result) return;
      if (
        editingAnnotation &&
        dispatch &&
        dialog.querySelector<HTMLSelectElement>("#annotation-destination")!
          .value !== "interface"
      )
        await command(
          {
            type: "dispatch",
            investigationId: result.investigationId || investigationId,
          },
          false,
        );
      const interfaceFeedback =
        dialog.querySelector<HTMLSelectElement>("#annotation-destination")!
          .value === "interface";
      clearDraft();
      dialog.close();
      syncComposer();
      setMode(false);
      updateCounts();
      message(
        interfaceFeedback
          ? "Interface feedback saved for development review."
          : dispatch
            ? "Investigation queued for a researcher. Your accepted graph is unchanged."
            : "Annotation saved. Send it from Investigations when you’re ready.",
      );
      if (view === "work") renderView();
      else if (view === "review") {
        notice.hidden = false;
        notice.querySelector("span")!.textContent =
          "Your feedback is saved in this investigation.";
      }
    } catch (error) {
      dialog.querySelector(".form-error")!.textContent = (
        error as Error
      ).message;
    }
  });
  (window as any).lavishUnifiedFeedback = {
    selectReference: (context: any) => {
      const resolved = resolveTarget(context);
      openAnnotation(resolved.target, resolved.investigationId);
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
  graph.addEventListener(
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
    else if (button?.hasAttribute("data-add-instruction"))
      openAnnotation(
        undefined,
        view === "work" || view === "review"
          ? selectedInvestigation
          : undefined,
      );
    else if (button?.id === "annotation-mode") setMode(!annotate);
  });
  notice
    .querySelector("button")!
    .addEventListener(
      "click",
      () => void refresh().catch((error) => message(error.message)),
    );

  function heading(kicker: string, title: string, description: string) {
    return `<header class="surface-heading"><span class="eyebrow">${kicker}</span><h1>${title}</h1><p>${description}</p></header>`;
  }
  function empty(title: string, detail: string) {
    return `<div class="workspace-empty"><span class="empty-symbol" aria-hidden="true">⌖</span><h2>${title}</h2><p>${detail}</p><button type="button" data-go-research>Explore the research graph</button></div>`;
  }
  function listItem(i: Investigation) {
    const queued = i.annotations.filter((a) => !a.dispatchedAt).length;
    return `<button type="button" class="investigation-list-item ${selectedInvestigation === i.id ? "selected" : ""}" data-select-investigation="${i.id}"><span class="status-badge status-${i.status}">${statusLabel(i.status)}</span><strong>${escape(i.title)}</strong><small>${i.annotations.length} annotation${i.annotations.length === 1 ? "" : "s"}${queued ? ` · ${queued} unsent` : ""}</small></button>`;
  }
  function renderView() {
    previewGeneration++;
    previewRenderer?.destroy();
    previewRenderer = undefined;
    if (view === "research") return;
    if (view === "sources") {
      renderSources();
      return;
    }
    const items = [...state.investigations]
      .reverse()
      .filter((i) => view === "work" || i.proposals.length > 0);
    if (!items.some((i) => i.id === selectedInvestigation)) {
      selectedInvestigation = items[0]?.id;
      selectedProposal = undefined;
    }
    const investigation = currentInvestigation();
    const engine = state.researcher;
    const coordination = state.coordinator;
    const coordinatorControl =
      view === "work"
        ? `<section class="engine-control" aria-label="Research coordinator"><div><strong data-coordinator-status>${coordination?.connected ? "Coordinator connected" : coordination?.enabled ? "Waiting for your coordinator" : "Agent-led research available"}</strong><p data-coordinator-description>${coordination?.connected ? `${escape(coordination.name)} is supervising research and preparing proposals.` : coordination?.enabled ? "Research and findings are saved. Open an agent in the research repository to continue." : "Open an agent in this repository to coordinate investigations, or use the independent researcher below."}</p></div></section>`
        : "";
    const engineControl =
      view === "work" && engine
        ? `<form id="engine-form" class="engine-control"><div><label for="research-engine">${coordination?.enabled ? "Preferred delegated researcher" : "Researcher for new work"}</label><p>Uses your installed CLI and its existing account. Up to two investigations run together, with a ten-minute limit per pass.</p></div><select id="research-engine"><option value="manual" ${engine.selected === "manual" ? "selected" : ""}>${coordination?.enabled ? "Coordinator’s own research tools" : "Connected agent / manual handoff"}</option>${engine.engines.map((e) => `<option value="${e.id}" ${engine.selected === e.id ? "selected" : ""} ${!e.available ? "disabled" : ""}>${e.id === "codex" ? "Codex" : "Claude Code"}${e.available ? "" : " (not installed)"}</option>`).join("")}</select><button type="submit">${coordination?.enabled ? "Save preference" : "Use for queued research"}</button></form>`
        : "";
    surface.innerHTML =
      (view === "work"
        ? heading(
            "Investigation desk",
            "Investigations",
            "Questions stay connected to their evidence, findings, and revisions.",
          )
        : heading(
            "Your judgment, in context",
            "Review research",
            "Inspect the evidence. Annotate an interpretation. Accept only what it supports.",
          )) +
      coordinatorControl +
      engineControl +
      (view === "work" && state.interfaceFeedback?.length
        ? `<details class="interface-feedback-list"><summary>Interface feedback (${state.interfaceFeedback.length})</summary>${state.interfaceFeedback.map((f) => `<article><p class="preserve-lines">${escape(f.text)}</p><small>${date(f.at)} · ${f.references.length} references</small></article>`).join("")}</details>`
        : "") +
      (items.length
        ? `<div class="investigation-layout"><aside class="investigation-list" aria-label="Investigations">${items.map(listItem).join("")}</aside><article class="investigation-detail" data-investigation-id="${investigation!.id}">${view === "work" ? workDetail(investigation!) : reviewDetail(investigation!)}</article></div>`
        : empty(
            view === "work"
              ? "Start with something you wonder about"
              : "Nothing is waiting for your judgment",
            view === "work"
              ? "Explore a person or relationship. Turn on Annotate, select it, and ask what needs investigating."
              : "Research proposals will arrive here, connected to the questions that prompted them.",
          ));
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
          message(
            state.coordinator?.enabled
              ? "Researcher preference saved for your coordinator."
              : "Researcher selection saved. Queued investigations will use this selection.",
          );
        } catch (error) {
          message((error as Error).message);
        }
      });
  }
  function workDetail(i: Investigation): string {
    const last = i.checkpoints.at(-1);
    const execution = i.executions?.at(-1);
    const currentFindings = i.proposals.flatMap((p) =>
      (p.findings || [])
        .filter((f) => f.status !== "superseded")
        .map((f) => ({ p, f })),
    );
    const queued = i.annotations.filter((a) => !a.dispatchedAt).length;
    return `<div class="detail-topline"><span class="status-badge status-${i.status}">${statusLabel(i.status)}</span><span class="muted">Started ${date(i.createdAt)}</span></div><h2>${escape(i.title)}</h2><p class="phase-label">${i.phase === "graph" ? "Graph construction" : "Investigation and findings"}</p>${execution ? `<p class="muted">Actual assignment: ${escape(execution.worker)} · ${escape(execution.provider)} · ${escape(execution.model)}</p>` : ""}${i.accessRequest && !i.accessRequest.resolvedAt ? `<div class="access-request"><h3>Needs your help</h3><p>${escape(i.accessRequest.instruction)}</p>${safeUrl(i.accessRequest.url) ? `<a href="${safeUrl(i.accessRequest.url)}" target="_blank" rel="noopener">Open source</a>` : ""}<button data-command="resolve-access">Access is ready, resume</button></div>` : ""}<div class="work-actions"><button data-add-question>Add question</button>${queued ? '<button class="primary" data-command="dispatch">Send queued annotations</button>' : ""}${["queued", "running"].includes(i.status) ? '<button data-command="pause">Pause investigation</button>' : ""}${["paused", "running", "closed"].includes(i.status) ? `<button data-command="resume">${i.status === "running" ? "Replace researcher" : "Resume investigation"}</button>` : ""}${i.proposals.length ? "<button data-open-review>Open review</button>" : ""}</div><div class="activity-callout"><span class="eyebrow">${i.status === "running" ? "Assigned researcher" : "Research status"}</span><p>${i.status === "running" ? (state.coordinator?.awaitingSynthesis.includes(i.id) ? "Findings returned. Your coordinator is preparing the review proposal." : escape(i.lease?.worker)) : i.status === "queued" ? (state.coordinator?.enabled ? "Sent to your coordinator for assignment. Your accepted research is unchanged." : "Saved and ready for an agent to claim. No researcher is assigned yet.") : i.status === "draft" ? "Your annotations are saved. Send them together when you’re ready." : i.status === "paused" ? "Findings are preserved. Resume to hand them to a new researcher." : i.status === "review" ? "A proposal is ready. The accepted research has not changed." : "The review decision is recorded. You can reopen this investigation."}</p></div><div class="scope-summary"><span class="eyebrow">Where to look</span><p>${i.scope.map((id) => escape(state.collections.find((c) => c.id === id)?.name || id)).join(" · ") || "No collections selected"}</p></div>${last ? `<section class="review-section"><span class="eyebrow">Latest saved checkpoint</span><h3>${escape(last.summary)}</h3><p class="preserve-lines">${escape(last.findings)}</p><h4>Remaining work</h4><p class="preserve-lines">${escape(last.nextSteps)}</p><small>${date(last.at)} · ${escape(last.worker)}</small></section>` : ""}${currentFindings.length ? `<section class="review-section"><h3>Current findings</h3>${currentFindings.map(({ p, f }) => `<article ${targetAttribute({ label: f.statement, proposalId: p.id, findingId: f.id })}><p>${escape(f.statement)}</p><span class="status-badge">${escape(f.status)} · ${escape(f.qualification)}</span><button data-source-review="${i.id}" data-source-proposal="${p.id}">Review finding</button></article>`).join("")}</section>` : ""}<section class="review-section"><h3>Annotations <span class="count-label">${i.annotations.length}</span></h3>${i.annotations.map((a) => `<div class="annotation-record" ${targetAttribute(a.target)}><div><span class="eyebrow">${escape(a.target.label)}</span><small>${a.dispatchedAt ? "Sent" : "Queued"}${a.target.proposalId ? " · Proposal feedback" : ""}</small></div>${a.target.text ? `<blockquote>${escape(a.target.text)}</blockquote>` : ""}<p class="preserve-lines">${escape(a.question)}</p>${a.references?.length ? `<small>${a.references.length} references</small>` : ""}<button data-edit-note="${a.id}">${a.dispatchedAt ? "Amend instruction" : "Edit annotation"}</button>${!a.dispatchedAt ? `<button data-delete-note="${a.id}">Remove</button>` : ""}</div>`).join("")}</section><details class="history-section"><summary>Investigation history</summary>${i.events.map((e) => `<p><time>${date(e.at)}</time> ${escape(e.message)}</p>`).join("")}${i.checkpoints
      .slice(0, -1)
      .map(
        (c) =>
          `<p><time>${date(c.at)}</time> ${escape(c.summary)}<br>${escape(c.findings)}<br>${escape(c.nextSteps)}</p>`,
      )
      .join("")}</details>`;
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
    const p =
      i.proposals.find((p) => p.id === selectedProposal) ||
      i.proposals.filter((p) => p.status === "pending").at(-1) ||
      i.proposals.at(-1)!;
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
    return `<div data-proposal-id="${p.id}" ${targetAttribute({ label: p.title, proposalId: p.id })}><div class="detail-topline"><span class="status-badge status-${p.status}">${escape(p.status)}</span><span class="muted">Revision ${p.revision} · ${date(p.createdAt)}</span></div><div class="origin-question"><span class="eyebrow">Your investigation</span><p>${escape(i.annotations[0]?.question)}</p></div><h2>${escape(p.title)}</h2><p class="proposal-summary">${escape(p.summary)}</p><div class="revision-choices" aria-label="Proposal revisions">${i.proposals.map((version) => `<button type="button" data-proposal="${version.id}" aria-pressed="${version.id === p.id}">Revision ${version.revision}</button>`).join("")}</div>${outstanding ? '<div class="activity-callout">New feedback belongs to this investigation. Send queued annotations from Investigations, then review the revised proposal before accepting.</div>' : ""}<section class="review-section"><span class="eyebrow">Evidence and interpretation</span><h3>What the sources actually support</h3>${p.evidence.map((e) => `<article class="evidence-card" ${targetAttribute({ label: `Evidence: ${sourceTitle(e.sourceId)}`, proposalId: p.id })}><div class="detail-topline"><span class="status-badge">${escape(e.stance)}</span><span class="muted">${escape(e.locator)}</span></div><h4>${escape(sourceTitle(e.sourceId))}</h4><blockquote>${escape(e.quote)}</blockquote><div class="interpretation" ${targetAttribute({ label: "Interpretation of evidence", proposalId: p.id })}><span class="eyebrow">Interpretation</span><p>${escape(e.interpretation)}</p></div><details><summary>Surrounding context</summary><p class="preserve-lines">${escape(e.context)}</p></details><button type="button" data-evidence="${escape(e.id)}">View source in context ↗</button></article>`).join("") || '<p class="muted">No source passages were found. This outcome records an open question.</p>'}</section>${p.ambiguity ? `<section class="ambiguity-card" ${targetAttribute({ label: "Remaining ambiguity", proposalId: p.id })}><span class="eyebrow">Still open</span><h3>Uncertainty worth preserving</h3><p class="preserve-lines">${escape(p.ambiguity)}</p></section>` : ""}<section class="review-section"><span class="eyebrow">Proposed model changes</span><h3>${p.changes.length ? `${p.changes.length} change${p.changes.length === 1 ? "" : "s"} to review together` : "Preserve an unresolved outcome"}</h3>${p.changes.map((c) => `<article class="change-card" ${targetAttribute({ table: c.table, recordId: c.recordId, label: String(c.after?.name || c.after?.label || c.before?.name || c.recordId), proposalId: p.id })}><h4>${escape(c.after?.name || c.after?.label || c.before?.name || c.recordId)}</h4><p>${escape(c.reason)}</p><div class="change-comparison"><section><span class="eyebrow">Accepted now</span>${recordFields(c.before)}</section><section><span class="eyebrow">Proposed</span>${recordFields(c.after)}</section></div></article>`).join("")}</section><footer class="review-decision">${p.status === "pending" ? `<p>${p.changes.length ? "Accepting applies these exact changes together and preserves this review." : "Recording this outcome preserves the ambiguity without changing the graph."}</p><div><button class="primary" data-command="accept" ${outstanding || i.status !== "review" ? "disabled" : ""}>${p.changes.length ? "Accept proposal" : "Record unresolved outcome"}</button><button data-command="reject" ${outstanding || i.status !== "review" ? "disabled" : ""}>Reject proposal</button><button data-followup>Request further research</button></div>` : `<p>${p.status === "accepted" ? "Accepted and preserved in the research history." : p.status === "superseded" ? "A later research pass superseded this proposal. It remains available for inspection." : "Rejected. The accepted research was unchanged."}</p><button data-followup>Continue this investigation</button>`}</footer></div>`;
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
    surface.innerHTML = `<button data-source-list>Back to source library</button><article class="source-inspector" ${targetAttribute({ table: "sources", recordId: sourceId || documentId, label: String(source?.title || doc?.name || "Source") })}><span class="eyebrow">Source record</span><h1>${escape(source?.title || doc?.name || "Source")}</h1><p>${[source?.repository, source?.access || "Access not recorded"].filter(Boolean).map(escape).join(" · ")}</p><p class="preserve-lines">${escape(source?.note)}</p>${doc ? `<p>Preserved ${date(doc.importedAt)}</p><a href="/api/documents/${doc.id}" target="_blank" rel="noopener">Open preserved original</a>` : ""}<section class="source-content">${body}</section><h2>Findings from this source</h2>${related.map(({ i, p, f }) => `<section class="source-finding" data-investigation-id="${i.id}" ${targetAttribute({ label: f.statement, proposalId: p.id, findingId: f.id })}><span class="status-badge">${escape(f.status)} · ${escape(f.qualification)}</span><h3>${escape(f.statement)}</h3><p class="preserve-lines">${escape(f.explanation)}</p><button data-source-review="${i.id}" data-source-proposal="${p.id}">Open finding review</button></section>`).join("") || '<p class="muted">No structured findings recorded yet.</p>'}<h2>Accepted graph connections</h2>${subjects.map((r) => `<p ${targetAttribute({ label: "name" in r ? r.name : r.label || r.id, recordId: r.id })}>${escape("name" in r ? r.name : r.label || r.id)}</p>`).join("") || '<p class="muted">No accepted graph records cite this source yet.</p>'}<details><summary>Recorded passages and review history (${passages.length})</summary>${passages.map(({ i, p, e }) => `<section data-investigation-id="${i.id}"><p class="muted">Revision ${p.revision} · ${escape(p.status)}</p>${evidenceCard(state, p, e)}</section>`).join("")}</details></article>`;
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

  surface.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>(
      "button",
    );
    if (!button) return;
    if (button.dataset.sourceReview) {
      selectedInvestigation = button.dataset.sourceReview;
      selectedProposal = button.dataset.sourceProposal;
      cardIndex = 0;
      setView("review");
      return;
    }
    if (button.hasAttribute("data-add-question")) {
      openAnnotation(undefined, selectedInvestigation);
      return;
    }
    if (button.dataset.editNote) {
      const a = currentInvestigation()!.annotations.find(
        (a) => a.id === button.dataset.editNote,
      )!;
      clearDraft();
      references = a.references?.length ? [...a.references] : [a.target];
      pendingInvestigation = selectedInvestigation;
      if (a.dispatchedAt) amendingAnnotation = a.id;
      else {
        editingAnnotation = a.id;
        editingInvestigation = selectedInvestigation;
      }
      dialog.querySelector<HTMLTextAreaElement>("textarea")!.value =
        a.dispatchedAt ? "" : a.question;
      openAnnotation(undefined, selectedInvestigation);
      return;
    }
    if (button.dataset.deleteNote) {
      void command({
        type: "delete-annotation",
        investigationId: selectedInvestigation,
        annotationId: button.dataset.deleteNote,
      }).catch((e) => message(e.message));
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
      openAnnotation(
        {
          label: button.dataset.questionFinding
            ? "Question this finding"
            : "Question this graph representation",
          proposalId: selectedProposal,
          findingId: button.dataset.questionFinding,
          groupId: button.dataset.questionGroup,
        },
        selectedInvestigation,
      );
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
      })
        .then(() => message("Research state saved."))
        .catch((error) => message(error.message));
    else if (button.hasAttribute("data-followup"))
      openAnnotation(
        { label: currentInvestigation()!.title, proposalId: selectedProposal },
        selectedInvestigation,
      );
    else if (button.dataset.rescan) void scanFolder(button.dataset.rescan);
    else if (button.dataset.document) showSource(button.dataset.document);
    else if (button.dataset.evidence) {
      const p = currentInvestigation()!.proposals.find(
        (p) => p.id === selectedProposal,
      )!;
      const e = p.evidence.find((e) => e.id === button.dataset.evidence)!;
      showSource(e.documentId, e.quote, e.sourceId, p);
    }
  });
  surface.addEventListener("change", (event) => {
    const e = event.target as HTMLInputElement;
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
  // Poll only lightweight revision metadata. The user decides when to load arriving research.
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
        notice.querySelector("span")!.textContent =
          "New research activity is available. Your current view is preserved.";
        notice.hidden = false;
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
      openAnnotation({ label: state.dataset.title, text: state.dataset.title }),
    );
  document
    .querySelector("[data-open-sources]")
    ?.addEventListener("click", () => setView("sources"));
  updateCounts();
}
