import { beforeEach, describe, expect, it } from "vitest";
import {
  initialState,
  transition,
  type ResearchCommand,
  type ResearchState,
} from "../src/domain/research";
import { batchStatus, repairClosedBatches } from "../src/domain/conversation";
import { emptyGraph } from "../src/domain/graph-schema";
const empty = emptyGraph();

let state: ResearchState;
function run(command: ResearchCommand): any {
  const result = transition(state, command);
  state = result.state;
  return result.result;
}
const topic = () => ({ label: state.dataset.title, text: state.dataset.title });

beforeEach(() => {
  state = initialState({ ...empty, title: "The fictional Harbour Mill" });
});

describe("project-wide queue and conversation", () => {
  it("queues annotations without creating an investigation", () => {
    run({ type: "queue-annotation", question: "Who built the mill?", references: [topic()] });
    run({ type: "queue-annotation", question: "When did it close?", references: [] });
    expect(state.queue).toHaveLength(2);
    expect(state.investigations).toHaveLength(0);
    expect(state.queue![1]!.target.label).toBe("The fictional Harbour Mill");
  });

  it("edits and removes queued annotations only while unsent", () => {
    const { annotationId } = run({ type: "queue-annotation", question: "Draft", references: [] });
    run({ type: "edit-queued", annotationId, question: "Revised", references: [topic()] });
    expect(state.queue![0]!.question).toBe("Revised");
    run({ type: "send", queue: true });
    expect(() => run({ type: "edit-queued", annotationId, question: "Late", references: [] })).toThrow(
      "already been sent",
    );
    expect(() => run({ type: "remove-queued", annotationId })).toThrow("already been sent");
  });

  it("sends a chat message alone, leaving the annotation queue as it was", () => {
    run({ type: "queue-annotation", question: "First thought", references: [] });
    run({ type: "send", text: "A quick question while I keep collecting." });
    expect(state.conversation![0]!).toMatchObject({ author: "human", text: "A quick question while I keep collecting." });
    expect(state.conversation![0]!.annotations).toBeUndefined();
    expect(state.queue!.map((a) => a.question)).toEqual(["First thought"]);
  });

  it("sends the whole queue only when the queue is sent", () => {
    run({ type: "queue-annotation", question: "First thought", references: [] });
    run({ type: "queue-annotation", question: "A second, contradictory thought", references: [] });
    run({ type: "send", queue: true });
    const message = state.conversation![0]!;
    expect(message.author).toBe("human");
    expect(message.text).toBeUndefined();
    expect(message.annotations!.map((a) => a.question)).toEqual([
      "First thought",
      "A second, contradictory thought",
    ]);
    expect(message.annotations!.every((a) => a.dispatchedAt)).toBe(true);
    expect(state.queue).toHaveLength(0);
    expect(() => run({ type: "send", queue: true })).toThrow("Write a message");
  });

  it("sends one annotation immediately without touching the rest of the queue", () => {
    run({ type: "queue-annotation", question: "Still thinking", references: [] });
    run({ type: "send", annotation: { question: "Urgent question", references: [topic()] } });
    expect(state.queue!.map((a) => a.question)).toEqual(["Still thinking"]);
    expect(state.conversation![0]!.annotations![0]!.question).toBe("Urgent question");
  });

  it("rejects an empty send", () => {
    expect(() => run({ type: "send", text: "  " })).toThrow("Write a message");
  });

  it("records coordinator replies with references", () => {
    run({ type: "reply", text: "Yes, that is the same mill.", references: [topic()] });
    expect(state.conversation![0]!).toMatchObject({
      author: "coordinator",
      text: "Yes, that is the same mill.",
    });
  });
});

describe("coordinator batches", () => {
  const goal = "Find who built the fictional Harbour Mill, and whether the builder was local.";

  it("opens a numbered batch with a goal and a team, whatever the human sent", () => {
    run({ type: "send", queue: false, text: "Who built the mill, and was the builder local?" });
    const { investigationId, researchers } = run({ type: "open-batch", title: "The mill's builder", goal });
    const batch = state.investigations.find((i) => i.id === investigationId)!;
    expect(batch).toMatchObject({ number: 1, goal, status: "running", annotations: [] });
    expect(researchers).toEqual(["Researcher 1", "Researcher 2", "Researcher 3", "Researcher 4"]);
    expect(batch.assignments!.map((a) => [a.title, a.brief, a.status])).toEqual(researchers.map((name: string) => [name, "", "waiting"]));
    expect(batchStatus(batch)).toBe("in progress");
    expect(() => run({ type: "open-batch", title: "No goal" })).toThrow("goal is required");
    expect(() => run({ type: "open-batch", title: "Too long", goal: "x".repeat(5001) })).toThrow("maximum 5,000 characters");
  });

  it("lets the coordinator rewrite a batch's heading", () => {
    const { investigationId } = run({ type: "open-batch", title: "draft title", goal });
    run({ type: "retitle", investigationId, title: "The mill's builder" });
    expect(state.investigations[0]!.title).toBe("The mill's builder");
    expect(() => run({ type: "retitle", investigationId, assignments: [{ assignmentId: "missing", title: "x" }] })).toThrow(
      "not part of this batch",
    );
  });

  it("repairs a batch closed without its status", () => {
    run({ type: "open-batch", title: "Old", goal });
    state.investigations[0]!.closedAt = new Date().toISOString();
    expect(repairClosedBatches(state)).toBe(1);
    expect(state.investigations[0]!.status).toBe("closed");
    expect(repairClosedBatches(state)).toBe(0);
  });

  it("is ready for review once every researcher in its team has finished", () => {
    const { investigationId } = run({ type: "open-batch", title: "Ready", goal });
    for (const seat of state.investigations[0]!.assignments!) {
      const token = run({ type: "claim", investigationId, assignmentId: seat.id, worker: "Fixture researcher" }).assignment.lease.token;
      expect(batchStatus(state.investigations[0]!)).toBe("in progress");
      run({ type: "seat-finished", assignmentId: seat.id, token });
    }
    expect(batchStatus(state.investigations[0]!)).toBe("ready");
  });
});
