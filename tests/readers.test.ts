// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AgentSupervisor } from "../server/agents/supervisor.mjs";
import { Readers } from "../server/readers.mjs";
import { READER_INSTRUCTIONS } from "../src/domain/reader";
import { until } from "./fixtures/until";

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).reverse().forEach((clean) => clean()));

function project() {
  const directory = mkdtempSync(join(tmpdir(), "weir-readers-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
const tick = () => new Promise((done) => setTimeout(done, 5));

const passages = [
  { label: "ledger", document: "doc-1", pages: [{ page: 1, text: "Example Mill opened in 1882." }, { page: 2, text: "Ada Example sold the mill to Ben Example in 1901." }] },
  { label: "gazette", document: "doc-2", text: "Fine weather for the fictional regatta." },
  { label: "deed", document: "doc-3", pages: [{ page: 4, text: "Ben Example of Example Harbor, miller, holds the mill by this deed of 1901." }] },
];
const question = "Who sold the Example mill, and when?";

describe.each(["claude", "codex"] as const)("readers on %s", (provider) => {
  // The fake CLI answers a prompt holding the deed with one answer, and a prompt holding
  // the ledger and the gazette with two; anything else gets a plain reply.
  function readers() {
    const directory = project();
    const steps = join(directory, "steps.json");
    writeFileSync(
      steps,
      JSON.stringify({
        "deed ===": [{ say: JSON.stringify([{ passage: 1, relevant: true, answer: "Ben Example held it in 1901.", quotes: [{ page: 4, quote: "holds the mill by this deed of 1901" }] }]) }],
        "ledger ===": [
          {
            say: JSON.stringify([
              { passage: 1, relevant: true, answer: "Ada Example, in 1901.", quotes: [{ page: 2, quote: "Ada Example sold the mill to Ben Example in 1901." }] },
              { passage: 2, relevant: false, answer: "It does not say.", quotes: [] },
            ]),
          },
        ],
        default: [{ say: "A plain reply." }],
      }),
    );
    const launched: string[][] = [];
    const supervisor = new AgentSupervisor({
      stopGrace: 200,
      launch: ((command: string, args: string[], options: object) => {
        launched.push(args);
        return spawn(command, args, options);
      }) as typeof spawn,
    });
    const r = new Readers({ state: {} }, directory, {
      supervisor,
      findExecutable: (name: string) => resolve(`tests/fixtures/fake-${name}.mjs`),
      dispatch: { choose: () => ({ agent: provider, model: "cheap", effort: "high" }) },
      env: { ...process.env, FAKE_CLAUDE_STEPS: steps, FAKE_CODEX_STEPS: steps },
      // The ledger and the gazette fit one prompt together; the deed needs the next.
      input: 150,
    });
    cleanups.push(() => r.stop());
    return { directory, launched, readers: r };
  }

  it("answer a batch of passages, per passage, with quotes and pages", async () => {
    const { directory, launched, readers: r } = readers();
    expect(await r.ask({ question, passages })).toEqual([
      { label: "ledger", document: "doc-1", relevant: true, answer: "Ada Example, in 1901.", quotes: [{ page: 2, quote: "Ada Example sold the mill to Ben Example in 1901.", found: true }], cached: false },
      { label: "gazette", document: "doc-2", relevant: false, answer: "It does not say.", quotes: [], cached: false },
      { label: "deed", document: "doc-3", relevant: true, answer: "Ben Example held it in 1901.", quotes: [{ page: 4, quote: "holds the mill by this deed of 1901", found: true }], cached: false },
    ]);
    // Three passages, packed whole into two prompts, one reader each.
    expect(launched).toHaveLength(2);
    // Each reader's folder was only somewhere to stand, and goes with it.
    await until(() => readdirSync(join(directory, "agents", "readers")).length === 0);
  });

  it("return a repeated call from the cache without starting a reader", async () => {
    const { launched, readers: r } = readers();
    const first = await r.ask({ question, passages });
    const again = await r.ask({ question, passages: [...passages].reverse() });
    expect(launched).toHaveLength(2);
    expect(again.map((a: any) => [a.label, a.cached])).toEqual([["deed", true], ["gazette", true], ["ledger", true]]);
    expect(again[2]).toEqual({ ...first[0], cached: true });
    expect(await r.ask({ prompt: "Say something plain." })).toBe("A plain reply.");
    expect(await r.ask({ prompt: "Say something plain." })).toBe("A plain reply.");
    expect(launched).toHaveLength(3);
  });

  it("start the CLI with no tools and the reader's instructions", async () => {
    const { launched, readers: r } = readers();
    await r.ask({ prompt: "Say something plain." });
    const args = launched[0]!;
    if (provider === "claude") {
      expect(args[args.indexOf("--tools") + 1]).toBe("");
      expect(args).toEqual(expect.arrayContaining(["--strict-mcp-config", "--no-session-persistence", "--model", "cheap", "--effort", "high", "--system-prompt", READER_INSTRUCTIONS]));
      expect(args.join(" ")).not.toMatch(/--settings|--append-system-prompt|--resume/);
    } else {
      const joined = args.join(" ");
      expect(joined).toContain("permissions.agent.network={enabled=false}");
      expect(joined).toContain("features.shell_tool=false");
      expect(joined).toContain("features.unified_exec=false");
      expect(joined).not.toContain('="write"');
    }
  });
});

// A supervisor whose readers answer when the test says so.
function staged({ limit = 20 }: { limit?: number } = {}) {
  const directory = project();
  const started: any[] = [];
  const supervisor = {
    start(options: any) {
      const agent = Object.assign(new EventEmitter(), { stopped: false, stop() { agent.stopped = true; } });
      started.push({ ...options, agent });
      return agent;
    },
  };
  let choice: any = { agent: "codex", model: "gpt-6-luna", effort: "high" };
  const state: any = { researchSettings: { readerLimit: limit } };
  const readers = new Readers({ state }, directory, { supervisor, findExecutable: (name: string) => `/bin/${name}`, dispatch: { choose: () => choice } });
  // Answers each passage in a prompt with its own label.
  const answer = (job: any) =>
    job.agent.emit("turn", {
      outcome: "done",
      text: JSON.stringify([...job.prompt.matchAll(/^=== Passage (\d+): (.*) ===$/gm)].map((m) => ({ passage: Number(m[1]), relevant: true, answer: `About ${m[2]}.`, quotes: [] }))),
    });
  return { directory, started, readers, state, answer, choose: (next: any) => (choice = next) };
}

describe("the reader limit", () => {
  it("holds further calls, and starts them in the order they were asked as places come free", async () => {
    const { started, readers, state } = staged({ limit: 2 });
    const replies = ["one", "two", "three", "four", "five"].map((word) => readers.ask({ prompt: word }));
    await tick();
    expect(started.map((s) => s.prompt)).toEqual(["one", "two"]);
    started[1].agent.emit("turn", { outcome: "done", text: "Second." });
    await tick();
    expect(started.map((s) => s.prompt)).toEqual(["one", "two", "three"]);
    expect(started[1].agent.stopped).toBe(true);
    // A raised limit lets more of them start.
    state.researchSettings.readerLimit = 4;
    readers.pump();
    expect(started.map((s) => s.prompt)).toEqual(["one", "two", "three", "four", "five"]);
    for (const job of started) job.agent.emit("turn", { outcome: "done", text: `Reply to ${job.prompt}.` });
    expect(await Promise.all(replies)).toEqual(["Reply to one.", "Second.", "Reply to three.", "Reply to four.", "Reply to five."]);
  });
  it("counts the prompts of one batch", async () => {
    const { started, readers, answer } = staged({ limit: 1 });
    const many = Array.from({ length: 3 }, (_, n) => ({ label: `p${n + 1}`, text: "x".repeat(60_000) }));
    const asked = readers.ask({ question, passages: many });
    await tick();
    expect(started).toHaveLength(1);
    answer(started[0]);
    await tick();
    expect(started).toHaveLength(2);
    answer(started[1]);
    await tick();
    answer(started[2]);
    expect((await asked).map((a: any) => a.answer)).toEqual(["About p1.", "About p2.", "About p3."]);
  });
});

describe("what a reader's answer is kept under", () => {
  it("asks again for another question, another model or another input, and only for the passage that changed", async () => {
    const { started, readers, answer, choose } = staged();
    const ask = async (given: any) => {
      const asked = readers.ask(given);
      await tick();
      const fresh = started.filter((s) => !s.answered);
      for (const job of fresh) {
        job.answered = true;
        answer(job);
      }
      return { answers: await asked, prompts: fresh.map((s) => s.prompt as string) };
    };
    expect((await ask({ question, passages })).prompts).toHaveLength(1);
    expect((await ask({ question, passages })).prompts).toHaveLength(0);
    // Another question.
    const other = await ask({ question: "Who bought the mill?", passages });
    expect(other.prompts).toHaveLength(1);
    expect(other.answers.every((a: any) => !a.cached)).toBe(true);
    // Another input: only the changed passage goes to a reader.
    const changed = await ask({ question, passages: [passages[0], { label: "gazette", text: "Rain stopped the fictional regatta." }, passages[2]] });
    expect(changed.answers.map((a: any) => a.cached)).toEqual([true, false, true]);
    expect(changed.prompts).toHaveLength(1);
    expect(changed.prompts[0]).toContain("=== Passage 1: gazette ===\nRain stopped");
    expect(changed.prompts[0]).not.toContain("ledger");
    // A passage's label is not part of what it is kept under; its text is.
    expect((await ask({ question, passages: [{ label: "renamed", text: "Rain stopped the fictional regatta." }] })).answers[0].cached).toBe(true);
    // Another model, and another effort.
    choose({ agent: "claude", model: "haiku", effort: null });
    expect((await ask({ question, passages })).answers.every((a: any) => !a.cached)).toBe(true);
    choose({ agent: "codex", model: "gpt-6-luna", effort: "low" });
    expect((await ask({ question, passages })).answers.every((a: any) => !a.cached)).toBe(true);
    choose({ agent: "codex", model: "gpt-6-luna", effort: "high" });
    expect((await ask({ question, passages })).answers.every((a: any) => a.cached)).toBe(true);
  });
});

describe("a reader that does not answer", () => {
  const big = (label: string) => ({ label, text: label.repeat(40_000) });
  it("leaves its passages with the problem, keeps the others' answers, and is asked again next time", async () => {
    const { started, readers, answer } = staged();
    const asked = readers.ask({ question, passages: [big("aa"), big("bb")] });
    await tick();
    expect(started).toHaveLength(2);
    answer(started[0]);
    started[1].agent.emit("turn", { outcome: "error", text: "" });
    expect(await asked).toEqual([
      { label: "aa", relevant: true, answer: "About aa.", quotes: [], cached: false },
      { label: "bb", problem: "The reader's turn failed before it answered.", cached: false },
    ]);
    const again = readers.ask({ question, passages: [big("aa"), big("bb")] });
    await tick();
    expect(started).toHaveLength(3);
    expect(started[2].prompt).toContain("=== Passage 1: bb ===");
    started[2].agent.emit("turn", { outcome: "done", text: "Not what was asked for." });
    // A reply that could not be read is not kept either.
    expect((await again).map((a: any) => a.cached ?? a.problem)).toEqual([true, false]);
    expect((await again)[1].problem).toBe("The reader's reply was not the JSON it was asked for.");
    const third = readers.ask({ question, passages: [big("bb")] });
    await tick();
    expect(started).toHaveLength(4);
    answer(started[3]);
    expect((await third)[0]).toMatchObject({ answer: "About bb.", cached: false });
  });
  it("says why when none could run: the usage limit, a CLI that fails, or none installed", async () => {
    const { started, readers, directory } = staged();
    const limited = readers.ask({ question, passages });
    await tick();
    started[0].agent.emit("paused", { resetsAt: null, reason: "Paused" });
    await expect(limited).rejects.toThrow("The readers' usage limit is reached. Answers already given are kept, so the same call later asks only for the rest.");
    expect(started[0].agent.stopped).toBe(true);
    const failing = readers.ask({ prompt: "Anything." });
    await tick();
    started[1].agent.emit("failed", new Error("Codex is not signed in for this app."));
    await expect(failing).rejects.toThrow("The reader could not run: Codex is not signed in for this app.");
    // The log of a reader that failed is kept for diagnosis; there is none here, and its folder is gone.
    expect(readdirSync(join(directory, "agents", "readers"))).toEqual([]);
    readers.findExecutable = () => null;
    await expect(readers.ask({ prompt: "Anything." })).rejects.toThrow("No agent CLI is installed for readers.");
  });
  it("is ended when it takes too long", async () => {
    const directory = project();
    const agent = Object.assign(new EventEmitter(), { stopped: false, stop() { agent.stopped = true; } });
    const readers = new Readers({ state: {} }, directory, { supervisor: { start: () => agent }, findExecutable: () => "/bin/codex", dispatch: { choose: () => ({ agent: "codex" }) }, patience: 20 });
    await expect(readers.ask({ prompt: "Anything." })).rejects.toThrow("The reader did not answer in time, and was ended.");
    expect(agent.stopped).toBe(true);
  });
});

describe("a seat whose session has ended", () => {
  it("has its readers stopped and its waiting calls dropped, leaving its teammates' alone", async () => {
    const { started, readers } = staged({ limit: 2 });
    const outcomes: string[] = [];
    const ask = (prompt: string, seat: string) => readers.ask({ prompt }, { seat }).then((text: string) => outcomes.push(text), (error: Error) => outcomes.push(error.message));
    const all = [ask("first", "seat-1"), ask("second", "seat-2"), ask("third", "seat-1"), ask("fourth", "seat-2")];
    await tick();
    readers.cancel("seat-1");
    await tick();
    expect(started[0].agent.stopped).toBe(true);
    // The place it freed goes to the next call still wanted.
    expect(started.map((s) => s.prompt)).toEqual(["first", "second", "fourth"]);
    started[1].agent.emit("turn", { outcome: "done", text: "Second." });
    started[2].agent.emit("turn", { outcome: "done", text: "Fourth." });
    await Promise.all(all);
    expect(outcomes.sort()).toEqual(["Fourth.", "Second.", "The seat's session ended before its readers answered.", "The seat's session ended before its readers answered."]);
    expect(existsSync(join(readers.directory, "cache", "reader"))).toBe(true);
  });
});
