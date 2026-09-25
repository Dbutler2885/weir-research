// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import dataset from "./fixtures/workshop.json";
import { WorkspaceStore } from "../server/store.mjs";
import { Coordinator } from "../server/coordinator.mjs";
import { CoordinatorHost } from "../server/coordinator-host.mjs";
import { AgentSupervisor } from "../server/agents/supervisor.mjs";
import { LiveActivity } from "../server/live-activity.mjs";

const exec = promisify(execFile);
const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).reverse().forEach((clean) => clean()));
const until = async (check: () => unknown, tries = 400) => {
  for (let n = 0; n < tries && !check(); n++) await new Promise((done) => setTimeout(done, 10));
  expect(check()).toBeTruthy();
};

function fixture(steps: object[] = []) {
  const directory = mkdtempSync(join(tmpdir(), "coordinator-host-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  // What the fake coordinator does with any message that is not a list of steps.
  const stepsFile = join(directory, "fake-steps.json");
  writeFileSync(stepsFile, JSON.stringify(steps));
  process.env.FAKE_CLAUDE_STEPS = stepsFile;
  process.env.FAKE_CLAUDE_RECORD = "1";
  cleanups.push(() => {
    delete process.env.FAKE_CLAUDE_STEPS;
    delete process.env.FAKE_CLAUDE_RECORD;
  });
  const store = new WorkspaceStore(directory, dataset);
  const coordinator = new Coordinator(store);
  const supervisor = new AgentSupervisor({ live: new LiveActivity(), stopGrace: 200 });
  const commands: any[] = [];
  const open = () => {
    const host = new CoordinatorHost({
      store,
      coordinator,
      supervisor,
      directory,
      root: resolve("."),
      debounce: 20,
      findExecutable: (name: string) => (name === "claude" ? resolve("tests/fixtures/fake-claude.mjs") : null),
      handle: (data: any) => {
        commands.push(data);
        return coordinator.command(data);
      },
    });
    cleanups.push(() => host.stop());
    host.start();
    return host;
  };
  const received = (host: CoordinatorHost) => {
    const file = join(host.folder!, "received.jsonl");
    // Only whole lines: the fake may be writing the next one.
    return existsSync(file) ? readFileSync(file, "utf8").split("\n").slice(0, -1).map((l) => JSON.parse(l)) : [];
  };
  return { store, coordinator, open, received, commands };
}

describe("the app's coordinator", () => {
  it("starts fresh in its own folder with the startup context, and again on reopening", async () => {
    const f = fixture();
    const first = f.open();
    expect(readFileSync(join(first.folder!, "AGENTS.md"), "utf8")).toContain("You are the research coordinator");
    expect(existsSync(join(first.folder!, "tools", "research.mjs"))).toBe(true);
    expect(existsSync(join(first.folder!, ".claude", "skills", "coordinate-research", "SKILL.md"))).toBe(true);
    expect(existsSync(join(first.folder!, ".agents", "skills", "research-contract", "SKILL.md"))).toBe(true);
    await until(() => f.received(first).length === 1);
    expect(f.received(first)[0].text).toContain("You are starting as this project's coordinator");
    expect(f.received(first)[0].text).toContain("How to get more");
    expect(f.coordinator.status()).toMatchObject({ connected: true, attached: true });
    first.stop();
    expect(f.coordinator.status().connected).toBe(false);
    await new Promise((done) => setTimeout(done, 5));
    const second = f.open();
    expect(second.folder).not.toBe(first.folder);
    await until(() => f.received(second).length === 1);
    expect(f.coordinator.status()).toMatchObject({ connected: true });
  });

  it("delivers the human's note as a message, at its next step when it is mid-turn", async () => {
    const f = fixture([{ tool: "Read", input: { file_path: "AGENTS.md" }, delay: 600 }]);
    const host = f.open();
    await until(() => f.coordinator.status().latest?.text === "Reading its instructions");
    expect(f.coordinator.status().listening).toBe(false);
    f.store.command({ type: "send", text: "Please look at the workshop's founder." });
    await until(() => f.received(host).length === 2);
    const note = f.received(host)[1];
    expect(note.midTurn).toBe(true);
    expect(note.text).toContain("Please look at the workshop's founder.");
    // After its turns end, it is listening.
    await until(() => f.coordinator.status().listening, 600);
  });

  it("answers commands from its tool, without telling it about its own changes", async () => {
    const f = fixture();
    const host = f.open();
    await until(() => f.received(host).length === 1 && f.coordinator.status().listening);
    const tool = (arg: string) => exec(process.execPath, ["tools/research.mjs", arg], { cwd: host.folder! });
    const found = JSON.parse((await tool('{"action":"search","query":"Alex"}')).stdout);
    expect(found.hits.length).toBeGreaterThan(0);
    expect((await tool("snapshot")).stdout).toContain("How to get more");
    await expect(tool('{"action":"claim","investigationId":"x"}')).rejects.toThrow("The app runs every worker");
    await expect(tool('{"action":"wait"}')).rejects.toThrow("The app manages your session");
    await tool('{"action":"handoff","notes":"Saved by the coordinator."}');
    expect(f.store.state.coordination.handoff).toBe("Saved by the coordinator.");
    await new Promise((done) => setTimeout(done, 100));
    expect(f.received(host)).toHaveLength(1);
    expect(f.commands.every((c) => c.session === host.secret)).toBe(true);
    // Several real processes run here, which is slow when the whole suite runs at once.
  }, 20_000);

  it("says when no agent CLI is installed to run it", () => {
    const f = fixture();
    const host = new CoordinatorHost({
      store: f.store,
      coordinator: f.coordinator,
      supervisor: new AgentSupervisor(),
      directory: "/nowhere",
      root: resolve("."),
      findExecutable: () => null,
      handle: () => null,
    });
    expect(host.start()).toBeNull();
    expect(f.coordinator.status()).toMatchObject({ connected: false, problem: expect.stringContaining("No agent CLI") });
  });
});

describe("the coordinator in the live panel", () => {
  it("says when the coordinator is not running, and why", async () => {
    const { runningSummary, liveRows } = await import("../src/ui/live-panel");
    const state = { investigations: [], conversation: [], coordinator: { connected: false, problem: "No agent CLI is installed. Install Claude Code or Codex to start the coordinator." } } as any;
    expect(runningSummary(state)).toBe("Coordinator not running");
    expect(liveRows(state)).toEqual([{ who: "Coordinator", stage: "No agent CLI is installed. Install Claude Code or Codex to start the coordinator." }]);
  });
});
