import { assert } from "./findings.ts";
import type { GraphDataset } from "./types.ts";
import type { Investigation, ResearchCommand, ResearchState } from "./research.ts";
import type { SavedSession } from "./agent-control.ts";

// An assignment is one researcher's place in a batch, and everything its researcher has
// done, kept apart from its siblings so each can be paused, resumed and switched alone.
// In a batch with a goal it is a seat in the team: the researchers share the goal and
// organize themselves on the board. In a batch from before teams it is one researcher's
// bounded part, with the coordinator's title and brief, kept as history.

export interface Checkpoint {
  id: string;
  at: string;
  worker: string;
  summary: string;
  findings: string;
  nextSteps: string;
}

export interface Choice {
  engine: "claude" | "codex";
  model: string | null;
  effort: string | null;
}

export interface Assignment {
  id: string;
  // A seat's title is its researcher's name in the team, such as "Researcher 2".
  title: string;
  // The coordinator's brief, in prose, from before teams. A seat has none.
  brief: string;
  annotationIds?: string[];
  // The agent, model and effort the dispatch rules chose, or the human switched it to.
  choice?: Choice;
  // waiting: to start, or to start again; running: a researcher works on it;
  // finished: its researcher said it has nothing left to pursue, until a post wakes it;
  // paused: interrupted, to resume with its saved session; stopped: ended with its batch.
  // returned and done are from before teams: a result waiting for the coordinator, and
  // one it published.
  status: "waiting" | "running" | "finished" | "returned" | "done" | "paused" | "stopped";
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  worker?: string;
  lease?: { token: string; worker: string; at: string; dataset: GraphDataset };
  // The researcher's session with its CLI, kept so a paused, interrupted or finished
  // researcher picks up its conversation where it stopped.
  session?: SavedSession;
  checkpoints: Checkpoint[];
  // Sources it asked the human to open that the human could not get into.
  unreachable?: { instruction: string; url?: string; at: string }[];
  // From before teams: the coordinator's redirections while it ran, and its notes when
  // it sent it back.
  steering: { at: string; message: string }[];
  // How many of its batch's board posts have been put in its inbox, so each is put
  // there once, whenever the app gets to it.
  posted?: number;
}

// What a researcher, or the coordinator, posted for the researchers in a batch.
export interface BoardPost {
  id: string;
  at: string;
  // The researcher's seat; absent for the coordinator's post.
  assignmentId?: string;
  author?: "coordinator";
  text: string;
  // A researcher's post: its seat and content, so a repeat is refused.
  key?: string;
}

export const assignmentCommands = new Set([
  "assignment-session",
  "assignment-paused",
  "seat-finished",
  "stop-team",
  "post",
  "coordinator-post",
  "pause-assignment",
  "resume-assignment",
  "switch-assignment",
]);

const text = (value: unknown, label: string, max: number): string => {
  assert(
    typeof value === "string" && value.trim().length > 0 && value.length <= max,
    `${label} is required (maximum ${max.toLocaleString("en-US")} characters).`,
  );
  return (value as string).trim();
};

// How many researchers a new batch's team has, as the human set it.
export const DEFAULT_RESEARCHERS_PER_BATCH = 4;
export const researchersPerBatch = (state: Pick<ResearchState, "researchSettings">) =>
  state.researchSettings?.researchersPerBatch ?? DEFAULT_RESEARCHERS_PER_BATCH;

// A batch worked by a team: it has a goal, and its assignments are the team's seats.
export const isTeam = (b: Pick<Investigation, "goal">) => typeof b.goal === "string";
// Who a seat's researcher is, as the human and the coordinator read it.
export const researcherName = (b: Pick<Investigation, "goal">, a: Pick<Assignment, "title">) =>
  isTeam(b) ? a.title : `the researcher on "${a.title}"`;
const sentence = (words: string) => words.charAt(0).toUpperCase() + words.slice(1);

export const assignmentsOf = (b: Investigation): Assignment[] => (b.assignments ||= []);
export const findAssignment = (state: ResearchState, id: unknown) => {
  for (const batch of state.investigations) {
    const assignment = batch.assignments?.find((a) => a.id === id);
    if (assignment) return { batch, assignment };
  }
  return null;
};
// The assignment a worker's lease belongs to.
export const leased = (b: Investigation, token: unknown) =>
  typeof token === "string" ? b.assignments?.find((a) => a.lease?.token === token) : undefined;
// Researchers working on a batch now.
export const runningIn = (b: Investigation) => (b.assignments || []).filter((a) => a.status === "running");
// Seats waiting to start, in the order they were made.
export const waitingIn = (b: Investigation) =>
  (b.assignments || []).filter((a) => a.status === "waiting").sort((x, y) => x.createdAt.localeCompare(y.createdAt));

// A batch's status follows its assignments. A team's batch is running while any seat
// runs or waits, and ready for Review once every seat has finished or been stopped; a
// seat that wakes takes it out of Review until it finishes again. A batch from before
// teams follows its assignments while any is under way, and otherwise stays as the
// coordinator and the human left it.
export function settle(b: Investigation, now = new Date().toISOString()): void {
  if (b.closedAt) return;
  const all = b.assignments || [];
  if (isTeam(b)) {
    if (b.pausedAt) b.status = "paused";
    else if (all.some((a) => a.status === "running" || a.status === "waiting")) b.status = "running";
    else if (all.some((a) => a.status === "paused")) b.status = "paused";
    else b.status = "review";
    if (b.status !== "review") delete b.readyAt;
    else if (!b.readyAt) {
      b.readyAt = now;
      if (!b.stoppedAt) b.events.push({ at: now, message: "Every researcher has finished; the batch is ready for review.", kind: "ready" });
    }
    return;
  }
  if (all.some((a) => a.status === "running" || a.status === "returned")) b.status = "running";
  else if (all.some((a) => a.status === "waiting")) b.status = "queued";
  else if (all.some((a) => a.status === "paused")) b.status = "paused";
  else if (["running", "queued"].includes(b.status) && all.length) b.status = "review";
}

// The seats of a new batch's team, one per place, each named for its place.
export function newSeats(count: number, choice: Choice | undefined, now: string, id: () => string): Assignment[] {
  return Array.from({ length: count }, (_, n) => ({
    id: id(),
    title: `Researcher ${n + 1}`,
    brief: "",
    ...(choice ? { choice } : {}),
    status: "waiting" as const,
    createdAt: now,
    checkpoints: [],
    steering: [],
  }));
}

// A post reaches the whole team: every finished seat but the one that posted wakes to
// take it up. While the human has the batch paused, a woken seat waits with it.
function wake(batch: Investigation, except: string | undefined, now: string): string[] {
  const woken = (batch.assignments || []).filter((a) => a.status === "finished" && a.id !== except);
  for (const a of woken) {
    a.status = batch.pausedAt ? "paused" : "waiting";
    delete a.endedAt;
  }
  const ready = Boolean(batch.readyAt);
  settle(batch, now);
  if (ready && !batch.readyAt) batch.events.push({ at: now, message: "A post on the board woke the team; the batch is at work again." });
  return woken.map((a) => a.id);
}

export function assignmentTransition(
  next: ResearchState,
  command: ResearchCommand,
  now: string,
  id: () => string,
): unknown {
  if (command.type === "coordinator-post") {
    const batch = next.investigations.find((i) => i.id === command.investigationId);
    assert(batch, "Unknown batch.");
    assert(!batch.closedAt, "This batch is closed.");
    assert(!batch.stoppedAt, "This batch's team was stopped. Open a new batch for further research.");
    const post: BoardPost = { id: id(), at: now, author: "coordinator", text: text(command.text, "A board post", 5000) };
    (batch.board ||= []).push(post);
    return { postId: post.id, woken: wake(batch, undefined, now) };
  }
  // The coordinator ends a batch's research at the human's word: every seat stops,
  // finished ones too, so nothing wakes them again.
  if (command.type === "stop-team") {
    const batch = next.investigations.find((i) => i.id === command.investigationId);
    assert(batch && isTeam(batch), "Unknown batch, or one with no team.");
    assert(!batch.closedAt, "This batch is closed.");
    assert(!batch.stoppedAt, "This batch's team was already stopped.");
    for (const a of batch.assignments || []) {
      a.status = "stopped";
      a.endedAt ??= now;
      delete a.lease;
      delete a.session;
    }
    batch.stoppedAt = now;
    delete batch.pausedAt;
    const reason = typeof command.reason === "string" && command.reason.trim() ? `: ${command.reason.trim().slice(0, 2000)}` : ".";
    batch.events.push({ at: now, message: `The coordinator stopped this batch's team${reason}` });
    settle(batch, now);
    return { stopped: true };
  }
  const found = findAssignment(next, command.assignmentId);
  assert(found, "Unknown assignment.");
  const { batch, assignment } = found;
  const note = (message: string) => batch.events.push({ at: now, message });
  const who = researcherName(batch, assignment);
  switch (command.type) {
    case "assignment-session": {
      const session = command.session as Assignment["session"];
      if (assignment.lease?.token === command.token) assignment.session = session;
      return { saved: Boolean(assignment.session) };
    }
    // Its researcher said it has nothing left to pursue, with nothing of its own
    // outstanding. It keeps its conversation, for a post to wake it.
    case "seat-finished": {
      assert(assignment.status === "running" && assignment.lease?.token === command.token, "Worker lease is no longer current.");
      assignment.status = "finished";
      assignment.endedAt = now;
      delete assignment.lease;
      batch.events.push({ at: now, message: `${sentence(who)} finished.`, kind: "finished", researcher: assignment.title });
      settle(batch, now);
      return { finished: true, ready: Boolean(batch.readyAt) };
    }
    case "assignment-paused": {
      // A researcher interrupted by a crash or the app closing waits to be resumed,
      // keeping its session unless it is asked to start afresh.
      if (command.token !== undefined && assignment.lease?.token !== command.token) return { paused: false };
      if (!["running", "waiting"].includes(assignment.status)) return { paused: false };
      assignment.status = "paused";
      delete assignment.lease;
      if (command.fresh) delete assignment.session;
      settle(batch, now);
      if (command.reason) note(String(command.reason));
      return { paused: true };
    }
    // The human pauses a researcher; it keeps its conversation until the human resumes it.
    case "pause-assignment": {
      assert(assignment.status === "running", "Only a running researcher can be paused.");
      assignment.status = "paused";
      delete assignment.lease;
      settle(batch, now);
      note(`You paused ${who}. It keeps its conversation until you resume it.`);
      return { paused: true };
    }
    case "resume-assignment": {
      assert(assignment.status === "paused", "Only a paused researcher can be resumed.");
      assert(!batch.pausedAt, "The whole batch is paused. Resume the batch, and its researchers resume with it.");
      assignment.status = "waiting";
      settle(batch, now);
      note(`You resumed ${who}.`);
      return { resumed: true };
    }
    // The human moves a researcher to another agent or model. A running one stops and
    // starts again on it: with the same program it picks up its conversation; with
    // another, it starts afresh from its checkpoints.
    case "switch-assignment": {
      assert(["running", "waiting", "paused"].includes(assignment.status), "Only a researcher under way can be switched.");
      const choice = command.choice as Choice;
      assert(choice && ["claude", "codex"].includes(choice.engine), "Choose claude or codex.");
      // The program it runs on now: its conversation's, or the one chosen for it.
      const program = (assignment.session?.engine ?? assignment.choice?.engine) !== choice.engine;
      assignment.choice = { engine: choice.engine, model: choice.model ?? null, effort: choice.effort ?? null };
      if (program) delete assignment.session;
      if (assignment.status === "running") {
        assignment.status = "waiting";
        delete assignment.lease;
      }
      settle(batch, now);
      note(`You switched ${who} to ${typeof command.label === "string" ? command.label : choice.engine}${program ? "; it starts again from its checkpoints" : "; it keeps its conversation"}.`);
      return { switched: true };
    }
    // A researcher's post, from its session's code. The app checks the lease the code
    // ran under before it gets here; the key refuses the same post from the same seat
    // twice, so code run again never posts twice.
    case "post": {
      assert(!batch.closedAt, "This batch is closed, so nothing more is posted to it.");
      assert(assignment.status !== "stopped", "This batch's team was stopped, so nothing more is posted to it.");
      const key = typeof command.key === "string" ? command.key : undefined;
      assert(!key || !(batch.board || []).some((p) => p.key === key), "You already posted exactly this, so it was not posted again.");
      const post: BoardPost = { id: id(), at: now, assignmentId: assignment.id, text: text(command.text, "A board post", 5000), ...(key ? { key } : {}) };
      (batch.board ||= []).push(post);
      return { postId: post.id, woken: wake(batch, assignment.id, now) };
    }
  }
  throw new Error("Unknown assignment command.");
}
