// @vitest-environment node
import { assignQueued, assignmentOf } from "./fixtures/assign";
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
import { until } from "./fixtures/until";

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups
    .splice(0)
    .reverse()
    .forEach((clean) => clean());
});
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "weir-pool-"));
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
  // The researcher working on a batch's latest assignment.
  const task = (id: string) => pool.active.get(assignmentOf(store, id).id);
  return { directory, store, pool, launches, queue, task, live: pool.live };
}
describe("local researcher supervision", () => {
  it("defaults to no time limit and tells the worker there is no deadline", () => {
    const f = fixture();
    const id = f.queue();
    assignQueued(f.store, f.pool, "claude");
    const task = f.task(id);
    task.started = Date.now() - 24 * 60 * 60_000;
    f.pool.pump();
    expect(f.launches[0]!.child.killed).toBe(false);
    expect(f.store.state.investigations[0].status).toBe("running");
    expect(f.launches[0]!.args.join(" ")).toContain("No elapsed-time limit");
    expect(f.launches[0]!.args.join(" ")).not.toContain("within ten minutes");
    // Checkpoints hold discoveries; progress comes from the stream.
    expect(f.launches[0]!.args.join(" ")).toContain("not progress reports");
    expect(f.launches[0]!.args.join(" ")).not.toMatch(/status\.(txt|json)/);
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
    assignQueued(f.store, f.pool, "claude");
    expect(f.launches[0]!.args.join(" ")).toContain("2-minute time limit");
    const task = f.task(id);
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
    expect(assignmentOf(f.store, id)).toMatchObject({ status: "paused" });
    expect(assignmentOf(f.store, id).checkpoints).toHaveLength(1);
    expect(f.store.state.investigations[0].events.at(-1).message).toContain(
      "2-minute time limit",
    );
    expect(
      JSON.parse(readFileSync(join(f.directory, "workspace.json"), "utf8"))
        .researchSettings.timeLimitMinutes,
    ).toBeNull();
    f.launches[0]!.child.emit("close", 1);
    // Resumed, the same assignment starts again, under the setting now in force.
    f.store.command({ type: "resume", investigationId: id });
    f.pool.pump();
    expect(f.task(id).timeLimitMinutes).toBeNull();
  });
  it("launches only on the coordinator's assignments, and limits researchers per batch, not in all", () => {
    const f = fixture();
    expect(() => f.pool.configure({ researchersPerBatch: 0 })).toThrow("from 1 to 20");
    f.pool.configure({ researchersPerBatch: 2 });
    expect(f.store.state.researchSettings).toEqual({ timeLimitMinutes: null, researchersPerBatch: 2 });
    f.queue();
    f.queue();
    f.queue();
    f.pool.pump();
    expect(f.launches).toHaveLength(0);
    // Three batches with one assignment each: the limit is per batch, so all three start.
    assignQueued(f.store, f.pool, "codex");
    expect(f.launches).toHaveLength(3);
    expect(f.launches[0]!.args[0]).toBe("app-server");
  });
  it("runs a batch's assignments together up to the limit, and starts the next in order when one finishes", () => {
    const f = fixture();
    f.pool.configure({ researchersPerBatch: 2 });
    const id = f.queue();
    const coordinator = assignQueued(f.store, f.pool, "codex");
    for (const title of ["Second part", "Third part"])
      coordinator.command({ action: "assign", session: coordinator.session.secret, investigationId: id, engine: "codex", title, brief: `Look into the ${title.toLowerCase()}.` });
    f.pool.pump();
    const assignments = () => f.store.state.investigations[0].assignments;
    expect(f.launches).toHaveLength(2);
    expect(assignments().map((a: any) => a.status)).toEqual(["running", "running", "waiting"]);
    expect(f.store.state.investigations[0].status).toBe("running");
    // Each has its own folder, and reads its own brief.
    expect(f.launches[0]!.options.cwd).not.toBe(f.launches[1]!.options.cwd);
    expect(readFileSync(join(f.launches[1]!.options.cwd, "brief.md"), "utf8")).toContain("Look into the second part.");
    writeFileSync(join(f.launches[0]!.options.cwd, "result.json"), JSON.stringify({ title: "First", summary: "S", ambiguity: "A", evidence: [], changes: [] }));
    f.launches[0]!.child.emit("close", 0);
    expect(assignments().map((a: any) => a.status)).toEqual(["returned", "running", "running"]);
    expect(f.launches).toHaveLength(3);
    expect(readFileSync(join(f.launches[2]!.options.cwd, "brief.md"), "utf8")).toContain("# Third part");
  });
  it("posts what a researcher writes for its batch to the others at work, and keeps it on the board", async () => {
    const f = fixture();
    const id = f.queue();
    const coordinator = assignQueued(f.store, f.pool, "claude");
    coordinator.command({ action: "assign", session: coordinator.session.secret, investigationId: id, engine: "claude", title: "Second part", brief: "Look elsewhere." });
    f.pool.pump();
    const other = f.launches[1]!;
    const input: string[] = [];
    other.child.stdin.on("data", (chunk: Buffer) => input.push(chunk.toString()));
    const post = join(f.launches[0]!.options.cwd, "post.md");
    writeFileSync(post, "The 1881 register is missing from the scans; don't look for it online.");
    // A post being written is left until it has settled.
    f.pool.pump();
    expect(f.store.state.investigations[0].board).toBeUndefined();
    const { utimesSync, existsSync } = await import("node:fs");
    utimesSync(post, new Date(Date.now() - 5000), new Date(Date.now() - 5000));
    f.pool.pump();
    expect(f.store.state.investigations[0].board).toEqual([
      expect.objectContaining({ assignmentId: f.store.state.investigations[0].assignments[0].id, text: "The 1881 register is missing from the scans; don't look for it online." }),
    ]);
    expect(existsSync(post)).toBe(false);
    await new Promise((done) => setImmediate(done));
    expect(input.join("")).toContain('A post on your batch\'s board, from the researcher on \\"Fixture assignment\\"');
    // The library keeps it for researchers who start later.
    const { writeLibrary } = await import("../server/research-library.mjs");
    writeLibrary(f.store.state, f.directory);
    expect(readFileSync(join(f.directory, "library", "batches", `investigation-${id}`, "board.md"), "utf8")).toContain("The 1881 register is missing");
  });
  it("saves checkpoints and holds a worker's result for the coordinator, applying nothing", () => {
    const f = fixture();
    f.queue();
    const coordinator = assignQueued(f.store, f.pool, "codex");
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
    expect(f.store.state.investigations[0]!.assignments[0].checkpoints).toHaveLength(1);
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
    expect(coordinator.candidates().map((c: any) => c.proposal.title)).toEqual(["Still unresolved"]);
    expect(f.store.state.investigations[0]!.proposals).toEqual([]);
    expect(f.store.state.dataset).toEqual(dataset);
  });
  it("terminates replaced work and starts a replacement with the selected provider", () => {
    const f = fixture();
    const id = f.queue();
    const coordinator = assignQueued(f.store, f.pool, "codex");
    const old = f.launches[0]!;
    const assignmentId = assignmentOf(f.store, id).id;
    // The coordinator stops it and sends it back to another agent.
    coordinator.researchers = f.pool;
    coordinator.command({ action: "stop-researcher", session: coordinator.session.secret, assignmentId, reason: "Another agent suits it better." });
    expect(old.child.killed).toBe(true);
    old.child.emit("close", 1);
    coordinator.command({ action: "revise", session: coordinator.session.secret, assignmentId, engine: "claude", notes: "Start again with the deeds." });
    f.pool.pump();
    expect(f.launches).toHaveLength(2);
    expect(f.launches[1]!.executable).toBe("/test/claude");
    expect(f.store.state.investigations[0]!.executions.at(-1).provider).toBe(
      "claude",
    );
    expect(assignmentOf(f.store, id).lease.worker).toBe("Claude Code researcher");
    expect(readFileSync(join(f.launches[1]!.options.cwd, "brief.md"), "utf8")).toContain("Start again with the deeds.");
  });
  it("pauses failures rather than entering an automatic retry loop", () => {
    const f = fixture();
    f.queue();
    assignQueued(f.store, f.pool, "claude");
    f.launches[0]!.child.emit("close", 1);
    f.pool.pump();
    expect(f.store.state.investigations[0]!.status).toBe("paused");
    expect(f.store.state.investigations[0]!.assignments[0].status).toBe("paused");
    expect(f.launches).toHaveLength(1);
  });
  it("pauses interrupted managed jobs on restart so old results cannot publish", () => {
    const f = fixture();
    const id = f.queue();
    assignQueued(f.store, f.pool, "codex");
    const token = assignmentOf(f.store, id).lease.token;
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
  it("requires a coordinator brief and holds results for synthesis", async () => {
    const { Coordinator } = await import("../server/coordinator.mjs");
    const f = fixture();
    const coordinator = new Coordinator(f.store);
    const session = "coordinator-session-for-test-000001";
    coordinator.attach("Test coordinator", session);
    f.pool.coordinator = coordinator as any;
    const id = f.queue();
    f.pool.pump();
    expect(f.launches).toHaveLength(0);
    expect(() => coordinator.command({ action: "assign", session, investigationId: id, engine: "codex", brief: "No title." })).toThrow("Assignment title");
    coordinator.command({
      action: "assign",
      session,
      investigationId: id,
      engine: "codex",
      title: "The two identities",
      brief: "Compare the two identities; preserve ambiguity.",
    });
    f.pool.pump();
    expect(f.launches).toHaveLength(1);
    const process = f.launches[0]!;
    const { readFileSync } = await import("node:fs");
    // The researcher reads the brief as prose, and gets no credential and no snapshot.
    const brief = readFileSync(join(process.options.cwd, "brief.md"), "utf8");
    expect(brief).toContain("# The two identities");
    expect(brief).toContain("Compare the two identities; preserve ambiguity.");
    expect(readFileSync(join(process.options.cwd, "AGENTS.md"), "utf8")).toContain(join(f.directory, "library"));
    const { existsSync } = await import("node:fs");
    expect(existsSync(join(process.options.cwd, "brief.json"))).toBe(false);
    const token = assignmentOf(f.store, id).lease.token;
    const { readdirSync } = await import("node:fs");
    for (const file of readdirSync(process.options.cwd).filter((n) => /\.(md|json)$/.test(n)))
      expect(readFileSync(join(process.options.cwd, file), "utf8")).not.toContain(token);
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
    expect(assignmentOf(f.store, id).status).toBe("returned");
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
    const { assignmentId } = coordinator.command({ action: "assign", session, investigationId: id, engine: "claude", title: "The fixture record", brief: "Trace the fixture record." }) as any;
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
    const command = (data: object) => coordinator.command({ session, assignmentId, ...data });
    const investigation = () => f.store.state.investigations.find((i: any) => i.id === id);
    const assignment = () => investigation().assignments.find((a: any) => a.id === assignmentId);
    return { ...f, id, assignmentId, coordinator, process, input, say, command, investigation, assignment };
  }
  const result = { title: "Unresolved", summary: "Two identities", ambiguity: "Open", evidence: [], changes: [] };

  it("keeps its input open and receives the assignment as its first message", async () => {
    const s = await steerable();
    await new Promise((done) => setImmediate(done));
    expect(s.process.args).toEqual(expect.arrayContaining(["--input-format", "stream-json"]));
    expect(s.process.child.stdin.writableEnded).toBe(false);
    expect(s.input[0]).toMatchObject({ type: "user", message: { content: expect.stringContaining("brief.md") } });
  });

  it("delivers the coordinator's redirection to the running researcher", async () => {
    const s = await steerable();
    expect(s.command({ action: "steer", message: "Focus on the 1880 census instead." })).toEqual({ steered: true });
    await new Promise((done) => setImmediate(done));
    expect(s.input.at(-1)).toEqual({ type: "user", message: { role: "user", content: "Focus on the 1880 census instead." } });
    expect(s.investigation().events.at(-1).message).toBe('Coordinator redirected the researcher on "The fixture record": Focus on the 1880 census instead.');
    expect(s.assignment().steering).toEqual([{ at: expect.any(String), message: "Focus on the 1880 census instead." }]);
    expect(s.coordinator.status().latest!.text).toBe('Redirecting the researcher on "The fixture record" in a batch');
    expect(() => s.command({ action: "steer", message: " " })).toThrow("A redirection must be text");
    expect(() => s.coordinator.command({ session: "coordinator-session-for-test-000002", action: "steer", investigationId: s.id, message: "Which one?" })).toThrow("Name the assignment with assignmentId");
  });

  it("stops a researcher outright, leaving the batch the coordinator's to assign again", async () => {
    const s = await steerable();
    s.say({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "brief.md" } }] } });
    expect(s.live.list()).toHaveLength(1);
    expect(s.command({ action: "stop-researcher", reason: "The human withdrew this question." })).toEqual({ stopped: true });
    expect(s.process.child.killed).toBe(true);
    expect(s.assignment()).toMatchObject({ status: "stopped" });
    expect(s.assignment().lease).toBeUndefined();
    expect(s.investigation().events.at(-1).message).toBe('Coordinator stopped "The fixture record": The human withdrew this question.');
    s.process.child.emit("close", null);
    expect(s.live.list()).toEqual([]);
    // Its exit is not a failure, and nothing asks the human to approve resuming it.
    expect(s.assignment().status).toBe("stopped");
    expect(s.investigation().status).toBe("review");
    s.store.update((next: any) => {
      next.investigations.find((i: any) => i.id === s.id).number = 1;
    });
    expect(liveRows({ ...s.store.state, live: s.live.list() } as any).filter((r: any) => r.group === "attention")).toEqual([]);
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
    expect(s.pool.active.get(s.assignmentId).agent.busy).toBe(true);
  });
});

describe("a researcher the app crashed under", () => {
  it("waits to be resumed with its session, taking in the checkpoint it last wrote", () => {
    const f = fixture();
    const id = f.queue();
    assignQueued(f.store, f.pool, "codex");
    const task = f.task(id);
    const session = { engine: "codex", id: "thread-crashed", directory: task.directory, at: new Date().toISOString() };
    f.store.update((next: any) => {
      next.investigations[0].assignments[0].session = session;
    });
    writeFileSync(join(task.directory, "checkpoint.json"), JSON.stringify({ summary: "Found the deed", findings: "Registry book 4, page 12", nextSteps: "Check the tax rolls" }));
    // The app ends without stopping its researchers, as a crash would.
    clearInterval(f.pool.timer);
    const reopened = new ResearcherPool(f.store, f.directory, resolve("."));
    cleanups.push(() => reopened.stop());
    const i = f.store.state.investigations[0]!;
    expect(i.status).toBe("paused");
    expect(i.events.at(-1)!.message).toBe('The app closed while the researcher on "Fixture assignment" was working. Resume to pick up its conversation where it left off.');
    expect(i.assignments![0]!.checkpoints.map((c: any) => c.summary)).toEqual(["Found the deed"]);
    expect(i.assignments![0]!.session).toEqual(session);
  });
});

describe.each(["claude", "codex"] as const)("a %s researcher under the coordinator", (engine) => {
  const executables = { claude: resolve("tests/fixtures/fake-claude.mjs"), codex: resolve("tests/fixtures/fake-codex.mjs") };
  async function running() {
    const { Coordinator } = await import("../server/coordinator.mjs");
    const directory = mkdtempSync(join(tmpdir(), "weir-steer-"));
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
    const { assignmentId } = coordinator.command({ session, investigationId: id, action: "assign", engine, title: "The fixture record", brief: "Trace the fixture record." }) as any;
    const command = (data: object) => coordinator.command({ session, assignmentId, ...data });
    pool.pump();
    const investigation = () => store.state.investigations.find((i: any) => i.id === id);
    const assignment = () => investigation().assignments.find((a: any) => a.id === assignmentId);
    const events = () => investigation().events.map((e: any) => e.message);
    return { pool, coordinator, command, investigation, assignment, events, until, store, directory, id, assignmentId };
  }
  // The app opens again and the human resumes the paused batch; with another engine named,
  // the coordinator first stops the assignment and sends it back to that engine.
  async function resumed(r: Awaited<ReturnType<typeof running>>, options: { engine?: string } = {}) {
    const { Coordinator } = await import("../server/coordinator.mjs");
    const pool = new ResearcherPool(r.store, r.directory, resolve("."), { findExecutable: (name: string) => (executables as any)[name] });
    cleanups.push(() => pool.stop());
    const coordinator = new Coordinator(r.store);
    const session = "coordinator-session-for-test-000004";
    coordinator.attach("Test coordinator", session);
    coordinator.researchers = pool;
    pool.coordinator = coordinator as any;
    if (options.engine) {
      coordinator.command({ session, action: "stop-researcher", assignmentId: r.assignmentId, reason: "Another agent takes it." });
      coordinator.command({ session, action: "revise", assignmentId: r.assignmentId, engine: options.engine, notes: "Carry on with the fixture record." });
      // Sent back within a paused batch, it waits for the human to resume the batch.
      expect(r.assignment().status).toBe("paused");
    }
    r.store.command({ type: "resume", investigationId: r.id });
    pool.pump();
    return pool;
  }
  const result = JSON.stringify({ title: "Unresolved", summary: "Two identities", ambiguity: "Open", evidence: [], changes: [] });
  const write = engine === "claude"
    ? { tool: "Write", input: { file_path: "result.json" }, writes: { "result.json": result } }
    : { change: "result.json", writes: { "result.json": result } };
  const slow = engine === "claude" ? { tool: "Read", input: { file_path: "brief.md" }, delay: 10_000 } : { command: "cat brief.md", delay: 10_000 };

  it("waits for instructions, takes a redirection, and closes once its findings are written", async () => {
    const r = await running();
    await r.until(() => r.events().some((m: string) => m.includes("waiting for instructions")));
    expect(r.command({ action: "steer", message: `steps:${JSON.stringify([write])}` })).toEqual({ steered: true });
    await r.until(() => r.coordinator.candidates().length === 1);
    await r.until(() => r.pool.active.size === 0);
    expect(r.pool.live.list()).toEqual([]);
  });

  it("keeps its conversation when stopped, and picks it up in the same folder when the batch is resumed", async () => {
    const r = await running();
    await r.until(() => r.events().some((m: string) => m.includes("waiting for instructions")));
    const session = r.assignment().session;
    expect(session).toMatchObject({ engine, directory: expect.stringContaining(r.id) });
    // The human closes the app and chooses to stop its workers.
    r.pool.stop();
    await r.until(() => r.investigation().status === "paused");
    expect(r.events().at(-1)).toContain("Resume to pick up its conversation where it left off.");
    expect(r.assignment().session).toEqual(session);
    process.env.FAKE_CLAUDE_RECORD = "1";
    cleanups.push(() => delete process.env.FAKE_CLAUDE_RECORD);
    const pool = await resumed(r);
    await r.until(() => r.investigation().status === "running" && pool.active.size === 1);
    await r.until(() => r.events().filter((m: string) => m.includes("waiting for instructions")).length === 2);
    // It is told it was stopped, and that messages it has not acted on still stand.
    if (engine === "claude") {
      const received = readFileSync(join(session.directory, "received.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l).text);
      expect(received.at(-1)).toContain("You were stopped partway through this assignment");
      expect(received.at(-1)).toContain("Any message above that you have not acted on still stands");
    }
    // The same session, in the same folder, rather than a fresh researcher.
    expect(r.assignment().session).toMatchObject({ id: session.id, directory: session.directory });
    expect([...pool.active.values()][0].directory).toBe(session.directory);
    // Handing in its result ends the session.
    pool.steer(r.assignmentId, `steps:${JSON.stringify([write])}`);
    await r.until(() => pool.active.size === 0);
    expect(r.coordinator.candidates()).toHaveLength(1);
    expect(r.assignment().session).toBeUndefined();
  });

  it("starts a fresh researcher from the checkpoints when its conversation cannot be picked up", async () => {
    const r = await running();
    await r.until(() => r.events().some((m: string) => m.includes("waiting for instructions")));
    r.pool.stop();
    await r.until(() => r.investigation().status === "paused");
    const old = r.assignment().session;
    r.store.update((next: any) => {
      next.investigations.find((i: any) => i.id === r.id).assignments[0].session.id = "a-session-that-is-gone";
    });
    const pool = await resumed(r);
    await r.until(() => r.events().some((m: string) => m.includes("could not be picked up")));
    await r.until(() => r.assignment().session?.id && r.assignment().session.id !== "a-session-that-is-gone");
    expect(r.assignment().session.directory).not.toBe(old.directory);
    expect(r.investigation().status).toBe("running");
    pool.stop();
    await r.until(() => pool.active.size === 0);
  });

  it("starts afresh when the coordinator assigns another engine, or stopped the researcher itself", async () => {
    const r = await running();
    await r.until(() => r.events().some((m: string) => m.includes("waiting for instructions")));
    r.command({ action: "stop-researcher", reason: "Moving this to another batch." });
    await r.until(() => r.pool.active.size === 0);
    expect(r.assignment().session).toBeUndefined();
    const s = await running();
    await s.until(() => s.events().some((m: string) => m.includes("waiting for instructions")));
    s.pool.stop();
    await s.until(() => s.investigation().status === "paused");
    const old = s.assignment().session;
    const pool = await resumed(s, { engine: engine === "claude" ? "codex" : "claude" });
    await s.until(() => s.assignment().session && s.assignment().session.id !== old.id);
    expect(s.assignment().session.directory).not.toBe(old.directory);
    pool.stop();
    await s.until(() => pool.active.size === 0);
  });

  it("stops mid-run when the coordinator says so", async () => {
    const r = await running();
    await r.until(() => r.events().some((m: string) => m.includes("waiting for instructions")));
    r.command({ action: "steer", message: `steps:${JSON.stringify([slow])}` });
    await r.until(() => r.pool.live.list()[0]?.latest?.text === "Reading its assignment");
    r.command({ action: "stop-researcher", reason: "Wrong direction." });
    await r.until(() => r.pool.active.size === 0);
    expect(r.assignment().status).toBe("stopped");
    expect(r.events().at(-1)).toBe('Coordinator stopped "The fixture record": Wrong direction.');
    expect(r.pool.live.list()).toEqual([]);
  });
});

describe("the research browser for web researchers", () => {
  it("gives a web researcher the browser, and tells it to keep to its own tab", async () => {
    const f = fixture();
    // A stand-in for the app's research browser.
    const server = { command: "/bin/node", args: ["chrome-devtools-mcp.js", "--browserUrl", "http://127.0.0.1:9333"], env: {} };
    f.pool.browser = { available: true, open: async () => "http://127.0.0.1:9333", mcpServer: () => server } as any;
    f.queue();
    assignQueued(f.store, f.pool, "claude");
    await new Promise((done) => setTimeout(done, 10));
    const args = f.launches[0]!.args;
    expect(JSON.parse(args[args.indexOf("--mcp-config") + 1]!)).toEqual({ mcpServers: { browser: server } });
    expect(JSON.parse(args[args.indexOf("--settings") + 1]!).permissions.allow).toContain("mcp__browser");
    expect(args.join(" ")).toContain("Open your own tab with new_page");
  });

  it("gives a researcher confined to local documents no browser", async () => {
    const f = fixture();
    let opened = false;
    f.pool.browser = { available: true, open: async () => ((opened = true), "http://127.0.0.1:9333"), mcpServer: () => ({}) } as any;
    f.store.command({ type: "annotate", question: "Local only", target: { label: "R" }, dispatch: true, scope: ["imports"] });
    assignQueued(f.store, f.pool, "claude");
    await new Promise((done) => setTimeout(done, 10));
    expect(opened).toBe(false);
    const args = f.launches[0]!.args;
    expect(JSON.parse(args[args.indexOf("--mcp-config") + 1]!)).toEqual({ mcpServers: {} });
  });
});
