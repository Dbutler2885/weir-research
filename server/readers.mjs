// Readers: one prompt and one answer from a cheap model with no tools. A researcher's
// code asks for them through its session, with one prompt or with a question and a
// batch of labelled passages; the passages are packed whole into as few prompts as
// hold them, and the answers come back passage by passage. Every answer is kept in
// the project's cache, and the app runs only so many readers at once: further calls
// wait their turn in order.
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { READER_INPUT, READER_INSTRUCTIONS, batchPrompt, packPassages, readAnswers, readerPassages, readerPrompt, readerQuestion } from "../src/domain/reader.ts";
import { resetTime } from "../src/domain/reset-time.ts";
import { CallCache } from "./call-cache.mjs";

export const DEFAULT_READER_LIMIT = 20;
// A reader that has not answered in this long is ended.
const DEFAULT_PATIENCE = 15 * 60_000;

export const readerLimit = (state) => state.researchSettings?.readerLimit ?? DEFAULT_READER_LIMIT;

// A reader's model as its answers are cached under: a different agent, model or
// effort reads differently.
const modelOf = (choice) => [choice.agent, choice.model || "default", choice.effort || "default"].join("/");

class Cancelled extends Error {}

export class Readers {
  /** @param {any} store @param {string} directory @param {{supervisor: any, dispatch?: any, findExecutable?: (name: string) => string | null, cache?: CallCache, input?: number, patience?: number, env?: Record<string, string | undefined>}} options */
  constructor(store, directory, { supervisor, dispatch = /** @type {any} */ (null), findExecutable = (/** @type {string} */ _name) => /** @type {string | null} */ (null), cache = new CallCache(join(directory, "cache")), input = READER_INPUT, patience = DEFAULT_PATIENCE, env = process.env }) {
    this.store = store;
    this.directory = directory;
    this.supervisor = supervisor;
    this.dispatch = dispatch;
    this.findExecutable = findExecutable;
    this.cache = cache;
    this.input = input;
    this.patience = patience;
    this.env = env;
    // Prompts waiting for a free place, in the order they were asked.
    this.waiting = [];
    this.running = new Set();
  }
  // The agent, model and effort readers use now.
  choice() {
    const choice = this.dispatch?.choose("reader");
    const executable = choice && this.findExecutable(choice.agent);
    if (!executable) throw new Error("No agent CLI is installed for readers. Install Claude Code or Codex.");
    return { ...choice, executable };
  }
  // What a session's code asked for: {prompt}, answered with the reader's reply as
  // text, or {question, passages}, answered with one answer for each passage in the
  // order given. seat names whose call it is, so it can be dropped when the seat stops.
  async ask(given, { seat = "" } = {}) {
    const choice = this.choice();
    const model = modelOf(choice);
    if (given.passages === undefined) {
      const prompt = readerPrompt(given.prompt ?? given.question, this.input);
      const call = { kind: "reader", model, input: prompt };
      const cached = this.cache.get(call);
      if (typeof cached === "string") return cached;
      const reply = await this.run(prompt, choice, seat);
      this.cache.set(call, reply);
      return reply;
    }
    const question = readerQuestion(given.question);
    const passages = readerPassages(given.passages, this.input);
    const call = (passage) => ({ kind: "reader", model, question, input: passage.text });
    const answers = new Map();
    for (const passage of passages) {
      const cached = this.cache.get(call(passage));
      if (cached) answers.set(passage, { ...cached, cached: true });
    }
    const failures = [];
    await Promise.all(
      packPassages(passages.filter((p) => !answers.has(p)), this.input, question).map(async (group) => {
        let read;
        try {
          read = readAnswers(await this.run(batchPrompt(question, group), choice, seat), group);
        } catch (error) {
          if (error instanceof Cancelled) throw error;
          failures.push(error);
          read = group.map(() => ({ problem: error.message }));
        }
        group.forEach((passage, n) => {
          if (!("problem" in read[n])) this.cache.set(call(passage), read[n]);
          answers.set(passage, { ...read[n], cached: false });
        });
      }),
    );
    // No reader could run at all: the reason is the answer.
    if (failures.length && passages.every((p) => "problem" in answers.get(p))) throw failures[0];
    return passages.map((p) => ({ ...p.carried, ...answers.get(p) }));
  }
  // One prompt to one reader, when a place is free.
  run(prompt, choice, seat) {
    return new Promise((resolve, reject) => {
      this.waiting.push({ prompt, choice, seat, resolve, reject });
      this.pump();
    });
  }
  pump() {
    while (this.waiting.length && this.running.size < readerLimit(this.store.state)) this.start(this.waiting.shift());
  }
  // Starts the reader's CLI with no tools, sends the prompt, takes the final text and ends it.
  start(job) {
    const id = randomUUID().slice(0, 8);
    const folder = join(this.directory, "agents", "readers", id);
    const log = `${folder}.log`;
    this.running.add(job);
    let settled = false;
    // The reader's place is free once its process has gone, not when it is told to go:
    // the limit counts processes.
    const release = () => {
      if (!this.running.delete(job)) return;
      // The folder was only somewhere to stand. The log explains a failure, and is kept for one.
      rmSync(folder, { recursive: true, force: true });
      if (!job.failed) rmSync(log, { force: true });
      this.pump();
    };
    const end = (error, text) => {
      if (settled) return;
      settled = true;
      clearTimeout(job.timer);
      job.failed = Boolean(error);
      if (error) job.reject(error);
      else job.resolve(text);
      if (job.agent && !job.exited) job.agent.stop();
      else release();
    };
    job.end = end;
    try {
      mkdirSync(folder, { recursive: true });
      job.agent = this.supervisor.start({
        key: `reader:${id}`,
        provider: job.choice.agent,
        executable: job.choice.executable,
        folder,
        log,
        env: this.env,
        local: true,
        tools: false,
        instructions: READER_INSTRUCTIONS,
        model: job.choice.model,
        effort: job.choice.effort,
        prompt: job.prompt,
        meta: { project: this.directory, role: "reader", seat: job.seat },
      });
    } catch (error) {
      return end(error);
    }
    job.agent.on("turn", ({ outcome, text }) => {
      if (outcome === "done" && text.trim()) end(null, text);
      else end(new Error(outcome === "done" ? "The reader gave no answer." : "The reader's turn failed before it answered."));
    });
    // A reader does not wait out a usage limit: the code that asked is told, and can ask again later.
    job.agent.on("paused", ({ resetsAt }) => end(new Error(`The readers' usage limit is reached${resetsAt ? `; it resets at ${resetTime(resetsAt, Date.now())}` : ""}. Answers already given are kept, so the same call later asks only for the rest.`)));
    job.agent.on("failed", (error) => end(new Error(`The reader could not run: ${error.message}`)));
    job.agent.on("exit", () => {
      job.exited = true;
      end(new Error("The reader ended before it answered."));
      release();
    });
    job.timer = setTimeout(() => end(new Error("The reader did not answer in time, and was ended.")), this.patience);
    job.timer.unref();
  }
  // Drops a seat's calls, waiting or running: its session has ended, so nobody is
  // waiting for them.
  cancel(seat) {
    const dropped = new Cancelled("The seat's session ended before its readers answered.");
    for (const job of this.waiting.filter((j) => j.seat === seat)) job.reject(dropped);
    this.waiting = this.waiting.filter((j) => j.seat !== seat);
    for (const job of [...this.running].filter((j) => j.seat === seat)) job.end(dropped);
  }
  stop() {
    const dropped = new Cancelled("The app is closing.");
    for (const job of this.waiting.splice(0)) job.reject(dropped);
    for (const job of [...this.running]) {
      job.end(dropped);
      // The app is going: a reader has nothing to finish, so it is not given time to.
      job.agent?.kill?.();
    }
  }
}
