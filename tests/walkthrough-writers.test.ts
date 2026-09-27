// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { WorkspaceStore } from "../server/store.mjs";
import { flowCommand } from "../server/review-flow.mjs";
import { WalkthroughWriters } from "../server/walkthrough-writers.mjs";
import { LiveActivity } from "../server/live-activity.mjs";
import { liveRows } from "../src/ui/live-panel";
import { emptyGraph, prepareResearch } from "./fixtures/guided-flow";
import { until } from "./fixtures/until";

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).reverse().forEach((clean) => clean()));

// The fake Claude CLI writes what a writer would, one step per message.
const write = (text: string) =>
  `steps:${JSON.stringify([{ tool: "Write", input: { file_path: "walkthrough.json" }, writes: { "walkthrough.json": text } }])}`;

// Any other message makes the fake read its materials slowly, leaving time to steer it.
function fixture(slow = false) {
  const directory = mkdtempSync(join(tmpdir(), "fictional-writer-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  if (slow) {
    const steps = join(directory, "fake-steps.json");
    writeFileSync(steps, JSON.stringify([{ tool: "Read", input: { file_path: "materials.json" }, delay: 400 }]));
    process.env.FAKE_CLAUDE_STEPS = steps;
    cleanups.push(() => delete process.env.FAKE_CLAUDE_STEPS);
  }
  const store = new WorkspaceStore(directory, emptyGraph);
  const research = prepareResearch(store);
  store.update((next: any) => {
    next.investigations[0].number = 1;
  });
  const live = new LiveActivity();
  const writers = new WalkthroughWriters(store, directory, resolve("."), {
    live,
    findExecutable: () => resolve("tests/fixtures/fake-claude.mjs"),
  });
  cleanups.push(() => writers.stop());
  const command = (action: string, data: object = {}, actor = "coordinator") =>
    flowCommand(store, { action, investigationId: research.investigationId, ...data }, actor);
  const writer = () => store.state.investigations[0].reviewFlow?.writer;
  const events = () => store.state.investigations[0].events.map((e: any) => e.message);
  return { store, research, writers, live, command, writer, events };
}

describe("walkthrough writers", () => {
  it("are assigned by the coordinator only after the human asks, with a brief", () => {
    const f = fixture();
    expect(() => f.command("assign-walkthrough", { engine: "claude", brief: "Explain the location." })).toThrow("not asked for a walkthrough");
    f.command("request-walkthrough", {}, "human");
    expect(() => f.command("assign-walkthrough", { engine: "claude" })).toThrow("brief");
    f.command("assign-walkthrough", { engine: "claude", brief: "Explain the location." });
    expect(f.writer()).toMatchObject({ status: "queued", engine: "claude", brief: "Explain the location." });
    expect(() => f.command("assign-walkthrough", { engine: "claude", brief: "Again" })).toThrow("already assigned");
  });

  it("run in the live panel, send a broken draft back, and hand in a checked one for the coordinator to publish", async () => {
    const f = fixture(true);
    f.command("request-walkthrough", {}, "human");
    f.command("assign-walkthrough", { engine: "claude", brief: "Explain the location." });
    f.writers.pump();
    const folder = f.writer().directory;
    expect(readFileSync(join(folder, "AGENTS.md"), "utf8")).toContain("walkthrough writer for batch 1");
    expect(JSON.parse(readFileSync(join(folder, "materials.json"), "utf8"))).toMatchObject({
      brief: "Explain the location.",
      proposals: [{ id: f.research.proposalId, findings: [{ id: "location" }] }],
    });
    expect(existsSync(join(folder, ".claude", "skills", "present-research", "references", "runtime.md"))).toBe(true);
    await until(() => f.live.list()[0]?.latest?.text === "Reading the findings for this batch");
    // While the writer runs the row names it; once it exits, the same row reads "Walkthrough".
    const row = () => liveRows({ ...f.store.state, live: f.live.list() } as any).find((r) => r.batch && /walkthrough/i.test(r.who));
    expect(row()).toMatchObject({ who: "Claude walkthrough writer", stage: "A walkthrough writer is working on it.", latest: "Reading the findings for this batch" });
    // A redirection reaches it mid-run; the broken draft it writes goes back to it.
    f.writers.steer(f.research.investigationId, write(JSON.stringify({ ...f.research.walkthrough, steps: [] })));
    await until(() => f.writer().corrections === 1);
    expect(f.events().at(-1)).toContain("needs evidence steps");
    await until(() => f.live.list()[0]?.latest?.text === "Reading the findings for this batch");
    f.writers.steer(f.research.investigationId, write(JSON.stringify(f.research.walkthrough)));
    await until(() => f.writer().status === "returned");
    expect(f.writer().draft.title).toBe("Locating Example Works");
    expect(f.events()).toContain("Walkthrough writer handed in a draft; the coordinator is checking it.");
    expect(row()?.stage).toBe("The draft is written; your coordinator is checking it.");
    await until(() => f.live.list().length === 0);
    // The coordinator publishes the checked draft as it stands.
    const { walkthroughId } = f.command("publish-walkthrough") as any;
    const investigation = f.store.state.investigations[0];
    expect(investigation.reviewFlow.walkthroughs.at(-1)).toMatchObject({ id: walkthroughId, title: "Locating Example Works" });
    expect(investigation.walkthroughRequestedAt).toBeUndefined();
    expect(f.writer().status).toBe("published");
  });

  it("stop after the correction limit, saying why", async () => {
    const f = fixture();
    f.command("request-walkthrough", {}, "human");
    f.command("assign-walkthrough", { engine: "claude", brief: "Explain the location." });
    f.writers.pump();
    await until(() => f.writer().status === "paused");
    expect(f.writer().progress).toContain("walkthrough.json has not been written");
    expect(() => f.writers.steer(f.research.investigationId, "Try again")).toThrow("No walkthrough writer is running");
    // The coordinator can assign a fresh writer.
    f.command("assign-walkthrough", { engine: "claude", brief: "Explain the location, briefly." });
    expect(f.writer().status).toBe("queued");
  });
});
