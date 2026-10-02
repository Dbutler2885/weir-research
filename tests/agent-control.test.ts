// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import dataset from "./fixtures/workshop.json";
import { WorkspaceStore } from "../server/store.mjs";
import { ResearcherPool } from "../server/researchers.mjs";
import { GraphBuilders } from "../server/graph-builders.mjs";
import { WalkthroughWriters } from "../server/walkthrough-writers.mjs";
import { LiveActivity } from "../server/live-activity.mjs";
import { flowCommand } from "../server/review-flow.mjs";
import { affectedBy, controlledAgents, costLine, switchCost, type ControlledAgent } from "../src/domain/agent-control";
import { defaultDispatch, type Dispatch } from "../src/domain/dispatch";
import { emptyGraph, prepareResearch } from "./fixtures/guided-flow";
import { until } from "./fixtures/until";

const cleanups: (() => void)[] = [];
// Each pool is stopped, and its agents' processes have gone, before their folders are removed.
const pools: { stop(): void; active: Map<string, unknown> }[] = [];
afterEach(async () => {
  for (const pool of pools.splice(0)) {
    pool.stop();
    await until(() => pool.active.size === 0);
  }
  cleanups.splice(0).reverse().forEach((clean) => clean());
});

const executables: Record<string, string> = { claude: resolve("tests/fixtures/fake-claude.mjs"), codex: resolve("tests/fixtures/fake-codex.mjs") };
const findExecutable = (name: string) => executables[name] ?? null;
const other = (engine: string) => (engine === "claude" ? "codex" : "claude");

// Every turn reads a file slowly, reporting how much conversation it carries, so the
// agent is still at work when the human acts on it.
function slowly(engine: string, file: string) {
  const steps = join(mkdtempSync(join(tmpdir(), "weir-steps-")), "steps.json");
  cleanups.push(() => rmSync(join(steps, ".."), { recursive: true, force: true }));
  writeFileSync(
    steps,
    JSON.stringify([engine === "claude" ? { tool: "Read", input: { file_path: file }, tokens: 84_000, delay: 60_000 } : { command: `cat ${file}`, tokens: 84_000, delay: 60_000 }]),
  );
  for (const name of ["FAKE_CLAUDE_STEPS", "FAKE_CODEX_STEPS"]) {
    process.env[name] = steps;
    cleanups.push(() => delete process.env[name]);
  }
}
// What each start of the agent in a folder asked for: "start <model>" or "resume <model>".
const models = (folder: string) => (existsSync(join(folder, "models.txt")) ? readFileSync(join(folder, "models.txt"), "utf8").trim().split("\n") : []);

const agent = (over: Partial<ControlledAgent>): ControlledAgent => ({
  ref: { kind: "researcher", assignmentId: "a" },
  role: "researcher",
  who: "Researcher",
  activity: "Leases",
  status: "running",
  choice: { agent: "claude", model: "opus", effort: null },
  tokens: 84_000,
  ...over,
});

describe("what switching an agent costs", () => {
  it("re-reads the conversation on the same program, restarts from the checkpoint on another, and starts the coordinator fresh", () => {
    const researcher = agent({});
    expect(switchCost(researcher, { agent: "claude", model: "opus", effort: null })).toEqual({ kind: "unchanged" });
    expect(switchCost(researcher, { agent: "claude", model: "sonnet", effort: null })).toEqual({ kind: "rereads", tokens: 84_000 });
    // A cache belongs to one model and its settings, so a new effort re-reads too.
    expect(switchCost(researcher, { agent: "claude", model: "opus", effort: "high" })).toEqual({ kind: "rereads", tokens: 84_000 });
    expect(switchCost(researcher, { agent: "codex", model: null, effort: null })).toEqual({ kind: "restarts" });
    expect(switchCost(agent({ ref: { kind: "coordinator" }, role: "coordinator" }), { agent: "codex", model: null, effort: null })).toEqual({ kind: "fresh" });
    expect(costLine({ kind: "rereads", tokens: 84_000 })).toBe("It keeps its conversation. Its next turn re-reads about 84k tokens of it without the cache.");
    expect(costLine({ kind: "rereads", tokens: null })).toBe("It keeps its conversation. Its next turn re-reads all of it without the cache.");
    expect(costLine({ kind: "restarts" }, researcher.choice, { agent: "codex", model: null, effort: null })).toBe(
      "Codex cannot take over Claude Code's conversation, so it starts again from its last checkpoint. Its saved files are kept.",
    );
  });

  it("asks about the running agents still on what a changed role or default gave them", () => {
    const before: Dispatch = { ...defaultDispatch("claude"), roles: { "graph-builder": { agent: "claude", model: "opus", effort: null } } };
    const researcher = agent({ choice: { agent: "claude", model: null, effort: null } });
    const named = agent({ ref: { kind: "researcher", assignmentId: "b" }, choice: { agent: "codex", model: null, effort: null } });
    const paused = agent({ ref: { kind: "researcher", assignmentId: "c" }, status: "paused", choice: { agent: "claude", model: null, effort: null } });
    const builder = agent({ ref: { kind: "builder", jobId: "j" }, role: "graph-builder", choice: { agent: "claude", model: "opus", effort: null } });
    const all = [researcher, named, paused, builder];
    // The builder's role moves to a newer model: only the builder still on the old one is asked about.
    const newer = { ...before, roles: { "graph-builder": { agent: "claude" as const, model: "fable", effort: null } } };
    expect(affectedBy(all, before, newer)).toEqual([{ agent: builder, to: { agent: "claude", model: "fable", effort: null } }]);
    // The default changes: every running agent that follows it, but not one the coordinator named another agent for.
    const codex = { ...before, default: { agent: "codex" as const, model: null, effort: null } };
    expect(affectedBy(all, before, codex).map((a) => a.agent)).toEqual([researcher]);
    expect(affectedBy(all, before, before)).toEqual([]);
  });
});

describe.each(["claude", "codex"] as const)("a %s researcher the human controls", (engine) => {
  async function running() {
    const { Coordinator } = await import("../server/coordinator.mjs");
    const directory = mkdtempSync(join(tmpdir(), "weir-control-"));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    slowly(engine, "brief.md");
    const store = new WorkspaceStore(directory, dataset);
    const pool = new ResearcherPool(store, directory, resolve("."), { findExecutable });
    pools.push(pool);
    const coordinator = new Coordinator(store);
    const session = "coordinator-session-for-test-000005";
    coordinator.attach("Test coordinator", session);
    coordinator.researchers = pool;
    pool.coordinator = coordinator as any;
    pool.configure({ researchersPerBatch: 1 });
    const { investigationId: id } = store.command({ type: "annotate", question: "Investigate", target: { label: "Record" }, dispatch: true }) as any;
    store.update((next: any) => {
      next.investigations[0].number = 1;
    });
    const assign = (title: string) => (coordinator.command({ session, investigationId: id, action: "assign", engine, title, brief: `Trace ${title}.` }) as any).assignmentId;
    const first = assign("The lease registers");
    const second = assign("The trade directories");
    pool.pump();
    const batch = () => store.state.investigations.find((i: any) => i.id === id);
    const assignment = (a: string) => batch().assignments.find((x: any) => x.id === a);
    const agents = () => controlledAgents({ ...store.state, live: pool.live.list() } as any);
    await until(() => assignment(first).session && pool.live.list()[0]?.tokens === 84_000);
    return { store, pool, batch, assignment, agents, first, second };
  }

  it("pauses keeping its conversation and its place free, and resumes it in the same folder", async () => {
    const r = await running();
    expect(r.agents()).toEqual([
      expect.objectContaining({ ref: { kind: "researcher", assignmentId: r.first }, status: "running", choice: { agent: engine, model: null, effort: null }, tokens: 84_000 }),
    ]);
    const session = r.assignment(r.first).session;
    r.pool.pause(r.first);
    expect(r.assignment(r.first)).toMatchObject({ status: "paused", session });
    expect(r.batch().events.map((e: any) => e.message)).toContain('You paused the researcher on "The lease registers". It keeps its conversation until you resume it; do not steer it meanwhile.');
    // The batch's one place goes to the next assignment.
    await until(() => r.assignment(r.second).status === "running" && r.pool.active.has(r.second));
    await until(() => !r.pool.active.has(r.first));
    expect(r.agents().find((a) => a.ref.kind === "researcher" && a.ref.assignmentId === r.first)?.status).toBe("paused");
    r.pool.pause(r.second);
    r.pool.resume(r.first);
    await until(() => r.pool.active.has(r.first) && models(session.directory).length === 2);
    expect(models(session.directory)).toEqual(["start default", "resume default"]);
    expect(r.pool.active.get(r.first).directory).toBe(session.directory);
    await until(() => r.pool.live.list().some((w: any) => w.assignmentId === r.first));
    expect(r.assignment(r.first).session.id).toBe(session.id);
  });

  it("switches to another model keeping its conversation, and to another program starting afresh", async () => {
    const r = await running();
    const session = r.assignment(r.first).session;
    r.pool.switch(r.first, { agent: engine, model: "model-b", effort: null }, "the other model");
    const events = () => r.batch().events.map((e: any) => e.message);
    expect(events()).toContain(`You switched the researcher on "The lease registers" to the other model; it keeps its conversation.`);
    await until(() => models(session.directory).at(-1) === "resume model-b");
    await until(() => r.pool.live.list().some((w: any) => w.assignmentId === r.first && w.choice?.model === "model-b"));
    expect(r.assignment(r.first)).toMatchObject({ status: "running", choice: { engine, model: "model-b" }, session: { id: session.id } });
    r.pool.switch(r.first, { agent: other(engine), model: null, effort: null }, "the other program");
    expect(events()).toContain(`You switched the researcher on "The lease registers" to the other program; it starts again from its checkpoints.`);
    await until(() => r.assignment(r.first).session?.engine === other(engine));
    expect(r.assignment(r.first).session.directory).not.toBe(session.directory);
    expect(models(r.assignment(r.first).session.directory)).toEqual(["start default"]);
  });
});

describe.each(["claude", "codex"] as const)("a %s graph builder the human controls", (engine) => {
  async function running() {
    const directory = mkdtempSync(join(tmpdir(), "weir-control-graph-"));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    slowly(engine, "packet.json");
    const store = new WorkspaceStore(directory, emptyGraph);
    const research = prepareResearch(store);
    flowCommand(store, { action: "publish-walkthrough", ...research });
    store.update((next: any) => {
      next.engine = engine;
      next.investigations[0].number = 1;
    });
    const { jobId } = flowCommand(store, { action: "request-graph", investigationId: research.investigationId }, "human") as any;
    flowCommand(store, { action: "assign-graph", investigationId: research.investigationId, jobId, brief: "Represent the findings.", engine });
    const live = new LiveActivity();
    const start = () => {
      const pool = new GraphBuilders(store, directory, resolve("."), { findExecutable, live });
      pools.push(pool);
      pool.pump();
      return pool;
    };
    const job = () => store.state.investigations[0].reviewFlow.jobs.find((j: any) => j.id === jobId);
    const events = () => store.state.investigations[0].events.map((e: any) => e.message);
    const pool = start();
    await until(() => job().session && live.list()[0]?.tokens === 84_000);
    return { store, pool, start, job, jobId, live, events };
  }

  it("keeps its conversation through a pause, a switch of model and a closed app", async () => {
    const r = await running();
    const session = r.job().session;
    expect(session).toMatchObject({ engine, directory: expect.stringContaining(r.jobId) });
    expect(controlledAgents({ ...r.store.state, live: r.live.list() } as any)).toEqual([
      expect.objectContaining({ ref: { kind: "builder", jobId: r.jobId }, status: "running", tokens: 84_000 }),
    ]);
    r.pool.control("pause", r.jobId);
    expect(r.job().status).toBe("paused");
    await until(() => r.pool.active.size === 0 && r.live.list().length === 0);
    expect(r.events().at(-1)).toBe("You paused the graph builder. It keeps its conversation until you resume it.");
    process.env.FAKE_CLAUDE_RECORD = "1";
    cleanups.push(() => delete process.env.FAKE_CLAUDE_RECORD);
    r.pool.control("resume", r.jobId);
    await until(() => models(session.directory).length === 2 && r.live.list().length === 1);
    expect(models(session.directory)).toEqual(["start default", "resume default"]);
    // It is told it was stopped, once the resumed fake has the message.
    const received = join(session.directory, "received.jsonl");
    if (engine === "claude") await until(() => existsSync(received) && readFileSync(received, "utf8").includes("You were stopped partway through this graph draft"));
    r.pool.control("switch", r.jobId, { agent: engine, model: "model-b", effort: null }, "the other model");
    expect(r.events().at(-1)).toBe("You switched the graph builder to the other model; it keeps its conversation.");
    await until(() => models(session.directory).at(-1) === "resume model-b" && r.job().status === "running");
    // The app closes, stopping it; opening again picks up the same conversation.
    r.pool.stop();
    await until(() => r.live.list().length === 0);
    expect(r.job().session.id).toBe(session.id);
    r.start();
    await until(() => models(session.directory).length === 4);
    expect(models(session.directory).at(-1)).toBe("resume model-b");
  });

  it("starts afresh from its saved files on another program, or when its conversation is gone", async () => {
    const r = await running();
    const session = r.job().session;
    r.pool.control("pause", r.jobId);
    await until(() => r.pool.active.size === 0);
    r.store.update((next: any) => {
      next.investigations[0].reviewFlow.jobs[0].session.id = "a-session-that-is-gone";
    });
    r.pool.control("resume", r.jobId);
    await until(() => r.events().some((m: string) => m.includes("could not be picked up")));
    await until(() => r.job().session?.id && r.job().session.id !== "a-session-that-is-gone");
    expect(r.job().status).toBe("running");
    r.pool.control("switch", r.jobId, { agent: other(engine), model: null, effort: null }, "the other program");
    expect(r.events().at(-1)).toBe("You switched the graph builder to the other program; it starts again from its saved files.");
    await until(() => r.job().session?.engine === other(engine));
    expect(r.job().session.id).not.toBe(session.id);
  });
});

describe.each(["claude", "codex"] as const)("a %s walkthrough writer the human controls", (engine) => {
  async function running() {
    const directory = mkdtempSync(join(tmpdir(), "weir-control-writer-"));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    slowly(engine, "materials.json");
    const store = new WorkspaceStore(directory, emptyGraph);
    const research = prepareResearch(store);
    store.update((next: any) => {
      next.investigations[0].number = 1;
    });
    const id = research.investigationId;
    flowCommand(store, { action: "request-walkthrough", investigationId: id }, "human");
    flowCommand(store, { action: "assign-walkthrough", investigationId: id, engine, brief: "Explain the location." }, "coordinator");
    const live = new LiveActivity();
    const writers = new WalkthroughWriters(store, directory, resolve("."), { findExecutable, live });
    pools.push(writers);
    writers.pump();
    const writer = () => store.state.investigations[0].reviewFlow.writer;
    await until(() => writer().session && live.list()[0]?.tokens === 84_000);
    return { store, writers, writer, id, live };
  }

  it("keeps its conversation through a pause, and starts again on another program", async () => {
    const r = await running();
    const session = r.writer().session;
    r.writers.control("pause", r.id);
    expect(r.writer()).toMatchObject({ status: "paused", session });
    await until(() => r.live.list().length === 0);
    r.writers.control("resume", r.id);
    await until(() => models(session.directory).length === 2 && r.live.list().length === 1);
    expect(models(session.directory)).toEqual(["start default", "resume default"]);
    expect(r.writer().session.id).toBe(session.id);
    r.writers.control("switch", r.id, { agent: other(engine), model: null, effort: null }, "the other program");
    await until(() => r.writer().session?.engine === other(engine));
    expect(r.writer().session.directory).not.toBe(session.directory);
  });
});
