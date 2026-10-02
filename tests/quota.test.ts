// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { claudeAdapter } from "../server/agents/claude.mjs";
import { codexAdapter, retryTime } from "../server/agents/codex.mjs";
import { AgentSupervisor } from "../server/agents/supervisor.mjs";
import { LiveActivity, fileDescriber, researcherFiles } from "../server/live-activity.mjs";
import { usageLines } from "../src/ui/live-panel";
import { resetTime } from "../src/domain/reset-time";
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
    // Recorded on 2026-09-29: the error names the reset in local time.
    const worded = { ...failed, params: { ...failed.params, turn: { ...failed.params.turn, error: { message: "You’ve hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Sep 30th, 2026 12:06 AM.", codexErrorInfo: "usageLimitExceeded" } } } };
    expect(session.read(worded).turn).toMatchObject({ quota: true, resetsAt: new Date(2026, 8, 30, 0, 6).getTime() });
    // Recorded at 12:05 AM on 2026-09-30: a reset within the day names only the time.
    const soon = "You’ve hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 12:06 AM.";
    expect(retryTime(soon, new Date(2026, 8, 30, 0, 5, 24).getTime())).toBe(new Date(2026, 8, 30, 0, 6).getTime());
    expect(retryTime(soon, new Date(2026, 8, 29, 23, 35).getTime())).toBe(new Date(2026, 8, 30, 0, 6).getTime());
    const other = { method: "turn/completed", params: { threadId: "t", turn: { id: "u", status: "failed", error: { message: "Server busy", codexErrorInfo: "serverOverloaded" } } } };
    expect(session.read(other).turn).toMatchObject({ ok: false, quota: false });
  });

  it("keeps a Codex limit's reset when another of its limits reports nothing", () => {
    // Recorded on 2026-09-29: the full five-hour limit, then an empty report for a second limit.
    const session = codexAdapter.session({ write: () => {}, describe: describe_, folder: "/work" });
    const update = (rateLimits: object) => ({ method: "account/rateLimits/updated", params: { rateLimits } });
    session.read(update({ limitId: "codex", primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: 1790741218 }, secondary: { usedPercent: 63, windowDurationMins: 10080, resetsAt: 1791170788 }, rateLimitReachedType: null }));
    const usage = session.read(update({ limitId: "premium", primary: null, secondary: null, rateLimitReachedType: null })).usage;
    expect(usage).toMatchObject({ exhausted: true, resetsAt: 1790741218_000 });
    expect(usage!.windows.map((w: any) => w.name)).toEqual(["5-hour", "weekly"]);
  });
});

describe("an agent that reaches its usage limit", () => {
  function start(quota = 1, { provider = "claude", ask = 30 * 60_000 } = {}) {
    const folder = mkdtempSync(join(tmpdir(), "quota-"));
    cleanups.push(() => rmSync(folder, { recursive: true, force: true }));
    cleanups.push(() => rmSync(`${folder}.log`, { force: true }));
    process.env.FAKE_CLAUDE_RECORD = "1";
    cleanups.push(() => delete process.env.FAKE_CLAUDE_RECORD);
    const live = new LiveActivity();
    const supervisor = new AgentSupervisor({ live, stopGrace: 200, quotaWait: { unknown: 30 * 60_000, margin: 0, check: 50, ask } });
    const agent = supervisor.start({
      key: "research:quota",
      provider,
      executable: resolve(`tests/fixtures/fake-${provider}.mjs`),
      folder,
      prompt: `steps:${JSON.stringify([{ quota }])}`,
      live: { role: "researcher", name: "Researcher", investigationId: "quota" },
      describe: describe_,
    });
    cleanups.push(() => agent.stop());
    const events: string[] = [];
    for (const name of ["paused", "resumed", "turn", "exit"]) agent.on(name, () => events.push(name));
    const received = () =>
      existsSync(join(folder, "received.jsonl")) ? readFileSync(join(folder, "received.jsonl"), "utf8").split("\n").slice(0, -1).map((l) => JSON.parse(l).text) : [];
    return { agent, live, supervisor, events, received, folder };
  }
  const read = `steps:${JSON.stringify([{ tool: "Read", input: { file_path: "brief.md" } }])}`;

  it("pauses with the reason and reset time, holds the app's messages, and carries on with them at the reset", async () => {
    const a = start();
    const paused = await new Promise<any>((done) => a.agent.once("paused", done));
    expect(paused.reason).toMatch(/^Paused: the usage limit is reached\. It carries on at \d+:\d\d [AP]M\.$/);
    expect(a.live.list()[0]!.latest!.text).toBe(paused.reason);
    expect(a.supervisor.usage.claude).toMatchObject({ exhausted: true });
    // The stopped turn is neither a finished turn nor a failure.
    expect(a.events).toEqual(["paused"]);
    a.agent.send(read);
    expect(a.received()).toHaveLength(1);
    await until(() => a.events.includes("turn"));
    expect(a.events).toEqual(["paused", "resumed", "turn"]);
    // It was told to carry on, with what was sent while it waited.
    expect(a.received()[1]).toContain("The usage limit has reset. Carry on with your assignment");
    expect(a.received()[1]).toContain(read);
    expect(a.received()[1]).not.toContain("refused");
  });

  it("lets a person's message try at once, staying paused while the limit refuses it and carrying on once it gets through", async () => {
    const a = start(3600);
    await new Promise((done) => a.agent.once("paused", done));
    a.agent.steer(`steps:${JSON.stringify([{ quota: 3600 }])}`);
    await until(() => a.received().length === 2);
    await new Promise((done) => setTimeout(done, 100));
    expect(a.agent.paused).not.toBeNull();
    expect(a.events).not.toContain("resumed");
    // The limit lifted early; the next message gets through.
    a.agent.steer(read);
    await until(() => a.events.includes("turn"));
    expect(a.agent.paused).toBeNull();
    expect(a.events.slice(-2)).toEqual(["resumed", "turn"]);
    expect(a.received()).toHaveLength(3);
  });

  it("at the reset, points the agent to the messages the limit refused rather than sending them again", async () => {
    const a = start(2);
    await new Promise((done) => a.agent.once("paused", done));
    a.agent.steer(`steps:${JSON.stringify([{ quota: 2 }])}`);
    await until(() => a.events.includes("turn"), 10_000);
    expect(a.received()).toHaveLength(3);
    expect(a.received()[2]).toContain("The limit refused them at the time, so act on them now.");
  });

  it("asks Codex whether the limit still holds, and carries on when it has lifted", async () => {
    const a = start(1, { provider: "codex", ask: 50 });
    writeFileSync(join(a.folder, "limited"), "");
    // The thread's reset is not known, so it would wait the full half hour.
    await new Promise((done) => a.agent.once("paused", done));
    await new Promise((done) => setTimeout(done, 300));
    expect(a.agent.paused).not.toBeNull();
    rmSync(join(a.folder, "limited"));
    await until(() => a.events.includes("resumed"));
    await until(() => a.events.includes("turn"));
  });

  it("carries on soon after the reset when the computer slept through it", async () => {
    const a = start(3 * 3600);
    await new Promise((done) => a.agent.once("paused", done));
    // Timers stand still while the computer sleeps; only the clock moves on.
    const woke = Date.now() + 3 * 3600_000 + 1000;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => woke);
    cleanups.push(() => clock.mockRestore());
    await until(() => a.events.includes("resumed"));
    expect(a.received()[1]).toContain("The usage limit has reset.");
  });
});

describe("showing remaining usage", () => {
  it("gives a reset's date when it is not today, as a weekly limit's often is", () => {
    const now = new Date(2026, 8, 30, 17, 52).getTime();
    expect(resetTime(new Date(2026, 8, 30, 23, 26).getTime(), now)).toBe("11:26 PM");
    expect(resetTime(new Date(2026, 9, 4, 23, 26).getTime(), now)).toBe("11:26 PM on Oct 4");
    expect(resetTime(new Date(2026, 9, 1, 0, 30).getTime(), now)).toBe("12:30 AM on Oct 1");
  });

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
