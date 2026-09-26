// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AgentSupervisor, agentCli } from "../server/agents/supervisor.mjs";
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

function start(provider: "claude" | "codex", prompt?: string, env: Record<string, string> = {}, watchInterval = 2000, logSegment?: number) {
  const folder = mkdtempSync(join(tmpdir(), "agent-"));
  cleanups.push(() => rmSync(folder, { recursive: true, force: true }));
  cleanups.push(() => ["", ".1", ".2", ".3", ".4", ".5"].forEach((n) => rmSync(`${folder}.log${n}`, { force: true })));
  const live = new LiveActivity();
  const supervisor = new AgentSupervisor({ live, stopGrace: 200, watchInterval, logSegment });
  const agent = supervisor.start({
    key: "research:fixture",
    provider,
    executable: providers[provider].executable,
    folder,
    env: { ...process.env, ...env },
    instructions: "Fixture instructions",
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
    // The turn carries the agent's final reply.
    expect(await a.next("turn")).toEqual({ outcome: "done", text: "Done." });
    expect(a.actions).toEqual(["Reading its assignment", "Reading The fictional register"]);
    expect(a.live.list()[0]!.latest!.text).toBe("Reading The fictional register");
    expect(a.agent.busy).toBe(false);
    // A waiting agent takes its next instruction as a new turn.
    a.agent.send(steps([write("checkpoint.json")]));
    expect(await a.next("turn")).toMatchObject({ outcome: "done" });
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
    expect(await a.next("turn")).toMatchObject({ outcome: "interrupted" });
    a.agent.send(steps([read("types.ts")]));
    expect(await a.next("turn")).toMatchObject({ outcome: "done" });
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

  it("sets a long log aside as it grows, so the end of the run is always kept", async () => {
    const a = start(provider, steps([read("brief.json"), read("findings.ts"), read("types.ts"), read("brief.json"), read("findings.ts")]), {}, 2000, 600);
    await a.next("turn");
    expect(existsSync(`${a.folder}.log.1`)).toBe(true);
    expect(existsSync(`${a.folder}.log.6`)).toBe(false);
    expect(readFileSync(`${a.folder}.log`, "utf8")).toContain("Done.");
  });
});

describe("isolation", () => {
  it("confines Codex to a permission profile for its folder, with the app's own homes", () => {
    const folder = realpathSync(mkdtempSync(join(tmpdir(), "agent-")));
    cleanups.push(() => rmSync(folder, { recursive: true, force: true }));
    const args = codexAdapter.args({ folder }).join(" ");
    expect(args).toContain('default_permissions="agent"');
    expect(args).toContain(`":minimal"="read"`);
    expect(args).toContain(`"${folder}"="write"`);
    expect(args).toContain("permissions.agent.network={enabled=true}");
    expect(codexAdapter.env({ PATH: "/bin", HOME: "/Users/someone" }, { homes: { codexHome: "/app/codex", home: "/app/home" } })).toEqual({
      PATH: "/bin",
      HOME: "/app/home",
      CODEX_HOME: "/app/codex",
    });
  });
  it("refuses a Codex home that is not signed in, saying how to sign in", async () => {
    const a = start("codex", steps([]), { FAKE_CODEX_SIGNED_OUT: "1" });
    const failure = await a.next("failed");
    expect(failure.message).toContain("Codex is not signed in for this app");
    expect(failure.message).toContain("npm run workspace -- sign-in codex");
  });
  it("recognises an agent CLI however it is run, and nothing that merely names one", () => {
    expect(agentCli("/usr/local/bin/codex exec hi")).toBe(true);
    expect(agentCli("node /home/u/.nvm/bin/claude -p hi")).toBe(true);
    expect(agentCli("/bin/sh /tmp/x/claude")).toBe(true);
    expect(agentCli("grep claude notes.txt")).toBe(false);
    expect(agentCli("/usr/bin/codex-linux-sandbox --x")).toBe(false);
  });
  it("stops an agent CLI started beneath an agent and reports it", async () => {
    const bin = mkdtempSync(join(tmpdir(), "agent-bin-"));
    cleanups.push(() => rmSync(bin, { recursive: true, force: true }));
    const claude = join(bin, "claude");
    writeFileSync(claude, "#!/bin/sh\nsleep 30\n");
    chmodSync(claude, 0o755);
    // Watching often only here: each look lists every process on the machine.
    const a = start("claude", steps([{ tool: "Bash", input: { command: "claude" }, run: [claude], delay: 5000 }]), {}, 100);
    const intruder = await a.next("intruder");
    expect(intruder.command).toContain(claude);
    expect(a.actions).toContain("Tried to start another agent; the app stopped it");
    expect(a.live.list()[0]!.latest!.text).toBe("Tried to start another agent; the app stopped it");
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
  it("launches in print mode with stream-json input and output, confined to its folder", () => {
    const folder = realpathSync(mkdtempSync(join(tmpdir(), "agent-")));
    cleanups.push(() => rmSync(folder, { recursive: true, force: true }));
    const args = claudeAdapter.args({ folder, instructions: "Be careful", model: "sonnet", effort: "high", web: true });
    expect(args.join(" ")).toContain("--print --input-format stream-json --output-format stream-json --verbose");
    expect(args).toEqual(
      expect.arrayContaining(["--append-system-prompt", "Be careful", "--model", "sonnet", "--effort", "high", "--setting-sources", "project", "--strict-mcp-config"]),
    );
    const settings = JSON.parse(args[args.indexOf("--settings") + 1]!);
    expect(settings.sandbox).toMatchObject({
      enabled: true,
      allowUnsandboxedCommands: false,
      filesystem: { denyRead: [homedir()], allowWrite: [folder] },
      network: { allowedDomains: ["*"] },
    });
    expect(settings.permissions.allow).toEqual(["Bash", `Read(/${folder}/**)`, `Edit(/${folder}/**)`, "WebSearch", "WebFetch"]);
    expect(settings.permissions.deny).toEqual(["Agent", "Task"]);
    const local = JSON.parse(claudeAdapter.args({ folder }).find((a: string) => a.includes("sandbox"))!);
    expect(local.permissions.allow).not.toContain("WebSearch");
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
      { actions: [], usage: { exhausted: false, resetsAt: null, windows: [] } },
      { actions: [] },
      { actions: [] },
      { actions: [], turn: { ok: true, quota: false, text: "STEERED" } },
      { actions: [] },
      { actions: [], turn: { ok: false, quota: false, text: "" } },
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
    // The recording has no sign-in check, so the adapter's requests are numbered one
    // higher; a recorded response goes to the adapter's request of the same kind.
    const nth = (list: any[], m: any) => list.filter((c) => c.method === m.method && c.id !== undefined).indexOf(m);
    const answer = (m: any) => {
      if (m.id === undefined || m.method) return m;
      const asked = client.find((c) => c.id === m.id);
      const mine = written.filter((w) => w.method === asked.method && w.id !== undefined)[nth(client, asked)];
      return { ...m, id: mine.id };
    };
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
      const signIn = written.find((w) => w.method === "account/read" && !w.answered);
      if (signIn) {
        signIn.answered = true;
        expect(session.read({ jsonrpc: "2.0", id: signIn.id, result: { account: { type: "chatgpt" }, requiresOpenaiAuth: true } }).failure).toBeUndefined();
      }
      const result = session.read(answer(m));
      expect(result.failure).toBeUndefined();
      actions.push(...result.actions);
      if (result.turn) turns.push(result.turn.ok);
    }
    // The adapter wrote what the recorded client wrote, in the same order.
    // Only the client's name, the web setting, the probe's model and sandbox, and
    // the sign-in check differ.
    const shape = (m: any) => {
      const { clientInfo, config, model, sandbox, ...params } = m.params || {};
      return JSON.parse(JSON.stringify({ method: m.method, params }));
    };
    expect(written.filter((m) => m.method !== "account/read").map(shape)).toEqual(client.map(shape));
    const thread = written.find((m) => m.method === "thread/start").params;
    expect(thread).toMatchObject({ cwd: "/work", approvalPolicy: "never", developerInstructions: "You are a test agent." });
    // A sandbox mode would replace the folder's permission profile.
    expect(thread.sandbox).toBeUndefined();
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
