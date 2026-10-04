// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import dataset from "./fixtures/workshop.json";
import { changeDispatch, cheapChoice, choose, defaultDispatch, validateDispatch, type Catalog } from "../src/domain/dispatch";
import { agentCatalog } from "../server/agents/catalog.mjs";
import { DispatchRules } from "../server/dispatch.mjs";
import { WorkspaceStore } from "../server/store.mjs";
import { Coordinator } from "../server/coordinator.mjs";
import { Helpers } from "../server/helpers.mjs";
import { AgentSupervisor } from "../server/agents/supervisor.mjs";
import { LiveActivity } from "../server/live-activity.mjs";
import { liveRows } from "../src/ui/live-panel";
import { until } from "./fixtures/until";

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).reverse().forEach((clean) => clean()));

// What `codex debug models` and `claude --help` report, trimmed.
const codexModels = JSON.stringify({
  models: [
    { slug: "gpt-6-sol", display_name: "GPT-6-Sol", visibility: "list", supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }, { effort: "ultra" }] },
    { slug: "gpt-hidden", display_name: "Hidden", visibility: "hide", supported_reasoning_levels: [{ effort: "low" }] },
  ],
});
const claudeHelp = "  --effort <level>   Effort level for the current session\n                     (low, medium, high, xhigh, max)\n  --model <model>   Provide an alias for the latest model (e.g. 'fable', 'opus', or 'sonnet')\n";
// What Claude Code answers when asked to initialize, trimmed: its current models, then older ones.
const model = (value: string, displayName: string, efforts?: string[]) => ({ value, displayName, ...(efforts ? { supportedEffortLevels: efforts } : {}) });
const claudeList = JSON.stringify({
  type: "control_response",
  response: {
    subtype: "success",
    request_id: "models",
    response: {
      models: [
        model("default", "Default (recommended)", ["low", "high"]),
        model("opus", "Opus 5.5", ["low", "medium", "high", "xhigh", "max"]),
        model("claude-fable-5-1", "Fable 5.1", ["low", "high", "max"]),
        model("haiku", "Haiku 4.5"),
        model("claude-opus-5", "Opus 5", ["low", "high"]),
      ],
    },
  },
});
let claudeAnswers = true;
const run = async (command: string, args: string[]) =>
  command === "codex" ? codexModels : args.includes("--help") ? claudeHelp : claudeAnswers ? `${claudeList}\n` : "";
const catalogOf = async (installed = ["claude", "codex"]): Promise<Catalog> =>
  (await agentCatalog({ findExecutable: (name: string) => (installed.includes(name) ? `/bin/${name}` : null), run })) as Catalog;
const both = await catalogOf();
const claudeOnly = await catalogOf(["claude"]);
const catalog = (installed?: string[]) => (installed?.length === 1 ? claudeOnly : both);
const now = "2026-09-25T12:00:00.000Z";
let n = 0;
const id = () => `rule-${++n}`;

describe("what the installed CLIs offer", () => {
  it("lists Codex's own models and efforts, never an effort that delegates to other agents", () => {
    const codex = catalog().agents.find((a) => a.id === "codex")!;
    expect(codex.models).toEqual([{ id: "gpt-6-sol", label: "GPT-6-Sol", efforts: ["low", "high"] }]);
    expect(codex.efforts).toEqual(["low", "high"]);
  });
  it("lists the models Claude Code names itself, offering each kind's current one by the alias that follows new versions", () => {
    const claude = catalog().agents.find((a) => a.id === "claude")!;
    expect(claude.models).toEqual([
      { id: "opus", label: "Opus 5.5", efforts: ["low", "medium", "high", "xhigh", "max"] },
      { id: "fable", label: "Fable 5.1", efforts: ["low", "high", "max"] },
      { id: "claude-fable-5-1", label: "Fable 5.1", efforts: ["low", "high", "max"], older: true },
      { id: "haiku", label: "Haiku 4.5", efforts: [] },
      { id: "claude-opus-5", label: "Opus 5", efforts: ["low", "high"], older: true },
    ]);
    expect(claude.efforts).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });
  it("falls back to Claude Code's aliases when it cannot list its models", async () => {
    claudeAnswers = false;
    const claude = (await catalogOf()).agents.find((a) => a.id === "claude")!;
    claudeAnswers = true;
    expect(claude.models.map((m) => m.id)).toEqual(["fable", "opus", "sonnet", "haiku"]);
    expect(claude.efforts).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });
  it("marks a CLI that is not installed", () => {
    expect(catalog(["claude"]).agents.map((a) => [a.id, a.installed])).toEqual([["claude", true], ["codex", false]]);
  });
});

describe("dispatch rules", () => {
  it("use one CLI with its own defaults for every role in a new project", () => {
    const doc = defaultDispatch("claude");
    for (const role of ["coordinator", "researcher", "graph-builder", "walkthrough-writer", "helper"] as const)
      expect(choose(doc, role)).toEqual({ agent: "claude" });
  });
  it("prefer what is named for an assignment, then the role's entry, then the default", () => {
    const doc = changeDispatch(defaultDispatch("claude"), { action: "set-role", role: "researcher", agent: "codex", model: "gpt-6-sol", effort: "high" }, catalog(), "human", id, now);
    expect(choose(doc, "researcher")).toEqual({ agent: "codex", model: "gpt-6-sol", effort: "high" });
    expect(choose(doc, "helper")).toEqual({ agent: "claude", model: null, effort: null });
    expect(choose(doc, "researcher", { agent: "claude", model: "haiku" })).toEqual({ agent: "claude", model: "haiku", effort: null });
    const back = changeDispatch(doc, { action: "set-role", role: "researcher" }, catalog(), "human", id, now);
    expect(back.roles).toEqual({});
  });
  it("give readers Codex's Luna at high effort, or without Codex the default agent's cheapest model, unless the human chose", () => {
    const luna = { id: "gpt-6-luna", label: "GPT-6-Luna", efforts: ["low", "high", "max"] };
    const withLuna: Catalog = { agents: catalog().agents.map((a) => (a.id === "codex" ? { ...a, models: [...a.models, luna, { id: "gpt-5.6-luna", label: "GPT-5.6-Luna", efforts: ["low"] }] } : a)) };
    const doc = defaultDispatch("claude");
    expect(choose(doc, "reader", null, withLuna)).toEqual({ agent: "codex", model: "gpt-6-luna", effort: "high" });
    // Codex is not installed: Claude Code's cheapest, at the effort it offers.
    expect(choose(doc, "reader", null, catalog(["claude"]))).toEqual({ agent: "claude", model: "haiku", effort: null });
    // Codex is the default and lists no cheap model: readers use the default as it is.
    expect(cheapChoice(catalog(), { agent: "codex", model: "gpt-6-sol", effort: "low" })).toEqual({ agent: "codex", model: "gpt-6-sol", effort: "low" });
    // The other roles still follow the default, and a reader the human set follows that.
    expect(choose(doc, "researcher", null, withLuna)).toEqual({ agent: "claude" });
    const set = changeDispatch(doc, { action: "set-role", role: "reader", agent: "claude", model: "opus", effort: "low" }, withLuna, "human", id, now);
    expect(choose(set, "reader", null, withLuna)).toEqual({ agent: "claude", model: "opus", effort: "low" });
    const directory = mkdtempSync(join(tmpdir(), "dispatch-"));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    const store = new WorkspaceStore(directory, structuredClone(dataset));
    store.update((next: any) => (next.dispatch = doc));
    expect(new DispatchRules(store, withLuna).choose("reader")).toEqual({ agent: "codex", model: "gpt-6-luna", effort: "high" });
  });
  it("add and remove rules with a condition, a choice and a reason", () => {
    const doc = changeDispatch(defaultDispatch("claude"), { action: "add-rule", role: "helper", when: "a quick lookup", agent: "claude", model: "haiku", reason: "Cheap" }, catalog(), "coordinator", id, now);
    expect(doc.rules).toEqual([{ id: expect.any(String), role: "helper", when: "a quick lookup", choose: { agent: "claude", model: "haiku", effort: null }, reason: "Cheap", by: "coordinator", at: now }]);
    expect(changeDispatch(doc, { action: "remove-rule", ruleId: doc.rules[0]!.id }, catalog(), "human", id, now).rules).toEqual([]);
  });
  it("refuse a malformed rule with a clear message", () => {
    const base = defaultDispatch("claude");
    const change = (command: Record<string, unknown>, c = catalog()) => () => changeDispatch(base, command, c, "human", id, now);
    expect(change({ action: "set-role", role: "janitor", agent: "claude" })).toThrow('Choose a role, one of default, coordinator, researcher');
    expect(change({ action: "set-role", role: "helper", agent: "gemini" })).toThrow("the agent must be claude or codex");
    expect(change({ action: "set-role", role: "helper", agent: "codex" }, catalog(["claude"]))).toThrow("Codex is not installed");
    expect(change({ action: "set-role", role: "helper", agent: "codex", model: "gpt-9" })).toThrow('Codex does not offer the model "gpt-9". Choose one of: gpt-6-sol.');
    expect(change({ action: "set-role", role: "helper", agent: "codex", model: "gpt-6-sol", effort: "ultra" })).toThrow('effort "ultra" is not offered for gpt-6-sol. Choose one of: low, high.');
    expect(change({ action: "add-rule", role: "helper", agent: "claude", reason: "Cheap" })).toThrow("say when it applies");
    expect(change({ action: "add-rule", role: "helper", when: "always", agent: "claude" })).toThrow("give the reason");
    expect(change({ action: "remove-rule", ruleId: "nope" })).toThrow("That rule does not exist.");
    expect(() => validateDispatch({ default: { agent: "claude" }, roles: { chef: { agent: "claude" } } }, catalog())).toThrow('Unknown role "chef"');
  });
});

function project() {
  const directory = mkdtempSync(join(tmpdir(), "dispatch-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const store = new WorkspaceStore(directory, dataset);
  const rules = new DispatchRules(store, catalog());
  const coordinator = new Coordinator(store);
  coordinator.dispatch = rules;
  const session = "coordinator-session-for-dispatch-01";
  coordinator.attach("Test coordinator", session);
  return { directory, store, rules, coordinator, session };
}

describe("dispatch rules in a project", () => {
  it("start from the saved engine preference, or the first installed CLI", () => {
    const p = project();
    expect(p.rules.ensure()).toEqual(defaultDispatch("claude"));
    const other = project();
    other.store.update((next: any) => {
      delete next.dispatch;
      next.engine = "codex";
    });
    expect(other.rules.ensure()).toEqual(defaultDispatch("codex"));
  });

  it("take a preference the human states through the coordinator", () => {
    const p = project();
    p.coordinator.command({ action: "set-role", session: p.session, role: "researcher", agent: "codex", model: "gpt-6-sol", effort: "high" });
    expect(p.store.state.dispatch.roles.researcher).toEqual({ agent: "codex", model: "gpt-6-sol", effort: "high" });
    expect(p.coordinator.status().latest!.text).toBe("Updating who does which job");
  });

  it("choose the agent, model and effort of a new batch's researchers", () => {
    const p = project();
    p.rules.change({ action: "set-role", role: "researcher", agent: "codex", model: "gpt-6-sol", effort: "low" }, "human");
    p.coordinator.command({ action: "open-batch", session: p.session, title: "Look", goal: "Look into the fictional record." });
    const seats = p.store.state.investigations[0].assignments;
    expect(seats).toHaveLength(4);
    for (const seat of seats) expect(seat.choice).toEqual({ engine: "codex", model: "gpt-6-sol", effort: "low" });
    // What the coordinator names for one batch wins over the role's entry.
    p.coordinator.command({ action: "open-batch", session: p.session, title: "Look again", goal: "Look again.", engine: "claude", model: "opus" });
    expect(p.store.state.investigations[1].assignments[0].choice).toEqual({ engine: "claude", model: "opus", effort: null });
  });
});

describe("helpers", () => {
  it("do a small task and send the answer back to the coordinator", async () => {
    const p = project();
    const live = new LiveActivity();
    const answers: string[] = [];
    const helpers = new Helpers(p.store, p.directory, {
      live,
      supervisor: new AgentSupervisor({ live, stopGrace: 200 }),
      dispatch: p.rules,
      findExecutable: () => resolve("tests/fixtures/fake-claude.mjs"),
      answer: (text: string) => answers.push(text),
    });
    cleanups.push(() => helpers.stop());
    expect(() => helpers.ask({ task: " " })).toThrow("Describe the helper's task");
    helpers.ask({ task: 'steps:[{"tool":"Read","input":{"file_path":"AGENTS.md"},"delay":200}]' });
    const row = () => liveRows({ investigations: [], conversation: [], live: live.list() } as any)[0];
    await until(() => row()?.latest === "Reading its instructions");
    expect(row()).toMatchObject({ who: "Claude helper", latest: "Reading its instructions" });
    await until(() => answers.length);
    expect(answers[0]).toContain("Your helper finished");
    expect(answers[0]).toContain("Done.");
  });
});
