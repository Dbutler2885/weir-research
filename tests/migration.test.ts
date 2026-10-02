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
    old.command({ type: "checkpoint", investigationId: id, token: claimed.assignment.lease.token, summary: "Found the register", findings: "Page 4", nextSteps: "Compare" });
    const saved = JSON.parse(readFileSync(join(directory, "workspace.json"), "utf8"));
    // A graph job it was building itself, too.
    saved.investigations[0].reviewFlow = { walkthroughs: [], graphReviews: [], jobs: [{ id: "job", status: "running", engine: "manual", progress: "Building", updates: [], attempt: 1, consumedUpdateSequence: 0 }] };
    writeFileSync(join(directory, "workspace.json"), JSON.stringify(saved));

    const store = new WorkspaceStore(directory, dataset);
    const batch = store.state.investigations[0];
    expect(batch.status).toBe("paused");
    expect(batch.assignments[0]).toMatchObject({ status: "paused" });
    expect(batch.assignments[0].lease).toBeUndefined();
    expect(batch.assignments[0].checkpoints.map((c: any) => c.summary)).toEqual(["Found the register"]);
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
    // The coordinator chose no agent for it, so the project's default takes it.
    store.update((next: any) => {
      next.engine = "claude";
    });
    const pool = new ResearcherPool(store, directory, resolve("."), { launch: launch as any, findExecutable: (n: string) => `/test/${n}` });
    cleanups.push(() => pool.stop());
    assignQueued(store, pool, "claude");
    expect(launches).toEqual(["/test/claude"]);
    const assignment = store.state.investigations[0].assignments[0];
    expect(assignment.lease.worker).toBe("Claude Code researcher");
    // The new researcher is pointed at the saved checkpoint, which the library holds.
    const folder = join(directory, "agents", id, assignment.id, assignment.lease.token);
    expect(readFileSync(join(folder, "brief.md"), "utf8")).toContain("pass-1/checkpoints.md");
    expect(readFileSync(join(directory, "library", `batches/investigation-${id}/pass-1/checkpoints.md`), "utf8")).toContain("Found the register");
  });
});

// A fictional project saved before assignments: one batch whose researcher worked one
// pass at a time under questions, and one briefed but not yet started.
function oldProject() {
  const at = (n: number) => `2026-03-0${n}T10:00:00.000Z`;
  const annotation = (id: string, question: string, n: number) => ({ id, target: { label: "Harbour Mill" }, references: [], question, createdAt: at(n), dispatchedAt: at(n) });
  const findings = (id: string, title: string, addressed: string[], n: number) => ({
    id, revision: 1, kind: "findings", title, summary: "Fixture.", ambiguity: "", evidence: [], changes: [], status: "pending", createdAt: at(n), addressedAnnotationIds: addressed,
    findings: [{ id: "f", statement: `${title}.`, qualification: "reported", explanation: "Fixture.", evidenceIds: [] }],
  });
  const state = JSON.parse(JSON.stringify(new WorkspaceStore(mkdtempSync(join(tmpdir(), "migration-seed-")), dataset).state));
  state.investigations = [
    {
      id: "mill", number: 1, title: "The mill", status: "running", createdAt: at(1), scope: ["web"],
      brief: { purpose: "Who built and ran the fictional mill.", scope: "To 1900.", direction: "Leases.", updatedAt: at(1) },
      annotations: [annotation("a1", "Who built it?", 1), annotation("a2", "Was the builder local?", 1), annotation("a3", "Who ran it after 1880?", 3)],
      questions: [
        { id: "q1", title: "Who built the mill?", origin: "human", annotationIds: ["a1", "a2"], createdAt: at(1) },
        { id: "q2", title: "Who ran it after 1880?", origin: "human", annotationIds: ["a3"], createdAt: at(3) },
      ],
      executions: [
        { at: at(1), worker: "Codex researcher", provider: "codex", model: "m" },
        { at: at(3), worker: "Claude Code researcher", provider: "claude", model: "m" },
        { at: at(5), worker: "Claude Code researcher", provider: "claude", model: "m" },
      ],
      checkpoints: [
        { id: "c1", at: "2026-03-01T12:00:00.000Z", worker: "Codex researcher", summary: "Building register read", findings: "x", nextSteps: "y" },
        { id: "c2", at: "2026-03-05T12:00:00.000Z", worker: "Claude Code researcher", summary: "Leases half read", findings: "x", nextSteps: "y" },
      ],
      proposals: [findings("p1", "The builder", ["a1", "a2"], 2), findings("p2", "Later lessees", ["a1", "a2", "a3"], 4)],
      events: [],
      lease: { token: "current-token", worker: "Claude Code researcher", at: at(5), annotationIds: ["a1", "a2", "a3"], dataset: state.dataset },
      researcherSession: { engine: "claude", id: "session-1", directory: "/fictional/folder", at: at(5) },
    },
    {
      id: "wharf", number: 2, title: "The wharf", status: "queued", createdAt: at(6), scope: ["web"],
      annotations: [annotation("a4", "Who owned the wharf?", 6)],
      questions: [{ id: "q3", title: "Who owned the wharf?", origin: "human", annotationIds: ["a4"], createdAt: at(6) }],
      checkpoints: [], proposals: [], events: [],
    },
  ];
  state.coordination = {
    enabled: true,
    candidates: [{ id: "cand", investigationId: "mill", token: "current-token", proposal: {}, receivedAt: at(6) }],
    assignments: { wharf: { engine: "codex", model: null, effort: "high", phase: "research", brief: "Read the wharf deeds.", annotationIds: ["a4"] } },
  };
  state.conversation = [{ id: "m1", at: at(7), author: "human", annotations: [{ ...annotation("a5", "Look again", 7), references: [{ label: "Who ran it after 1880?", investigationId: "mill", questionId: "q2" }] }] }];
  return state;
}

describe("a project from before assignments", () => {
  it("turns each past research pass into an assignment, keeping the one at work and the one briefed", () => {
    const directory = mkdtempSync(join(tmpdir(), "migration-"));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    writeFileSync(join(directory, "workspace.json"), JSON.stringify(oldProject()));
    const store = new WorkspaceStore(directory, dataset);
    const [mill, wharf] = store.state.investigations;
    expect(mill.assignments.map((a: any) => [a.title, a.status, a.worker, a.annotationIds])).toEqual([
      ["Who built the mill?", "done", "Codex researcher", ["a1", "a2"]],
      ["Who ran it after 1880?", "done", "Claude Code researcher", ["a1", "a2", "a3"]],
      ["Who ran it after 1880?", "returned", "Claude Code researcher", ["a1", "a2", "a3"]],
    ]);
    // Each pass keeps its own checkpoints and reports.
    expect(mill.assignments.map((a: any) => a.checkpoints.map((c: any) => c.id))).toEqual([["c1"], [], ["c2"]]);
    expect(mill.proposals.map((p: any) => p.assignmentId)).toEqual([mill.assignments[0].id, mill.assignments[1].id]);
    // The last researcher keeps its lease, so its result still waits for the coordinator;
    // with its result in, there is no session left to pick up.
    expect(mill.assignments[2]).toMatchObject({ lease: { token: "current-token" } });
    expect(mill.assignments[2].session).toBeUndefined();
    for (const old of ["questions", "lease", "researcherSession", "checkpoints"]) expect(mill[old]).toBeUndefined();
    // A batch briefed and waiting keeps the coordinator's brief and choice.
    expect(wharf.assignments).toEqual([
      expect.objectContaining({ title: "Who owned the wharf?", brief: "Read the wharf deeds.", status: "waiting", choice: { engine: "codex", model: null, effort: "high" } }),
    ]);
    expect(store.state.coordination.assignments).toBeUndefined();
    // What the human pinned to a question now points at the pass that took it up.
    expect(store.state.conversation[0].annotations[0].references[0]).toEqual({ label: "Who ran it after 1880?", investigationId: "mill", assignmentId: mill.assignments[1].id });
    // The original is kept, and converting again changes nothing.
    expect(JSON.parse(readFileSync(join(directory, "workspace.before-assignments.json"), "utf8")).investigations[0].questions).toHaveLength(2);
    expect(new WorkspaceStore(directory, dataset).state.revision).toBe(store.state.revision);
  });

  it("shows a past pass's direction as the annotations it was started from", async () => {
    const directory = mkdtempSync(join(tmpdir(), "migration-"));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    writeFileSync(join(directory, "workspace.json"), JSON.stringify(oldProject()));
    const store = new WorkspaceStore(directory, dataset);
    const { libraryFiles } = await import("../server/research-library.mjs");
    const pass = libraryFiles(store.state).get("batches/batch-1/pass-1/assignment.md");
    expect(pass).toContain("## Started from the human's annotations");
    expect(pass).toContain("> Who built it?");
    const { findingsPage } = await import("../src/ui/findings-view");
    const page = findingsPage(store.state, "findings", new Set());
    expect(page).toContain("Started from your annotations");
    expect(page).toContain("Read the wharf deeds.");
  });
});
