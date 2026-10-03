import { beforeEach, describe, expect, it } from "vitest";
import { initialState, transition, type ResearchCommand, type ResearchState } from "../src/domain/research";
import { emptyGraph } from "../src/domain/graph-schema";

// A batch worked by a team of researchers, as domain transitions.
let state: ResearchState;
function run(command: ResearchCommand): any {
  const result = transition(state, command);
  state = result.state;
  return result.result;
}
const batch = () => state.investigations[0]!;
const statuses = () => batch().assignments!.map((a) => a.status);
const claim = (assignmentId: string) =>
  run({ type: "claim", investigationId: batch().id, assignmentId, worker: "Fixture researcher" }).assignment.lease.token as string;
const finish = (assignmentId: string, token = claim(assignmentId)) => run({ type: "seat-finished", assignmentId, token });

let ids: string[];
beforeEach(() => {
  state = initialState({ ...emptyGraph(), title: "The fictional Harbour Mill" });
  state.researchSettings = { timeLimitMinutes: null, researchersPerBatch: 3 };
  run({ type: "open-batch", title: "Who ran the mill", goal: "Find who ran the fictional Harbour Mill after 1880." });
  ids = batch().assignments!.map((a) => a.id);
});

describe("opening a batch", () => {
  it("creates one seat per place in the team, named for its place, and the batch is running", () => {
    expect(batch()).toMatchObject({ number: 1, title: "Who ran the mill", goal: "Find who ran the fictional Harbour Mill after 1880.", status: "running" });
    expect(batch().brief).toBeUndefined();
    expect(batch().assignments!.map((a) => a.title)).toEqual(["Researcher 1", "Researcher 2", "Researcher 3"]);
    expect(statuses()).toEqual(["waiting", "waiting", "waiting"]);
    // Four by default, and as many as the human sets.
    state.researchSettings = { timeLimitMinutes: null };
    run({ type: "open-batch", title: "Another", goal: "Another fictional goal." });
    expect(state.investigations[1]!.assignments).toHaveLength(4);
  });

  it("takes a goal, not a brief or a division of the work", () => {
    expect(() => run({ type: "open-batch", title: "No goal" })).toThrow("The batch's goal is required");
    expect(() => run({ type: "open-batch", title: "Old", goal: "G", assignments: [{ title: "Leases", brief: "Read them." }] })).toThrow("A batch opens with a title and a goal");
    expect(() => run({ type: "open-batch", title: "Old", goal: "G", brief: { purpose: "P", scope: "S", direction: "D" } })).toThrow("A batch opens with a title and a goal");
    expect(() => run({ type: "retitle", investigationId: batch().id, assignments: [{ assignmentId: ids[0], title: "Leases" }] })).toThrow("keep their names");
  });
});

describe("a team's seats", () => {
  it("each holds its own lease and checkpoints, and the batch runs while any runs or waits", () => {
    const first = claim(ids[0]!);
    claim(ids[1]!);
    expect(statuses()).toEqual(["running", "running", "waiting"]);
    expect(batch().status).toBe("running");
    expect(() => claim(ids[0]!)).toThrow("not waiting");
    run({ type: "checkpoint", investigationId: batch().id, token: first, summary: "Vol. 4 read", findings: "Lease to Holloway", nextSteps: "Vol. 5" });
    expect(batch().assignments![0]!.checkpoints.map((c) => c.summary)).toEqual(["Vol. 4 read"]);
    expect(batch().assignments![1]!.checkpoints).toEqual([]);
  });

  it("finish one at a time, keeping their conversations, and the batch reaches Review only when every seat has finished", () => {
    const token = claim(ids[0]!);
    const session = { engine: "claude", id: "s-1", directory: "/fictional", at: "t" };
    run({ type: "assignment-session", assignmentId: ids[0], token, session });
    expect(() => run({ type: "seat-finished", assignmentId: ids[0], token: "old" })).toThrow("lease");
    expect(finish(ids[0]!, token)).toEqual({ finished: true, ready: false });
    expect(batch().assignments![0]).toMatchObject({ status: "finished", session, endedAt: expect.any(String) });
    expect(batch().assignments![0]!.lease).toBeUndefined();
    expect(batch().events.at(-1)!.message).toBe("Researcher 1 finished.");
    finish(ids[1]!);
    expect(batch().status).toBe("running");
    expect(batch().readyAt).toBeUndefined();
    expect(finish(ids[2]!)).toEqual({ finished: true, ready: true });
    expect(statuses()).toEqual(["finished", "finished", "finished"]);
    expect(batch().status).toBe("review");
    expect(batch().readyAt).toEqual(expect.any(String));
    expect(batch().events.at(-1)!.message).toBe("Every researcher has finished; the batch is ready for review.");
  });

  it("are not finished by a paused seat: the batch waits for the human", () => {
    finish(ids[0]!);
    finish(ids[1]!);
    claim(ids[2]!);
    run({ type: "pause-assignment", assignmentId: ids[2] });
    expect(batch().status).toBe("paused");
    expect(batch().readyAt).toBeUndefined();
  });
});

describe("the board", () => {
  it("records a researcher's post, and refuses the same post from the same seat twice", () => {
    claim(ids[0]!);
    expect(run({ type: "post", assignmentId: ids[0], text: "Vol. 5 is missing from the scans.", key: "k1" })).toMatchObject({ postId: expect.any(String), woken: [] });
    expect(batch().board).toEqual([{ id: expect.any(String), at: expect.any(String), assignmentId: ids[0], text: "Vol. 5 is missing from the scans.", key: "k1" }]);
    expect(() => run({ type: "post", assignmentId: ids[0], text: "Vol. 5 is missing from the scans.", key: "k1" })).toThrow("already posted exactly this");
    expect(batch().board).toHaveLength(1);
    expect(() => run({ type: "post", assignmentId: ids[0], text: " ", key: "k2" })).toThrow("A board post is required");
  });

  it("wakes every finished seat but the one that posted, and never a paused, waiting or stopped one", () => {
    finish(ids[0]!);
    claim(ids[1]!);
    run({ type: "pause-assignment", assignmentId: ids[1] });
    // Seat 1 finished, seat 2 paused, seat 3 waiting: a post from seat 3 wakes only seat 1.
    const { woken } = run({ type: "post", assignmentId: ids[2], text: "A sale notice names the buyer.", key: "k" });
    expect(woken).toEqual([ids[0]]);
    expect(statuses()).toEqual(["waiting", "paused", "waiting"]);
    expect(batch().assignments![0]!.endedAt).toBeUndefined();
  });

  it("takes the batch out of Review when a post wakes a seat, until the team finishes again", () => {
    for (const id of ids) finish(id);
    expect(batch().status).toBe("review");
    // The coordinator's post wakes the whole team, which is how "keep going" reaches it.
    const { woken } = run({ type: "coordinator-post", investigationId: batch().id, text: "The human wants the 1890s followed too." });
    expect(woken).toEqual(ids);
    expect(statuses()).toEqual(["waiting", "waiting", "waiting"]);
    expect(batch().status).toBe("running");
    expect(batch().readyAt).toBeUndefined();
    expect(batch().events.at(-1)!.message).toBe("A post on the board woke the team; the batch is at work again.");
    // A researcher's own post does not wake its own seat.
    for (const id of ids) finish(id);
    expect(batch().status).toBe("review");
  });

  it("holds a woken seat while the human has the batch paused, and starts it when they resume", () => {
    finish(ids[0]!);
    claim(ids[1]!);
    run({ type: "pause", investigationId: batch().id });
    expect(statuses()).toEqual(["finished", "paused", "paused"]);
    expect(batch().status).toBe("paused");
    run({ type: "coordinator-post", investigationId: batch().id, text: "A new lead." });
    expect(statuses()).toEqual(["paused", "paused", "paused"]);
    run({ type: "resume", investigationId: batch().id });
    expect(statuses()).toEqual(["waiting", "waiting", "waiting"]);
    expect(batch().status).toBe("running");
  });
});

describe("pausing, resuming and switching a seat", () => {
  it("keeps a paused researcher's session, and lets the human pause and resume one alone", () => {
    const token = claim(ids[0]!);
    claim(ids[1]!);
    const session = { engine: "claude", id: "s-1", directory: "/fictional", at: "t" };
    run({ type: "assignment-session", assignmentId: ids[0], token, session });
    run({ type: "pause-assignment", assignmentId: ids[0] });
    expect(batch().assignments![0]).toMatchObject({ status: "paused", session });
    expect(batch().assignments![0]!.lease).toBeUndefined();
    // Its teammates carry on, and the batch with them.
    expect(statuses()).toEqual(["paused", "running", "waiting"]);
    expect(batch().status).toBe("running");
    expect(() => run({ type: "pause-assignment", assignmentId: ids[2] })).toThrow("Only a running researcher");
    run({ type: "resume-assignment", assignmentId: ids[0] });
    expect(batch().assignments![0]).toMatchObject({ status: "waiting", session });
    expect(batch().events.at(-1)!.message).toBe("You resumed Researcher 1.");
  });

  it("keeps an interrupted researcher's session to resume, leaving its teammates at work", () => {
    const first = claim(ids[0]!);
    const second = claim(ids[1]!);
    const session = { engine: "claude", id: "s-1", directory: "/fictional", at: "t" };
    run({ type: "assignment-session", assignmentId: ids[0], token: first, session });
    run({ type: "assignment-paused", assignmentId: ids[0], token: first, reason: "The app closed." });
    expect(batch().assignments![0]).toMatchObject({ status: "paused", session });
    expect(batch().status).toBe("running");
    run({ type: "resume", investigationId: batch().id });
    expect(statuses()).toEqual(["waiting", "running", "waiting"]);
    expect(batch().assignments![1]!.lease!.token).toBe(second);
  });

  it("switches a researcher's model keeping its session, and its program dropping it", () => {
    const token = claim(ids[0]!);
    const session = { engine: "claude", id: "s-1", directory: "/fictional", at: "t" };
    run({ type: "assignment-session", assignmentId: ids[0], token, session });
    run({ type: "switch-assignment", assignmentId: ids[0], choice: { engine: "claude", model: "sonnet", effort: null }, label: "Claude Code, Sonnet" });
    expect(batch().assignments![0]).toMatchObject({ status: "waiting", choice: { engine: "claude", model: "sonnet", effort: null }, session });
    expect(batch().assignments![0]!.lease).toBeUndefined();
    expect(batch().events.at(-1)!.message).toBe("You switched Researcher 1 to Claude Code, Sonnet; it keeps its conversation.");
    run({ type: "switch-assignment", assignmentId: ids[0], choice: { engine: "codex", model: null, effort: null } });
    expect(batch().assignments![0]!.session).toBeUndefined();
    expect(batch().events.at(-1)!.message).toBe("You switched Researcher 1 to codex; it starts again from its checkpoints.");
  });

  it("pauses only the researcher that needs a sign-in, and resumes it when access is ready", () => {
    const token = claim(ids[0]!);
    claim(ids[1]!);
    run({
      type: "checkpoint",
      investigationId: batch().id,
      token,
      summary: "Needs the archive",
      findings: "Login wall",
      nextSteps: "Read vol. 5",
      accessRequest: { instruction: "Sign in to the county archive." },
    });
    expect(statuses()).toEqual(["paused", "running", "waiting"]);
    expect(batch().accessRequest).toMatchObject({ assignmentId: ids[0] });
    run({ type: "resolve-access", investigationId: batch().id });
    expect(statuses()).toEqual(["waiting", "running", "waiting"]);
  });

  it("lets the human say they could not get access, so the researcher carries on without the source", () => {
    const token = claim(ids[0]!);
    const ask = { instruction: "Clear the fictional deed portal's verification.", url: "https://deeds.example/search" };
    run({ type: "checkpoint", investigationId: batch().id, token, summary: "Needs the portal", findings: "Bot check", nextSteps: "Search deeds", accessRequest: ask });
    run({ type: "resolve-access", investigationId: batch().id, outcome: "unavailable" });
    expect(batch().assignments![0]).toMatchObject({ status: "waiting", unreachable: [{ ...ask, at: expect.any(String) }] });
    expect(batch().accessRequest).toMatchObject({ outcome: "unavailable", resolvedAt: expect.any(String) });
  });
});

describe("stopping a batch's team", () => {
  it("stops every seat, finished ones too, so no post wakes them again", () => {
    const token = claim(ids[0]!);
    run({ type: "assignment-session", assignmentId: ids[0], token, session: { engine: "claude", id: "s-1", directory: "/fictional", at: "t" } });
    finish(ids[1]!);
    run({ type: "stop-team", investigationId: batch().id, reason: "The human no longer wants this." });
    expect(statuses()).toEqual(["stopped", "stopped", "stopped"]);
    expect(batch().assignments!.every((a) => !a.lease && !a.session)).toBe(true);
    expect(batch().stoppedAt).toEqual(expect.any(String));
    expect(batch().events.at(-1)!.message).toBe("The coordinator stopped this batch's team: The human no longer wants this.");
    // What the team published stays for Review.
    expect(batch().status).toBe("review");
    expect(() => run({ type: "coordinator-post", investigationId: batch().id, text: "Keep going." })).toThrow("team was stopped");
    expect(() => run({ type: "post", assignmentId: ids[0], text: "Late.", key: "k" })).toThrow("team was stopped");
    expect(() => run({ type: "seat-finished", assignmentId: ids[0], token })).toThrow("lease");
    expect(() => run({ type: "stop-team", investigationId: batch().id })).toThrow("already stopped");
  });
});
