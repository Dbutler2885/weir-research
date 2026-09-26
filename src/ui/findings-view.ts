import { queueSection } from "./queue-view";
import type {
  Annotation,
  Investigation,
  Proposal,
  ResearchState,
} from "../domain/research";
import type { Question } from "../domain/conversation";
import { batchStatus } from "../domain/conversation";
import { sourceLibrary } from "../domain/findings";
import { html, target } from "./finding-review";

export type FindingsSection = "findings" | "activity" | "queue";

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
      : section === "activity"
      ? `<div class="findings-scroll">${activity(state, all)}</div>`
      : all.length
        ? `<div class="findings-layout"><nav class="findings-toc" aria-label="Contents">${contents(all)}</nav><div class="findings-scroll">${all.map((b) => batchCard(state, b, expanded)).join("")}</div></div>`
        : '<div class="findings-scroll"><div class="findings-empty"><h2>No research yet</h2><p>Send an annotation or a question from the Annotations drawer. Your coordinator groups the work into batches, and every report appears here.</p></div></div>';
  return `<section class="findings-page"><header class="findings-head"><div class="findings-head-row"><div><h1>Investigations</h1><p>${section === "queue" ? "Batches waiting and in progress, in the order they are worked." : section === "activity" ? "What has happened, batch by batch." : "Everything researchers have returned, grouped by batch. Newest first."}</p></div><button type="button" class="text-action" data-open-settings>Research settings</button></div><nav class="findings-tabs" aria-label="Investigations"><button type="button" data-investigation-section="findings" ${section === "findings" ? 'aria-current="page"' : ""}>Findings</button><button type="button" data-investigation-section="queue" ${section === "queue" ? 'aria-current="page"' : ""}>Queue</button><button type="button" data-investigation-section="activity" ${section === "activity" ? 'aria-current="page"' : ""}>Activity</button></nav></header>${body}</section>`;
}

function contents(all: Investigation[]): string {
  return `<ol>${all
    .map(
      (b) =>
        `<li><a class="toc-batch" href="#batch-${html(b.id)}" data-toc="batch-${html(b.id)}"><span class="toc-number">${b.number}</span>${html(b.title)}</a>${
          b.questions?.length
            ? `<ol>${b.questions
                .map(
                  (q) =>
                    `<li><a href="#question-${html(q.id)}" data-toc="question-${html(q.id)}">${html(q.title)}</a></li>`,
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
  const times = [
    b.createdAt,
    ...b.annotations.map((a) => a.dispatchedAt || a.createdAt),
    ...b.proposals.map((p) => p.createdAt),
  ].sort();
  const range =
    day(times[0]!) === day(times.at(-1)!)
      ? day(times[0]!)
      : `${day(times[0]!)} to ${day(times.at(-1)!)}`;
  const meta = [
    range,
    b.reviewFlow?.walkthroughs.length
      ? `<button type="button" class="text-action" data-open-walkthrough>Read the walkthrough</button>`
      : "",
    graphStatus(b),
    ["queued", "running"].includes(b.status)
      ? '<button type="button" class="text-action" data-command="pause">Pause</button>'
      : "",
    b.status === "paused" && b.resumeRequest?.status !== "pending"
      ? '<button type="button" class="text-action" data-command="resume">Resume</button>'
      : "",
  ].filter(Boolean);
  const answers = reportQuestions(b);
  const questions = (b.questions || [])
    .map((q) => question(state, b, q, expanded, answers))
    .join("");
  const other = b.proposals.filter((p) => !answers.get(p.id)?.length);
  return `<article class="batch-card" id="batch-${html(b.id)}" data-investigation-id="${html(b.id)}"><div class="batch-label">Batch ${b.number} · ${label}</div><h2>${html(b.title)}</h2><p class="batch-meta">${meta.join(" · ")}</p>${requests(state, b)}${questions}${
    other.length
      ? `<section class="batch-question"><h3>Other reports in this batch</h3>${other.map((p, n) => report(state, b, p, n === 0, expanded, [])).join("")}</section>`
      : ""
  }</article>`;
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

// Each pass addresses every annotation sent to its batch so far. A report
// answers the questions it addressed for the first time; a pass that adds
// none revises the questions of the report before it.
export function reportQuestions(b: Investigation): Map<string, string[]> {
  const answers = new Map<string, string[]>();
  const seen = new Set<string>();
  let previous: string[] = [];
  for (const p of [...b.proposals].sort((x, y) => x.createdAt.localeCompare(y.createdAt))) {
    const fresh = p.addressedAnnotationIds.filter((id) => !seen.has(id));
    p.addressedAnnotationIds.forEach((id) => seen.add(id));
    const ids = (b.questions || [])
      .filter((q) => q.annotationIds.some((id) => fresh.includes(id)))
      .map((q) => q.id);
    answers.set(p.id, ids.length ? ids : previous);
    if (ids.length) previous = ids;
  }
  return answers;
}

function question(
  state: ResearchState,
  b: Investigation,
  q: Question,
  expanded: ReadonlySet<string>,
  answers: Map<string, string[]>,
): string {
  const notes = b.annotations.filter((a) => q.annotationIds.includes(a.id));
  const reports = b.proposals
    .filter((p) => answers.get(p.id)?.includes(q.id))
    .reverse();
  const others = (p: Proposal) =>
    (b.questions || []).filter(
      (other) => other.id !== q.id && answers.get(p.id)?.includes(other.id),
    );
  const pending = ["queued", "running"].includes(b.status)
    ? "A researcher is working on this now."
    : "No report yet.";
  return `<section class="batch-question" id="question-${html(q.id)}"><h3>${html(q.title)}</h3>${asked(state, b, q, notes)}${
    reports.length
      ? reports.map((p, n) => report(state, b, p, n === 0, expanded, others(p))).join("")
      : `<p class="report-pending">${pending}</p>`
  }</section>`;
}

function asked(
  state: ResearchState,
  b: Investigation,
  q: Question,
  notes: Annotation[],
): string {
  if (q.origin === "coordinator") {
    const approval = state.conversation?.find((m) => m.id === q.approvalMessageId);
    return `<div class="asked asked-coordinator"><span class="eyebrow">The coordinator asked</span><p>After research returned:</p><blockquote>${html(q.explanation)}</blockquote>${approval?.decision?.decidedAt ? `<p class="asked-note">You approved this research on ${html(when(approval.decision.decidedAt))}.</p>` : ""}</div>`;
  }
  const written = b.reviewFlow?.walkthroughs[0]?.createdAt;
  return `<div class="asked"><span class="eyebrow">You asked</span>${notes
    .map((a) => {
      const ref = a.references?.[0] || a.target;
      const about =
        ref && ref.label && ref.label !== state.dataset.title
          ? `On "${html(ref.label)}" you wrote:`
          : "You wrote:";
      const late =
        written && a.dispatchedAt && a.dispatchedAt > written
          ? `<p class="asked-note">Sent ${html(when(a.dispatchedAt))}, after the walkthrough was written.</p>`
          : "";
      return `<p>${about}</p><blockquote ${target({ label: a.question })}>${html(a.question)}</blockquote>${late}`;
    })
    .join("")}</div>`;
}

function report(
  state: ResearchState,
  b: Investigation,
  p: Proposal,
  open: boolean,
  expanded: ReadonlySet<string>,
  alsoAnswers: Question[],
): string {
  const execution = (b.executions || [])
    .filter((e) => e.at <= p.createdAt)
    .at(-1);
  const by = execution?.worker.startsWith("Coordinator")
    ? "the coordinator"
    : execution?.worker || "a researcher";
  const findings = p.findings || [];
  const shown = expanded.has(p.id) ? findings : findings.slice(0, FINDINGS_SHOWN);
  const also = alsoAnswers.length
    ? ` Also answers ${alsoAnswers.map((q) => `<a href="#question-${html(q.id)}" data-toc="question-${html(q.id)}">${html(q.title)}</a>`).join(", ")}.`
    : "";
  return `<details class="report" data-proposal-id="${html(p.id)}" ${open ? "open" : ""}><summary>${html(p.title)}</summary><p class="report-by">Returned by ${html(by)}, ${html(when(p.createdAt))}.${also}</p><p class="report-summary">${html(p.summary)}</p>${
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
