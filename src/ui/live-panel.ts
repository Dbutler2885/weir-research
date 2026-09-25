import type { Investigation, LiveWorker, ResearchState } from "../domain/research";
import { html } from "./finding-review";
import { writerStatus } from "./review-view";

// One worker, or one piece of work waiting for one, as the Now list shows it.
export interface LiveRow {
  who: string;
  batch?: { id: string; number: number };
  stage: string;
  latest?: string;
  since?: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function elapsed(since: string, now: number): string {
  const minutes = Math.floor((now - Date.parse(since)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
}

// Notes sent since the coordinator last said anything, and not yet put in a batch.
export function unansweredNotes(state: ResearchState): number {
  const conversation = state.conversation || [];
  const last = conversation.map((m) => m.author).lastIndexOf("coordinator");
  const placed = new Set(state.investigations.flatMap((i) => i.annotations.map((a) => a.id)));
  return conversation
    .slice(last + 1)
    .flatMap((m) => (m.author === "human" ? m.annotations || [] : []))
    .filter((a) => !placed.has(a.id)).length;
}

const coordinatorWorking = (state: ResearchState) =>
  Boolean(state.coordinator?.connected && !state.coordinator.listening);

export function liveRows(state: ResearchState): LiveRow[] {
  const rows: LiveRow[] = [];
  const live = state.live || [];
  const waiting = unansweredNotes(state);
  const c = state.coordinator;
  if (c?.connected)
    rows.push({
      who: "Coordinator",
      stage: c.listening
        ? waiting ? `Listening; reading your ${waiting === 1 ? "note" : "notes"} next` : "Listening"
        : "Working",
      latest: c.latest ? `${c.listening ? "Last: " : ""}${c.latest.text}` : undefined,
      since: c.listening ? undefined : c.latest?.at,
    });
  else if (c?.problem)
    rows.push({ who: "Coordinator", stage: c.problem });
  else if (waiting)
    rows.push({
      who: "Coordinator",
      stage: `Not connected. ${plural(waiting, "note is", "notes are")} waiting for it.`,
    });
  for (const helper of live.filter((w) => w.role === "helper"))
    rows.push({ who: helper.name, stage: `Helping the coordinator: ${helper.task}`, latest: helper.latest?.text, since: helper.startedAt });
  for (const i of state.investigations.filter((i) => i.number && !i.closedAt)) {
    const batch = { id: i.id, number: i.number! };
    if (i.status === "running") rows.push(researcherRow(i, live, batch));
    else if (i.status === "queued") rows.push({ who: "Researcher", batch, stage: "Waiting to start" });
    else if (i.status === "paused")
      rows.push({ who: "Researcher", batch, stage: `Paused. ${i.events.at(-1)?.message || ""}`.trim() });
    if (i.walkthroughRequestedAt) {
      const writer = live.find((w) => w.role === "writer" && w.investigationId === i.id);
      rows.push({
        who: writer?.name || "Walkthrough",
        batch,
        stage: writerStatus(i),
        latest: writer?.latest?.text,
        since: writer?.startedAt || i.walkthroughRequestedAt,
      });
    }
    for (const job of i.reviewFlow?.jobs || []) {
      if (!["queued", "running", "returned", "paused"].includes(job.status)) continue;
      const worker = live.find((w) => w.jobId === job.id);
      rows.push({
        who: job.status === "returned" ? "Graph draft" : worker?.name || "Graph builder",
        batch,
        stage: job.progress || "Waiting to start",
        latest: worker?.latest?.text,
        since: worker?.startedAt,
      });
    }
  }
  return rows;
}

function researcherRow(i: Investigation, live: LiveWorker[], batch: LiveRow["batch"]): LiveRow {
  const worker = live.find((w) => w.role === "researcher" && w.investigationId === i.id);
  const lease = i.lease?.worker || "";
  return {
    who: worker?.name || (lease.startsWith("Coordinator") ? "Researcher run by the coordinator" : "Researcher"),
    batch,
    stage: `Researching ${i.title}`,
    latest: worker?.latest?.text,
    since: worker?.startedAt || i.lease?.at,
  };
}

// The line in the header: who is working, said briefly. Empty when nothing is.
export function runningSummary(state: ResearchState): string {
  const open = state.investigations.filter((i) => !i.closedAt);
  // Only a batch a researcher has claimed is being worked on; a queued one is waiting.
  const running = open.filter((i) => i.status === "running").length;
  const queued = open.filter((i) => i.status === "queued").length;
  const builders = open.flatMap((i) => i.reviewFlow?.jobs || [])
    .filter((j) => ["queued", "running", "returned"].includes(j.status)).length;
  const writing = open.filter((i) => i.walkthroughRequestedAt).length;
  const helping = (state.live || []).filter((w) => w.role === "helper").length;
  const waiting = unansweredNotes(state);
  const c = state.coordinator;
  return [
    coordinatorWorking(state) ? "Coordinator working" : "",
    // Why the coordinator is not running shows in the panel this opens.
    !c?.connected && c?.problem ? "Coordinator not running" : "",
    waiting && !coordinatorWorking(state) ? `${plural(waiting, "note", "notes")} waiting for the coordinator` : "",
    running ? `${plural(running, "researcher", "researchers")} working` : "",
    queued ? `${plural(queued, "batch", "batches")} waiting for a researcher` : "",
    builders ? `${plural(builders, "graph update", "graph updates")} building` : "",
    writing ? `${plural(writing, "walkthrough", "walkthroughs")} being written` : "",
    helping ? `${plural(helping, "helper", "helpers")} working` : "",
  ].filter(Boolean).join(" · ");
}

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

export function livePanel(state: ResearchState, now = Date.now()): string {
  const rows = liveRows(state);
  const recent = state.investigations
    .filter((i) => i.number)
    .flatMap((i) => i.events.map((e) => ({ ...e, batch: i.number!, id: i.id })))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 6);
  const now_ = rows.length
    ? `<ul class="live-now">${rows
        .map(
          (r) =>
            `<li${r.batch ? ` data-live-open="${html(r.batch.id)}"` : ""}><div class="live-who"><strong>${html(r.who)}</strong>${r.batch ? `<span>Batch ${r.batch.number}</span>` : ""}${r.since ? `<time datetime="${html(r.since)}">${html(elapsed(r.since, now))}</time>` : ""}</div><p class="live-stage">${html(r.stage)}</p>${r.latest ? `<p class="live-latest">${html(r.latest)}</p>` : ""}</li>`,
        )
        .join("")}</ul>`
    : '<p class="live-empty">Nothing is running.</p>';
  const history = recent.length
    ? `<ol class="live-recent">${recent
        .map(
          (e) =>
            `<li data-live-open="${html(e.id)}"><time datetime="${html(e.at)}">${html(clock(e.at))}</time><span><b>Batch ${e.batch}</b> ${html(e.message)}</span></li>`,
        )
        .join("")}</ol>`
    : "";
  return `<h2>Now</h2>${now_}${history ? `<h2>Recent</h2>${history}` : ""}<button type="button" class="text-action" data-live-all>All activity</button>`;
}
