// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JevClient, JevProblem, JevSweeps } from "../server/jev.mjs";
import { keyFile, stowKey, typesafeKey } from "../server/typesafe-key.mjs";
import { Readers } from "../server/readers.mjs";
import { EventEmitter } from "node:events";

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).reverse().forEach((clean) => clean()));

// A fictional ledger of forty pages, each long enough to be a chunk of its own. Page 12
// records the sale of a mill and page 30 a marriage.
const pageText = (n: number) => `${n === 12 ? "Ada Example sold the mill to Ben Example in 1901." : n === 30 ? "Cora Example married Dan Example at the harbor chapel." : `Entry ${n}: barrels of example flour.`} `.padEnd(3900, ".");
// The ledger's own text, page by page.
const ledgerSize = 40 * 3900;
const ledger = Array.from({ length: 40 }, (_, n) => `[Page ${n + 1}]\n${pageText(n + 1)}`).join("\n\n");

// A stand-in for TypeSafe: a question about a sale is likely true of a chunk naming one,
// and one about a marriage of a chunk naming one.
function fakeClient({ fail = (_n: number, _state: string): Error | null => null } = {}) {
  const requests: { state: string; questions: Record<string, string> }[] = [];
  let calls = 0;
  return {
    key: "fictional-key",
    model: "jev-latest",
    requests,
    get calls() {
      return calls;
    },
    async ask({ state, questions }: { state: string; questions: Record<string, string> }) {
      const problem = fail(calls++, state);
      if (problem) throw problem;
      requests.push({ state, questions });
      const answers = Object.fromEntries(Object.entries(questions).map(([name, q]) => [name, /sale|sold/.test(q) ? (state.includes("sold the mill") ? 0.95 : 0.02) : /marri/.test(q) ? (state.includes("married") ? 0.4 : 0.01) : 0.2]));
      return { answers, inputTokens: 1000 };
    },
  };
}

function sweeps({ client = fakeClient(), readers = null as any, ...options }: any = {}) {
  const directory = mkdtempSync(join(tmpdir(), "weir-jev-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const state: any = { documents: [{ id: "doc-1", text: ledger }, { id: "doc-2", text: "" }] };
  const store = { state, update: (change: (next: any) => void) => change(state) };
  const waits: number[] = [];
  let clock = 0;
  const s = new JevSweeps(store, directory, {
    client,
    readers,
    random: () => 0,
    now: () => clock,
    sleep: async (ms: number) => {
      waits.push(ms);
      clock += ms;
    },
    ...options,
  });
  return { sweeps: s, client, state, directory, waits };
}
const sale = "Does this text record the sale of a mill?";
const marriage = "Does this text record a marriage?";

describe("a Jev sweep", () => {
  it("cuts the document into chunks and asks every question of each chunk in one request", async () => {
    const { sweeps: s, client } = sweeps();
    const result = await s.sweep({ document: "doc-1", questions: [sale, marriage] });
    expect(client.requests).toHaveLength(40);
    expect(client.requests.every((r: any) => r.state.length < 4100)).toBe(true);
    expect(client.requests[11]).toEqual({ state: `[Page 12]\n${pageText(12)}`, questions: { q1: sale, q2: marriage } });
    expect(result).toMatchObject({ document: "doc-1", chunks: 40, flagged: 2, whole: false, characters: ledgerSize });
  });
  it("returns the flagged chunks as passages a reader takes, saying which questions flagged each", async () => {
    const { sweeps: s } = sweeps();
    const { passages, passed } = await s.sweep({ document: "doc-1", questions: { sale, marriage } });
    expect(passages.map((p: any) => [p.label, p.document, p.matched, p.probability, p.pages.map((q: any) => q.page)])).toEqual([
      ["doc-1, page 11 line 1 to page 13 line 1", "doc-1", ["sale"], 0.95, [11, 12, 13]],
      ["doc-1, page 29 line 1 to page 31 line 1", "doc-1", ["marriage"], 0.4, [29, 30, 31]],
    ]);
    expect(passages[0]!.pages[1]!.text).toBe(pageText(12));
    expect(passed).toBe(6 * 3900);
  });
  it("flags a chunk when any question's probability reaches the threshold, 0.3 unless the caller says", async () => {
    const { sweeps: s } = sweeps();
    expect((await s.sweep({ document: "doc-1", questions: [sale, marriage], threshold: 0.5 })).flagged).toBe(1);
    expect((await s.sweep({ document: "doc-1", questions: [sale, marriage], threshold: 0.4 })).flagged).toBe(2);
    // A question every chunk scores 0.2 on flags none at 0.3, and the whole document at 0.2.
    expect((await s.sweep({ document: "doc-1", questions: ["Is this a ledger?"] })).passages).toEqual([]);
    const all = await s.sweep({ document: "doc-1", questions: ["Is this a ledger?"], threshold: 0.2 });
    expect(all).toMatchObject({ flagged: 40, whole: true });
    expect(all.passages.map((p: any) => p.pages.length).reduce((a: number, b: number) => a + b)).toBe(40);
    await expect(s.sweep({ document: "doc-1", questions: [sale], threshold: 1.5 })).rejects.toThrow("The threshold is a probability between 0 and 1");
  });
  it("keeps each answer, so a repeated sweep asks nothing and a new question is asked alone", async () => {
    const { sweeps: s, client } = sweeps();
    await s.sweep({ document: "doc-1", questions: [sale] });
    await s.sweep({ document: "doc-1", questions: { again: sale }, threshold: 0.6 });
    expect(client.requests).toHaveLength(40);
    const both = await s.sweep({ document: "doc-1", questions: { sale, marriage } });
    expect(client.requests).toHaveLength(80);
    expect(client.requests[79]!.questions).toEqual({ marriage });
    expect(both.flagged).toBe(2);
  });
  it("tries again with a growing wait when TypeSafe is busy, as long as it says to, and holds the other requests back too", async () => {
    const busy = (status: number, retryAfter = 0) => new JevProblem(`TypeSafe answered ${status}`, { status, retryAfter });
    // The first chunk's request fails four times before it is answered.
    const failures = [busy(429), busy(529), busy(503), busy(429, 7)];
    const { sweeps: s, client, waits } = sweeps({ client: fakeClient({ fail: (_n, state) => (state.startsWith("[Page 1]\n") ? failures.shift() ?? null : null) }), rate: { requests: 1000, tokens: 1e9, inFlight: 100 } });
    const result = await s.sweep({ document: "doc-1", questions: [sale] });
    expect(result.flagged).toBe(1);
    expect(client.calls).toBe(44);
    // Half a second, then one, then two, then the seven seconds TypeSafe asked for.
    expect(waits.filter((ms) => ms >= 400).map((ms) => Math.round(ms / 100) / 10)).toEqual([0.5, 1, 2, 7]);
  });
  it("gives up after its tries, and at once for a problem that waiting will not mend", async () => {
    const always = sweeps({ client: fakeClient({ fail: () => new JevProblem("TypeSafe answered 529", { status: 529 }) }), retries: 3, rate: { requests: 1000, tokens: 1e9, inFlight: 1 } });
    await expect(always.sweeps.sweep({ document: "doc-1", questions: [sale] })).rejects.toThrow("TypeSafe answered 529");
    expect(always.client.calls).toBeGreaterThanOrEqual(4);
    const refused = sweeps({ client: fakeClient({ fail: () => new JevProblem("TypeSafe answered 422: questions.q1 is malformed", { status: 422 }) }), rate: { requests: 1000, tokens: 1e9, inFlight: 1 } });
    await expect(refused.sweeps.sweep({ document: "doc-1", questions: [sale] })).rejects.toThrow("TypeSafe answered 422");
    // Each chunk's request was made once, and none again.
    expect(refused.client.calls).toBeLessThanOrEqual(40);
  });
  it("spaces its requests to stay within the requests and the tokens allowed each second", async () => {
    // Ten requests a second: forty chunks take about four seconds.
    const byRequests = sweeps({ rate: { requests: 10, tokens: 1e9, inFlight: 100 } });
    await byRequests.sweeps.sweep({ document: "doc-1", questions: [sale] });
    expect(Math.round(byRequests.waits.reduce((a, b) => a + b, 0) / 100) / 10).toBe(3.9);
    // Each chunk is about 1,300 tokens: at 2,600 a second, two chunks a second.
    const byTokens = sweeps({ rate: { requests: 1000, tokens: 2600, inFlight: 100 } });
    await byTokens.sweeps.sweep({ document: "doc-1", questions: [sale] });
    const seconds = byTokens.waits.reduce((a, b) => a + b, 0) / 1000;
    expect(seconds).toBeGreaterThan(19);
    expect(seconds).toBeLessThan(21);
  });
  it("records what each sweep let through, in the project's figures and in detail", async () => {
    const { sweeps: s, state, directory } = sweeps();
    await s.sweep({ document: "doc-1", questions: [sale, marriage] });
    await s.sweep({ document: "doc-1", questions: [sale] });
    expect(state.jevFigures).toEqual({ sweeps: 2, characters: 2 * ledgerSize, passed: 9 * 3900, sampled: 0, misses: 0, inputTokens: 40_000 });
    const lines = readFileSync(join(directory, "jev", "sweeps.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(lines[0]).toMatchObject({ document: "doc-1", questions: [sale, marriage], threshold: 0.3, chunks: 40, flagged: 2, characters: ledgerSize, passed: 6 * 3900, requests: 40, inputTokens: 40_000 });
    expect(lines[1]).toMatchObject({ flagged: 1, requests: 0, inputTokens: 0 });
  });
  it("sends a few chunks it passed over to a reader with the same questions, and records each the reader finds relevant as a miss", async () => {
    const asked: any[] = [];
    const readers = {
      async ask(given: any) {
        asked.push(given);
        // The reader finds the marriage that a sweep for sales passed over.
        return given.passages.map((p: any) => ({ ...p, relevant: p.text.includes("married"), answer: p.text.includes("married") ? "It records a marriage." : "No.", quotes: [], cached: false }));
      },
    };
    // Picks chunk 30, the marriage, first; then the first two left.
    const picks = [26.5 / 37, 0, 0];
    const { sweeps: s, state, directory } = sweeps({ readers, random: () => picks.shift() ?? 0 });
    const result = await s.sweep({ document: "doc-1", questions: [sale, "Does this text name a member of the Example family?"] });
    // The sweep does not wait for its samples.
    expect(state.jevFigures).toMatchObject({ sampled: 0, misses: 0 });
    await s.sampled();
    expect(asked).toHaveLength(1);
    expect(asked[0].question).toBe(`Does the passage answer, or help to answer, any of these questions?\n- ${sale}\n- Does this text name a member of the Example family?`);
    expect(asked[0].passages.map((p: any) => p.label)).toEqual(["chunk 30", "chunk 1", "chunk 2"]);
    expect(asked[0].passages[0].text).toBe(`[Page 30]\n${pageText(30)}`);
    // None of the sampled chunks is in a passage the sweep returned.
    expect(result.passages.flatMap((p: any) => p.pages.map((q: any) => q.page))).toEqual([11, 12, 13]);
    expect(state.jevFigures).toMatchObject({ sweeps: 1, sampled: 3, misses: 1 });
    const detail = JSON.parse(readFileSync(join(directory, "jev", "sweeps.jsonl"), "utf8").trim().split("\n")[1]!);
    expect(detail).toMatchObject({ document: "doc-1", sampled: [29, 0, 1], misses: [{ chunk: 29, answer: "It records a marriage." }] });
  });
  it("samples nothing when the whole document went through, and records nothing when no reader could run", async () => {
    const asked: any[] = [];
    const whole = sweeps({ readers: { ask: async (given: any) => (asked.push(given), []) } });
    await whole.sweeps.sweep({ document: "doc-1", questions: ["Is this a ledger?"], threshold: 0.2 });
    await whole.sweeps.sampled();
    expect(asked).toEqual([]);
    const failing = sweeps({ readers: { ask: async () => Promise.reject(new Error("No agent CLI is installed for readers.")) } });
    await failing.sweeps.sweep({ document: "doc-1", questions: [sale] });
    await failing.sweeps.sampled();
    expect(failing.state.jevFigures).toMatchObject({ sweeps: 1, sampled: 0, misses: 0 });
  });
  it("holds back requests already waiting their turn when TypeSafe says to wait", async () => {
    vi.useFakeTimers();
    cleanups.push(() => vi.useRealTimers());
    const at: number[] = [];
    const started = Date.now();
    let first = true;
    const client = {
      key: "k",
      model: "jev-latest",
      async ask({ questions }: any) {
        at.push(Date.now() - started);
        if (first) {
          first = false;
          throw new JevProblem("TypeSafe answered 429", { status: 429, retryAfter: 7 });
        }
        return { answers: Object.fromEntries(Object.keys(questions).map((name) => [name, 0])), inputTokens: 1 };
      },
    };
    const { sweeps: s, state } = sweeps({ client, now: Date.now, sleep: (ms: number) => new Promise<void>((done) => setTimeout(done, ms)), rate: { requests: 60, tokens: 1e9, inFlight: 32 } });
    state.documents[0].text = Array.from({ length: 4 }, (_, n) => `[Page ${n + 1}]\n${pageText(n + 1)}`).join("\n\n");
    const swept = s.sweep({ document: "doc-1", questions: [sale] });
    await vi.runAllTimersAsync();
    await swept;
    expect(at[0]).toBe(0);
    // The three already due within fifty milliseconds wait the seven seconds too.
    expect(at.slice(1).every((ms) => ms >= 7000)).toBe(true);
    expect(at).toHaveLength(5);
  });
  it("never has more requests under way than its limit, retries included", async () => {
    vi.useFakeTimers();
    cleanups.push(() => vi.useRealTimers());
    let under = 0;
    let most = 0;
    let calls = 0;
    const client = {
      key: "k",
      model: "jev-latest",
      async ask({ questions }: any) {
        most = Math.max(most, ++under);
        const n = calls++;
        await new Promise((done) => setTimeout(done, 10));
        under--;
        if (n % 3 === 0) throw new JevProblem("TypeSafe answered 529", { status: 529 });
        return { answers: Object.fromEntries(Object.keys(questions).map((name) => [name, 0])), inputTokens: 1 };
      },
    };
    const { sweeps: s } = sweeps({ client, now: Date.now, sleep: (ms: number) => new Promise<void>((done) => setTimeout(done, ms)), rate: { requests: 1000, tokens: 1e9, inFlight: 2 }, retries: 20 });
    const swept = s.sweep({ document: "doc-1", questions: [sale] });
    await vi.runAllTimersAsync();
    expect((await swept).chunks).toBe(40);
    expect(most).toBe(2);
  });
  it("records what the answered requests cost when another fails the sweep", async () => {
    const { sweeps: s, state, client } = sweeps({ client: fakeClient({ fail: (_n, text) => (text.startsWith("[Page 40]") ? new JevProblem("TypeSafe answered 422: malformed", { status: 422 }) : null) }) });
    await expect(s.sweep({ document: "doc-1", questions: [sale] })).rejects.toThrow("TypeSafe answered 422");
    expect(state.jevFigures).toEqual({ sweeps: 0, characters: 0, passed: 0, sampled: 0, misses: 0, inputTokens: 39_000 });
    expect(client.requests).toHaveLength(39);
  });
  it("keeps blank stretches of a document in its passages, asks nothing about them, and counts line ends in what it let through", async () => {
    const { sweeps: s, state, client } = sweeps();
    const lines = Array.from({ length: 3000 }, (_, n) => (n === 1500 ? "Ada Example sold the mill." : `Line ${n}.`)).join("\n");
    const page = `${"A".repeat(3990)}\n${" ".repeat(9000)}\nB`;
    state.documents[0].text = `[Page 1]\n${page}\n\n[Page 2]\n${lines}`;
    const swept = await s.sweep({ document: "doc-1", questions: ["Is this a ledger?"], threshold: 0.2 });
    expect(swept.whole).toBe(true);
    expect(swept.passages.flatMap((p: any) => p.pages).filter((p: any) => p.page === 1).map((p: any) => p.text).join("")).toBe(page);
    expect(client.requests.some((r: any) => !r.state.replace(/\[Page \d+\]/g, "").trim())).toBe(false);
    expect(swept.characters).toBe(page.length + lines.length);
    expect(swept.passed).toBe(swept.characters);
  });
  it("samples with the real readers' rules: long questions are asked in turns, and a chunk is counted once", async () => {
    const directory = mkdtempSync(join(tmpdir(), "weir-jev-readers-"));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    const prompts: string[] = [];
    const supervisor = {
      start(options: any) {
        const agent = Object.assign(new EventEmitter(), { stop() { setTimeout(() => agent.emit("exit", {})); } });
        prompts.push(options.prompt);
        const numbers = [...options.prompt.matchAll(/^=== Passage (\d+): /gm)].map((m: any) => Number(m[1]));
        setTimeout(() => agent.emit("turn", { outcome: "done", text: JSON.stringify(numbers.map((passage) => ({ passage, relevant: true, answer: "It helps.", quotes: [] }))) }));
        return agent;
      },
    };
    const readers = new Readers({ state: {} }, directory, { supervisor, findExecutable: () => "/bin/codex", dispatch: { choose: () => ({ agent: "codex" }) } });
    const long = Array.from({ length: 5 }, (_, n) => `Does this text record sale number ${n}? ${"Consider every entry. ".repeat(90)}`.slice(0, 2000));
    const { sweeps: s, state } = sweeps({ readers });
    await s.sweep({ document: "doc-1", questions: long });
    await s.sampled();
    // Ten thousand characters of questions do not fit one reader's question: two turns.
    expect(prompts).toHaveLength(2);
    expect(state.jevFigures).toMatchObject({ sampled: 3, misses: 3 });
  });
  it("lets nothing escape when a sample cannot be recorded", async () => {
    const readers = { ask: async (given: any) => given.passages.map((p: any) => ({ ...p, relevant: true, answer: "Yes.", quotes: [] })) };
    const { sweeps: s, state } = sweeps({ readers });
    const escaped: unknown[] = [];
    const listen = (reason: unknown) => escaped.push(reason);
    process.on("unhandledRejection", listen);
    cleanups.push(() => process.off("unhandledRejection", listen));
    await s.sweep({ document: "doc-1", questions: [sale] });
    // The project's state can no longer be saved.
    s.store.update = () => {
      throw new Error("ENOSPC: no space left on device");
    };
    await s.sampled();
    await new Promise((done) => setTimeout(done, 20));
    expect(escaped).toEqual([]);
    expect(s.sampling.size).toBe(0);
    expect(state.jevFigures).toMatchObject({ sampled: 0 });
  });
  it("refuses plainly without a key, for a document it does not have, and for questions it cannot take", async () => {
    const { sweeps: s } = sweeps({ client: new JevClient({ key: "" }) });
    await expect(s.sweep({ document: "doc-1", questions: [sale] })).rejects.toThrow(
      "Jev needs the human's TypeSafe API key, and the app was started without one. Tell the human that TYPESAFE_API_KEY is not set; the setup screen says how. Meanwhile you can search the document with weir.library.search, or send it to readers as passages.",
    );
    const { sweeps: keyed } = sweeps();
    await expect(keyed.sweep({ document: "doc-9", questions: [sale] })).rejects.toThrow('No saved document has the ID "doc-9".');
    await expect(keyed.sweep({ document: "doc-2", questions: [sale] })).rejects.toThrow("Document doc-2 has no text to sweep yet.");
    await expect(keyed.sweep({ document: "doc-1", questions: [] })).rejects.toThrow("Give Jev one or more yes-or-no questions");
    await expect(keyed.sweep({ document: "doc-1", questions: Array.from({ length: 21 }, () => sale) })).rejects.toThrow("Jev takes up to 20 questions in one sweep; you sent 21.");
  });
});

describe("the Jev client", () => {
  const reply = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
  it("sends the state and its yes-or-no questions to TypeSafe's endpoint with the key, and reads each probability", async () => {
    const sent: any[] = [];
    const client = new JevClient({
      key: "fictional-key",
      fetch: (async (url: string, init: any) => {
        sent.push({ url, headers: init.headers, body: JSON.parse(init.body) });
        return reply(200, { model: "jev-1.13.0", answers: { sale: { type: "noul", noul: 0.99 }, weather: { type: "noul", noul: 0 } }, usage: { input_tokens: 310, output_tokens: 2 } });
      }) as any,
    });
    expect(await client.ask({ state: "Ada Example sold the mill.", questions: { sale: "Was a mill sold?", weather: "Is the weather described?" } })).toEqual({ answers: { sale: 0.99, weather: 0 }, inputTokens: 310 });
    expect(sent).toEqual([
      {
        url: "https://api.typesafe.ai/v1/systemone",
        headers: { Authorization: "Bearer fictional-key", "Content-Type": "application/json" },
        body: { state: "Ada Example sold the mill.", model: "jev-latest", questions: { sale: { type: "noul", instructions: "Was a mill sold?" }, weather: { type: "noul", instructions: "Is the weather described?" } } },
      },
    ]);
  });
  it("never passes on a failed connection's own words, which can hold the key", async () => {
    const client = new JevClient({ key: "fictional-key", fetch: (async () => Promise.reject(Object.assign(new TypeError("Headers.append: \"Bearer fictional-key\" is an invalid header value."), { cause: { code: "ECONNRESET" } }))) as any });
    const problem = await client.ask({ state: "x", questions: { a: "A?" } }).catch((error: Error) => error);
    expect(problem).toMatchObject({ status: 503, message: "TypeSafe could not be reached (ECONNRESET)." });
    expect(JSON.stringify(problem)).not.toContain("fictional-key");
  });
  it("says what went wrong: a refused key, a busy service with how long to wait, an answer left out", async () => {
    const answering = (response: Response) => new JevClient({ key: "k", fetch: (async () => response) as any });
    await expect(answering(reply(401, "{}")).ask({ state: "x", questions: { a: "A?" } })).rejects.toMatchObject({ status: 401, message: "TypeSafe refused the app's API key. Ask the human to check TYPESAFE_API_KEY and start the app again." });
    await expect(answering(reply(429, "slow down", { "retry-after": "3" })).ask({ state: "x", questions: { a: "A?" } })).rejects.toMatchObject({ status: 429, retryAfter: 3, message: "TypeSafe answered 429: slow down" });
    await expect(answering(reply(200, { answers: {} })).ask({ state: "x", questions: { a: "A?" } })).rejects.toThrow("TypeSafe gave no answer to one of the questions.");
  });
});

describe("the human's TypeSafe key", () => {
  const home = () => {
    const folder = mkdtempSync(join(tmpdir(), "weir-key-"));
    cleanups.push(() => rmSync(folder, { recursive: true, force: true }));
    return folder;
  };
  it("is moved from the environment into the app's own file, which only the human's account can read", () => {
    const folder = home();
    const env: Record<string, string | undefined> = { PATH: "/bin", TYPESAFE_API_KEY: " fictional-key-1 \n" };
    expect(typesafeKey(folder)).toBe("");
    stowKey(folder, env);
    expect(env).toEqual({ PATH: "/bin" });
    expect(typesafeKey(folder)).toBe("fictional-key-1");
    expect(statSync(keyFile(folder)).mode & 0o777).toBe(0o600);
    // Started later without the key in the environment, the app still has it; a new key replaces it.
    stowKey(folder, { PATH: "/bin" });
    expect(typesafeKey(folder)).toBe("fictional-key-1");
    stowKey(folder, { TYPESAFE_API_KEY: "fictional-key-2" });
    expect(typesafeKey(folder)).toBe("fictional-key-2");
  });
  it("is not kept when it could not be sent as it is, and still leaves the environment", () => {
    const folder = home();
    const env: Record<string, string | undefined> = { TYPESAFE_API_KEY: "fictional\nkey with a break" };
    stowKey(folder, env);
    expect(env).toEqual({});
    expect(typesafeKey(folder)).toBe("");
  });
});
