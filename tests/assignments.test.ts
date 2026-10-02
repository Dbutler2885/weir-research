import { beforeEach, describe, expect, it } from "vitest";
import { initialState, transition, type ResearchCommand, type ResearchState } from "../src/domain/research";
import { emptyGraph } from "../src/domain/graph-schema";

// A batch with several researchers' assignments, as domain transitions.
let state: ResearchState;
function run(command: ResearchCommand): any {
  const result = transition(state, command);
  state = result.state;
  return result.result;
}
const brief = { purpose: "Who ran the fictional mill.", scope: "After 1880.", direction: "Leases first." };
const batch = () => state.investigations[0]!;
const statuses = () => batch().assignments!.map((a) => a.status);
const claim = (assignmentId: string) =>
  run({ type: "claim", investigationId: batch().id, assignmentId, worker: "Fixture researcher" }).assignment.lease.token as string;
const findings = (title: string) => ({
  kind: "findings",
  title,
  summary: "Fixture summary.",
  ambiguity: "None.",
  evidence: [],
  changes: [],
  findings: [{ id: "f", statement: `${title} is unresolved.`, qualification: "unresolved", explanation: "Fixture.", evidenceIds: [] }],
});

let ids: string[];
beforeEach(() => {
  state = initialState({ ...emptyGraph(), title: "The fictional Harbour Mill" });
  run({
    type: "open-batch",
    brief,
    title: "Who ran the mill",
    assignments: [
      { title: "Leases", brief: "Read the lease registers." },
      { title: "Directories", brief: "Read the trade directories." },
      { title: "Newspapers", brief: "Search for a sale notice." },
    ],
  });
  ids = batch().assignments!.map((a) => a.id);
});

describe("assignments in a batch", () => {
  it("each holds its own lease, checkpoints and result, and the batch runs while any does", () => {
    const leases = claim(ids[0]!);
    const directories = claim(ids[1]!);
    expect(statuses()).toEqual(["running", "running", "waiting"]);
    expect(batch().status).toBe("running");
    expect(() => claim(ids[0]!)).toThrow("not waiting");
    run({ type: "checkpoint", investigationId: batch().id, token: leases, summary: "Vol. 4 read", findings: "Lease to Holloway", nextSteps: "Vol. 5" });
    expect(batch().assignments![0]!.checkpoints.map((c) => c.summary)).toEqual(["Vol. 4 read"]);
    expect(batch().assignments![1]!.checkpoints).toEqual([]);
    run({ type: "propose", investigationId: batch().id, token: leases, proposal: findings("Leases") });
    expect(batch().proposals[0]!.assignmentId).toBe(ids[0]);
    expect(statuses()).toEqual(["done", "running", "waiting"]);
    // Another's lease is still good after one hands in its result.
    run({ type: "propose", investigationId: batch().id, token: directories, proposal: findings("Directories") });
    expect(batch().status).toBe("queued");
    run({ type: "propose", investigationId: batch().id, token: claim(ids[2]!), proposal: findings("Newspapers") });
    expect(statuses()).toEqual(["done", "done", "done"]);
    expect(batch().status).toBe("review");
  });

  it("holds a returned result for the coordinator while the batch still counts as running", () => {
    const token = claim(ids[0]!);
    run({ type: "assignment-returned", assignmentId: ids[0], token });
    expect(statuses()).toEqual(["returned", "waiting", "waiting"]);
    expect(batch().status).toBe("running");
    // The coordinator publishes it later with the same lease.
    run({ type: "propose", investigationId: batch().id, token, proposal: findings("Leases") });
    expect(statuses()[0]).toBe("done");
    expect(batch().status).toBe("queued");
  });

  it("keeps a paused researcher's session to resume, and lets the human pause and resume the batch", () => {
    const token = claim(ids[0]!);
    const session = { engine: "claude", id: "s-1", directory: "/fictional", at: "t" };
    run({ type: "assignment-session", assignmentId: ids[0], token, session });
    run({ type: "assignment-paused", assignmentId: ids[0], token, reason: "The app closed." });
    expect(batch().assignments![0]).toMatchObject({ status: "paused", session });
    expect(batch().assignments![0]!.lease).toBeUndefined();
    expect(batch().status).toBe("queued");
    claim(ids[1]!);
    run({ type: "pause", investigationId: batch().id });
    expect(statuses()).toEqual(["paused", "paused", "paused"]);
    expect(batch().status).toBe("paused");
    run({ type: "resume", investigationId: batch().id });
    expect(statuses()).toEqual(["waiting", "waiting", "waiting"]);
    expect(batch().assignments![0]!.session).toEqual(session);
    expect(batch().status).toBe("queued");
  });

  it("resumes only an interrupted researcher, leaving its siblings at work", () => {
    const leases = claim(ids[0]!);
    const directories = claim(ids[1]!);
    run({ type: "assignment-paused", assignmentId: ids[0], token: leases, reason: "The app closed." });
    expect(batch().status).toBe("running");
    run({ type: "resume", investigationId: batch().id });
    expect(statuses()).toEqual(["waiting", "running", "waiting"]);
    expect(batch().assignments![1]!.lease!.token).toBe(directories);
  });

  it("lets the coordinator stop one assignment and send it back with notes, leaving the others alone", () => {
    claim(ids[0]!);
    claim(ids[1]!);
    run({ type: "stop-assignment", assignmentId: ids[0], reason: "The leases are in batch 4." });
    expect(statuses()).toEqual(["stopped", "running", "waiting"]);
    expect(batch().events.at(-1)!.message).toBe('Coordinator stopped "Leases": The leases are in batch 4.');
    expect(() => run({ type: "stop-assignment", assignmentId: ids[0], reason: "Again" })).toThrow("not under way");
    run({ type: "revise-assignment", assignmentId: ids[0], notes: "Only volume 5 is needed." });
    expect(batch().assignments![0]).toMatchObject({ status: "waiting", steering: [{ message: "Only volume 5 is needed.", at: expect.any(String) }] });
    expect(() => run({ type: "revise-assignment", assignmentId: ids[1], notes: "Mid-run" })).toThrow("returned, published or stopped");
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

  it("records a researcher's board post on its batch, only while its lease is current", () => {
    const token = claim(ids[0]!);
    run({ type: "post", assignmentId: ids[0], token, text: "Vol. 5 is missing from the scans." });
    expect(batch().board).toEqual([{ id: expect.any(String), at: expect.any(String), assignmentId: ids[0], text: "Vol. 5 is missing from the scans." }]);
    expect(() => run({ type: "post", assignmentId: ids[0], token: "old", text: "Late" })).toThrow("lease");
  });

  it("starts a new assignment in a paused batch paused, so nothing starts until the human resumes", () => {
    run({ type: "pause", investigationId: batch().id });
    const { assignmentId } = run({ type: "assign", investigationId: batch().id, title: "Insurance plans", brief: "Find the plans." });
    expect(batch().assignments!.find((a) => a.id === assignmentId)!.status).toBe("paused");
    expect(batch().status).toBe("paused");
  });
});
