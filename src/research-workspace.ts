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
    ["research", "Research"],
    ["work", "Ongoing work"],
    ["review", "Review"],
    ["sources", "Sources & access"],
  ]
    .map(
      ([id, label]) =>
        `<button type="button" data-view="${id}" ${id === "research" ? 'aria-current="page"' : ""}>${label}<span data-count="${id}"></span></button>`,
    )
    .join(
      "",
    )}</div><div class="workspace-actions"><span class="local-indicator">Saved on this computer</span><button type="button" data-organize-project>Organize</button><button type="button" id="annotation-mode" aria-pressed="false" title="Toggle annotation (Command or Control + I)"><span aria-hidden="true">⌖</span> Annotate <kbd>⌘ I</kbd></button></div>`;
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
  dialog.innerHTML = `<form id="annotation-form"><div class="dialog-heading"><span class="eyebrow">Research annotation</span><button type="button" data-close aria-label="Close annotation">×</button></div><h2 id="annotation-label"></h2><blockquote id="annotation-selection"></blockquote><label for="annotation-question">What needs investigating?</label><textarea id="annotation-question" required rows="4" placeholder="Question the evidence, resolve an identity, or follow a connection…"></textarea><div id="annotation-belongs"></div><fieldset id="annotation-scope"><legend>Where to look</legend></fieldset><p class="muted">Your accepted research stays unchanged until you review a proposal.</p><div class="dialog-actions"><button type="submit" name="dispatch" value="queue">Queue annotation</button><button class="primary" type="submit" name="dispatch" value="now">Investigate now</button></div><p class="form-error" role="alert"></p></form>`;
  document.body.append(dialog);
  const sourceDialog = document.createElement("dialog");
  sourceDialog.className = "source-dialog";
  document.body.append(sourceDialog);
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
  function openAnnotation(target: AnnotationTarget, investigationId?: string) {
    pendingTarget = target;
    pendingInvestigation = investigationId;
    dialog.querySelector("#annotation-label")!.textContent = target.label;
    const selection = dialog.querySelector<HTMLElement>(
      "#annotation-selection",
    )!;
    selection.textContent = target.text || target.label;
    dialog.querySelector<HTMLTextAreaElement>("textarea")!.value = "";
    dialog.querySelector(".form-error")!.textContent = "";
    const belongs = dialog.querySelector("#annotation-belongs")!;
    const investigation = state.investigations.find(
      (i) => i.id === investigationId,
    );
    belongs.innerHTML = investigation
      ? `<p class="belongs-label">Continuing investigation<br><strong>${escape(investigation.title)}</strong></p>`
      : `<label for="annotation-investigation">Keep this work together</label><select id="annotation-investigation"><option value="">Start a new investigation</option>${state.investigations
          .filter((i) => i.status !== "closed")
          .map((i) => `<option value="${i.id}">${escape(i.title)}</option>`)
          .join("")}</select>`;
    const scope =
      dialog.querySelector<HTMLFieldSetElement>("#annotation-scope")!;
    scope.hidden = Boolean(investigation);
    scope.innerHTML = `<legend>Where to look</legend>${state.collections.map((c) => `<label class="scope-option"><input type="checkbox" value="${escape(c.id)}" ${["web", "imports"].includes(c.id) ? "checked" : ""}>${escape(c.name)}</label>`).join("")}`;
    belongs.querySelector("select")?.addEventListener("change", (event) => {
      scope.hidden = Boolean((event.target as HTMLSelectElement).value);
    });
    dialog.showModal();
    dialog.querySelector<HTMLTextAreaElement>("textarea")!.focus();
  }
  dialog
    .querySelector("[data-close]")!
    .addEventListener("click", () => dialog.close());
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
          type: "annotate",
          investigationId,
          target: pendingTarget,
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
      dialog.close();
      setMode(false);
      updateCounts();
      message(
        dispatch
          ? "Investigation queued for a researcher. Your accepted graph is unchanged."
          : "Annotation saved. Send it from Ongoing work when you’re ready.",
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
            "Ongoing work",
            "Questions stay connected to their evidence, findings, and revisions.",
          )
        : heading(
            "Your judgment, in context",
            "Review research",
            "Inspect the evidence. Annotate an interpretation. Accept only what it supports.",
          )) +
      coordinatorControl +
      engineControl +
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
    const queued = i.annotations.filter((a) => !a.dispatchedAt).length;
    return `<div class="detail-topline"><span class="status-badge status-${i.status}">${statusLabel(i.status)}</span><span class="muted">Started ${date(i.createdAt)}</span></div><h2>${escape(i.title)}</h2><div class="work-actions">${queued ? '<button class="primary" data-command="dispatch">Send queued annotations</button>' : ""}${["queued", "running"].includes(i.status) ? '<button data-command="pause">Pause investigation</button>' : ""}${["paused", "running", "closed"].includes(i.status) ? `<button data-command="resume">${i.status === "running" ? "Replace researcher" : "Resume investigation"}</button>` : ""}${i.proposals.length ? "<button data-open-review>Open review</button>" : ""}</div><div class="activity-callout"><span class="eyebrow">${i.status === "running" ? "Assigned researcher" : "Research status"}</span><p>${i.status === "running" ? (state.coordinator?.awaitingSynthesis.includes(i.id) ? "Findings returned. Your coordinator is preparing the review proposal." : escape(i.lease?.worker)) : i.status === "queued" ? (state.coordinator?.enabled ? "Sent to your coordinator for assignment. Your accepted research is unchanged." : "Saved and ready for an agent to claim. No researcher is assigned yet.") : i.status === "draft" ? "Your annotations are saved. Send them together when you’re ready." : i.status === "paused" ? "Findings are preserved. Resume to hand them to a new researcher." : i.status === "review" ? "A proposal is ready. The accepted research has not changed." : "The review decision is recorded. You can reopen this investigation."}</p></div><div class="scope-summary"><span class="eyebrow">Where to look</span><p>${i.scope.map((id) => escape(state.collections.find((c) => c.id === id)?.name || id)).join(" · ") || "No collections selected"}</p></div>${last ? `<section class="review-section"><span class="eyebrow">Latest saved checkpoint</span><h3>${escape(last.summary)}</h3><p class="preserve-lines">${escape(last.findings)}</p><h4>Remaining work</h4><p class="preserve-lines">${escape(last.nextSteps)}</p><small>${date(last.at)} · ${escape(last.worker)}</small></section>` : ""}<section class="review-section"><h3>Annotations <span class="count-label">${i.annotations.length}</span></h3>${i.annotations.map((a) => `<div class="annotation-record" ${targetAttribute(a.target)}><div><span class="eyebrow">${escape(a.target.label)}</span><small>${a.dispatchedAt ? "Sent" : "Queued"}${a.target.proposalId ? " · Proposal feedback" : ""}</small></div>${a.target.text ? `<blockquote>${escape(a.target.text)}</blockquote>` : ""}<p>${escape(a.question)}</p></div>`).join("")}</section><details class="history-section"><summary>Investigation history</summary>${i.events.map((e) => `<p><time>${date(e.at)}</time> ${escape(e.message)}</p>`).join("")}${i.checkpoints
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
      i.proposals.find((p) => p.id === selectedProposal) || i.proposals.at(-1)!;
    selectedProposal = p.id;
    const outstanding = i.annotations.some(
      (a) => !p.addressedAnnotationIds.includes(a.id),
    );
    const sourceTitle = (id: string) =>
      state.dataset.sources?.find((s) => s.id === id)?.title ||
      p.changes.find((c) => c.table === "sources" && c.recordId === id)?.after
        ?.title ||
      id;
    return `<div data-proposal-id="${p.id}" ${targetAttribute({ label: p.title, proposalId: p.id })}><div class="detail-topline"><span class="status-badge status-${p.status}">${escape(p.status)}</span><span class="muted">Revision ${p.revision} · ${date(p.createdAt)}</span></div><div class="origin-question"><span class="eyebrow">Your investigation</span><p>${escape(i.annotations[0]?.question)}</p></div><h2>${escape(p.title)}</h2><p class="proposal-summary">${escape(p.summary)}</p><div class="revision-choices" aria-label="Proposal revisions">${i.proposals.map((version) => `<button type="button" data-proposal="${version.id}" aria-pressed="${version.id === p.id}">Revision ${version.revision}</button>`).join("")}</div>${outstanding ? '<div class="activity-callout">New feedback belongs to this investigation. Send queued annotations from Ongoing work, then review the revised proposal before accepting.</div>' : ""}<section class="review-section"><span class="eyebrow">Evidence and interpretation</span><h3>What the sources actually support</h3>${p.evidence.map((e) => `<article class="evidence-card" ${targetAttribute({ label: `Evidence: ${sourceTitle(e.sourceId)}`, proposalId: p.id })}><div class="detail-topline"><span class="status-badge">${escape(e.stance)}</span><span class="muted">${escape(e.locator)}</span></div><h4>${escape(sourceTitle(e.sourceId))}</h4><blockquote>${escape(e.quote)}</blockquote><div class="interpretation" ${targetAttribute({ label: "Interpretation of evidence", proposalId: p.id })}><span class="eyebrow">Interpretation</span><p>${escape(e.interpretation)}</p></div><details><summary>Surrounding context</summary><p class="preserve-lines">${escape(e.context)}</p></details><button type="button" data-evidence="${escape(e.id)}">View source in context ↗</button></article>`).join("") || '<p class="muted">No source passages were found. This outcome records an open question.</p>'}</section>${p.ambiguity ? `<section class="ambiguity-card" ${targetAttribute({ label: "Remaining ambiguity", proposalId: p.id })}><span class="eyebrow">Still open</span><h3>Uncertainty worth preserving</h3><p class="preserve-lines">${escape(p.ambiguity)}</p></section>` : ""}<section class="review-section"><span class="eyebrow">Proposed model changes</span><h3>${p.changes.length ? `${p.changes.length} change${p.changes.length === 1 ? "" : "s"} to review together` : "Preserve an unresolved outcome"}</h3>${p.changes.map((c) => `<article class="change-card" ${targetAttribute({ table: c.table, recordId: c.recordId, label: String(c.after?.name || c.after?.label || c.before?.name || c.recordId), proposalId: p.id })}><h4>${escape(c.after?.name || c.after?.label || c.before?.name || c.recordId)}</h4><p>${escape(c.reason)}</p><div class="change-comparison"><section><span class="eyebrow">Accepted now</span>${recordFields(c.before)}</section><section><span class="eyebrow">Proposed</span>${recordFields(c.after)}</section></div></article>`).join("")}</section><footer class="review-decision">${p.status === "pending" ? `<p>${p.changes.length ? "Accepting applies these exact changes together and preserves this review." : "Recording this outcome preserves the ambiguity without changing the graph."}</p><div><button class="primary" data-command="accept" ${outstanding || i.status !== "review" ? "disabled" : ""}>${p.changes.length ? "Accept proposal" : "Record unresolved outcome"}</button><button data-command="reject" ${outstanding || i.status !== "review" ? "disabled" : ""}>Reject proposal</button><button data-followup>Request further research</button></div>` : `<p>${p.status === "accepted" ? "Accepted and preserved in the research history." : p.status === "superseded" ? "A later research pass superseded this proposal. It remains available for inspection." : "Rejected. The accepted research was unchanged."}</p><button data-followup>Continue this investigation</button>`}</footer></div>`;
  }
  function renderSources() {
    surface.innerHTML =
      heading(
        "Research materials",
        "Sources & access",
        "Choose where researchers can look. Preserve the documents behind their conclusions.",
      ) +
      `<div class="sources-layout"><section><div class="section-heading"><h2>Available collections</h2><span class="count-label">${state.collections.length}</span></div>${state.collections.map((c) => `<article class="collection-card"><div class="collection-icon" aria-hidden="true">${c.kind === "web" ? "◎" : "▤"}</div><div><h3>${escape(c.name)}</h3><p>${escape(c.description)}</p><span class="capability">${c.kind === "web" ? "Requires a researcher with web access" : `${state.documents.filter((d) => d.collectionId === c.id).length} preserved documents`}</span>${c.path ? `<p class="folder-path">${escape(c.path)}</p><button type="button" data-rescan="${escape(c.path)}">Re-scan folder</button>` : ""}</div></article>`).join("")}<div class="section-heading"><h2>Preserved documents</h2></div>${state.documents.length ? `<div class="document-list">${state.documents.map((d) => `<button class="document-row" type="button" data-document="${d.id}"><span><strong>${escape(d.name)}</strong><small>${escape(state.collections.find((c) => c.id === d.collectionId)?.name)} · ${Math.ceil(d.size / 1024)} KB</small></span><span class="capability">${d.text !== undefined ? "Readable text" : "Original PDF · extraction not enabled"}</span></button>`).join("")}</div>` : '<div class="source-empty">Add documents or a local folder to give your research a starting collection.</div>'}</section><aside class="source-controls"><section class="source-add-card"><span class="eyebrow">Add research materials</span><h2>Bring your own collection</h2><p>Import PDFs, text, Markdown, or CSV. Original copies are retained for evidence review.</p><label class="upload-label">Choose documents<input id="source-upload" type="file" accept=".pdf,.txt,.md,.csv" multiple></label><p class="muted">Up to 10 MB per document.</p><hr><form id="folder-form"><label for="folder-path">Local folder</label><input id="folder-path" placeholder="/Users/you/Documents/Research" required><button type="submit">Add folder</button></form><p class="muted">Scans up to 100 supported files, four folders deep. Changes to originals do not alter preserved copies.</p><p id="source-result" role="status"></p></section><section class="access-note"><h3>Subscription collections</h3><p>JSTOR and other subscription services need a supported access adapter. No account connection is enabled yet. You can import documents you already have.</p></section></aside></div>`;
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
  function showSource(
    documentId?: string,
    quote?: string,
    sourceId?: string,
    proposal?: Proposal,
  ) {
    const doc = state.documents.find((d) => d.id === documentId);
    const source =
      state.dataset.sources?.find((s) => s.id === sourceId) ||
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
    sourceDialog.innerHTML = `<header class="dialog-heading"><div><span class="eyebrow">Original source</span><h2>${escape(doc?.name || source?.title || "Source access")}</h2></div><button type="button" data-close-source aria-label="Close source">×</button></header><button type="button" data-source-annotate aria-pressed="${annotate}">Annotate source text</button>${doc ? `<p class="document-fingerprint">Preserved ${date(doc.importedAt)}</p><details><summary>Document fingerprint</summary><p class="document-fingerprint">SHA-256 ${escape(doc.sha256)}</p></details><a href="/api/documents/${doc.id}" target="_blank" rel="noopener">Open preserved file ↗</a>` : ""}<div class="source-content" ${targetAttribute({ table: "sources", recordId: sourceId || doc?.id, label: String(doc?.name || source?.title || "Source passage"), proposalId: proposal?.id })}>${body}</div>`;
    if (proposal && selectedInvestigation) {
      sourceDialog.dataset.investigationId = selectedInvestigation;
      sourceDialog.dataset.proposalId = proposal.id;
    } else {
      delete sourceDialog.dataset.investigationId;
      delete sourceDialog.dataset.proposalId;
    }
    sourceDialog
      .querySelector("[data-close-source]")!
      .addEventListener("click", () => sourceDialog.close());
    sourceDialog
      .querySelector("[data-source-annotate]")!
      .addEventListener("click", () => {
        setMode(!annotate);
        sourceDialog
          .querySelector("[data-source-annotate]")!
          .setAttribute("aria-pressed", String(annotate));
      });
    sourceDialog.showModal();
    sourceDialog.querySelector("mark")?.scrollIntoView({ block: "center" });
  }
  surface.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>(
      "button",
    );
    if (!button) return;
    if (button.dataset.selectInvestigation) {
      selectedInvestigation = button.dataset.selectInvestigation;
      selectedProposal = undefined;
      renderView();
    } else if (button.hasAttribute("data-go-research")) setView("research");
    else if (button.hasAttribute("data-open-review")) setView("review");
    else if (button.dataset.proposal) {
      selectedProposal = button.dataset.proposal;
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
