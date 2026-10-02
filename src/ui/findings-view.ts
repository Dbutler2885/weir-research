import { queueSection } from "./queue-view";
import type {
  Annotation,
  Investigation,
  Proposal,
  ResearchState,
} from "../domain/research";
import type { Assignment } from "../domain/assignments";
import { researchersPerBatch } from "../domain/assignments";
import { batchStatus } from "../domain/conversation";
import { sourceLibrary } from "../domain/findings";
import { html, target } from "./finding-review";

export type FindingsSection = "findings" | "activity" | "queue" | "board";

const FINDINGS_SHOWN = 3;
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function batches(state: ResearchState): Investigation[] {
  return state.investigations
    .filter((i) => i.number)
    .sort((a, b) => b.number! - a.number!);
}

// Project-wide record of researcher returns, grouped by batch and question.
export function findingsPage(
  state: ResearchState,
  section: FindingsSection,
  expanded: ReadonlySet<string>,
): string {
  const all = batches(state);
  const body =
    section === "queue"
      ? queueSection(state)
      : section === "board"
      ? `<div class="findings-scroll">${boards(all)}</div>`
      : section === "activity"
      ? `<div class="findings-scroll">${activity(state, all)}</div>`
      : all.length
        ? `<div class="findings-layout"><nav class="findings-toc" aria-label="Contents">${contents(all)}</nav><div class="findings-scroll">${all.map((b) => batchCard(state, b, expanded)).join("")}</div></div>`
        : '<div class="findings-scroll"><div class="findings-empty"><h2>No research yet</h2><p>Write to your coordinator, or annotate what you see, from the Coordinator sidebar. Your coordinator groups the work into batches, and every report appears here.</p></div></div>';
  return `<section class="findings-page"><header class="findings-head"><div class="findings-head-row"><div><h1>Investigations</h1><p>${section === "queue" ? "Batches waiting and in progress, in the order they are worked." : section === "activity" ? "What has happened, batch by batch." : section === "board" ? "What researchers and the coordinator posted for each batch's researchers." : "Everything researchers have returned, grouped by batch. Newest first."}</p></div></div><nav class="findings-tabs" aria-label="Investigations"><button type="button" data-investigation-section="findings" ${section === "findings" ? 'aria-current="page"' : ""}>Findings</button><button type="button" data-investigation-section="queue" ${section === "queue" ? 'aria-current="page"' : ""}>Queue</button><button type="button" data-investigation-section="activity" ${section === "activity" ? 'aria-current="page"' : ""}>Activity</button><button type="button" data-investigation-section="board" ${section === "board" ? 'aria-current="page"' : ""}>Board</button></nav></header>${body}</section>`;
}

function contents(all: Investigation[]): string {
  return `<ol>${all
    .map(
      (b) =>
        `<li><a class="toc-batch" href="#batch-${html(b.id)}" data-toc="batch-${html(b.id)}"><span class="toc-number">${b.number}</span>${html(b.title)}</a>${
          b.assignments?.length
            ? `<ol>${[...b.assignments]
                .reverse()
                .map(
                  (a) =>
                    `<li><a href="#pass-${html(a.id)}" data-toc="pass-${html(a.id)}">${html(a.title)}${a.status === "running" || a.status === "waiting" || a.status === "paused" ? ` <span class="toc-state">· ${a.status}</span>` : ""}</a></li>`,
                )
                .join("")}</ol>`
            : ""
        }</li>`,
    )
    .join("")}</ol>`;
}

function batchCard(
  state: ResearchState,
  b: Investigation,
  expanded: ReadonlySet<string>,
): string {
  const status = batchStatus(b);
  const label =
    status === "ready" ? "ready for review" : status === "closed" ? "closed" : b.status === "paused" ? "paused" : "in progress";
  const assignments = b.assignments || [];
  const times = [
    b.createdAt,
    ...assignments.map((a) => a.startedAt || a.createdAt),
    ...b.proposals.map((p) => p.createdAt),
  ].sort();
  const range =
    day(times[0]!) === day(times.at(-1)!)
      ? day(times[0]!)
      : `${day(times[0]!)} to ${day(times.at(-1)!)}`;
  const working = assignments.filter((a) => a.status === "running").length;
  const meta = [
    range,
    working ? `${working} researcher${working === 1 ? "" : "s"} working` : "",
    b.reviewFlow?.walkthroughs.length
      ? `<button type="button" class="text-action" data-open-walkthrough>Read the walkthrough</button>`
      : "",
    graphStatus(b),
    ["queued", "running"].includes(b.status)
      ? '<button type="button" class="text-action" data-command="pause">Pause</button>'
      : "",
    // A batch the human paused, or one with a researcher an interruption paused.
    (b.status === "paused" || assignments.some((a) => a.status === "paused")) && b.resumeRequest?.status !== "pending"
      ? '<button type="button" class="text-action" data-command="resume">Resume</button>'
      : "",
  ].filter(Boolean);
  // The newest research pass first, as batches are.
  const passes = [...assignments].reverse().map((a) => pass(state, b, a, expanded)).join("");
  const other = b.proposals.filter((p) => !p.assignmentId || !assignments.some((a) => a.id === p.assignmentId));
  return `<article class="batch-card" id="batch-${html(b.id)}" data-investigation-id="${html(b.id)}" ${target({ label: b.title, investigationId: b.id })}><div class="batch-label">Batch ${b.number} · ${label}</div><h2>${html(b.title)}</h2><p class="batch-meta">${meta.join(" · ")}</p>${requests(state, b)}${passes}${
    other.length
      ? `<section class="batch-question"><h3>Other reports in this batch</h3>${other.map((p, n) => report(state, p, n === 0, expanded)).join("")}</section>`
      : ""
  }${board(b)}</article>`;
}

function graphStatus(b: Investigation): string {
  const review = b.reviewFlow?.graphReviews.at(-1);
  const job = b.reviewFlow?.jobs.filter((j) => j.status !== "superseded").at(-1);
  if (b.closedAt) return `Graph approved ${day(b.closedAt)}`;
  if (review?.status === "pending") return "Graph review in progress";
  if (job && ["queued", "running", "returned"].includes(job.status)) return "Graph update in progress";
  if (job?.status === "paused") return "Graph update paused";
  return "";
}

// Researchers reach the web through the research browser, so a sign-in they need is
// made there; one made in the human's everyday browser does not reach them.
function accessActions(state: ResearchState, url?: string): string {
  const page = url && /^https?:\/\//.test(url) ? url : "";
  const browser = state.researchBrowser;
  const resume = '<button type="button" data-command="resolve-access">Access is ready, resume</button>';
  if (!browser?.available)
    return `<div class="batch-request-actions">${page ? `<a href="${html(page)}" target="_blank" rel="noopener">Open source</a>` : ""}${resume}</div>`;
  return `<p class="batch-request-note">Sign in in the research browser, the separate ${html(browser.name || "browser")} window researchers use. Sign-ins in your everyday browser do not reach them.</p><div class="batch-request-actions"><button type="button" class="primary" data-open-research-browser-page="${html(page)}">Open in the research browser</button>${resume}</div>`;
}

function requests(state: ResearchState, b: Investigation): string {
  const resume =
    b.status === "paused" && b.resumeRequest?.status === "pending"
      ? `<section class="batch-request"><strong>Resume this batch?</strong><p>${html(b.resumeRequest.reason)}</p><div class="batch-request-actions"><button type="button" class="primary" data-command="resume-decision" data-resume-request="${html(b.resumeRequest.id)}" data-resume-decision="approve">Resume research</button><button type="button" data-command="resume-decision" data-resume-request="${html(b.resumeRequest.id)}" data-resume-decision="decline">Keep paused</button></div></section>`
      : "";
  const access =
    b.accessRequest && !b.accessRequest.resolvedAt
      ? `<section class="batch-request"><strong>Source access needs your help</strong><p>${html(b.accessRequest.instruction)}</p>${accessActions(state, b.accessRequest.url)}</section>`
      : "";
  return resume + access;
}

const passStates: Record<Assignment["status"], string> = {
  waiting: "Waiting",
  running: "running",
  returned: "returned; your coordinator is checking it",
  done: "returned",
  paused: "paused",
  stopped: "stopped",
};

// Where a research pass stands: who did it and when.
function passState(state: ResearchState, b: Investigation, a: Assignment): string {
  if (a.status === "waiting")
    return (b.assignments || []).filter((x) => x.status === "running").length >= researchersPerBatch(state)
      ? "Waiting. This batch already has as many researchers working as your setting allows; this starts when one finishes."
      : "Waiting for a researcher.";
  if (!a.startedAt) return a.status === "stopped" ? "Not started." : passStates[a.status];
  const who = a.worker?.startsWith("Coordinator") ? "Your coordinator" : a.worker || "A researcher";
  if (a.status === "paused") return `${who} · paused. Resume the batch to carry on.`;
  const at = a.status === "running" ? `since ${when(a.startedAt)}` : a.endedAt ? when(a.endedAt) : when(a.startedAt);
  return `${who} · ${passStates[a.status]} ${at}`;
}

// The longest brief shown in full; a longer one opens on request.
const BRIEF_SHOWN = 600;

// What the pass was asked: the coordinator's brief, or, for a pass from before briefs,
// the annotations it was started from.
function direction(state: ResearchState, b: Investigation, a: Assignment, expanded: ReadonlySet<string>): string {
  if (a.brief) {
    const whole = expanded.has(`brief:${a.id}`) || a.brief.length <= BRIEF_SHOWN;
    return `<div class="asked"><p class="asked-label">The coordinator's brief</p><blockquote class="${whole ? "" : "is-clipped"}" ${target({ label: a.brief, investigationId: b.id, assignmentId: a.id })}>${html(a.brief)}</blockquote>${whole ? "" : `<button type="button" class="text-action" data-whole-brief="${html(a.id)}">Show the whole brief</button>`}</div>`;
  }
  const notes = b.annotations.filter((x) => a.annotationIds?.includes(x.id));
  if (!notes.length) return "";
  const written = b.reviewFlow?.walkthroughs[0]?.createdAt;
  return `<div class="asked"><p class="asked-label">Started from your annotations</p>${notes
    .map((x) => {
      const ref = x.references?.[0] || x.target;
      const about =
        ref && ref.label && ref.label !== state.dataset.title
          ? `On "${html(ref.label)}" you wrote:`
          : "You wrote:";
      const late =
        written && x.dispatchedAt && x.dispatchedAt > written
          ? `<p class="asked-note">Sent ${html(when(x.dispatchedAt))}, after the walkthrough was written.</p>`
          : "";
      return `<p>${about}</p><blockquote ${target({ label: x.question })}>${html(x.question)}</blockquote>${late}`;
    })
    .join("")}</div>`;
}

// One research pass: its title and direction, any steering, and what it returned.
function pass(state: ResearchState, b: Investigation, a: Assignment, expanded: ReadonlySet<string>): string {
  const reports = b.proposals.filter((p) => p.assignmentId === a.id).reverse();
  const steering = a.steering.length
    ? `<ul class="steering">${a.steering.map((s) => `<li><time datetime="${html(s.at)}">The coordinator redirected it, ${html(when(s.at))}</time>${html(s.message)}</li>`).join("")}</ul>`
    : "";
  const pending =
    a.status === "running"
      ? '<p class="report-pending">The researcher is working on this now.</p>'
      : a.status === "returned"
        ? '<p class="report-pending">The researcher has returned its findings; your coordinator is checking them.</p>'
        : "";
  return `<section class="batch-question" id="pass-${html(a.id)}" ${target({ label: a.title, investigationId: b.id, assignmentId: a.id })}><h3>${html(a.title)}</h3><p class="pass-state">${passState(state, b, a)}</p>${direction(state, b, a, expanded)}${steering}${
    reports.map((p, n) => report(state, p, n === 0, expanded)).join("") || pending
  }</section>`;
}

// What the batch's researchers told each other, for the human to look into.
function board(b: Investigation): string {
  const posts = b.board || [];
  if (!posts.length) return "";
  return `<details class="batch-board"><summary>What the researchers told each other · ${posts.length} post${posts.length === 1 ? "" : "s"}</summary><p>Researchers in this batch post here when they find something the others should know. Researchers who start later read these first.</p>${postList(b)}</details>`;
}

// A batch's posts, each with who wrote it.
function postList(b: Investigation): string {
  const title = (id?: string) => b.assignments?.find((a) => a.id === id)?.title || "a research pass";
  return `<ol class="board-posts">${(b.board || [])
    .map((p) => `<li><span class="board-who">${p.author === "coordinator" ? "Your coordinator" : `The researcher on "${html(title(p.assignmentId))}"`} · ${html(when(p.at))}</span>${html(p.text)}</li>`)
    .join("")}</ol>`;
}

// Every batch's board, newest batch first, to see how researchers use it.
function boards(all: Investigation[]): string {
  const posted = all.filter((b) => b.board?.length);
  return posted.length
    ? posted.map((b) => `<section class="board-batch"><h2><span class="activity-batch">Batch ${b.number}</span> ${html(b.title)}</h2>${postList(b)}</section>`).join("")
    : '<p class="findings-empty">Posts appear here when researchers in a batch tell each other what they found.</p>';
}

function report(
  state: ResearchState,
  p: Proposal,
  open: boolean,
  expanded: ReadonlySet<string>,
): string {
  const findings = p.findings || [];
  const shown = expanded.has(p.id) ? findings : findings.slice(0, FINDINGS_SHOWN);
  return `<details class="report" data-proposal-id="${html(p.id)}" ${target({ label: p.title, proposalId: p.id })} ${open ? "open" : ""}><summary>${html(p.title)}</summary><p class="report-by">Published ${html(when(p.createdAt))}.</p><p class="report-summary">${html(p.summary)}</p>${
    shown.length
      ? `<div class="finding-list">${shown
          .map(
            (f) =>
              `<article ${target({ label: f.statement, proposalId: p.id, findingId: f.id })}><div class="finding-meta">${html(f.qualification)}</div><h4>${html(f.statement)}</h4><p class="preserve-lines">${html(f.explanation)}</p>${f.evidenceIds.map((id) => passage(state, p, id)).join("")}</article>`,
          )
          .join("")}</div>`
      : ""
  }${
    findings.length > shown.length
      ? `<button type="button" class="text-action" data-more-findings="${html(p.id)}">Show ${findings.length - shown.length} more finding${findings.length - shown.length === 1 ? "" : "s"} from this report</button>`
      : ""
  }</details>`;
}

function passage(state: ResearchState, p: Proposal, id: string): string {
  const e = p.evidence.find((e) => e.id === id);
  if (!e) return "";
  const source = sourceLibrary(state).find((s) => s.id === e.sourceId);
  return `<details class="guided-passage"><summary>${html(source?.title || e.sourceId)} · ${html(e.locator)}</summary><blockquote>${html(e.quote)}</blockquote><button type="button" class="text-action" data-open-source="${html(e.sourceId)}">Inspect source</button></details>`;
}

function activity(state: ResearchState, all: Investigation[]): string {
  const items = all
    .flatMap((b) => b.events.map((e) => ({ ...e, batch: b.number! })))
    .sort((a, b) => b.at.localeCompare(a.at));
  return items.length
    ? `<ol class="activity-list">${items
        .map(
          (e) =>
            `<li><time datetime="${html(e.at)}">${html(when(e.at))}</time><div><span class="activity-batch">Batch ${e.batch}</span> ${html(e.message)}</div></li>`,
        )
        .join("")}</ol>`
    : '<p class="findings-empty">Activity appears here as research happens.</p>';
}
