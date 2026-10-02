// @vitest-environment node
import { describe, expect, it } from "vitest";
import { initialState, transition, type ResearchCommand, type ResearchState } from "../src/domain/research";
import { emptyGraph } from "../src/domain/graph-schema";
import { inbox } from "../server/coordinator-inbox.mjs";

function project() {
  let state = initialState({ ...emptyGraph(), title: "The fictional Harbour Mill" } as never) as ResearchState;
  const run = (command: ResearchCommand) => (state = transition(state, command).state);
  return { run, get state() { return state; } };
}
const human = (state: ResearchState) => (state.conversation || []).filter((m) => m.author === "human");

describe("what the coordinator receives", () => {
  it("gets a chat message as the human's own words", () => {
    const p = project();
    p.run({ type: "send", text: "Did the mill burn in 1890?" });
    expect(inbox(p.state, { messages: human(p.state) })).toEqual([{ text: "Did the mill burn in 1890?", fromHuman: true }]);
  });

  it("gets sent annotations together, each with what it points at, and no IDs", () => {
    const p = project();
    p.run({ type: "queue-annotation", question: "Same mill as the 1881 list?", references: [{ label: "Harbour Mill entry", text: "the mill on Harbour Row" }] });
    p.run({ type: "queue-annotation", question: "This is great.", references: [] });
    p.run({ type: "send", queue: true });
    const [message] = inbox(p.state, { messages: human(p.state) });
    expect(message!.fromHuman).toBe(true);
    expect(message!.text.split("\n")[0]).toBe("The human sent 2 annotations:");
    const body = JSON.parse(message!.text.slice(message!.text.indexOf("\n\n") + 2));
    expect(body).toEqual([
      { annotation: "Same mill as the 1881 list?", on: [expect.stringContaining("the mill on Harbour Row")] },
      { annotation: "This is great." },
    ]);
    expect(message!.text).not.toMatch(/"id"|"at"|"author"/);
  });

  it("keeps news from the app separate, with only the parts that changed", () => {
    const p = project();
    p.run({ type: "send", text: "Thanks." });
    const messages = inbox(p.state, {
      messages: human(p.state),
      investigations: [{ id: "batch-1", title: "The mill's builder", status: "running" }],
      removedInvestigationIds: [],
      pendingDecisions: [],
    });
    expect(messages.map((m) => m.fromHuman)).toEqual([false, true]);
    expect(messages[0]!.text.split("\n")[0]).toBe("News from the app. Act on what needs you, then end your turn.");
    const news = JSON.parse(messages[0]!.text.slice(messages[0]!.text.indexOf("\n\n") + 2));
    expect(news).toEqual({ investigations: [{ id: "batch-1", title: "The mill's builder", status: "running" }] });
    expect(messages[1]!.text).toBe("Thanks.");
  });

  it("sends nothing when nothing worth saying changed", () => {
    const p = project();
    expect(inbox(p.state, { messages: [], investigations: [], pendingDecisions: [] })).toEqual([]);
  });
});
