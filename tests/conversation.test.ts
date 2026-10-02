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
  const brief = {
    purpose: "Find who built the fictional Harbour Mill.",
    scope: "The mill's construction only, not its later owners.",
    direction: "Start with the parish building register.",
  };
  const part = (title: string, extra: object = {}) => ({ title, brief: `Research: ${title}`, ...extra });

  it("opens a numbered batch with the coordinator's assignments, whatever the human sent", () => {
    run({ type: "send", queue: false, text: "Who built the mill, and was the builder local?" });
    const { investigationId } = run({
      type: "open-batch",
      brief,
      title: "The mill's builder",
      assignments: [part("Who built the Harbour Mill?"), part("Was the builder local?")],
    });
    const batch = state.investigations.find((i) => i.id === investigationId)!;
    expect(batch.number).toBe(1);
    expect(batch.status).toBe("queued");
    expect(batch.annotations).toEqual([]);
    expect(batch.assignments!.map((a) => [a.title, a.brief, a.status])).toEqual([
      ["Who built the Harbour Mill?", "Research: Who built the Harbour Mill?", "waiting"],
      ["Was the builder local?", "Research: Was the builder local?", "waiting"],
    ]);
    expect(batchStatus(batch)).toBe("in progress");
    // Questions are gone; an assignment needs its own title and brief.
    expect(() => run({ type: "open-batch", brief, title: "Old", questions: [{ title: "Q", request: "R" }] })).toThrow("assignment with a title and a brief");
    expect(() => run({ type: "open-batch", brief, title: "No brief", assignments: [{ title: "Q" }] })).toThrow("Assignment brief");
  });

  it("opens a batch with nothing assigned yet, waiting for the coordinator", () => {
    const { investigationId } = run({ type: "open-batch", brief, title: "Later" });
    expect(state.investigations.find((i) => i.id === investigationId)).toMatchObject({ status: "queued", assignments: [] });
  });

  it("requires a brief to open a batch and keeps it current", () => {
    expect(() => run({ type: "open-batch", title: "No brief", assignments: [part("Q")] })).toThrow("brief");
    const { investigationId } = run({ type: "open-batch", brief, title: "The mill's builder", assignments: [part("Who built it?")] });
    run({ type: "set-brief", investigationId, brief: { direction: "The register is lost; try the 1880 newspaper." } });
    const batch = state.investigations[0]!;
    expect(batch.brief).toMatchObject({
      purpose: brief.purpose,
      scope: brief.scope,
      direction: "The register is lost; try the 1880 newspaper.",
    });
    expect(batch.events.at(-1)!.message).toContain("try the 1880 newspaper");
    expect(() => run({ type: "set-brief", investigationId, brief: { direction: "" } })).toThrow("direction");
  });

  it("adds a later assignment to an open batch and reopens it", () => {
    const { investigationId } = run({ type: "open-batch", brief, title: "The mill's builder", assignments: [part("Who built it?")] });
    run({ type: "batch-ready", investigationId, text: "Batch 1 is done." });
    const { assignmentId } = run({ type: "assign", investigationId, ...part("Was the builder local?") });
    const batch = state.investigations[0]!;
    expect(batch.assignments!.at(-1)).toMatchObject({ id: assignmentId, title: "Was the builder local?", status: "waiting" });
    expect(batch.readyAt).toBeUndefined();
    expect(batch.status).toBe("queued");
  });

  it("lets the coordinator rewrite batch and assignment headings", () => {
    const { investigationId } = run({ type: "open-batch", brief, title: "draft title", assignments: [part("draft heading")] });
    const assignmentId = state.investigations[0]!.assignments![0]!.id;
    run({ type: "retitle", investigationId, title: "The mill's builder", assignments: [{ assignmentId, title: "Who built the mill?" }] });
    expect(state.investigations[0]!.title).toBe("The mill's builder");
    expect(state.investigations[0]!.assignments![0]!.title).toBe("Who built the mill?");
    expect(() => run({ type: "retitle", investigationId, assignments: [{ assignmentId: "missing", title: "x" }] })).toThrow(
      "not part of this batch",
    );
  });

  it("refuses work for a closed batch", () => {
    const { investigationId } = run({ type: "open-batch", brief, title: "Closed", assignments: [part("Q")] });
    state.investigations[0]!.closedAt = new Date().toISOString();
    expect(() => run({ type: "assign", investigationId, ...part("Q2") })).toThrow("closed");
  });

  it("repairs a batch closed without its status", () => {
    run({ type: "open-batch", brief, title: "Old", assignments: [part("Q")] });
    state.investigations[0]!.closedAt = new Date().toISOString();
    expect(repairClosedBatches(state)).toBe(1);
    expect(state.investigations[0]!.status).toBe("closed");
    expect(repairClosedBatches(state)).toBe(0);
  });

  it("announces a ready batch in the conversation", () => {
    const { investigationId } = run({ type: "open-batch", brief, title: "Ready", assignments: [part("Q")] });
    run({ type: "batch-ready", investigationId, text: "I think this batch is done." });
    expect(batchStatus(state.investigations[0]!)).toBe("ready");
    expect(state.conversation!.at(-1)).toMatchObject({ readyBatchId: investigationId });
  });
});
