// Jev, TypeSafe's typed-decision model, sweeps a long document cheaply: the document is
// cut into small chunks, every yes-or-no question is asked of each chunk in one request,
// and the chunks any question is likely true of become passages for readers. Each answer
// is kept in the project's cache, each sweep records how much text it let through, and a
// few of the chunks it passed over go to a reader, to see what it missed.
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { blank, buildPassages, charactersIn, chunkPages, chunkText } from "../src/domain/passages.ts";
import { readerQuestion } from "../src/domain/reader.ts";
import { pagesOf } from "../src/domain/quotes.ts";
import { CallCache } from "./call-cache.mjs";

export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const JEV_MODEL = "jev-latest";
export const DEFAULT_THRESHOLD = 0.3;
const MAX_QUESTIONS = 20;
const MAX_QUESTION = 2_000;
// TypeSafe publishes 80 requests and 100,000 tokens a second, and says both may change
// without notice; the sweep stays under them and slows down when told to.
const RATE = { requests: 60, tokens: 80_000, inFlight: 32 };
const RETRIES = 6;
const SAMPLE = 3;
// How much of a reader's question the sweep's questions may fill.
const ROOM = 9_000;

export class JevProblem extends Error {
  constructor(message, { status = 0, retryAfter = 0 } = {}) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}
const retryable = (error) => error instanceof JevProblem && (error.status === 408 || error.status === 429 || error.status >= 500);

// The one call to TypeSafe: a state and yes-or-no questions in; each question's
// probability of yes out, with the tokens it used. Tests replace it with a fake.
export class JevClient {
  /** @param {{key?: string, fetch?: typeof fetch, endpoint?: string, model?: string, timeout?: number}} [options] */
  constructor({ key = "", fetch: request = fetch, endpoint = JEV_ENDPOINT, model = JEV_MODEL, timeout = 30_000 } = {}) {
    this.key = key;
    this.request = request;
    this.endpoint = endpoint;
    this.model = model;
    this.timeout = timeout;
  }
  // questions: {name: question}. Resolves with {answers: {name: probability}, inputTokens}.
  async ask({ state, questions }) {
    let response;
    try {
      response = await this.request(this.endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ state, model: this.model, questions: Object.fromEntries(Object.entries(questions).map(([name, instructions]) => [name, { type: "noul", instructions }])) }),
        signal: AbortSignal.timeout(this.timeout),
      });
    } catch (error) {
      // Only the kind of failure is passed on: its own words can hold the request, key and all.
      throw new JevProblem(`TypeSafe could not be reached (${error?.name === "TimeoutError" ? "it did not answer in time" : error?.cause?.code || error?.code || "the connection failed"}).`, { status: 503 });
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 500);
      const retryAfter = Number(response.headers.get("retry-after")) || 0;
      if (response.status === 401) throw new JevProblem("TypeSafe refused the app's API key. Ask the human to check TYPESAFE_API_KEY and start the app again.", { status: 401 });
      throw new JevProblem(`TypeSafe answered ${response.status}${detail ? `: ${detail}` : ""}`, { status: response.status, retryAfter });
    }
    const body = await response.json();
    const answers = {};
    for (const name of Object.keys(questions)) {
      const probability = body.answers?.[name]?.noul;
      if (typeof probability !== "number") throw new JevProblem(`TypeSafe gave no answer to one of the questions.`, { status: 502 });
      answers[name] = probability;
    }
    return { answers, inputTokens: body.usage?.input_tokens ?? 0 };
  }
}

// Spaces requests out so that neither the requests nor the tokens sent in a second
// pass their rate, and holds everything back for a while when TypeSafe says to.
class Pace {
  constructor({ requests, tokens, inFlight }, { now, sleep }) {
    Object.assign(this, { requests, tokens, inFlight, now, sleep });
    this.next = 0;
    this.held = 0;
    this.running = 0;
    this.waiting = [];
  }
  async enter(tokens) {
    // A place freed by leave() is handed straight to whoever waited longest.
    if (this.running >= this.inFlight) await new Promise((go) => this.waiting.push(go));
    else this.running++;
    const at = Math.max(this.now(), this.next);
    this.next = at + 1000 * Math.max(1 / this.requests, tokens / this.tokens);
    // A hold asked for while this request waited its turn delays it too.
    for (let until = Math.max(at, this.held); this.now() < until; until = Math.max(until, this.held)) await this.sleep(until - this.now());
  }
  leave() {
    const next = this.waiting.shift();
    if (next) next();
    else this.running--;
  }
  hold(ms) {
    this.held = Math.max(this.held, this.now() + ms);
    this.next = Math.max(this.next, this.held);
  }
}

// The questions a caller sent, as {name: question}: a list is named q1, q2 and so on.
function namedQuestions(given) {
  const entries = Array.isArray(given) ? given.map((q, n) => [`q${n + 1}`, q]) : given && typeof given === "object" ? Object.entries(given) : typeof given === "string" ? [["q1", given]] : [];
  if (!entries.length) throw new Error("Give Jev one or more yes-or-no questions: a list of them, or a dict of name to question.");
  if (entries.length > MAX_QUESTIONS) throw new Error(`Jev takes up to ${MAX_QUESTIONS} questions in one sweep; you sent ${entries.length}. Sweep again with the rest.`);
  for (const [name, question] of entries)
    if (typeof question !== "string" || !question.trim() || question.length > MAX_QUESTION) throw new Error(`Question ${JSON.stringify(name)} must be text of up to ${MAX_QUESTION.toLocaleString("en-US")} characters.`);
  return Object.fromEntries(entries.map(([name, question]) => [name, question.trim()]));
}

export const emptyFigures = () => ({ sweeps: 0, characters: 0, passed: 0, sampled: 0, misses: 0, inputTokens: 0 });

export class JevSweeps {
  /** @param {any} store @param {string} directory @param {{client?: any, cache?: CallCache, readers?: any, rate?: typeof RATE, retries?: number, sample?: number, random?: () => number, now?: () => number, sleep?: (ms: number) => Promise<void>}} [options] */
  constructor(store, directory, { client = null, cache = new CallCache(join(directory, "cache")), readers = null, rate = RATE, retries = RETRIES, sample = SAMPLE, random = Math.random, now = Date.now, sleep = (ms) => new Promise((done) => setTimeout(done, ms)) } = {}) {
    this.store = store;
    this.directory = directory;
    this.client = client;
    this.cache = cache;
    this.readers = readers;
    this.retries = retries;
    this.sample = sample;
    this.random = random;
    this.sleep = sleep;
    this.pace = new Pace(rate, { now, sleep });
    // Samples still with their readers.
    this.sampling = new Set();
  }
  // One request, tried again with a growing wait when TypeSafe is busy or out of reach.
  async request(state, questions) {
    const tokens = Math.ceil((state.length + Object.values(questions).join("").length) / 3);
    for (let attempt = 0; ; attempt++) {
      await this.pace.enter(tokens);
      try {
        return await this.client.ask({ state, questions });
      } catch (error) {
        if (!retryable(error) || attempt >= this.retries) throw error instanceof JevProblem ? error : new JevProblem("TypeSafe could not be asked.");
        const wait = Math.max((error.retryAfter || 0) * 1000, Math.min(30_000, 500 * 2 ** attempt) * (1 + this.random() / 4));
        // Whatever slowed this request slows the others too.
        this.pace.hold(wait);
      } finally {
        this.pace.leave();
      }
    }
  }
  // Sweeps a saved document with yes-or-no questions, and resolves with the passages
  // likely to matter: {document, passages, chunks, flagged, characters, passed, whole}.
  async sweep({ document: id, questions: given, threshold = DEFAULT_THRESHOLD }) {
    const questions = namedQuestions(given);
    if (typeof threshold !== "number" || !(threshold > 0 && threshold < 1)) throw new Error("The threshold is a probability between 0 and 1; 0.3 unless you say otherwise.");
    const document = this.store.state.documents.find((d) => d.id === id);
    if (!document) throw new Error(`No saved document has the ID ${JSON.stringify(id)}. weir.library.documents() lists them.`);
    if (typeof document.text !== "string" || !document.text.trim()) throw new Error(`Document ${id} has no text to sweep yet.`);
    if (!this.client?.key) throw new Error("Jev needs the human's TypeSafe API key, and the app was started without one. Tell the human that TYPESAFE_API_KEY is not set; the setup screen says how. Meanwhile you can search the document with weir.library.search, or send it to readers as passages.");
    const chunks = chunkPages(pagesOf(document.text));
    const texts = chunks.map(chunkText);
    const call = (n, name) => ({ kind: "jev", model: this.client.model || JEV_MODEL, question: questions[name], input: texts[n] });
    let inputTokens = 0;
    let requests = 0;
    // Each chunk's probability for each question, from the cache or one request for the
    // rest. A chunk with nothing in it is not asked about.
    const settled = await Promise.allSettled(
      chunks.map(async (chunk, n) => {
        const known = {};
        const asked = {};
        if (blank(chunk)) return known;
        for (const name of Object.keys(questions)) {
          const cached = this.cache.get(call(n, name));
          if (typeof cached === "number") known[name] = cached;
          else asked[name] = questions[name];
        }
        if (Object.keys(asked).length) {
          const reply = await this.request(texts[n], asked);
          requests++;
          inputTokens += reply.inputTokens;
          for (const [name, probability] of Object.entries(reply.answers)) {
            this.cache.set(call(n, name), probability);
            known[name] = probability;
          }
        }
        return known;
      }),
    );
    const failed = settled.find((s) => s.status === "rejected");
    if (failed) {
      // What the answered requests cost is recorded, though the sweep is not.
      if (inputTokens) this.store.update((next) => ((next.jevFigures ||= emptyFigures()).inputTokens += inputTokens));
      throw failed.reason;
    }
    const answers = settled.map((s) => s.value);
    const flags = answers.map((a) => Object.values(a).some((p) => p >= threshold));
    const built = buildPassages(chunks, flags, { name: id });
    const passages = built.map((passage) => {
      const [first, last] = passage.chunks;
      const within = answers.slice(first, last + 1);
      // The questions that flagged it, and how likely the likeliest is.
      const matched = Object.keys(questions).filter((name) => within.some((a) => a[name] >= threshold));
      return { ...passage, document: id, probability: Math.max(0, ...within.flatMap((a) => Object.values(a))), matched };
    });
    const flagged = flags.filter(Boolean).length;
    const whole = flagged * 2 > chunks.length;
    // Both sizes are of the document's own text, page by page, without its page lines.
    const characters = charactersIn(chunks, chunks.map((_, n) => n));
    const covered = new Set(built.flatMap((p) => chunks.slice(p.chunks[0], p.chunks[1] + 1)));
    const passed = charactersIn(chunks, chunks.map((chunk, n) => (covered.has(chunk) ? n : -1)).filter((n) => n >= 0));
    const record = { at: new Date().toISOString(), document: id, questions: Object.values(questions), threshold, chunks: chunks.length, flagged, characters, passed, requests, inputTokens };
    this.store.update((next) => {
      const figures = (next.jevFigures ||= emptyFigures());
      figures.sweeps++;
      figures.characters += characters;
      figures.passed += passed;
      figures.inputTokens += inputTokens;
    });
    this.log(record);
    this.check({ id, chunks, texts, covered, questions });
    return { document: id, passages, chunks: chunks.length, flagged, characters, passed, whole };
  }
  // A few of the chunks the sweep passed over go to a reader with the same questions;
  // each the reader finds relevant is a miss. The sweep does not wait for them.
  check({ id, chunks, texts, covered, questions }) {
    if (!this.readers || !this.sample) return;
    const left = chunks.map((chunk, n) => ({ chunk, n })).filter(({ chunk }) => !covered.has(chunk) && !blank(chunk));
    const picked = [];
    while (picked.length < this.sample && left.length) picked.push(...left.splice(Math.floor(this.random() * left.length), 1));
    if (!picked.length) return;
    // As many of the questions in each reader's question as it takes.
    const opening = "Does the passage answer, or help to answer, any of these questions?";
    const asks = [];
    for (const q of Object.values(questions)) {
      const last = asks[asks.length - 1];
      if (last && last.length + q.length + 3 <= ROOM) asks[asks.length - 1] = `${last}\n- ${q}`;
      else asks.push(`${opening}\n- ${q}`);
    }
    const passages = picked.map(({ n }) => ({ label: `chunk ${n + 1}`, text: texts[n], chunk: n }));
    const sampling = Promise.resolve()
      .then(() => Promise.all(asks.map((question) => this.readers.ask({ question: readerQuestion(question), passages }))))
      .then((rounds) => {
        // A chunk is read when any reader answered for it, and a miss when any found it relevant.
        const read = passages.map((p, i) => ({ chunk: p.chunk, answers: rounds.map((answers) => answers[i]).filter((a) => typeof a?.relevant === "boolean") })).filter((p) => p.answers.length);
        const misses = read.filter((p) => p.answers.some((a) => a.relevant));
        if (!read.length) return;
        this.store.update((next) => {
          const figures = (next.jevFigures ||= emptyFigures());
          figures.sampled += read.length;
          figures.misses += misses.length;
        });
        this.log({ at: new Date().toISOString(), document: id, sampled: read.map((p) => p.chunk), misses: misses.map((p) => ({ chunk: p.chunk, answer: p.answers.find((a) => a.relevant).answer })) });
      })
      // No reader could run, or the figures could not be saved: nothing is recorded for this sample.
      .catch(() => {})
      .finally(() => this.sampling.delete(sampling));
    this.sampling.add(sampling);
  }
  // Resolves when every sample under way has been read.
  sampled() {
    return Promise.all([...this.sampling]);
  }
  // Each sweep and each sample, in detail, for whoever wants more than the totals.
  log(record) {
    try {
      mkdirSync(join(this.directory, "jev"), { recursive: true });
      appendFileSync(join(this.directory, "jev", "sweeps.jsonl"), `${JSON.stringify(record)}\n`);
    } catch {
      /* The totals are in the project's state; the detail is for diagnosis. */
    }
  }
}
