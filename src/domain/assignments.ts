import { assert } from "./findings.ts";
import type { GraphDataset } from "./types.ts";
import type { Investigation, ResearchCommand, ResearchState } from "./research.ts";
import type { SavedSession } from "./agent-control.ts";

// An assignment is one researcher's bounded part of a batch, such as one question or
// one source: the coordinator's title and brief, and everything its researcher has
// done, kept apart from its siblings so each can be steered, stopped and resumed alone.

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
  title: string;
  // The coordinator's brief, in prose. A pass from before assignments has none; the
  // annotations it was started from are its direction.
  brief: string;
  annotationIds?: string[];
  // The agent, model and effort the coordinator or the dispatch rules chose.
  choice?: Choice;
  // waiting: for a free place in its batch; running: a researcher works on it;
  // returned: its result waits for the coordinator; done: its result is published;
  // paused: interrupted, to resume with its saved session; stopped: ended by the coordinator.
  status: "waiting" | "running" | "returned" | "done" | "paused" | "stopped";
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  worker?: string;
  lease?: { token: string; worker: string; at: string; dataset: GraphDataset };
  // The researcher's session with its CLI, kept until it hands in its result, so an
  // interrupted researcher picks up its conversation where it stopped.
  session?: SavedSession;
  checkpoints: Checkpoint[];
  // Sources it asked the human to open that the human could not get into.
  unreachable?: { instruction: string; url?: string; at: string }[];
  // The coordinator's redirections while it ran, and its notes when it sent it back.
  steering: { at: string; message: string }[];
}

// What a researcher, or the coordinator, posted for the researchers in a batch.
export interface BoardPost {
  id: string;
  at: string;
  // The researcher's assignment; absent for the coordinator's post.
  assignmentId?: string;
  author?: "coordinator";
  text: string;
}

export const assignmentCommands = new Set([
  "assign",
  "steered",
  "assignment-session",
  "assignment-returned",
  "assignment-paused",
  "stop-assignment",
  "revise-assignment",
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

// How many researchers may work one batch at once, as the human set it.
export const DEFAULT_RESEARCHERS_PER_BATCH = 4;
export const researchersPerBatch = (state: Pick<ResearchState, "researchSettings">) =>
  state.researchSettings?.researchersPerBatch ?? DEFAULT_RESEARCHERS_PER_BATCH;

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
// Researchers working on a batch now; a returned one has finished and frees its place.
export const runningIn = (b: Investigation) => (b.assignments || []).filter((a) => a.status === "running");
// Assignments waiting to start, in the order the coordinator made them.
export const waitingIn = (b: Investigation) =>
  (b.assignments || []).filter((a) => a.status === "waiting").sort((x, y) => x.createdAt.localeCompare(y.createdAt));

// A batch's status follows its assignments while any is under way; otherwise it stays
// as the coordinator and the human left it.
export function settle(b: Investigation): void {
  if (b.closedAt) return;
  const all = b.assignments || [];
  if (all.some((a) => a.status === "running" || a.status === "returned")) b.status = "running";
  else if (all.some((a) => a.status === "waiting")) b.status = "queued";
  else if (all.some((a) => a.status === "paused")) b.status = "paused";
  else if (["running", "queued"].includes(b.status) && all.length) b.status = "review";
}

export function newAssignment(
  input: Record<string, unknown>,
  choice: Choice | undefined,
  now: string,
  id: string,
): Assignment {
  return {
    id,
    title: text(input.title, "Assignment title", 300),
    brief: text(input.brief, "Assignment brief", 50_000),
    ...(choice ? { choice } : {}),
    status: "waiting",
    createdAt: now,
    checkpoints: [],
    steering: [],
  };
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
    const post: BoardPost = { id: id(), at: now, author: "coordinator", text: text(command.text, "A board post", 5000) };
    (batch.board ||= []).push(post);
    return { postId: post.id };
  }
  if (command.type === "assign") {
    const batch = next.investigations.find((i) => i.id === command.investigationId);
    assert(batch, "Unknown batch.");
    assert(!batch.closedAt, "This batch is closed. Open a new batch for further work.");
    const assignment = newAssignment(command, command.choice as Choice | undefined, now, id());
    assignmentsOf(batch).push(assignment);
    delete batch.readyAt;
    // A paused batch stays paused; its new assignment waits with it.
    if (batch.status === "paused") assignment.status = "paused";
    settle(batch);
    batch.events.push({ at: now, message: `Coordinator assigned "${assignment.title}".` });
    return { investigationId: batch.id, assignmentId: assignment.id };
  }
  const found = findAssignment(next, command.assignmentId);
  assert(found, "Unknown assignment.");
  const { batch, assignment } = found;
  const note = (message: string) => batch.events.push({ at: now, message });
  switch (command.type) {
    case "steered": {
      assert(assignment.status === "running", "Only a running researcher can be redirected.");
      const message = text(command.message, "A redirection", 20_000);
      assignment.steering.push({ at: now, message });
      note(`Coordinator redirected the researcher on "${assignment.title}": ${message}`);
      return { steered: true };
    }
    case "assignment-session": {
      const session = command.session as Assignment["session"];
      if (assignment.lease?.token === command.token) assignment.session = session;
      return { saved: Boolean(assignment.session) };
    }
    case "assignment-returned": {
      assert(assignment.status === "running" && assignment.lease?.token === command.token, "Worker lease is no longer current.");
      assignment.status = "returned";
      assignment.endedAt = now;
      // Its result is in; there is nothing left to pick up.
      delete assignment.session;
      settle(batch);
      note(`Research findings returned for "${assignment.title}"; coordinator synthesis is pending.`);
      return { returned: true };
    }
    case "assignment-paused": {
      // A researcher interrupted by a time limit, a crash or the app closing waits to be
      // resumed, keeping its session unless it is asked to start afresh.
      if (command.token !== undefined && assignment.lease?.token !== command.token) return { paused: false };
      if (!["running", "waiting"].includes(assignment.status)) return { paused: false };
      assignment.status = "paused";
      delete assignment.lease;
      if (command.fresh) delete assignment.session;
      settle(batch);
      if (command.reason) note(String(command.reason));
      return { paused: true };
    }
    case "stop-assignment": {
      assert(["running", "waiting", "paused"].includes(assignment.status), "This assignment is not under way.");
      const reason = text(command.reason, "Why the researcher is being stopped", 5000);
      assignment.status = "stopped";
      assignment.endedAt = now;
      delete assignment.lease;
      // Stopped on purpose, so a later pass starts afresh.
      delete assignment.session;
      settle(batch);
      note(`Coordinator stopped "${assignment.title}": ${reason}`);
      return { stopped: true };
    }
    case "revise-assignment": {
      assert(
        ["returned", "stopped", "done"].includes(assignment.status),
        "Only a returned, published or stopped assignment can be sent back for another pass.",
      );
      const notes = text(command.notes, "Why another pass is needed", 20_000);
      assignment.steering.push({ at: now, message: notes });
      assignment.status = batch.status === "paused" ? "paused" : "waiting";
      delete assignment.lease;
      delete assignment.session;
      delete assignment.endedAt;
      delete batch.readyAt;
      settle(batch);
      note(`Coordinator sent "${assignment.title}" back for another pass: ${notes}`);
      return { queued: true };
    }
    // The human pauses a researcher; it keeps its conversation, and its place in the
    // batch's limit goes to another until the human resumes it.
    case "pause-assignment": {
      assert(assignment.status === "running", "Only a running researcher can be paused.");
      assignment.status = "paused";
      delete assignment.lease;
      settle(batch);
      note(`You paused the researcher on "${assignment.title}". It keeps its conversation until you resume it; do not steer it meanwhile.`);
      return { paused: true };
    }
    case "resume-assignment": {
      assert(assignment.status === "paused", "Only a paused researcher can be resumed.");
      assignment.status = "waiting";
      settle(batch);
      note(`You resumed the researcher on "${assignment.title}".`);
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
      settle(batch);
      note(`You switched the researcher on "${assignment.title}" to ${typeof command.label === "string" ? command.label : choice.engine}${program ? "; it starts again from its checkpoints" : "; it keeps its conversation"}.`);
      return { switched: true };
    }
    case "post": {
      assert(assignment.lease?.token === command.token, "Worker lease is no longer current.");
      const post: BoardPost = { id: id(), at: now, assignmentId: assignment.id, text: text(command.text, "A board post", 5000) };
      (batch.board ||= []).push(post);
      return { postId: post.id };
    }
  }
  throw new Error("Unknown assignment command.");
}
