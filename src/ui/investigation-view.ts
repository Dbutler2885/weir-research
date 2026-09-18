import type {
  AnnotationTarget,
  Investigation,
  ResearchState,
} from "../domain/research";
import { html, target } from "./finding-review";

export type InvestigationSection = "findings" | "annotations" | "activity";
const date = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

// A selected subject and the annotation about it are different objects.
// This affects presentation only; the original records remain intact.
export function investigationSubject(i: Investigation): string {
  const first = i.annotations[0];
  if (first?.references?.length) return first.references[0]!.label;
  if (first?.target.text) return first.target.label;
  return i.title;
}
export function referenceList(refs: AnnotationTarget[]): string {
  const unique = [...new Map(refs.map((r) => [JSON.stringify(r), r])).values()];
  return unique
    .map(
      (r) =>
        `<blockquote class="note-reference" ${target(r)}>${html(r.text || r.label)}</blockquote>`,
    )
    .join("");
}
const status = (i: Investigation) =>
  ({
    draft: "Not sent",
    queued: "Waiting to begin",
    running: i.phase === "graph" ? "Building a graph" : "Research in progress",
    paused: "Paused",
    review: "Ready for review",
    closed: "Recorded",
  })[i.status];

export function investigationView(
  state: ResearchState,
  i: Investigation,
  section: InvestigationSection,
): string {
  const findings = i.proposals.flatMap((p) =>
    (p.findings || [])
      .filter((f) => f.status !== "superseded")
      .map((f) => ({ p, f })),
  );
  const pending = i.proposals.filter((p) => p.status === "pending");
  const latest = i.events.at(-1)?.message || "";
  const pausedReason =
    i.status === "paused" &&
    (latest.includes("ten-minute") || latest.includes("time limit"))
      ? "Paused after the time limit"
      : status(i);
  const resumePending =
    i.status === "paused" && i.resumeRequest?.status === "pending";
  const guided = i.reviewFlow?.walkthroughs.at(-1);
  const graphJob = i.reviewFlow?.jobs.at(-1);
  const actions = `${["queued", "running"].includes(i.status) ? '<button data-command="pause">Pause</button>' : ""}${i.status === "paused" && !resumePending ? '<button data-command="resume">Resume</button>' : ""}${guided ? '<button class="primary" data-open-review>Read the walkthrough</button>' : pending.length ? '<button class="primary" data-open-review>Open research</button>' : ""}`;
  let content = "";
  if (section === "findings") {
    content = guided ? `<h2>${html(guided.title)}</h2><p class="preserve-lines">${html(guided.answer)}</p><p>${html(graphJob?.progress || "The walkthrough is ready.")}</p><button data-open-review>Open the research walkthrough</button>` : findings.length
      ? `<div class="finding-list">${findings.map(({ p, f }) => `<article ${target({ label: f.statement, proposalId: p.id, findingId: f.id })}><div class="finding-meta">${html(f.qualification)} · ${html(f.status)}</div><h2>${html(f.statement)}</h2><p class="preserve-lines">${html(f.explanation)}</p><button class="text-action" data-source-review="${i.id}" data-source-proposal="${p.id}">Read evidence and review</button></article>`).join("")}</div>`
      : i.proposals.length
        ? `<p>This investigation has a saved review.</p><button data-open-review>Open review</button>`
        : `<div class="investigation-empty"><h2>No findings are ready for review yet</h2><p>${i.checkpoints.length ? "Research notes are saved in Activity. They have not been published as findings." : "Findings will appear here as the research is prepared for your review."}</p>${i.checkpoints.length ? '<button class="text-action" data-investigation-section="activity">View saved research notes</button>' : ""}</div>`;
  } else if (section === "annotations") {
    content = `<div class="annotation-list">${i.annotations
      .map((a) => {
        const refs = a.references?.length
          ? a.references
          : a.target.text || a.target.recordId
            ? [a.target]
            : [];
        return `<article class="annotation-entry" data-annotation-id="${a.id}"><div class="note-meta"><span>Your annotation · ${a.dispatchedAt ? "Sent" : "Not sent"}</span><time>${date(a.createdAt)}</time></div><p class="annotation-text" ${target({ label: "Your annotation", text: a.question })}>${html(a.question)}</p>${refs.length ? `<details class="annotation-references"><summary>${refs.length === 1 ? "Referenced passage" : `${refs.length} references`}</summary>${referenceList(refs)}</details>` : ""}<div class="note-actions"><button class="text-action" data-edit-note="${a.id}">${a.dispatchedAt ? "Add amendment" : "Edit"}</button>${!a.dispatchedAt ? `<button class="text-action" data-delete-note="${a.id}">Remove</button>` : ""}</div></article>`;
      })
      .join("")}</div>`;
  } else {
    const events = [
      ...i.events.map((e) => ({ at: e.at, body: `<p>${html(e.message)}</p>` })),
      ...i.checkpoints.map((c) => ({
        at: c.at,
        body: `<h2>Saved research notes</h2><p class="preserve-lines">${html(c.summary)}</p><details class="research-notes"><summary>Read notes and remaining work</summary><div class="preserve-lines">${html(c.findings)}</div><h3>Remaining work</h3><p class="preserve-lines">${html(c.nextSteps)}</p></details>`,
      })),
    ].sort((a, b) => b.at.localeCompare(a.at));
    content = `<ol class="activity-list">${events.map((e) => `<li><time>${date(e.at)}</time><div>${e.body}</div></li>`).join("")}</ol>`;
  }
  const resumeApproval = resumePending
    ? `<section class="resume-approval" aria-label="Resume confirmation"><h2>Resume this investigation?</h2><p class="preserve-lines">${html(i.resumeRequest!.reason)}</p><div><button class="primary" data-command="resume-decision" data-resume-request="${html(i.resumeRequest!.id)}" data-resume-decision="approve">Resume research</button><button data-command="resume-decision" data-resume-request="${html(i.resumeRequest!.id)}" data-resume-decision="decline">Keep paused</button></div></section>`
    : "";
  return `<header class="investigation-heading"><h1>${html(investigationSubject(i))}</h1><div class="investigation-status"><span>${html(pausedReason)}</span>${actions}</div></header>${resumeApproval}${i.accessRequest && !i.accessRequest.resolvedAt ? `<section class="access-request"><h2>Source access needs your help</h2><p>${html(i.accessRequest.instruction)}</p>${i.accessRequest.url && /^https?:\/\//.test(i.accessRequest.url) ? `<a href="${html(i.accessRequest.url)}" target="_blank" rel="noopener">Open source</a>` : ""}<button data-command="resolve-access">Access is ready, resume</button></section>` : ""}<nav class="investigation-sections" aria-label="Investigation views">${[
    ["findings", "Findings"],
    ["annotations", `Your annotations (${i.annotations.length})`],
    ["activity", "Activity"],
  ]
    .map(
      ([id, label]) =>
        `<button data-investigation-section="${id}" ${id === section ? 'aria-current="page"' : ""}>${label}</button>`,
    )
    .join(
      "",
    )}</nav><section class="investigation-content" aria-label="${section}">${content}</section>`;
}

export function feedbackView(state: ResearchState): string {
  const items = state.interfaceFeedback || [];
  return `<div class="feedback-page"><header class="simple-heading"><h1>Interface feedback</h1><button data-new-interface-note>Add feedback</button></header><p class="page-context">${items.length} saved ${items.length === 1 ? "note" : "notes"} for this project.</p>${
    items.length
      ? `<div class="feedback-list">${[...items]
          .reverse()
          .map(
            (f) =>
              `<article class="annotation-entry"><div class="note-meta"><time>${date(f.at)}</time></div><p class="annotation-text">${html(f.text)}</p>${f.references.length ? `<details class="annotation-references"><summary>${f.references.length === 1 ? "Referenced passage" : `${f.references.length} references`}</summary>${referenceList(f.references)}</details>` : ""}</article>`,
          )
          .join("")}</div>`
      : "<p>Use Annotate or Add feedback to leave a note about the interface.</p>"
  }</div>`;
}

export function settingsView(state: ResearchState, i?: Investigation): string {
  const researcher = state.researcher;
  const coordinator = state.coordinator;
  const execution = i?.executions?.at(-1);
  const minutes = state.researchSettings?.timeLimitMinutes ?? null;
  const timeLimit = `<section><h2>Time limit</h2><form id="time-limit-form"><label for="research-time-limit-mode">Per research pass</label><div class="setting-control"><select id="research-time-limit-mode"><option value="none" ${minutes === null ? "selected" : ""}>No time limit</option><option value="limited" ${minutes !== null ? "selected" : ""}>Set a limit</option></select><label class="time-limit-value" ${minutes === null ? "hidden" : ""}><input id="research-time-limit" type="number" min="1" step="1" required ${minutes === null ? "disabled" : ""} value="${minutes ?? 30}" aria-label="Time limit in minutes"> minutes</label><button>Save time limit</button></div><p class="page-context">Applies to new research and graph-building passes in this project. Running passes keep their current limit.</p></form></section>`;
  return `<div class="settings-page"><header class="simple-heading"><h1>Research settings</h1><button data-view-work>Back to investigation</button></header><section><h2>Researcher preference</h2>${researcher ? `<form id="engine-form"><label for="research-engine">Use for new assignments</label><div class="setting-control"><select id="research-engine"><option value="manual" ${researcher.selected === "manual" ? "selected" : ""}>Coordinator's tools</option>${researcher.engines.map((e) => `<option value="${e.id}" ${e.id === researcher.selected ? "selected" : ""} ${!e.available ? "disabled" : ""}>${e.id === "codex" ? "Codex" : "Claude Code"}${e.available ? "" : " (not installed)"}</option>`).join("")}</select><button>Save preference</button></div></form>` : "<p>Researcher controls are unavailable.</p>"}</section>${timeLimit}<section><h2>Connection</h2><p data-coordinator-status>${coordinator?.connected ? `Connected to ${html(coordinator.name)}` : "Coordinator disconnected"}</p><p class="page-context">${coordinator?.connected ? "Your coordinator handles new research assignments." : "Open an agent in this repository to continue research. Saved work remains available."}</p></section>${i ? `<section><h2>This investigation</h2><dl class="settings-details"><dt>Source access</dt><dd>${i.scope.map((id) => html(state.collections.find((c) => c.id === id)?.name || id)).join(", ")}</dd>${execution ? `<dt>Last researcher</dt><dd>${html(execution.worker)}</dd>${execution.model !== "Runtime configured; not reported" ? `<dt>Model</dt><dd>${html(execution.model)}</dd>` : ""}` : ""}</dl></section>` : ""}</div>`;
}
