import { beforeEach, describe, expect, it } from "vitest";
import {
  initialState,
  transition,
  type ResearchCommand,
  type ResearchState,
} from "../src/domain/research";
import {
  batchStatus,
  repairClosedBatches,
  unassignedAnnotations,
} from "../src/domain/conversation";
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
  function sendTwo() {
    run({ type: "queue-annotation", question: "Who built the mill?", references: [topic()] });
    run({ type: "queue-annotation", question: "Was the builder local?", references: [] });
    run({ type: "send", queue: true });
    return state.conversation![0]!.annotations!.map((a) => a.id);
  }

  it("opens a numbered batch from sent annotations under coordinator headings", () => {
    const [a, b] = sendTwo();
    const { investigationId } = run({
      type: "open-batch",
      brief,
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

  it("requires a brief to open a batch and keeps it current", () => {
    const [a] = sendTwo();
    expect(() =>
      run({ type: "open-batch", title: "No brief", questions: [{ title: "Q", annotationIds: [a] }] }),
    ).toThrow("brief");
    const { investigationId } = run({
      type: "open-batch",
      brief,
      title: "The mill's builder",
      questions: [{ title: "Who built it?", annotationIds: [a] }],
    });
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

  it("does not place an annotation in two batches", () => {
    const [a] = sendTwo();
    run({ type: "open-batch", brief, title: "One", questions: [{ title: "Q", annotationIds: [a] }] });
    expect(() =>
      run({ type: "open-batch", brief, title: "Two", questions: [{ title: "Q", annotationIds: [a] }] }),
    ).toThrow("not yet placed in a batch");
  });

  it("adds a later annotation to an open batch and reopens it", () => {
    const [a, b] = sendTwo();
    const { investigationId } = run({
      type: "open-batch",
      brief,
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

  it("lets the coordinator rewrite batch and question headings", () => {
    const [a] = sendTwo();
    const { investigationId } = run({
      type: "open-batch",
      brief,
      title: "draft title",
      questions: [{ title: "draft question", annotationIds: [a] }],
    });
    const questionId = state.investigations[0]!.questions![0]!.id;
    run({ type: "retitle", investigationId, title: "The mill's builder", questions: [{ questionId, title: "Who built the mill?" }] });
    expect(state.investigations[0]!.title).toBe("The mill's builder");
    expect(state.investigations[0]!.questions![0]!.title).toBe("Who built the mill?");
    expect(() => run({ type: "retitle", investigationId, questions: [{ questionId: "missing", title: "x" }] })).toThrow(
      "not part of this batch",
    );
  });

    it("refuses work for a closed batch", () => {
    const [a, b] = sendTwo();
    const { investigationId } = run({
      type: "open-batch",
      brief,
      title: "Closed",
      questions: [{ title: "Q", annotationIds: [a] }],
    });
    state.investigations[0]!.closedAt = new Date().toISOString();
    expect(() =>
      run({ type: "add-to-batch", investigationId, questions: [{ title: "Q2", annotationIds: [b] }] }),
    ).toThrow("closed");
  });

  it("repairs a batch closed without its status", () => {
    const [a] = sendTwo();
    run({ type: "open-batch", brief, title: "Old", questions: [{ title: "Q", annotationIds: [a] }] });
    state.investigations[0]!.closedAt = new Date().toISOString();
    expect(repairClosedBatches(state)).toBe(1);
    expect(state.investigations[0]!.status).toBe("closed");
    expect(repairClosedBatches(state)).toBe(0);
  });

  it("announces a ready batch in the conversation", () => {
    const [a] = sendTwo();
    const { investigationId } = run({
      type: "open-batch",
      brief,
      title: "Ready",
      questions: [{ title: "Q", annotationIds: [a] }],
    });
    run({ type: "batch-ready", investigationId, text: "I think this batch is done." });
    expect(batchStatus(state.investigations[0]!)).toBe("ready");
    expect(state.conversation!.at(-1)).toMatchObject({ readyBatchId: investigationId });
  });

  it("opens a batch from research the human asked for in chat, worded by the coordinator", () => {
    const { messageId } = run({ type: "send", text: "Find out who ran the mill after 1900." });
    expect(() =>
      run({ type: "open-batch", brief, title: "Later owners", questions: [{ title: "Who ran the mill after 1900?", messageId }] }),
    ).toThrow("questions no longer cite a message");
    const { investigationId } = run({
      type: "open-batch",
      brief,
      title: "Later owners",
      questions: [{ title: "Who ran the mill after 1900?", request: "Trace who ran the mill after 1900.", references: [topic()] }],
    });
    const batch = state.investigations.find((i) => i.id === investigationId)!;
    expect(batch.questions![0]).toMatchObject({ origin: "coordinator", explanation: "Trace who ran the mill after 1900." });
    // The researcher receives the coordinator's words and what the human pointed at.
    const assignment = batch.annotations.find((x) => x.id === batch.questions![0]!.annotationIds[0])!;
    expect(assignment).toMatchObject({ question: "Trace who ran the mill after 1900.", author: "coordinator", references: [topic()] });
    expect(assignment.dispatchedAt).toBeTruthy();
    expect(() => run({ type: "add-to-batch", investigationId, questions: [{ title: "Q" }] })).toThrow("Research request");
  });

  it("opens a batch on the coordinator's own judgement", () => {
    const { investigationId } = run({
      type: "open-batch",
      brief,
      title: "Closing year",
      questions: [{ title: "When did the mill close?", request: "Resolve the conflicting closing years." }],
    });
    const question = state.investigations.find((i) => i.id === investigationId)!.questions![0]!;
    expect(question).toMatchObject({ origin: "coordinator", explanation: "Resolve the conflicting closing years." });
    expect(question.messageId).toBeUndefined();
  });

  it("links an approved request to its coordinator question", () => {
    const [a] = sendTwo();
    const { investigationId } = run({
      type: "open-batch",
      brief,
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
    const assignment = state.investigations[0]!.annotations.find((x) => x.id === question.annotationIds[0])!;
    expect(assignment).toMatchObject({ author: "coordinator", question: "Two sources give different closing years." });
    expect(assignment.dispatchedAt).toBeTruthy();
    expect(() =>
      run({ type: "add-to-batch", investigationId, questions: [{ title: "Again", approvalMessageId: messageId }] }),
    ).toThrow("already has a question");
    expect(() => run({ type: "decide", messageId, decision: "decline" })).toThrow("no longer waiting");
  });
});
