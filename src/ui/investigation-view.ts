import type {
  AnnotationTarget,
  Investigation,
  ResearchState,
} from "../domain/research";
import { html, target } from "./finding-review";
import { dispatchSettings } from "./dispatch-settings";
import { usageLines } from "./live-panel";
import { pdfReadingSettings } from "./pdf-reading";
import { researchersPerBatch } from "../domain/assignments";

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

// Whether the app's coordinator is running, and what that means, as settings says it.
export function coordinatorStatus(coordinator: ResearchState["coordinator"]): { status: string; description: string } {
  if (!coordinator?.connected && coordinator?.waiting)
    return { status: "The coordinator starts when you write to it", description: "Reopening a project spends nothing. It starts on your first message, annotation or decision." };
  return coordinator?.connected
    ? { status: "The coordinator is running", description: "It starts fresh each time the app opens this project, and handles new research assignments." }
    : { status: "The coordinator is not running", description: coordinator?.problem || "It starts when the app opens this project. Saved work remains available." };
}

export function settingsView(state: ResearchState, i?: Investigation): string {
  const coordinator = state.coordinator;
  // A fresh start waits for active work to finish. A coordinator held by its usage
  // limit is idle and can be replaced without disturbing any workers.
  const freshAllowed = Boolean(coordinator?.listening || coordinator?.paused || !coordinator?.connected);
  const execution = i?.executions?.at(-1);
  const settings = state.researchSettings;
  const number = (id: string, label: string, value: number, max: number) =>
    `<label for="${id}">${label}</label><div class="setting-control"><input id="${id}" type="number" min="1" max="${max}" step="1" required value="${value}"></div>`;
  const team = `<section><h2>The research team</h2><form id="team-form">${number("researchers-per-batch", "Researchers in each new batch's team", researchersPerBatch(state), 20)}${number("helper-limit", "Helpers at work at once, across the project", settings?.helperLimit ?? 8, 50)}${number("reader-limit", "Readers at work at once, across the project", settings?.readerLimit ?? 20, 100)}<button>Save</button><p class="page-context">A team shares its batch's goal and divides the work itself. Researchers send helpers on errands and readers over passages; further ones wait their turn.</p></form></section>`;
  const j = state.jevFigures;
  const share = j && j.characters ? Math.round((j.passed / j.characters) * 100) : 0;
  const jev = `<section><h2>Jev sweeps</h2>${
    j?.sweeps
      ? `<p>${j.sweeps.toLocaleString("en-US")} sweep${j.sweeps === 1 ? "" : "s"} of ${j.characters.toLocaleString("en-US")} characters; ${j.passed.toLocaleString("en-US")} went on to readers, ${share}% of what was swept.</p><p>${j.sampled ? `Of ${j.sampled.toLocaleString("en-US")} passage${j.sampled === 1 ? "" : "s"} it passed over that a reader then checked, ${j.misses.toLocaleString("en-US")} held something relevant.` : "No passed-over passages have been checked by a reader yet."}</p>`
      : "<p>No sweeps yet.</p>"
  }<p class="page-context">Jev is a fast, cheap model researchers use to find where to look in a long document. The smaller the share that goes on to readers, the more it saves; passages it wrongly passed over are what it costs.</p></section>`;
  return `<div class="settings-page"><header class="simple-heading"><h1>Research settings</h1></header>${dispatchSettings(state.dispatch, state.catalog)}${team}${jev}${pdfReadingSettings(state)}<section><h2>Research browser</h2><p class="page-context">Researchers share one browser, separate from your own, and each works in its own tab. Sign in to archives there once, and every researcher can use them.</p>${state.researchBrowser?.available ? '<button type="button" data-open-research-browser>Open the research browser</button>' : '<p>Install Chrome, Brave, Firefox or another browser researchers can drive to give them one.</p>'}</section>${usageLines(state).length ? `<section><h2>Usage</h2>${usageLines(state).map((u) => `<p class="usage-line">${html(u)}</p>`).join("")}<p class="page-context">As each agent last reported it. When a limit is reached, work pauses and carries on when it resets, or sooner if the limit lifts early.</p></section>` : ""}<section><h2>Your AI accounts</h2><p class="page-context">See which of your AI accounts are connected, connect another, or check what else the app needs.</p><a class="setting-link" href="/setup">Open setup</a></section><section><h2>Coordinator</h2><p data-coordinator-status>${html(coordinatorStatus(coordinator).status)}</p><p class="page-context" data-coordinator-description>${html(coordinatorStatus(coordinator).description)}</p>${coordinator?.context ? `<p class="page-context">Its context holds about ${coordinator.context.tokens.toLocaleString("en-US")} tokens of ${coordinator.context.threshold.toLocaleString("en-US")}.</p>` : ""}<form id="compact-form"><label for="compact-at">Compact its conversation at</label><div class="setting-control"><input id="compact-at" type="number" min="20000" max="2000000" step="1000" required value="${state.researchSettings?.compactAt ?? 200000}"> tokens<button>Save</button></div><p class="page-context">200,000 by default, or the model's own limit if that is smaller. A new threshold applies from the coordinator's next fresh start.</p></form><div class="setting-control"><button type="button" data-coordinator-fresh ${freshAllowed ? "" : "disabled"}>${coordinator?.connected ? "Start a fresh coordinator" : "Start the coordinator"}</button></div><p class="page-context">A fresh coordinator starts from the project's saved state; workers and queued work carry on.${freshAllowed ? "" : " Available while the coordinator is listening."}</p></section>${i ? `<section><h2>This investigation</h2><dl class="settings-details"><dt>Source access</dt><dd>${i.scope.map((id) => html(state.collections.find((c) => c.id === id)?.name || id)).join(", ")}</dd>${execution ? `<dt>Last researcher</dt><dd>${html(execution.worker)}</dd>${execution.model !== "Runtime configured; not reported" ? `<dt>Model</dt><dd>${html(execution.model)}</dd>` : ""}` : ""}</dl></section>` : ""}<section><h2>Developer mode</h2><label class="setting-check"><input type="checkbox" id="developer-mode" ${state.developerMode ? "checked" : ""}> Record feedback about Weir itself</label><p class="page-context">Adds a Feedback page and an Interface feedback choice to annotations, and lets you annotate any part of the app. It is for people working on Weir, and applies to every project.</p></section></div>`;
}
