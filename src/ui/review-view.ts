import type { Investigation, ResearchState } from "../domain/research";
import { batchStatus } from "../domain/conversation";
import { graphBlocker, graphWorkFinished } from "../domain/review-flow";
import { batches } from "./findings-view";
import { html } from "./finding-review";

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

// Walkthroughs and graph updates for each batch; the coordinator groups the research.
export function reviewPage(state: ResearchState): string {
  const settings = state.reviewSettings || { autoWalkthrough: false, autoGraph: false };
  // A draft being revised is not waiting for the human.
  const pending = batches(state).find((b) => {
    const review = b.reviewFlow?.graphReviews.at(-1);
    return review?.status === "pending" && !review.revisingSince;
  });
  const pendingReview = pending?.reviewFlow!.graphReviews.at(-1);
  const rows = batches(state).map((b) => row(state, b)).join("");
  return `<section class="review-page"><header class="findings-head"><h1>Review</h1><p>Walkthroughs and graph updates for each batch. Your coordinator groups the research; you decide when to spend on explaining it.</p></header><div class="review-scroll"><div class="review-inner">
<div class="review-settings"><span class="review-settings-label">When a batch is ready</span><label class="switch"><input type="checkbox" data-auto="autoWalkthrough" ${settings.autoWalkthrough ? "checked" : ""}><span></span>Create its walkthrough automatically</label><label class="switch"><input type="checkbox" data-auto="autoGraph" ${settings.autoGraph ? "checked" : ""}><span></span>Prepare its graph update automatically</label></div>
${
  pending && pendingReview
    ? `<div class="review-banner" data-investigation-id="${html(pending.id)}"><div><strong>Batch ${pending.number}'s graph draft is waiting for you</strong><span>${html(pendingReview.summary ?? "")} The next graph update starts after you accept or set it aside.</span></div><button type="button" class="primary" data-review-open="graph">Review the draft</button></div>`
    : ""
}
<div class="review-rows">${rows || '<p class="review-empty">Batches appear here once your coordinator groups research into them.</p>'}</div></div></div></section>`;
}

function row(state: ResearchState, b: Investigation): string {
  const status = batchStatus(b);
  const pill =
    status === "closed"
      ? '<span class="review-pill is-closed">Closed</span>'
      : status === "ready"
        ? '<span class="review-pill is-ready">Ready for review</span>'
        : `<span class="review-pill is-progress">${b.status === "paused" ? "Paused" : "In progress"}</span>`;
  const findings = b.proposals.reduce((n, p) => n + (p.findings?.length || 0), 0);
  const meta = [
    day(b.createdAt),
    `${b.questions?.length || 0} question${b.questions?.length === 1 ? "" : "s"}`,
    findings ? `${findings} findings` : "",
  ].filter(Boolean);
  return `<article class="review-row${status === "closed" ? " is-closed" : ""}" data-investigation-id="${html(b.id)}"><div>${pill}<h2>Batch ${b.number} · ${html(b.title)}</h2><p class="review-meta">${meta.join(" · ")}</p></div><div><div class="review-cell-label">Walkthrough</div>${walkthroughCell(b, status)}</div><div><div class="review-cell-label">Graph</div>${graphCell(state, b, status)}</div></article>`;
}

function walkthroughCell(b: Investigation, status: string): string {
  const walkthroughs = b.reviewFlow?.walkthroughs || [];
  const latest = walkthroughs.at(-1);
  const edits = b.reviewFlow?.edits?.basedOnWalkthroughId === latest?.id ? b.reviewFlow?.edits?.edits.length || 0 : 0;
  if (latest && edits)
    return `<p class="review-cell">Revision ${latest.revision} · ${day(latest.createdAt)}<br><strong>The coordinator suggested ${edits} ${edits === 1 ? "edit" : "edits"}.</strong></p><div class="review-actions"><button type="button" class="primary" data-review-open="reading">Review edits</button></div>`;
  if (latest)
    return `<p class="review-cell">Revision ${latest.revision} · ${day(latest.createdAt)}<br><span>${html(latest.title)}</span></p><div class="review-actions"><button type="button" data-review-open="reading">Open walkthrough</button>${b.walkthroughRequestedAt ? '<span class="review-why">A revision is being written.</span>' : ""}</div>`;
  if (b.walkthroughRequestedAt)
    return `<p class="review-cell">Requested ${day(b.walkthroughRequestedAt)}. ${html(writerStatus(b))}</p>`;
  if (status === "in progress")
    return '<p class="review-cell is-muted">Available when the coordinator marks this batch ready.</p>';
  return '<div class="review-actions"><button type="button" data-review-request="walkthrough">Create walkthrough</button></div>';
}

function graphCell(state: ResearchState, b: Investigation, status: string): string {
  const flow = b.reviewFlow;
  const review = flow?.graphReviews.at(-1);
  const job = flow?.jobs.filter((j) => j.status !== "superseded").at(-1);
  if (review?.status === "pending" && review.revisingSince)
    return `<p class="review-cell"><strong>Revising the draft</strong><br><span>${html(progressLine(job?.note || job?.progress || ""))}</span></p><div class="review-actions"><button type="button" data-review-open="graph">Open the current draft</button></div>`;
  if (review?.status === "pending")
    return `<p class="review-cell"><strong>Draft ready</strong><br><span>${html(review.summary ?? "")}</span></p><div class="review-actions"><button type="button" class="primary" data-review-open="graph">Review the draft</button></div>`;
  if (job && ["queued", "running", "returned", "paused"].includes(job.status)) {
    // Paused preparation for a finished batch can never resume; say so instead of offering it.
    const stranded = job.status === "paused" && graphWorkFinished(b);
    const note = job.status === "running" && job.note ? `<span class="review-why">${html(progressLine(job.note))}</span>` : "";
    return `<p class="review-cell">${html(progressLine(job.progress))}${stranded ? " This batch's graph update is finished, so it cannot resume." : ""}</p>${note}${job.status === "paused" && !stranded ? '<div class="review-actions"><button type="button" data-review-open="graph">Open</button></div>' : ""}`;
  }
  if (status === "closed" && review)
    return `<p class="review-cell">${review.status === "applied" ? "Accepted" : "Set aside"} ${day(review.decidedAt ?? b.closedAt!)}${review.summary ? `<br><span>${html(review.summary)}</span>` : ""}</p><div class="review-actions"><button type="button" data-review-open="graph">Open the draft</button></div>`;
  const blocker = graphBlocker(state);
  if (review?.status === "undone")
    return `<p class="review-cell">Accepted draft undone ${day(review.undoneAt!)}</p><div class="review-actions"><button type="button" data-review-open="graph">Open the draft</button><button type="button" data-review-request="graph" ${blocker ? "disabled" : ""}>Request a revised draft</button></div>${blocker ? `<span class="review-why">${html(blocker)}</span>` : ""}`;
  if (status === "in progress") return '<p class="review-cell is-muted">Not started.</p>';
  return `<p class="review-cell is-muted">No update yet.</p><div class="review-actions"><button type="button" data-review-request="graph" ${blocker ? "disabled" : ""}>Update graph</button></div>${blocker ? `<span class="review-why">${html(blocker)}</span>` : ""}`;
}

// Builder progress can arrive as a long list of validation errors.
export function progressLine(progress: string): string {
  const lines = progress.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return progress;
  return `${lines[0]} (and ${lines.length - 1} more problems)`;
}

// Where a requested walkthrough stands, in the words the Review page uses.
export function writerStatus(b: Investigation): string {
  const writer = b.reviewFlow?.writer;
  if (writer?.status === "running" || writer?.status === "queued") return "A walkthrough writer is working on it.";
  if (writer?.status === "returned") return "The draft is written; your coordinator is checking it.";
  if (writer?.status === "paused") return `The writer stopped: ${writer.progress}`;
  return "Waiting for your coordinator to assign a writer.";
}
