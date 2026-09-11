// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import dataset from "./fixtures/workshop.json";
import { WorkspaceStore } from "../server/store.mjs";
import { ResearcherPool } from "../server/researchers.mjs";

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
  return { directory, store, pool, launches, queue };
}
describe("local researcher supervision", () => {
  it("launches only after selecting an engine and bounds concurrent investigations", () => {
    const f = fixture();
    f.queue();
    f.queue();
    f.queue();
    f.pool.pump();
    expect(f.launches).toHaveLength(0);
    f.pool.choose("codex");
    expect(f.launches).toHaveLength(2);
    expect(f.launches[0]!.args).toContain("workspace-write");
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
