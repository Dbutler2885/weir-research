// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import dataset from "./fixtures/workshop.json";
import { WorkspaceStore } from "../server/store.mjs";
import { ResearcherPool } from "../server/researchers.mjs";
import { liveRows } from "../src/ui/live-panel";

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups
    .splice(0)
    .reverse()
    .forEach((clean) => clean());
});
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "pike-pool-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const store = new WorkspaceStore(directory, dataset);
  const launches: {
    child: any;
    options: any;
    executable: string;
    args: string[];
  }[] = [];
  const launch = (executable: string, args: string[], options: any) => {
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      exitCode: null,
      killed: false,
      kill() {
        this.killed = true;
        this.exitCode = 1 as any;
      },
    });
    launches.push({ child, options, executable, args });
    return child;
  };
  const pool = new ResearcherPool(store, directory, resolve("."), {
    launch: launch as any,
    findExecutable: (name: string) => `/test/${name}`,
  });
  cleanups.push(() => pool.stop());
  const queue = () =>
    (
      store.command({
        type: "annotate",
        question: "Investigate fixture",
        target: { label: "Fixture record" },
        dispatch: true,
      }) as any
    ).investigationId;
  return { directory, store, pool, launches, queue, live: pool.live };
}
describe("local researcher supervision", () => {
  it("defaults to no time limit and tells the worker there is no deadline", () => {
    const f = fixture();
    const id = f.queue();
    f.pool.choose("claude");
    const task = f.pool.active.get(id);
    task.started = Date.now() - 24 * 60 * 60_000;
    f.pool.pump();
    expect(f.launches[0]!.child.killed).toBe(false);
    expect(f.store.state.investigations[0].status).toBe("running");
    expect(f.launches[0]!.args.join(" ")).toContain("No elapsed-time limit");
    expect(f.launches[0]!.args.join(" ")).not.toContain("within ten minutes");
  });
  it("persists optional limits, snapshots each pass, and retains checkpoints on expiry", () => {
    const f = fixture();
    for (const value of [0, -1, 1.5, "10", undefined, Infinity])
      expect(() => f.pool.configure({ timeLimitMinutes: value })).toThrow(
        "positive whole number",
      );
    f.pool.configure({ timeLimitMinutes: 2 });
    const reopened = new WorkspaceStore(f.directory, dataset);
    expect(reopened.state.researchSettings.timeLimitMinutes).toBe(2);
    const id = f.queue();
    f.pool.choose("claude");
    expect(f.launches[0]!.args.join(" ")).toContain("2-minute time limit");
    const task = f.pool.active.get(id);
    f.pool.configure({ timeLimitMinutes: null });
    expect(task.timeLimitMinutes).toBe(2);
    writeFileSync(
      join(task.directory, "checkpoint.json"),
      JSON.stringify({
        summary: "Partial result",
        findings: "Fictional archive inspected",
        nextSteps: "Compare another source",
      }),
    );
    task.started = Date.now() - 60_000;
    f.pool.pump();
    expect(f.launches[0]!.child.killed).toBe(false);
    task.started = Date.now() - 2 * 60_000;
    f.pool.pump();
    expect(f.launches[0]!.child.killed).toBe(true);
    expect(f.store.state.investigations[0].status).toBe("paused");
    expect(f.store.state.investigations[0].checkpoints).toHaveLength(1);
    expect(f.store.state.investigations[0].events.at(-1).message).toContain(
      "2-minute time limit",
    );
    expect(
      JSON.parse(readFileSync(join(f.directory, "workspace.json"), "utf8"))
        .researchSettings.timeLimitMinutes,
    ).toBeNull();
    f.launches[0]!.child.emit("close", 1);
    f.store.command({ type: "resume", investigationId: id });
    f.pool.pump();
    expect(f.pool.active.get(id).timeLimitMinutes).toBeNull();
  });
  it("launches only after selecting an engine and bounds concurrent investigations", () => {
    const f = fixture();
    f.queue();
    f.queue();
    f.queue();
    f.pool.pump();
    expect(f.launches).toHaveLength(0);
    f.pool.choose("codex");
    expect(f.launches).toHaveLength(2);
    expect(f.launches[0]!.args).toEqual(["app-server"]);
    expect(f.store.state.investigations.map((i: any) => i.status)).toEqual([
      "running",
      "running",
      "queued",
    ]);
  });
  it("saves checkpoints and turns a worker result into a pending proposal without applying it", () => {
    const f = fixture();
    f.queue();
    f.pool.choose("codex");
    const process = f.launches[0]!;
    writeFileSync(
      join(process.options.cwd, "checkpoint.json"),
      JSON.stringify({
        summary: "Searched",
        findings: "No original found",
        nextSteps: "Inspect archive",
      }),
    );
    f.pool.pump();
    f.pool.pump();
    expect(f.store.state.investigations[0]!.checkpoints).toHaveLength(1);
    writeFileSync(
      join(process.options.cwd, "result.json"),
      JSON.stringify({
        title: "Still unresolved",
        summary: "Original not found",
        ambiguity: "Identity remains open",
        evidence: [],
        changes: [],
      }),
    );
    process.child.emit("close", 0);
    expect(f.store.state.investigations[0]!.status).toBe("review");
    expect(f.store.state.investigations[0]!.proposals[0]!.status).toBe(
      "pending",
    );
    expect(f.store.state.dataset).toEqual(dataset);
  });
  it("terminates replaced work and starts a replacement with the selected provider", () => {
    const f = fixture();
    const id = f.queue();
    f.pool.choose("codex");
    const old = f.launches[0]!;
    f.pool.choose("claude");
    f.store.command({ type: "resume", investigationId: id });
    f.pool.pump();
    expect(old.child.killed).toBe(true);
    old.child.emit("close", 1);
    expect(f.launches).toHaveLength(2);
    expect(f.launches[1]!.executable).toBe("/test/claude");
    expect(f.store.state.investigations[0]!.executions.at(-1).provider).toBe(
      "claude",
    );
    expect(f.store.state.investigations[0]!.lease!.worker).toBe(
      "Claude Code researcher",
    );
  });
  it("pauses failures rather than entering an automatic retry loop", () => {
    const f = fixture();
    f.queue();
    f.pool.choose("claude");
    f.launches[0]!.child.emit("close", 1);
    f.pool.pump();
    expect(f.store.state.investigations[0]!.status).toBe("paused");
    expect(f.launches).toHaveLength(1);
  });
  it("pauses interrupted managed jobs on restart so old results cannot publish", () => {
    const f = fixture();
    const id = f.queue();
    f.pool.choose("codex");
    const token = f.store.state.investigations[0]!.lease!.token;
    f.pool.stop();
    const restarted = new ResearcherPool(f.store, f.directory, resolve("."));
    cleanups.push(() => restarted.stop());
    expect(f.store.state.investigations[0]!.status).toBe("paused");
    expect(() =>
      f.store.command({
        type: "checkpoint",
        investigationId: id,
        token,
        summary: "late",
        findings: "late",
        nextSteps: "late",
      }),
    ).toThrow("lease");
  });
});

describe("coordinator-managed research processes", () => {
  it("requires a coordinator brief and holds results for synthesis even when a provider is selected", async () => {
    const { Coordinator } = await import("../server/coordinator.mjs");
    const f = fixture();
    const coordinator = new Coordinator(f.store);
    const session = "coordinator-session-for-test-000001";
    coordinator.attach("Test coordinator", session);
    f.pool.coordinator = coordinator as any;
    const id = f.queue();
    f.pool.choose("codex");
    expect(f.launches).toHaveLength(0);
    coordinator.command({
      action: "assign",
      session,
      investigationId: id,
      brief: "Compare the two identities; preserve ambiguity.",
    });
    f.pool.pump();
    expect(f.launches).toHaveLength(1);
    const process = f.launches[0]!;
    const { readFileSync } = await import("node:fs");
    const brief = JSON.parse(
      readFileSync(join(process.options.cwd, "brief.json"), "utf8"),
    );
    expect(brief.coordinatorBrief).toContain("two identities");
    expect(brief.investigation.lease.token).toBeUndefined();
    writeFileSync(
      join(process.options.cwd, "result.json"),
      JSON.stringify({
        title: "Unresolved",
        summary: "Two identities",
        ambiguity: "No primary evidence yet",
        evidence: [],
        changes: [],
      }),
    );
    process.child.emit("close", 0);
    expect(f.store.state.investigations[0]!.proposals).toHaveLength(0);
    expect(coordinator.candidates()).toHaveLength(1);
    f.pool.stop();
    const restarted = new ResearcherPool(f.store, f.directory, resolve("."), {
      coordinator,
    } as any);
    cleanups.push(() => restarted.stop());
    expect(f.store.state.investigations[0]!.status).toBe("running");
    expect(coordinator.candidates()).toHaveLength(1);
  });
});

describe("steerable researchers", () => {
  async function steerable() {
    const { Coordinator } = await import("../server/coordinator.mjs");
    const f = fixture();
    const coordinator = new Coordinator(f.store);
    const session = "coordinator-session-for-test-000002";
    coordinator.attach("Test coordinator", session);
    coordinator.researchers = f.pool;
    f.pool.coordinator = coordinator as any;
    const id = f.queue();
    f.pool.choose("claude");
    coordinator.command({ action: "assign", session, investigationId: id, engine: "claude", brief: "Trace the fixture record." });
    f.pool.pump();
    const process = f.launches.at(-1)!;
    const input: any[] = [];
    let pending = "";
    process.child.stdin.on("data", (chunk: Buffer) => {
      pending += chunk.toString();
      const lines = pending.split("\n");
      pending = lines.pop()!;
      input.push(...lines.map((l) => JSON.parse(l)));
    });
    const say = (event: object) => process.child.stdout.write(`${JSON.stringify(event)}\n`);
    const command = (data: object) => coordinator.command({ session, investigationId: id, ...data });
    const investigation = () => f.store.state.investigations.find((i: any) => i.id === id);
    return { ...f, id, coordinator, process, input, say, command, investigation };
  }
  const result = { title: "Unresolved", summary: "Two identities", ambiguity: "Open", evidence: [], changes: [] };

  it("keeps its input open and receives the assignment as its first message", async () => {
    const s = await steerable();
    await new Promise((done) => setImmediate(done));
    expect(s.process.args).toEqual(expect.arrayContaining(["--input-format", "stream-json"]));
    expect(s.process.child.stdin.writableEnded).toBe(false);
    expect(s.input[0]).toMatchObject({ type: "user", message: { content: expect.stringContaining("brief.json") } });
  });

  it("delivers the coordinator's redirection to the running researcher", async () => {
    const s = await steerable();
    expect(s.command({ action: "steer", message: "Focus on the 1880 census instead." })).toEqual({ steered: true });
    await new Promise((done) => setImmediate(done));
    expect(s.input.at(-1)).toEqual({ type: "user", message: { role: "user", content: "Focus on the 1880 census instead." } });
    expect(s.investigation().events.at(-1).message).toBe("Coordinator redirected the researcher: Focus on the 1880 census instead.");
    expect(s.coordinator.status().latest!.text).toBe("Redirecting the researcher on a batch");
    expect(() => s.command({ action: "steer", message: " " })).toThrow("A redirection must be text");
  });

  it("stops a researcher outright, pausing the batch with the coordinator's reason", async () => {
    const s = await steerable();
    s.say({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "brief.json" } }] } });
    expect(s.live.list()).toHaveLength(1);
    expect(s.command({ action: "stop-researcher", reason: "The human withdrew this question." })).toEqual({ stopped: true });
    expect(s.process.child.killed).toBe(true);
    expect(s.investigation().status).toBe("paused");
    expect(s.investigation().events.at(-1).message).toBe("Coordinator stopped the researcher: The human withdrew this question.");
    s.process.child.emit("close", null);
    expect(s.live.list()).toEqual([]);
    expect(s.investigation().status).toBe("paused");
    s.store.update((next: any) => {
      next.investigations.find((i: any) => i.id === s.id).number = 1;
    });
    expect(liveRows({ ...s.store.state, live: s.live.list() } as any)).toContainEqual({
      who: "Researcher",
      batch: { id: s.id, number: 1 },
      stage: "Paused. Coordinator stopped the researcher: The human withdrew this question.",
    });
    expect(() => s.command({ action: "steer", message: "Too late" })).toThrow("No researcher is running");
  });

  it("closes once its turn ends with its findings written", async () => {
    const s = await steerable();
    writeFileSync(join(s.process.options.cwd, "result.json"), JSON.stringify(result));
    s.say({ type: "result", subtype: "success", result: "Done." });
    expect(s.process.child.stdin.writableEnded).toBe(true);
    s.process.child.emit("close", 0);
    expect(s.coordinator.candidates()).toHaveLength(1);
    expect(s.pool.active.size).toBe(0);
  });

  it("waits for the coordinator when a turn ends without findings", async () => {
    const s = await steerable();
    s.say({ type: "result", subtype: "success", result: "I could not find the register." });
    expect(s.process.child.stdin.writableEnded).toBe(false);
    expect(s.investigation().status).toBe("running");
    expect(s.investigation().events.at(-1).message).toContain("waiting for instructions");
    s.command({ action: "steer", message: "Write up what you found as unresolved." });
    expect(s.pool.active.get(s.id).agent.busy).toBe(true);
  });
});

describe.each(["claude", "codex"] as const)("a %s researcher under the coordinator", (engine) => {
  const executables = { claude: resolve("tests/fixtures/fake-claude.mjs"), codex: resolve("tests/fixtures/fake-codex.mjs") };
  const until = async (check: () => unknown) => {
    for (let n = 0; n < 200 && !check(); n++) await new Promise((done) => setTimeout(done, 10));
    expect(check()).toBeTruthy();
  };
  async function running() {
    const { Coordinator } = await import("../server/coordinator.mjs");
    const directory = mkdtempSync(join(tmpdir(), "pike-steer-"));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    const store = new WorkspaceStore(directory, dataset);
    const pool = new ResearcherPool(store, directory, resolve("."), { findExecutable: (name: string) => (executables as any)[name] });
    cleanups.push(() => pool.stop());
    const coordinator = new Coordinator(store);
    const session = "coordinator-session-for-test-000003";
    coordinator.attach("Test coordinator", session);
    coordinator.researchers = pool;
    pool.coordinator = coordinator as any;
    const { investigationId: id } = store.command({ type: "annotate", question: "Investigate", target: { label: "Record" }, dispatch: true }) as any;
    const command = (data: object) => coordinator.command({ session, investigationId: id, ...data });
    command({ action: "assign", engine, brief: "Trace the fixture record." });
    pool.pump();
    const investigation = () => store.state.investigations.find((i: any) => i.id === id);
    const events = () => investigation().events.map((e: any) => e.message);
    return { pool, coordinator, command, investigation, events, until };
  }
  const result = JSON.stringify({ title: "Unresolved", summary: "Two identities", ambiguity: "Open", evidence: [], changes: [] });
  const write = engine === "claude"
    ? { tool: "Write", input: { file_path: "result.json" }, writes: { "result.json": result } }
    : { change: "result.json", writes: { "result.json": result } };
  const slow = engine === "claude" ? { tool: "Read", input: { file_path: "brief.json" }, delay: 10_000 } : { command: "cat brief.json", delay: 10_000 };

  it("waits for instructions, takes a redirection, and closes once its findings are written", async () => {
    const r = await running();
    await r.until(() => r.events().some((m: string) => m.includes("waiting for instructions")));
    expect(r.command({ action: "steer", message: `steps:${JSON.stringify([write])}` })).toEqual({ steered: true });
    await r.until(() => r.coordinator.candidates().length === 1);
    await r.until(() => r.pool.active.size === 0);
    expect(r.pool.live.list()).toEqual([]);
  });

  it("stops mid-run when the coordinator says so", async () => {
    const r = await running();
    await r.until(() => r.events().some((m: string) => m.includes("waiting for instructions")));
    r.command({ action: "steer", message: `steps:${JSON.stringify([slow])}` });
    await r.until(() => r.pool.live.list()[0]?.latest?.text === "Reading its assignment");
    r.command({ action: "stop-researcher", reason: "Wrong direction." });
    await r.until(() => r.pool.active.size === 0);
    expect(r.investigation().status).toBe("paused");
    expect(r.events().at(-1)).toBe("Coordinator stopped the researcher: Wrong direction.");
    expect(r.pool.live.list()).toEqual([]);
  });
});
