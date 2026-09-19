import { beforeEach, describe, expect, it } from "vitest";
import {
  initialState,
  transition,
  type ResearchCommand,
  type ResearchState,
} from "../src/domain/research";
import {
  batchStatus,
  unassignedAnnotations,
} from "../src/domain/conversation";
import empty from "../src/data/empty.json";

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
    run({ type: "send" });
    expect(() => run({ type: "edit-queued", annotationId, question: "Late", references: [] })).toThrow(
      "already been sent",
    );
    expect(() => run({ type: "remove-queued", annotationId })).toThrow("already been sent");
  });

  it("sends the whole queue with an optional message as one human message", () => {
    run({ type: "queue-annotation", question: "First thought", references: [] });
    run({ type: "queue-annotation", question: "A second, contradictory thought", references: [] });
    run({ type: "send", text: "These go together." });
    const message = state.conversation![0]!;
    expect(message.author).toBe("human");
    expect(message.text).toBe("These go together.");
    expect(message.annotations!.map((a) => a.question)).toEqual([
      "First thought",
      "A second, contradictory thought",
    ]);
    expect(message.annotations!.every((a) => a.dispatchedAt)).toBe(true);
    expect(state.queue).toHaveLength(0);
    expect(unassignedAnnotations(state)).toHaveLength(2);
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
  function sendTwo() {
    run({ type: "queue-annotation", question: "Who built the mill?", references: [topic()] });
    run({ type: "queue-annotation", question: "Was the builder local?", references: [] });
    run({ type: "send" });
    return state.conversation![0]!.annotations!.map((a) => a.id);
  }

  it("opens a numbered batch from sent annotations under coordinator headings", () => {
    const [a, b] = sendTwo();
    const { investigationId } = run({
      type: "open-batch",
      title: "The mill's builder",
      questions: [{ title: "Who built the Harbour Mill?", annotationIds: [a, b] }],
    });
    const batch = state.investigations.find((i) => i.id === investigationId)!;
    expect(batch.number).toBe(1);
    expect(batch.status).toBe("queued");
    expect(batch.annotations.map((x) => x.id)).toEqual([a, b]);
    expect(batch.questions![0]!).toMatchObject({ title: "Who built the Harbour Mill?", origin: "human" });
    expect(unassignedAnnotations(state)).toHaveLength(0);
    expect(batchStatus(batch)).toBe("in progress");
  });

  it("does not place an annotation in two batches", () => {
    const [a] = sendTwo();
    run({ type: "open-batch", title: "One", questions: [{ title: "Q", annotationIds: [a] }] });
    expect(() =>
      run({ type: "open-batch", title: "Two", questions: [{ title: "Q", annotationIds: [a] }] }),
    ).toThrow("not yet placed in a batch");
  });

  it("adds a later annotation to an open batch and reopens it", () => {
    const [a, b] = sendTwo();
    const { investigationId } = run({
      type: "open-batch",
      title: "The mill's builder",
      questions: [{ title: "Who built it?", annotationIds: [a] }],
    });
    run({ type: "batch-ready", investigationId, text: "Batch 1 is done." });
    const questionId = state.investigations[0]!.questions![0]!.id;
    run({ type: "add-to-batch", investigationId, questions: [{ questionId, annotationIds: [b] }] });
    const batch = state.investigations[0]!;
    expect(batch.questions![0]!.annotationIds).toEqual([a, b]);
    expect(batch.readyAt).toBeUndefined();
    expect(batch.status).toBe("queued");
  });

  it("refuses work for a closed batch", () => {
    const [a, b] = sendTwo();
    const { investigationId } = run({
      type: "open-batch",
      title: "Closed",
      questions: [{ title: "Q", annotationIds: [a] }],
    });
    state.investigations[0]!.closedAt = new Date().toISOString();
    expect(() =>
      run({ type: "add-to-batch", investigationId, questions: [{ title: "Q2", annotationIds: [b] }] }),
    ).toThrow("closed");
  });

  it("announces a ready batch in the conversation", () => {
    const [a] = sendTwo();
    const { investigationId } = run({
      type: "open-batch",
      title: "Ready",
      questions: [{ title: "Q", annotationIds: [a] }],
    });
    run({ type: "batch-ready", investigationId, text: "I think this batch is done." });
    expect(batchStatus(state.investigations[0]!)).toBe("ready");
    expect(state.conversation!.at(-1)).toMatchObject({ readyBatchId: investigationId });
  });

  it("requires the human's approval before a coordinator question", () => {
    const [a] = sendTwo();
    const { investigationId } = run({
      type: "open-batch",
      title: "Mill",
      questions: [{ title: "Q", annotationIds: [a] }],
    });
    const { messageId } = run({
      type: "request-approval",
      title: "Check the 1884 register?",
      body: "Two sources give different closing years.",
      investigationId,
    });
    expect(() =>
      run({ type: "add-to-batch", investigationId, questions: [{ title: "When did it close?", approvalMessageId: messageId }] }),
    ).toThrow("approved");
    run({ type: "decide", messageId, decision: "approve" });
    run({ type: "add-to-batch", investigationId, questions: [{ title: "When did it close?", approvalMessageId: messageId }] });
    const question = state.investigations[0]!.questions!.at(-1)!;
    expect(question).toMatchObject({
      origin: "coordinator",
      explanation: "Two sources give different closing years.",
    });
    expect(() => run({ type: "decide", messageId, decision: "decline" })).toThrow("no longer waiting");
  });
});
