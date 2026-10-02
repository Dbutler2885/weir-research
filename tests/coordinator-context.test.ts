// @vitest-environment node
import { describe, expect, it } from "vitest";
import { initialState, referenceText, transition, type ResearchCommand, type ResearchState } from "../src/domain/research";
import { buildCoordinatorContext, layerBudgets } from "../src/domain/coordinator-context";
import { inspectContext } from "../server/research-context.mjs";
import { emptyGraph } from "../src/domain/graph-schema";
const empty = emptyGraph();

const brief = {
  purpose: "Find who built the fictional Harbour Mill.",
  scope: "Construction only, not later owners.",
  direction: "Start with the parish building register.",
};

function project() {
  let state = initialState(empty as never) as ResearchState;
  const run = (command: ResearchCommand): any => {
    const out = transition(state, command);
    state = out.state;
    return out.result;
  };
  const send = (question: string) => {
    run({ type: "send", annotation: { question, references: [] } });
    return state.conversation!.at(-1)!.annotations![0]!.id;
  };
  const open = (title: string, question: string) =>
    run({
      type: "open-batch",
      brief,
      title,
      assignments: [{ title: question, brief: `Answer: ${question}` }],
    }).investigationId as string;
  return { run, send, open, get state() { return state; }, set state(s) { state = s; } };
}

const layer = (context: ReturnType<typeof buildCoordinatorContext>, id: string) =>
  context.layers.find((l) => l.id === id)!.text;

describe("notes on a text selection", () => {
  it("carry the words the human selected, not only the section they were in", () => {
    const p = project();
    const selection = { label: "What remains open", text: "indexed excerpts, not page images", anchor: { type: "text-range", text: "indexed excerpts, not page images" } };
    p.run({ type: "send", annotation: { question: "What do you mean, and why?", references: [selection] } });
    const context = buildCoordinatorContext(p.state);
    const said = "on the words “indexed excerpts, not page images” in “What remains open”";
    expect(layer(context, "conversation")).toContain(said);
    // A section clicked as a whole is named, without all of its text.
    expect(referenceText({ label: "What remains open", text: "What remains open Lawrence's 1914 history...", anchor: { type: "element" } })).toBe("What remains open");
  });
});

describe("coordinator startup context", () => {
  it("orders layers by urgency, puts pending requests first, and keeps no list of annotations to place", () => {
    const p = project();
    p.open("The mill's builder", "Who built the mill?");
    const note = p.send("Was the miller related to the builder?");
    p.run({ type: "request-approval", title: "Search the 1884 register?", body: "It may name the builder." });
    const context = buildCoordinatorContext(p.state);
    expect(context.layers.map((l) => l.id)).toEqual(["attention", "queue", "orientation", "conversation", "more"]);
    const attention = layer(context, "attention");
    expect(attention).toContain('Your request "Search the 1884 register?" is waiting');
    // An annotation is something the human said, not an item to place in a batch.
    expect(attention).not.toContain("Was the miller related");
    expect(context.text).not.toContain(note);
    expect(layer(context, "conversation")).toContain('Annotation: "Was the miller related to the builder?"');
  });

  it("shows the recent conversation in the human's words, without IDs or reminders", () => {
    const p = project();
    p.run({ type: "send", text: "Did the mill burn in 1890?" });
    p.run({ type: "reply", text: "I will check the fire insurance maps." });
    p.run({ type: "send", text: "Also check the newspaper." });
    const context = buildCoordinatorContext(p.state);
    expect(layer(context, "conversation")).toContain("Also check the newspaper.");
    expect(layer(context, "attention")).not.toContain("no reply yet");
    for (const m of p.state.conversation!) expect(context.text).not.toContain(m.id);
  });

  it("describes each open batch once, with its number, brief and next action", () => {
    const p = project();
    const first = p.open("The mill's builder", "Who built the mill?");
    p.open("The miller's family", "Who was the miller's father?");
    const queue = layer(buildCoordinatorContext(p.state), "queue");
    expect(queue.match(new RegExp(first, "g"))).toHaveLength(1);
    expect(queue).toContain("### Batch 1: The mill's builder");
    expect(queue).toContain("### Batch 2: The miller's family");
    expect(queue).toContain(`Purpose: ${brief.purpose}`);
    // Each assignment is listed with where it stands.
    const assignmentId = p.state.investigations[0]!.assignments![0]!.id;
    expect(queue).toContain(`- Assignment "Who built the mill?" (${assignmentId}): waiting for a free place.`);
    expect(queue).toContain("Next (waiting on worker): Assigned; waiting for a free researcher.");
    // A batch with nothing assigned waits for the coordinator.
    p.run({ type: "open-batch", brief, title: "Later" });
    expect(layer(buildCoordinatorContext(p.state), "queue")).toContain("Next (waiting on coordinator): Assign researchers");
  });

  it("never shows a closed batch as active, even one closed without its status", () => {
    const p = project();
    const id = p.open("The mill's builder", "Who built the mill?");
    const state = structuredClone(p.state);
    state.investigations[0]!.closedAt = "2026-01-05T00:00:00.000Z";
    const queue = layer(buildCoordinatorContext(state), "queue");
    expect(queue).toContain("0 open batches");
    expect(queue).toContain(`Batch 1: The mill's builder (${id}), closed 2026-01-05`);
    expect(queue).not.toContain("### Batch 1");
  });

  it("flags a batch without a brief", () => {
    const p = project();
    p.open("The mill's builder", "Who built the mill?");
    const state = structuredClone(p.state);
    delete state.investigations[0]!.brief;
    expect(layer(buildCoordinatorContext(state), "attention")).toContain("has no brief");
  });

  it("summarizes findings instead of reproducing them", () => {
    const p = project();
    p.open("The mill's builder", "Who built the mill?");
    const state = structuredClone(p.state);
    const statement = "A fictional finding statement that should stay out of the startup context.";
    state.investigations[0]!.status = "review";
    state.investigations[0]!.proposals.push({
      kind: "findings",
      id: "proposal-1",
      title: "The builder",
      changes: [],
      findings: Array.from({ length: 30 }, (_, n) => ({ id: `f${n}`, statement, status: "pending" })),
      status: "pending",
    } as never);
    const text = buildCoordinatorContext(state).text;
    expect(text).toContain("30 findings in 1 proposal");
    expect(text).not.toContain(statement);
    // What the human's screen shows, so the coordinator describes it in the app's words.
    expect(text).toContain("The human sees: 30 findings to read under Investigations, Findings; nothing in Review until you mark the batch ready.");
    state.investigations[0]!.readyAt = "2026-09-30T04:10:00Z";
    expect(buildCoordinatorContext(state).text).toContain("The human sees: 30 findings to read under Investigations, Findings; Create walkthrough in Review.");
    state.investigations[0]!.walkthroughRequestedAt = "2026-09-30T04:12:00Z";
    expect(buildCoordinatorContext(state).text).toContain("The human sees: 30 findings to read under Investigations, Findings; a walkthrough being written, not yet in Review.");
  });

  it("gives IDs the inspection commands can retrieve", () => {
    const p = project();
    const id = p.open("The mill's builder", "Who built the mill?");
    expect(buildCoordinatorContext(p.state).text).toContain(id);
    expect((inspectContext(p.state, { kind: "investigation", id }, []) as any).title).toBe("The mill's builder");
  });

  it("includes live workers and the human's saved preferences", () => {
    const p = project();
    const id = p.open("The mill's builder", "Who built the mill?");
    const state = {
      ...structuredClone(p.state),
      dispatch: {
        default: { agent: "claude" as const },
        roles: { researcher: { agent: "codex" as const, model: "gpt-6-sol", effort: "high" } },
        rules: [{ id: "r1", role: "helper" as const, when: "the task is a quick lookup", choose: { agent: "claude" as const, model: "haiku" }, reason: "It is cheap", by: "human" as const, at: "t" }],
      },
    };
    const context = buildCoordinatorContext(state, {
      workers: [{ role: "researcher", name: "Codex researcher", investigationId: id, startedAt: "t", latest: { at: "t", text: "Reading the parish register" } }],
      skills: [{ name: "present-research", description: "Write a walkthrough when the human asks for one." }],
    });
    expect(layer(context, "queue")).toContain("Worker: Codex researcher, Reading the parish register.");
    expect(layer(context, "orientation")).toContain("- researcher: codex, gpt-6-sol, high effort");
    expect(layer(context, "orientation")).toContain("- default: claude, its default model, its default effort");
    expect(layer(context, "orientation")).toContain("- rule for helper, when the task is a quick lookup: claude, haiku, its default effort (It is cheap; id r1)");
    expect(layer(context, "more")).toContain("present-research: Write a walkthrough");
  });

  it("keeps every layer within its budget as a project grows", () => {
    const p = project();
    for (let n = 0; n < 60; n++) p.open(`Fictional batch ${n} ${"about the harbour ".repeat(8)}`, `Question ${n} ${"on the mill ".repeat(20)}`);
    for (let n = 0; n < 40; n++) p.send(`Unplaced note ${n} ${"about the quay ".repeat(20)}`);
    const state = structuredClone(p.state);
    (state as any).coordination = { researchMap: "Map line about the fictional harbour.\n".repeat(400), handoff: "x".repeat(20_000) };
    const context = buildCoordinatorContext(state);
    for (const l of context.layers) expect(l.characters).toBeLessThanOrEqual(l.budget + 300);
    expect(context.layers.find((l) => l.id === "queue")!.omitted).toBeGreaterThan(0);
    expect(layer(context, "queue")).toContain("more batches; inspect investigations");
    const total = Object.values(layerBudgets).reduce((a, b) => a + b, 0);
    expect(context.text.length).toBeLessThanOrEqual(total + 1500);
  });
});
