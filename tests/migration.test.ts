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
import { assignQueued } from "./fixtures/assign";

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).reverse().forEach((clean) => clean()));

describe("a project from before the app ran every worker", () => {
  it("opens with native work paused and nothing lost, then resumes it through a researcher the app starts", () => {
    const directory = mkdtempSync(join(tmpdir(), "migration-"));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    const old = new WorkspaceStore(directory, dataset);
    const { investigationId: id } = old.command({ type: "annotate", question: "Q", target: { label: "R" }, dispatch: true }) as any;
    // The coordinator had claimed it for itself, and saved a checkpoint.
    const claimed: any = old.command({ type: "claim", investigationId: id, worker: "Coordinator: Earlier session" });
    old.command({ type: "checkpoint", investigationId: id, token: claimed.investigation.lease.token, summary: "Found the register", findings: "Page 4", nextSteps: "Compare" });
    const saved = JSON.parse(readFileSync(join(directory, "workspace.json"), "utf8"));
    // A graph job it was building itself, too.
    saved.investigations[0].reviewFlow = { walkthroughs: [], graphReviews: [], jobs: [{ id: "job", status: "running", engine: "manual", progress: "Building", updates: [], attempt: 1, consumedUpdateSequence: 0 }] };
    writeFileSync(join(directory, "workspace.json"), JSON.stringify(saved));

    const store = new WorkspaceStore(directory, dataset);
    const batch = store.state.investigations[0];
    expect(batch.status).toBe("paused");
    expect(batch.lease).toBeUndefined();
    expect(batch.checkpoints.map((c: any) => c.summary)).toEqual(["Found the register"]);
    expect(batch.events.at(-2).message).toContain("Paused when the app took over running workers");
    expect(batch.reviewFlow.jobs[0]).toMatchObject({ status: "paused", engine: "manual" });
    // Converting again changes nothing.
    expect(new WorkspaceStore(directory, dataset).state.revision).toBe(store.state.revision);

    // The human approves resuming; a researcher the app starts carries on.
    store.update((next: any) => {
      next.investigations[0].resumeRequest = { id: "r", reason: "Carry on", at: "t", status: "pending" };
    });
    store.command({ type: "resume-decision", investigationId: id, requestId: "r", decision: "approve" });
    const launches: string[] = [];
    const launch = (executable: string) => {
      launches.push(executable);
      return Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, kill() {} });
    };
    const pool = new ResearcherPool(store, directory, resolve("."), { launch: launch as any, findExecutable: (n: string) => `/test/${n}` });
    cleanups.push(() => pool.stop());
    assignQueued(store, pool, "claude");
    expect(launches).toEqual(["/test/claude"]);
    expect(store.state.investigations[0].lease.worker).toBe("Claude Code researcher");
    // The new researcher's brief carries the saved checkpoint.
    const brief = JSON.parse(readFileSync(join(directory, "agents", id, store.state.investigations[0].lease.token, "brief.json"), "utf8"));
    expect(brief.investigation.checkpoints.map((c: any) => c.summary)).toEqual(["Found the register"]);
  });
});
