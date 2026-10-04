// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JevClient, JevProblem, JevSweeps } from "../server/jev.mjs";
import { typesafeKey } from "../server/typesafe-key.mjs";

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).reverse().forEach((clean) => clean()));

// A fictional ledger of forty pages, each long enough to be a chunk of its own. Page 12
// records the sale of a mill and page 30 a marriage.
const pageText = (n: number) => `${n === 12 ? "Ada Example sold the mill to Ben Example in 1901." : n === 30 ? "Cora Example married Dan Example at the harbor chapel." : `Entry ${n}: barrels of example flour.`} `.padEnd(3900, ".");
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
    expect(result).toMatchObject({ document: "doc-1", chunks: 40, flagged: 2, whole: false, characters: ledger.length });
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
    const failures = [busy(429), busy(529), new Error("socket hang up"), busy(429, 7)];
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
    expect(state.jevFigures).toEqual({ sweeps: 2, characters: 2 * ledger.length, passed: 9 * 3900, sampled: 0, misses: 0, inputTokens: 40_000 });
    const lines = readFileSync(join(directory, "jev", "sweeps.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(lines[0]).toMatchObject({ document: "doc-1", questions: [sale, marriage], threshold: 0.3, chunks: 40, flagged: 2, characters: ledger.length, passed: 6 * 3900, requests: 40, inputTokens: 40_000 });
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
  it("says what went wrong: a refused key, a busy service with how long to wait, an answer left out", async () => {
    const answering = (response: Response) => new JevClient({ key: "k", fetch: (async () => response) as any });
    await expect(answering(reply(401, "{}")).ask({ state: "x", questions: { a: "A?" } })).rejects.toMatchObject({ status: 401, message: "TypeSafe refused the app's API key. Ask the human to check TYPESAFE_API_KEY and start the app again." });
    await expect(answering(reply(429, "slow down", { "retry-after": "3" })).ask({ state: "x", questions: { a: "A?" } })).rejects.toMatchObject({ status: 429, retryAfter: 3, message: "TypeSafe answered 429: slow down" });
    await expect(answering(reply(200, { answers: {} })).ask({ state: "x", questions: { a: "A?" } })).rejects.toThrow("TypeSafe gave no answer to one of the questions.");
  });
});

describe("the human's TypeSafe key", () => {
  it("is taken out of the environment, so nothing started afterwards inherits it", () => {
    const env: Record<string, string | undefined> = { PATH: "/bin", TYPESAFE_API_KEY: " fictional-key \n" };
    expect(typesafeKey(env)).toBe("fictional-key");
    expect(env).toEqual({ PATH: "/bin" });
    expect(typesafeKey({})).toBe("");
  });
});
