// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AgentSupervisor } from "../server/agents/supervisor.mjs";
import { claudeAdapter } from "../server/agents/claude.mjs";
import { codexAdapter } from "../server/agents/codex.mjs";
import { LiveActivity, fileDescriber, researcherFiles } from "../server/live-activity.mjs";

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).reverse().forEach((clean) => clean()));

// Each fake CLI speaks its provider's protocol; the steps say what it does in a turn.
const providers = {
  claude: {
    executable: resolve("tests/fixtures/fake-claude.mjs"),
    read: (file: string, delay = 0) => ({ tool: "Read", input: { file_path: file }, delay }),
    write: (file: string) => ({ tool: "Write", input: { file_path: file }, writes: { [file]: "{}" } }),
  },
  codex: {
    executable: resolve("tests/fixtures/fake-codex.mjs"),
    read: (file: string, delay = 0) => ({ command: `cat ${file}`, delay }),
    write: (file: string) => ({ change: file, writes: { [file]: "{}" } }),
  },
};
const steps = (list: object[]) => `steps:${JSON.stringify(list)}`;

function start(provider: "claude" | "codex", prompt?: string, env: Record<string, string> = {}) {
  const folder = mkdtempSync(join(tmpdir(), "agent-"));
  cleanups.push(() => rmSync(folder, { recursive: true, force: true }));
  cleanups.push(() => rmSync(`${folder}.log`, { force: true }));
  const live = new LiveActivity();
  const supervisor = new AgentSupervisor({ live, stopGrace: 200 });
  const agent = supervisor.start({
    key: "research:fixture",
    provider,
    executable: providers[provider].executable,
    folder,
    env: { ...process.env, ...env },
    instructions: "Fixture instructions",
    tools: ["Read", "Write"],
    prompt,
    live: { role: "researcher", name: "Fixture researcher", investigationId: "fixture" },
    describe: fileDescriber(researcherFiles, { "doc-1.pdf": "The fictional register" }),
  });
  cleanups.push(() => agent.stop());
  const actions: string[] = [];
  const turns: string[] = [];
  agent.on("action", (text: string) => actions.push(text));
  agent.on("turn", ({ outcome }: { outcome: string }) => turns.push(outcome));
  const next = (event: string) => new Promise<any>((done) => agent.once(event, done));
  return { folder, live, agent, actions, turns, next };
}

describe.each(["claude", "codex"] as const)("agent supervisor with a %s agent", (provider) => {
  const { read, write } = providers[provider];

  it("reports each action in plain words and the end of every turn", async () => {
    const a = start(provider, steps([read("brief.json"), read("documents/doc-1.pdf")]));
    expect(a.live.list()).toMatchObject([{ role: "researcher", name: "Fixture researcher", investigationId: "fixture" }]);
    expect(a.agent.busy).toBe(true);
    expect(await a.next("turn")).toEqual({ outcome: "done" });
    expect(a.actions).toEqual(["Reading its assignment", "Reading The fictional register"]);
    expect(a.live.list()[0]!.latest!.text).toBe("Reading The fictional register");
    expect(a.agent.busy).toBe(false);
    // A waiting agent takes its next instruction as a new turn.
    a.agent.send(steps([write("checkpoint.json")]));
    expect(await a.next("turn")).toEqual({ outcome: "done" });
    expect(a.actions.at(-1)).toBe("Saving its progress");
    expect(a.turns).toEqual(["done", "done"]);
  });

  it("delivers a redirection at the agent's next step and changes what it does", async () => {
    const a = start(provider, steps([read("brief.json", 300), read("findings.ts", 300), read("types.ts", 300)]));
    await new Promise((done) => a.agent.once("action", done));
    a.agent.steer(steps([write("result.json")]));
    await a.next("turn");
    expect(a.actions).toEqual(["Reading its assignment", "Writing up its findings"]);
    expect(a.turns).toEqual(["done"]);
    expect(existsSync(join(a.folder, "result.json"))).toBe(true);
  });

  it("interrupts a turn and keeps the agent for its next instruction", async () => {
    const a = start(provider, steps([read("brief.json", 5000)]));
    await new Promise((done) => a.agent.once("action", done));
    a.agent.interrupt();
    expect(await a.next("turn")).toEqual({ outcome: "interrupted" });
    a.agent.send(steps([read("types.ts")]));
    expect(await a.next("turn")).toEqual({ outcome: "done" });
  });

  it("stops an agent mid-run and removes it from the live panel", async () => {
    const a = start(provider, steps([read("brief.json", 10_000)]));
    await new Promise((done) => a.agent.once("action", done));
    const exit = a.next("exit");
    a.agent.stop();
    expect(await exit).toMatchObject({ stopped: true });
    expect(a.live.list()).toEqual([]);
    expect(a.turns).toEqual([]);
  });

  it("closes when told its work is finished, after what was already sent", async () => {
    const a = start(provider, steps([read("brief.json", 100)]));
    const exit = a.next("exit");
    a.agent.finish();
    expect(await exit).toEqual({ code: 0, stopped: false });
    expect(a.turns).toEqual(["done"]);
    expect(a.live.list()).toEqual([]);
    expect(() => a.agent.send("more")).toThrow("closed its input");
  });

  it("keeps the raw stream on disk for diagnosis, outside the agent's folder", async () => {
    const a = start(provider, steps([read("brief.json")]));
    await a.next("turn");
    expect(readFileSync(`${a.folder}.log`, "utf8")).toContain("Done.");
  });
});

describe("Codex app server compatibility", () => {
  it("refuses an app server older than the tested protocol, naming the version", async () => {
    const a = start("codex", steps([]), { FAKE_CODEX_VERSION: "0.120.0" });
    const failure = await a.next("failed");
    expect(failure.message).toBe("Codex 0.120.0 is older than this app supports. Update Codex to 0.155.1 or later.");
    await a.next("exit");
    expect(a.live.list()).toEqual([]);
  });
  it("refuses an app server that no longer answers a method the adapter needs", async () => {
    const a = start("codex", steps([]), { FAKE_CODEX_MISSING: "turn/start" });
    const failure = await a.next("failed");
    expect(failure.message).toBe("The Codex app server no longer supports turn/start; this app was tested with Codex 0.155.1.");
  });
});

describe("Claude adapter", () => {
  const describe_ = fileDescriber(researcherFiles);
  const session = () => {
    const written: any[] = [];
    return { written, session: claudeAdapter.session({ write: (m: any) => written.push(m), describe: describe_ }) };
  };
  it("launches in print mode with stream-json input and output", () => {
    const args = claudeAdapter.args({ instructions: "Be careful", tools: ["Read", "Write"], model: "sonnet", effort: "high" });
    expect(args.join(" ")).toContain("--print --input-format stream-json --output-format stream-json --verbose");
    expect(args).toEqual(
      expect.arrayContaining(["--allowedTools", "Read,Write", "--append-system-prompt", "Be careful", "--model", "sonnet", "--effort", "high"]),
    );
  });
  it("writes messages as user messages and interrupts with a control request", () => {
    const s = session();
    s.session.send("Look at the 1880 census");
    s.session.interrupt();
    expect(s.written[0]).toEqual({ type: "user", message: { role: "user", content: "Look at the 1880 census" } });
    expect(s.written[1]).toMatchObject({ type: "control_request", request: { subtype: "interrupt" } });
  });
  it("reads recorded Claude stream lines as actions and turn boundaries", () => {
    // Recorded from Claude Code 2.1.282 on 2026-09-25, trimmed to the fields read.
    const recorded = [
      { type: "system", subtype: "init" },
      { type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "/w/brief.json" } }] } },
      { type: "rate_limit_event", rate_limit_info: { status: "allowed" } },
      { type: "user", message: { content: [{ type: "tool_result", content: "{}" }] } },
      { type: "assistant", message: { content: [{ type: "text", text: "STEERED" }] } },
      { type: "result", subtype: "success", result: "STEERED" },
      { type: "control_response", response: { subtype: "success", request_id: "int-1" } },
      { type: "result", subtype: "error_during_execution" },
    ];
    const s = session();
    expect(recorded.map((e) => s.session.read(e))).toEqual([
      { actions: [] },
      { actions: ["Reading its assignment"] },
      { actions: [] },
      { actions: [] },
      { actions: [] },
      { actions: [], turn: { ok: true } },
      { actions: [] },
      { actions: [], turn: { ok: false } },
    ]);
  });
});

describe("Codex adapter", () => {
  it("replays a recorded app server session, including steering and interrupt", () => {
    // Recorded from Codex 0.155.1 on 2026-09-25: a turn of three slow commands
    // steered after the first, then a long command interrupted.
    const recorded = readFileSync(resolve("tests/fixtures/codex-app-server.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const written: any[] = [];
    const session = codexAdapter.session({
      write: (m: any) => written.push(m),
      describe: fileDescriber(researcherFiles),
      folder: "/work",
      instructions: "You are a test agent.",
      effort: "low",
    });
    const actions: string[] = [];
    const turns: boolean[] = [];
    // The client's side of the recording is replayed as what the supervisor asked for.
    const client = recorded.filter((r) => r.dir === "out").map((r) => r.m);
    const asked: Record<string, () => void> = {
      "turn/steer": () => session.send(client.find((m) => m.method === "turn/steer").params.input[0].text),
      "turn/interrupt": () => session.interrupt(),
    };
    let starts = 0;
    session.open();
    for (const { dir, m } of recorded) {
      if (dir === "out") {
        if (asked[m.method]) asked[m.method]!();
        if (m.method === "turn/start") {
          const text = client.filter((c) => c.method === "turn/start")[starts++].params.input[0].text;
          session.send(text);
        }
        continue;
      }
      const result = session.read(m);
      expect(result.failure).toBeUndefined();
      actions.push(...result.actions);
      if (result.turn) turns.push(result.turn.ok);
    }
    // The adapter wrote what the recorded client wrote, in the same order.
    // Only the client's name, the web setting and the probe's model differ.
    const shape = (m: any) => {
      const { clientInfo, config, model, ...params } = m.params || {};
      return JSON.parse(JSON.stringify({ method: m.method, id: m.id, params }));
    };
    expect(written.map(shape)).toEqual(client.map(shape));
    expect(written.find((m) => m.method === "thread/start").params).toMatchObject({
      cwd: "/work",
      sandbox: "workspace-write",
      approvalPolicy: "never",
      developerInstructions: "You are a test agent.",
    });
    expect(actions).toEqual([]);
    expect(turns).toEqual([true, false]);
  });
  it("names the commands, file changes and searches in Codex's items", () => {
    const session = codexAdapter.session({ write: () => {}, describe: fileDescriber(researcherFiles), folder: "/work" });
    const item = (method: string, item: object) => session.read({ method, params: { threadId: "t", turnId: "u", item } }).actions;
    expect(item("item/started", { type: "commandExecution", command: "/bin/zsh -lc 'cat brief.json'" })).toEqual(["Reading its assignment"]);
    expect(item("item/completed", { type: "fileChange", changes: [{ path: "/work/checkpoint.json" }] })).toEqual(["Saving its progress"]);
    expect(item("item/completed", { type: "webSearch", query: "Lubec cannery 1880" })).toEqual(["Searching the web for “Lubec cannery 1880”"]);
    expect(item("item/started", { type: "reasoning" })).toEqual([]);
  });
});
