// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { claudeAdapter } from "../server/agents/claude.mjs";
import { codexAdapter } from "../server/agents/codex.mjs";
import { AgentSupervisor } from "../server/agents/supervisor.mjs";
import { LiveActivity, fileDescriber, researcherFiles } from "../server/live-activity.mjs";
import { usageLines } from "../src/ui/live-panel";
import { until } from "./fixtures/until";

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).reverse().forEach((clean) => clean()));
const recorded = (file: string) =>
  readFileSync(resolve("tests/fixtures", file), "utf8").trim().split("\n").map((line) => JSON.parse(line));
const describe_ = fileDescriber(researcherFiles);

describe("recognising a reached usage limit", () => {
  it("from Claude Code's recorded rate-limit events and the turn it stopped", () => {
    // Recorded from a graph builder on 2026-09-17 that hit its five-hour limit.
    const session = claudeAdapter.session({ write: () => {}, describe: describe_ });
    const [warning, rejected, message, result] = recorded("claude-quota.jsonl").map((e) => session.read(e));
    expect(warning!.usage).toEqual({
      exhausted: false,
      resetsAt: 1789635600_000,
      windows: [
        { name: "5-hour", used: 0.9, resetsAt: 1789635600_000 },
        { name: "weekly", used: 0.17, resetsAt: 1790154000_000 },
      ],
    });
    expect(rejected!.usage).toMatchObject({ exhausted: true, resetsAt: 1789635600_000 });
    expect(message).toEqual({ actions: [] });
    // It reports success with an error flag; that is a quota stop, not a finished turn.
    expect((result as any).turn).toMatchObject({ ok: false, quota: true });
  });

  it("from Codex's recorded rate-limit report and a turn it failed for usage", () => {
    const session = codexAdapter.session({ write: () => {}, describe: describe_, folder: "/work" });
    // Recorded from Codex 0.155.1 on 2026-09-25.
    const report = recorded("codex-app-server.jsonl").find((r) => r.m.method === "account/rateLimits/updated")!.m;
    expect(session.read(report).usage).toEqual({
      exhausted: false,
      resetsAt: null,
      windows: [
        { name: "5-hour", used: 0.01, resetsAt: 1790365983_000 },
        { name: "weekly", used: 0.47, resetsAt: 1790703735_000 },
      ],
    });
    const full = { ...report, params: { rateLimits: { ...report.params.rateLimits, primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: 1790365983 } } } };
    expect(session.read(full).usage).toMatchObject({ exhausted: true, resetsAt: 1790365983_000 });
    // Shaped as the app server's protocol describes a turn failed for usage.
    const failed = { method: "turn/completed", params: { threadId: "t", turn: { id: "u", status: "failed", error: { message: "Usage limit reached", codexErrorInfo: "usageLimitExceeded" } } } };
    expect(session.read(failed).turn).toMatchObject({ ok: false, quota: true });
    const other = { method: "turn/completed", params: { threadId: "t", turn: { id: "u", status: "failed", error: { message: "Server busy", codexErrorInfo: "serverOverloaded" } } } };
    expect(session.read(other).turn).toMatchObject({ ok: false, quota: false });
  });
});

describe("an agent that reaches its usage limit", () => {
  function start() {
    const folder = mkdtempSync(join(tmpdir(), "quota-"));
    cleanups.push(() => rmSync(folder, { recursive: true, force: true }));
    cleanups.push(() => rmSync(`${folder}.log`, { force: true }));
    process.env.FAKE_CLAUDE_RECORD = "1";
    cleanups.push(() => delete process.env.FAKE_CLAUDE_RECORD);
    const live = new LiveActivity();
    const supervisor = new AgentSupervisor({ live, stopGrace: 200, quotaWait: { unknown: 30 * 60_000, margin: 0 } });
    const agent = supervisor.start({
      key: "research:quota",
      provider: "claude",
      executable: resolve("tests/fixtures/fake-claude.mjs"),
      folder,
      prompt: `steps:${JSON.stringify([{ quota: 1 }])}`,
      live: { role: "researcher", name: "Claude researcher", investigationId: "quota" },
      describe: describe_,
    });
    cleanups.push(() => agent.stop());
    const events: string[] = [];
    for (const name of ["paused", "resumed", "turn", "exit"]) agent.on(name, () => events.push(name));
    const received = () =>
      existsSync(join(folder, "received.jsonl")) ? readFileSync(join(folder, "received.jsonl"), "utf8").split("\n").slice(0, -1).map((l) => JSON.parse(l).text) : [];
    return { agent, live, supervisor, events, received };
  }

  it("pauses with the reason and reset time, holds new messages, and carries on at the reset", async () => {
    const a = start();
    const paused = await new Promise<any>((done) => a.agent.once("paused", done));
    expect(paused.reason).toMatch(/^Paused: the usage limit is reached\. It carries on at \d+:\d\d [AP]M\.$/);
    expect(a.live.list()[0]!.latest!.text).toBe(paused.reason);
    expect(a.supervisor.usage.claude).toMatchObject({ exhausted: true });
    // The stopped turn is neither a finished turn nor a failure.
    expect(a.events).toEqual(["paused"]);
    a.agent.steer(`steps:${JSON.stringify([{ tool: "Read", input: { file_path: "brief.json" } }])}`);
    expect(a.received()).toHaveLength(1);
    await until(() => a.events.includes("turn"));
    expect(a.events).toEqual(["paused", "resumed", "turn"]);
    // It was told to carry on, with what was sent while it waited.
    expect(a.received()[1]).toContain("The usage limit has reset. Carry on with your assignment");
    expect(a.received()[1]).toContain('steps:[{"tool":"Read"');
  });
});

describe("showing remaining usage", () => {
  const now = Date.UTC(2026, 8, 25, 12);
  it("says how much of each limit is used and when it resets", () => {
    const lines = usageLines(
      {
        usage: {
          claude: { exhausted: false, resetsAt: null, at: now, windows: [{ name: "5-hour", used: 0.9, resetsAt: now + 3_600_000 }, { name: "weekly", used: 0.17, resetsAt: null }] },
          codex: { exhausted: true, resetsAt: now + 7_200_000, at: now, windows: [] },
        },
      } as any,
      now,
    );
    expect(lines[0]).toMatch(/^Claude Code: 90% of the 5-hour limit \(resets \d+:\d\d [AP]M\), 17% of the weekly limit used\.$/);
    expect(lines[1]).toMatch(/^Codex: the usage limit is reached; it resets at \d+:\d\d [AP]M\.$/);
  });
});
