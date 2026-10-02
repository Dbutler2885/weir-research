import type { Investigation, LiveWorker, ResearchState } from "../domain/research";
import type { Assignment } from "../domain/assignments";
import { html } from "./finding-review";
import { resetTime } from "../domain/reset-time";
import { writerStatus } from "./review-view";
import { controlledAgents, sameAgentRef, type AgentRef, type ControlledAgent } from "../domain/agent-control";
import { agentButtons } from "./agent-controls";

// One worker, or one piece of work waiting for one, as the Now list shows it.
export interface LiveRow {
  // Working now, stopped and needing the human, or waiting its turn.
  group: "working" | "attention" | "waiting";
  who: string;
  batch?: { id: string; number: number };
  // A researcher's assignment title, which tells researchers in one batch apart.
  task?: string;
  stage: string;
  latest?: string;
  // The steps before the latest, most recent first.
  trail?: string[];
  since?: string;
  // The agent the row is about, for its Pause, Resume and Switch model.
  agent?: ControlledAgent;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function elapsed(since: string, now: number): string {
  const minutes = Math.floor((now - Date.parse(since)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
}

// How long something has been going, to the second while it is under a minute.
export function running(since: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(since)) / 1000));
  return seconds < 60 ? `${seconds} s` : elapsed(since, now);
}

// Messages the human sent since the coordinator last said anything.
export function unansweredMessages(state: ResearchState): number {
  const conversation = state.conversation || [];
  const last = conversation.map((m) => m.author).lastIndexOf("coordinator");
  return conversation.slice(last + 1).filter((m) => m.author === "human").length;
}

const coordinatorWorking = (state: ResearchState) =>
  Boolean(state.coordinator?.connected && !state.coordinator.listening && !state.coordinator.paused);
// A time of day, as "1:00 PM".
export const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

const thousands = (n: number) => `${Math.round(n / 1000).toLocaleString("en-US")}k`;
// How full the coordinator's context is, as a share of where it compacts.
export function contextShare(state: ResearchState): number {
  const c = state.coordinator?.context;
  return c && c.threshold ? c.tokens / c.threshold : 0;
}
// The point it has reached: half, three quarters, or nine tenths of the way.
export function contextLevel(state: ResearchState): number {
  const share = contextShare(state);
  return share >= 0.9 ? 3 : share >= 0.75 ? 2 : share >= 0.5 ? 1 : 0;
}
// What the human is told as the coordinator's context grows, and what they can do.
export function contextNotice(state: ResearchState): { title: string; detail: string; canStartFresh: boolean } | null {
  const c = state.coordinator?.context;
  if (!c || !contextLevel(state)) return null;
  return {
    title: `The coordinator's context is ${Math.round(contextShare(state) * 100)}% full`,
    detail: `It compacts on its own at ${thousands(c.threshold)} tokens. You can compact it now, or start a fresh coordinator from the project's saved state${state.coordinator?.listening ? "" : " once it is listening"}.`,
    canStartFresh: Boolean(state.coordinator?.listening),
  };
}

export function liveRows(state: ResearchState): LiveRow[] {
  const agents = controlledAgents(state);
  const agent = (ref: AgentRef) => agents.find((a) => sameAgentRef(a.ref, ref));
  const rows: LiveRow[] = [];
  const live = state.live || [];
  const waiting = unansweredMessages(state);
  const c = state.coordinator;
  if (c?.connected && c.paused)
    rows.push({ group: "waiting", who: "Coordinator", stage: `Paused until ${resetTime(Date.parse(c.paused.until))}: the usage limit is reached. Your messages still try to reach it, in case the limit lifts sooner.` });
  else if (c?.connected) {
    // Only what it has done in this turn; an idle coordinator shows none.
    const steps = c.listening ? [] : [c.latest, ...(c.trail || [])].filter((s) => s && (!c.since || s.at >= c.since));
    rows.push({
      group: "working",
      who: "Coordinator",
      stage: `${c.listening
        ? waiting ? `Listening; reading your ${waiting === 1 ? "note" : "notes"} next` : "Listening"
        : "Working"}${c.context?.compacting ? " · compacting its context" : contextLevel(state) ? ` · context ${Math.round(contextShare(state) * 100)}% full` : ""}`,
      latest: steps[0]?.text,
      trail: steps.slice(1).map((s) => s!.text),
      since: c.listening ? undefined : c.since || c.latest?.at,
      agent: agent({ kind: "coordinator" }),
    });
  } else if (c?.waiting)
    rows.push({ group: "waiting", who: "Coordinator", stage: "Starts when you write to it or annotate." });
  else if (c?.problem)
    rows.push({ group: "attention", who: "Coordinator", stage: c.problem });
  else if (waiting)
    rows.push({
      group: "attention",
      who: "Coordinator",
      stage: `Not connected. ${plural(waiting, "message is", "messages are")} waiting for it.`,
    });
  for (const helper of live.filter((w) => w.role === "helper"))
    rows.push({ group: "working", who: helper.name, stage: `Helping the coordinator: ${helper.task}`, ...steps(helper), since: helper.startedAt });
  for (const i of state.investigations.filter((i) => i.number && !i.closedAt)) {
    const batch = { id: i.id, number: i.number! };
    for (const a of i.assignments || []) {
      if (a.status === "running") rows.push({ ...researcherRow(a, live, batch), agent: agent({ kind: "researcher", assignmentId: a.id }) });
      else if (a.status === "waiting")
        rows.push({ group: "waiting", who: "Researcher", batch, stage: i.held ? `Held in the queue: ${a.title}` : `Waiting for a free place: ${a.title}` });
      else if (a.status === "paused")
        rows.push({ group: "attention", who: "Researcher", batch, stage: `Paused: ${a.title}`, agent: agent({ kind: "researcher", assignmentId: a.id }) });
    }
    if (i.status === "queued" && !(i.assignments || []).some((a) => a.status === "waiting"))
      rows.push({ group: "waiting", who: "Researcher", batch, stage: "Waiting for the coordinator to assign researchers." });
    if (i.status === "paused" && !(i.assignments || []).some((a) => a.status === "paused"))
      rows.push({ group: "attention", who: "Researcher", batch, stage: `Research paused. ${firstSentence(i.events.at(-1)?.message || "")}`.trim() });
    if (i.walkthroughRequestedAt) {
      const writer = live.find((w) => w.role === "writer" && w.investigationId === i.id);
      rows.push({
        group: writer ? "working" : i.reviewFlow?.writer?.status === "paused" ? "attention" : "waiting",
        who: writer?.name || "Walkthrough",
        batch,
        stage: i.reviewFlow?.writer?.status === "paused" ? "The walkthrough writer stopped." : writerStatus(i),
        ...(writer ? steps(writer) : {}),
        since: writer?.startedAt || i.walkthroughRequestedAt,
        agent: agent({ kind: "writer", investigationId: i.id }),
      });
    }
    for (const job of i.reviewFlow?.jobs || []) {
      if (!["queued", "running", "returned", "paused"].includes(job.status)) continue;
      const worker = live.find((w) => w.jobId === job.id);
      const asks = job.resumeRequest?.status === "pending";
      rows.push({
        group: worker ? "working" : job.status === "paused" ? "attention" : "waiting",
        who: job.status === "returned" ? "Graph draft" : worker?.name || "Graph builder",
        batch,
        // A paused job's progress can be a whole list of problems; the batch shows them.
        stage: job.status === "paused" ? `The graph builder is paused${asks ? "; the coordinator asks to resume it" : ""}.` : job.progress || "Waiting to start",
        ...(worker ? steps(worker) : {}),
        since: worker?.startedAt,
        agent: agent({ kind: "builder", jobId: job.id }),
      });
    }
  }
  const order = { working: 0, attention: 1, waiting: 2 };
  return rows.sort((a, b) => order[a.group] - order[b.group]);
}

const firstSentence = (text: string) => {
  const line = text.split("\n")[0]!;
  const end = line.search(/[.!?](\s|$)/);
  const sentence = end < 0 ? line : line.slice(0, end + 1);
  return sentence.length > 140 ? `${sentence.slice(0, 137)}...` : sentence;
};

// A live worker's current step and the ones before it.
const steps = (worker: LiveWorker) => ({ latest: worker.latest?.text, trail: (worker.trail || []).map((s) => s.text) });

function researcherRow(a: Assignment, live: LiveWorker[], batch: LiveRow["batch"]): LiveRow {
  const worker = live.find((w) => w.role === "researcher" && w.assignmentId === a.id);
  return {
    group: "working",
    who: worker?.name || "Researcher",
    batch,
    task: a.title,
    stage: `Researching ${a.title}`,
    ...(worker ? steps(worker) : {}),
    since: worker?.startedAt || a.startedAt,
  };
}

const roles: [RegExp, string][] = [[/walkthrough/i, "walkthrough writer"], [/graph/i, "graph builder"], [/helper/i, "helper"], [/researcher/i, "researcher"]];
// Who is working and the step they are on, for the header to take turns showing.
export function tickerEntries(state: ResearchState): { who: string; what: string }[] {
  return liveRows(state)
    .filter((r) => r.group === "working" && !(r.who === "Coordinator" && state.coordinator?.listening))
    .map((r) => {
      const role = roles.find(([pattern]) => pattern.test(r.who))?.[1];
      return { who: r.batch && role ? `Batch ${r.batch.number} ${role}` : r.who, what: r.latest || (r.who === "Coordinator" ? "Reading the latest changes" : r.stage) };
    });
}

// The line in the header: who is working, said briefly. Empty when nothing is.
export function runningSummary(state: ResearchState): string {
  const open = state.investigations.filter((i) => !i.closedAt);
  // Only a batch a researcher has claimed is being worked on; a queued one is waiting.
  const running = open.filter((i) => i.status === "running").length;
  // A held batch is not waiting for anyone; the queue shows it.
  const queued = open.filter((i) => i.status === "queued" && !i.held).length;
  const builders = open.flatMap((i) => i.reviewFlow?.jobs || [])
    .filter((j) => ["queued", "running", "returned"].includes(j.status)).length;
  const writing = open.filter((i) => i.walkthroughRequestedAt).length;
  const helping = (state.live || []).filter((w) => w.role === "helper").length;
  const waiting = unansweredMessages(state);
  const c = state.coordinator;
  return [
    coordinatorWorking(state) ? "Coordinator working" : "",
    c?.connected && c.paused ? `Coordinator paused until ${resetTime(Date.parse(c.paused.until))}` : "",
    // Why the coordinator is not running shows in the panel this opens.
    !c?.connected && c?.waiting ? "Coordinator starts when you write" : "",
    !c?.connected && !c?.waiting && c?.problem ? "Coordinator not running" : "",
    waiting && !coordinatorWorking(state) ? `${plural(waiting, "message", "messages")} waiting for the coordinator` : "",
    running ? `${plural(running, "researcher", "researchers")} working` : "",
    queued ? `${plural(queued, "batch", "batches")} waiting for a researcher` : "",
    builders ? `${plural(builders, "graph update", "graph updates")} building` : "",
    writing ? `${plural(writing, "walkthrough", "walkthroughs")} being written` : "",
    helping ? `${plural(helping, "helper", "helpers")} working` : "",
  ].filter(Boolean).join(" · ");
}

const labels: Record<string, string> = { claude: "Claude Code", codex: "Codex" };
// How much of each agent's usage limit is used, where the agent reports it.
export function usageLines(state: ResearchState, now = Date.now()): string[] {
  return Object.entries(state.usage || {}).map(([agent, u]) => {
    const name = labels[agent] || agent;
    if (u!.exhausted) return `${name}: the usage limit is reached${u!.resetsAt ? `; it resets at ${resetTime(u!.resetsAt, now)}` : ""}.`;
    const windows = u!.windows.map((w) => `${Math.round(w.used * 100)}% of the ${w.name} limit${w.resetsAt ? ` (resets ${resetTime(w.resetsAt, now)})` : ""}`);
    return `${name}: ${windows.join(", ") || "usage not reported"} used.`;
  });
}

const GROUPS: [LiveRow["group"], string][] = [["working", "Working now"], ["attention", "Needs you"], ["waiting", "Waiting"]];

// Who is working and on which step, what stopped and needs the human, and what waits.
export function livePanel(state: ResearchState, now = Date.now()): string {
  const rows = liveRows(state);
  const working = (r: LiveRow) =>
    `<li class="live-agent"${r.batch ? ` data-live-open="${html(r.batch.id)}"` : ""}><div class="live-who"><strong>${html(r.who)}</strong>${r.batch ? `<span class="live-task"${r.task ? ` title="${html(r.task)}"` : ""}>Batch ${r.batch.number}${r.task ? ` · ${html(r.task)}` : ""}</span>` : ""}${r.since ? `<time datetime="${html(r.since)}" data-elapsed>${html(running(r.since, now))}</time>` : ""}</div><p class="live-now${r.latest ? "" : " is-quiet"}${r.who === "Coordinator" && state.coordinator?.listening ? " is-listening" : ""}">${html(r.latest || r.stage)}</p>${r.trail?.length ? `<ul class="live-trail">${r.trail.map((t) => `<li>${html(t)}</li>`).join("")}</ul>` : ""}${switching(r)}${agentButtons(r.agent)}</li>`;
  const line = (r: LiveRow) =>
    `<li><span>${html(r.batch ? `Batch ${r.batch.number}: ${r.stage}` : r.stage)}</span>${r.batch ? `<button type="button" class="text-action" data-live-open="${html(r.batch.id)}">Open batch ${r.batch.number}</button>` : ""}${agentButtons(r.agent)}</li>`;
  // A coordinator asked to switch while it works switches once its turn is over.
  const switching = (r: LiveRow) =>
    r.agent?.ref.kind === "coordinator" && state.coordinator?.switching ? '<p class="live-switching">Switches to the new model once this turn is over.</p>' : "";
  const groups = GROUPS.map(([group, title]) => {
    const members = rows.filter((r) => r.group === group);
    if (!members.length) return "";
    return `<h2>${title}</h2><ul class="live-${group}">${members.map(group === "working" ? working : line).join("")}</ul>`;
  }).join("");
  return `${groups || '<p class="live-empty">Nothing is running.</p>'}<div class="live-foot"><button type="button" class="text-action" data-live-all>All activity</button></div>`;
}
