// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import dataset from "./fixtures/workshop.json";
import { claudeAdapter } from "../server/agents/claude.mjs";
import { codexAdapter } from "../server/agents/codex.mjs";
import { AgentSupervisor } from "../server/agents/supervisor.mjs";
import { LiveActivity, fileDescriber } from "../server/live-activity.mjs";
import { WorkspaceStore } from "../server/store.mjs";
import { Coordinator } from "../server/coordinator.mjs";
import { CoordinatorHost } from "../server/coordinator-host.mjs";
import { contextLevel, contextNotice, liveRows } from "../src/ui/live-panel";
import { until } from "./fixtures/until";

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).reverse().forEach((clean) => clean()));
const folder = () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "context-")));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

describe("the compaction threshold", () => {
  it("is set through Claude Code's auto-compact window and Codex's auto-compact token limit", () => {
    const args = claudeAdapter.args({ folder: folder(), compactAt: 120_000 });
    expect(JSON.parse(args[args.indexOf("--settings") + 1]!).autoCompactWindow).toBe(120_000);
    expect(codexAdapter.args({ folder: folder(), compactAt: 120_000 }).join(" ")).toContain("model_auto_compact_token_limit=120000");
    // Unset, each CLI keeps its own default.
    expect(JSON.parse(claudeAdapter.args({ folder: folder() }).find((a: string) => a.includes("sandbox"))!).autoCompactWindow).toBeUndefined();
  });
});

describe("reading context size and compaction from the streams", () => {
  it("from Claude Code: usage on each reply, the window on the result, and the compact boundary", () => {
    const written: any[] = [];
    const session = claudeAdapter.session({ write: (m: any) => written.push(m), describe: fileDescriber({}) });
    expect(session.read({ type: "assistant", message: { content: [], usage: { input_tokens: 10, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 5_000, output_tokens: 500 } } }).context).toEqual({ tokens: 95_510 });
    expect((session.read({ type: "result", subtype: "success", modelUsage: { "claude-opus": { contextWindow: 180_000 } } }) as any).context).toEqual({ window: 180_000 });
    // Recorded from Claude Code 2.1.282 on 2026-09-25: /compact in print mode reports its boundary.
    expect(session.read({ type: "system", subtype: "compact_boundary", compact_metadata: { trigger: "manual", pre_tokens: 19_960, post_tokens: 2_988 } }).compacted).toEqual({ before: 19_960, after: 2_988 });
    session.compact();
    expect(written.at(-1)).toEqual({ type: "user", message: { role: "user", content: "/compact" } });
  });

  it("from Codex: the last response's tokens and the model's window, and the compact request", () => {
    const written: any[] = [];
    const session = codexAdapter.session({ write: (m: any) => written.push(m), describe: fileDescriber({}), folder: "/work" });
    const usage = { method: "thread/tokenUsage/updated", params: { threadId: "t", turnId: "u", tokenUsage: { total: { totalTokens: 400_000 }, last: { totalTokens: 54_682 }, modelContextWindow: 272_000 } } };
    expect(session.read(usage).context).toEqual({ tokens: 54_682, window: 272_000 });
    expect(session.read({ method: "thread/compacted", params: { threadId: "t" } }).compacted).toEqual({ before: null, after: null });
    // Once a thread exists, compacting now is the app server's own request.
    session.open();
    session.read({ jsonrpc: "2.0", id: 1, result: { userAgent: "x/0.155.1 (y)" } });
    session.read({ jsonrpc: "2.0", id: 2, result: { account: { type: "chatgpt" } } });
    session.read({ jsonrpc: "2.0", id: 3, result: { thread: { id: "thread-1" } } });
    session.compact();
    expect(written.at(-1)).toMatchObject({ method: "thread/compact/start", params: { threadId: "thread-1" } });
  });
});

describe("the coordinator's context", () => {
  function host(settings = {}) {
    const directory = folder();
    const store = new WorkspaceStore(directory, dataset);
    store.update((next: any) => (next.researchSettings = { timeLimitMinutes: null, ...settings }));
    const coordinator = new Coordinator(store);
    const h = new CoordinatorHost({
      store,
      coordinator,
      supervisor: new AgentSupervisor({ live: new LiveActivity(), stopGrace: 200 }),
      directory,
      root: resolve("."),
      debounce: 20,
      findExecutable: (name: string) => (name === "claude" ? resolve("tests/fixtures/fake-claude.mjs") : null),
      handle: (data: any) => coordinator.command(data),
    });
    cleanups.push(() => h.stop());
    h.start();
    return { h, store, coordinator };
  }

  it("is tracked from its stream against the threshold, and compacts now when asked", async () => {
    const { h, coordinator } = host({ compactAt: 100_000 });
    await until(() => coordinator.status().listening);
    h.agent!.send(`steps:${JSON.stringify([{ tool: "Read", input: { file_path: "AGENTS.md" }, tokens: 80_000 }])}`);
    await until(() => coordinator.status().context?.tokens === 80_000 && coordinator.status().listening);
    expect(coordinator.status().context).toMatchObject({ tokens: 80_000, threshold: 100_000, compactions: 0 });
    h.compact();
    expect(coordinator.status().context!.compacting).toBe(true);
    await until(() => coordinator.status().context!.compactions === 1);
    expect(coordinator.status().context!.compacting).toBe(false);
    // The fake reports no size afterwards; the next reply will.
    expect(coordinator.status().context!.tokens).toBe(0);
    expect(coordinator.status().latest!.text).toBe("Compacted its conversation");
  });

  it("starts fresh only when idle, from the project's saved state", async () => {
    const { h, coordinator } = host();
    await until(() => coordinator.status().listening);
    h.agent!.send(`steps:${JSON.stringify([{ tool: "Read", input: { file_path: "AGENTS.md" }, delay: 2000 }])}`);
    await until(() => !coordinator.status().listening);
    expect(() => h.startFresh()).toThrow("The coordinator is working. Start fresh once it is listening.");
    await until(() => coordinator.status().listening);
    const before = h.folder;
    await new Promise((done) => setTimeout(done, 5));
    expect(h.startFresh()).toBe(true);
    expect(h.folder).not.toBe(before);
    await until(() => coordinator.status().connected);
  });
});

describe("telling the human as the context grows", () => {
  const state = (tokens: number, listening = true) => ({ investigations: [], conversation: [], coordinator: { connected: true, listening, context: { tokens, threshold: 200_000, compactions: 0, compacting: false } } }) as any;
  it("at half, three quarters and nine tenths of the threshold, with start fresh only while it is listening", () => {
    expect([40_000, 100_000, 150_000, 180_000].map((t) => contextLevel(state(t)))).toEqual([0, 1, 2, 3]);
    expect(contextNotice(state(40_000))).toBeNull();
    expect(contextNotice(state(150_000))).toEqual({
      title: "The coordinator's context is 75% full",
      detail: "It compacts on its own at 200k tokens. You can compact it now, or start a fresh coordinator from the project's saved state.",
      canStartFresh: true,
    });
    expect(contextNotice(state(150_000, false))!.canStartFresh).toBe(false);
    expect(liveRows(state(150_000))[0]!.stage).toBe("Listening · context 75% full");
  });
});
