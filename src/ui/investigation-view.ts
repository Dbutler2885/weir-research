import type {
  AnnotationTarget,
  Investigation,
  ResearchState,
} from "../domain/research";
import { html, target } from "./finding-review";

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
