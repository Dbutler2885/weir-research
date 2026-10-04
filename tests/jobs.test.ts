// @vitest-environment node
import { openTeam } from "./fixtures/assign";
import { afterEach, describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import dataset from "./fixtures/workshop.json";
import { WorkspaceStore } from "../server/store.mjs";
import { ResearcherPool, DONE_PHRASE } from "../server/researchers.mjs";
import { Jobs } from "../server/jobs.mjs";

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).reverse().forEach((clean) => clean()));
const tick = () => new Promise((done) => setImmediate(done));

// A stand-in for the supervisor's helpers: each start is an agent the test speaks for.
// kept are the hosts of helpers that outlived the app, for a restart to take back.
function helperSupervisor(kept: any[] = []) {
  const started: any[] = [];
  const agent = (options: any) => {
    const a: any = Object.assign(new EventEmitter(), { stopped: false, steered: [] as string[], stop() { a.stopped = true; }, steer(text: string) { a.steered.push(text); } });
    started.push({ ...options, agent: a });
    return a;
  };
  return { started, dismissed: [] as any[], start: agent, hosted: (filter: (r: any) => boolean) => kept.filter(filter), reattach: (record: any, options: any) => agent({ reattached: record, ...options }), dismiss(record: any) { this.dismissed.push(record); } };
}
// A stand-in for the app's Python sessions.
function fakeSessions() {
  const seats = new Map<string, any>();
  const running = new Map<string, number>();
  return {
    seats,
    running: (key: string) => running.get(key) ?? 0,
    setRunning: (key: string, n: number) => running.set(key, n),
    starting: () => null,
    open: (key: string, seat: any) => seats.set(key, { ...seat, open: true }),
    close: (key: string) => seats.has(key) && (seats.get(key).open = false),
    closeAll: () => seats.forEach((seat) => (seat.open = false)),
    keys: () => [...seats.entries()].filter(([, seat]) => seat.open).map(([key]) => key),
  };
}

// A project with a team whose researchers are stand-in processes the test speaks for,
// and the jobs those researchers set going.
function fixture({ directory = mkdtempSync(join(tmpdir(), "weir-jobs-")), kept = [] as any[], readers = null as any, open = true } = {}) {
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const store = new WorkspaceStore(directory, dataset);
  const launches: any[] = [];
  const launch = (_executable: string, _args: string[], options: any) => {
    const child: any = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      exitCode: null,
      killed: false,
      kill() {
        if (child.killed) return;
        child.killed = true;
        child.exitCode = 1;
        child.emit("close", 1);
      },
    });
    const sent: string[] = [];
    let pending = "";
    child.stdin.on("data", (chunk: Buffer) => {
      pending += chunk.toString();
      const lines = pending.split("\n");
      pending = lines.pop()!;
      for (const line of lines.filter(Boolean)) {
        const event = JSON.parse(line);
        if (event.type === "user") sent.push(event.message.content);
      }
    });
    launches.push({ child, options, sent });
    return child;
  };
  const sessions = fakeSessions();
  const pool = new ResearcherPool(store, directory, resolve("."), { launch: launch as any, findExecutable: (name: string) => `/test/${name}`, sessions: sessions as any });
  cleanups.push(() => pool.stop());
  const supervisor = helperSupervisor(kept);
  const jobs = new Jobs(store, directory, {
    supervisor,
    sessions,
    readers,
    dispatch: { choose: () => ({ agent: "codex", model: "gpt-6-luna", effort: "high" }) },
    findExecutable: (name: string) => `/test/${name}`,
    notice: (seat: string, text: string, id: string) => pool.notice(seat, text, id),
  });
  pool.jobs = jobs;
  cleanups.push(() => jobs.stop());
  if (open) {
    openTeam(store, pool, "claude", { size: 1, goal: "Find who bought the fictional Example mill.", title: "The Example mill" });
    launches[0].child.stdout.write(`${JSON.stringify({ type: "system", subtype: "init", session_id: "session-1" })}\n`);
  }
  const batch = () => store.state.investigations[0];
  const seat = () => batch().assignments[0];
  const researcher = () => launches.at(-1)!;
  const say = (text: string) => researcher().child.stdout.write(`${JSON.stringify({ type: "result", subtype: "success", result: text })}\n`);
  const record = (id: string) => JSON.parse(readFileSync(join(directory, "agents", batch().id, seat().id, "jobs", `${id}.json`), "utf8"));
  // What the researcher's session reads of a helper.
  const shown = (id: string) => JSON.parse(readFileSync(join(directory, "agents", batch().id, seat().id, "session", "helpers", `${id}.json`), "utf8"));
  const answer = (n: number, value: unknown) => supervisor.started[n].agent.emit("turn", { outcome: "done", text: typeof value === "string" ? value : JSON.stringify(value) });
  return { directory, store, pool, jobs, sessions, supervisor, launches, batch, seat, researcher, say, record, shown, answer };
}

describe("a helper sent on an errand", () => {
  it("is recorded with a ticket of its own before its handle is returned, and starts as a helper with its own session", () => {
    const f = fixture();
    const handle = f.jobs.helper("Search the fictional harbor gazette for Ada Example.", f.seat().id);
    expect(handle).toEqual({ id: "h1", status: "running" });
    const job = f.record("h1");
    expect(job).toMatchObject({ kind: "helper", id: "h1", seat: f.seat().id, status: "running", attempts: 1, errand: "Search the fictional harbor gazette for Ada Example." });
    expect(job.ticket).not.toBe(f.seat().lease.token);
    const started = f.supervisor.started[0];
    expect(started).toMatchObject({ provider: "codex", model: "gpt-6-luna", effort: "high", prompt: "Search the fictional harbor gazette for Ada Example.", live: { role: "helper", assignmentId: f.seat().id } });
    expect(started.env.WEIR_LEASE).toBe(job.ticket);
    expect(started.folder).toBe(join(f.directory, "agents", f.batch().id, f.seat().id, "helpers", "h1", "agent-1"));
    expect(started.instructions).toContain("You are a helper for Researcher 1");
    expect(started.instructions).toContain("weir.save(url)");
    expect(started.instructions).not.toMatch(/weir\.post|weir\.publish|weir\.helper/);
    // Its session answers its ticket, and may save, sweep and call readers only.
    const session = f.sessions.seats.get(`helper:${f.seat().id}:h1`);
    expect(session).toMatchObject({ open: true, folder: started.folder });
    expect(session.authorize(job.ticket)).toBe(true);
    expect(session.authorize(f.seat().lease.token)).toBe(false);
    expect([...session.can].sort()).toEqual(["jev", "reader", "save", "save_image", "save_page"]);
    expect(session.refusal("post")).toContain("The board and publishing are its researcher's");
    // What the researcher's session reads of it.
    expect(f.shown("h1")).toMatchObject({ id: "h1", status: "running", saved: [] });
  });
  it("gives its answer to the researcher who sent it: in full in the session, and as a one-line notice", async () => {
    const f = fixture();
    f.store.update((next: any) => next.documents.push({ id: "doc-1", collectionId: "web", name: "Gazette.html", mime: "text/html", text: "Ada Example sold the mill to Ben Example in 1901.", pages: 1 }));
    f.jobs.helper("Search the fictional harbor gazette for Ada Example.\nReport every mention.", f.seat().id);
    const key = `helper:${f.seat().id}:h1`;
    f.jobs.saved(key, { id: "doc-1", title: "Fictional harbor gazette", url: "https://example.org/gazette" });
    f.answer(0, {
      answer: "The gazette records the sale in 1901.",
      quotes: [
        { document: "doc-1", page: 1, quote: "Ada Example sold the mill to Ben Example in 1901." },
        { document: "doc-1", page: 1, quote: "Ada Example gave the mill away." },
      ],
    });
    await tick();
    expect(f.shown("h1")).toEqual({
      id: "h1",
      errand: "Search the fictional harbor gazette for Ada Example.\nReport every mention.",
      status: "answered",
      at: expect.any(String),
      answer: "The gazette records the sale in 1901.",
      quotes: [
        { document: "doc-1", page: 1, quote: "Ada Example sold the mill to Ben Example in 1901.", found: true },
        { document: "doc-1", page: 1, quote: "Ada Example gave the mill away.", found: false },
      ],
      saved: [{ id: "doc-1", title: "Fictional harbor gazette", url: "https://example.org/gazette" }],
    });
    // The researcher is sent one line, not the answer.
    expect(f.researcher().sent.at(-1)).toBe('Helper h1 has answered ("Search the fictional harbor gazette for Ada Example."): 2 quotes, 1 of them not found in the saved text, 1 source saved. Its full answer is in your session as weir.helpers()["h1"].answer.');
    // The helper and its session have ended.
    expect(f.supervisor.started[0].agent.stopped).toBe(true);
    expect(f.sessions.seats.get(key).open).toBe(false);
    expect(f.jobs.outstanding(f.seat().id)).toEqual([]);
  });
  it("takes a plain reply as the answer, waits for code of its own still running, and fails with the reason", async () => {
    const f = fixture();
    for (const errand of ["First errand.", "Second errand.", "Third errand."]) f.jobs.helper(errand, f.seat().id);
    f.answer(0, "Nothing in the gazette names her.");
    expect(f.shown("h1")).toMatchObject({ status: "answered", answer: "Nothing in the gazette names her.", quotes: [] });
    // Its turn ended while its code was still running: the run's output will start another turn.
    f.sessions.setRunning(`helper:${f.seat().id}:h2`, 1);
    f.answer(1, "Waiting for my code.");
    expect(f.shown("h2").status).toBe("running");
    f.sessions.setRunning(`helper:${f.seat().id}:h2`, 0);
    f.sessions.seats.get(`helper:${f.seat().id}:h2`).deliver("Your long Python run has finished.");
    expect(f.supervisor.started[1].agent.steered).toEqual(["Your long Python run has finished."]);
    f.answer(1, "Now it is done.");
    expect(f.shown("h2")).toMatchObject({ status: "answered", answer: "Now it is done." });
    f.supervisor.started[2].agent.emit("turn", { outcome: "error", text: "" });
    await tick();
    expect(f.shown("h3")).toMatchObject({ status: "failed", problem: "its turn ended with an error" });
    expect(f.researcher().sent.at(-1)).toContain('Helper h3 failed ("Third errand."): its turn ended with an error. It no longer counts as outstanding.');
  });
  it("is refused to a helper, and to an errand with nothing in it", () => {
    const f = fixture();
    expect(() => f.jobs.helper("Go further.", `helper:${f.seat().id}:h1`)).toThrow("A helper works its errand itself");
    expect(() => f.jobs.helper("  ", f.seat().id)).toThrow("Describe the helper's errand");
    expect(f.supervisor.started).toEqual([]);
  });
});

describe("the helper limit", () => {
  it("holds further helpers, and starts them in the order they were sent as places come free", () => {
    const f = fixture();
    f.store.update((next: any) => (next.researchSettings.helperLimit = 2));
    for (const errand of ["one", "two", "three", "four"]) f.jobs.helper(errand, f.seat().id);
    expect(f.supervisor.started.map((s) => s.prompt)).toEqual(["one", "two"]);
    expect(["h1", "h2", "h3", "h4"].map((id) => f.record(id).status)).toEqual(["running", "running", "queued", "queued"]);
    f.answer(1, "Second.");
    expect(f.supervisor.started.map((s) => s.prompt)).toEqual(["one", "two", "three"]);
    expect(() => f.pool.configure({ helperLimit: 0 })).toThrow("The helper limit must be a whole number from 1 to 50.");
    f.pool.configure({ helperLimit: 3 });
    f.jobs.pump();
    expect(f.supervisor.started.map((s) => s.prompt)).toEqual(["one", "two", "three", "four"]);
  });
});

describe("a seat with helpers at work", () => {
  it("is kept at work when its researcher says the done phrase, and can finish once its only helper has failed", async () => {
    const f = fixture();
    f.jobs.helper("Search the gazette.", f.seat().id);
    f.say(DONE_PHRASE);
    await tick();
    expect(f.seat().status).toBe("running");
    expect(f.researcher().sent.at(-1)).toContain(`You said ${DONE_PHRASE}, but helper h1 is still at work, and you will be sent a message as each answers.`);
    // It ends its turn to wait; with a helper outstanding it is not nudged.
    const sent = f.researcher().sent.length;
    f.say("I will wait for the helper.");
    await tick();
    expect(f.researcher().sent).toHaveLength(sent);
    f.supervisor.started[0].agent.emit("failed", new Error("Codex is not signed in."));
    await tick();
    // The notice wakes it.
    expect(f.researcher().sent.at(-1)).toContain("Helper h1 failed");
    f.say(DONE_PHRASE);
    await tick();
    expect(f.seat().status).toBe("finished");
  });
  it("lets its helper carry on and save a source while its researcher is paused, and holds the notice until it resumes", async () => {
    const f = fixture();
    f.jobs.helper("Search the gazette.", f.seat().id);
    const ticket = f.record("h1").ticket;
    f.pool.pause(f.seat().id);
    expect(f.seat().status).toBe("paused");
    // The helper's ticket is its own: its session still answers it.
    const session = f.sessions.seats.get(`helper:${f.seat().id}:h1`);
    expect(session.open).toBe(true);
    expect(session.authorize(ticket)).toBe(true);
    expect(session.live()).toBe(true);
    f.jobs.saved(`helper:${f.seat().id}:h1`, { id: "doc-7", title: "Gazette" });
    const sentBefore = f.researcher().sent.length;
    f.answer(0, "Found it.");
    await tick();
    expect(f.researcher().sent).toHaveLength(sentBefore);
    expect(f.shown("h1")).toMatchObject({ status: "answered", saved: [{ id: "doc-7", title: "Gazette" }] });
    const before = f.launches.length;
    f.pool.resume(f.seat().id);
    expect(f.launches).toHaveLength(before + 1);
    expect(f.researcher().sent[0]).toContain('Helper h1 has answered ("Search the gazette."): 0 quotes, 1 source saved.');
  });
  it("has its helpers ended when the team is stopped, and nothing of theirs delivered afterwards", async () => {
    const f = fixture();
    f.store.update((next: any) => (next.researchSettings.helperLimit = 1));
    f.jobs.helper("First.", f.seat().id);
    f.jobs.helper("Second.", f.seat().id);
    const ticket = f.record("h1").ticket;
    f.jobs.saved(`helper:${f.seat().id}:h1`, { id: "doc-7", title: "Gazette" });
    const session = f.sessions.seats.get(`helper:${f.seat().id}:h1`);
    const helper = f.supervisor.started[0].agent;
    f.pool.stopTeam(f.batch().id, "The human stopped the batch.");
    expect(helper.stopped).toBe(true);
    expect(session.open).toBe(false);
    // Every ticket is refused after a stop.
    expect(session.authorize(ticket)).toBe(false);
    expect(session.live()).toBe(false);
    expect(["h1", "h2"].map((id) => f.record(id).status)).toEqual(["cancelled", "cancelled"]);
    // An answer that arrives after the stop is dropped; the queued helper never starts.
    f.answer(0, "Too late.");
    await tick();
    expect(f.shown("h1")).toMatchObject({ status: "cancelled", saved: [{ id: "doc-7", title: "Gazette" }] });
    expect(f.supervisor.started).toHaveLength(1);
    const inbox = join(f.directory, "agents", f.batch().id, f.seat().id, "inbox");
    expect(existsSync(inbox) ? readdirSync(inbox) : []).toEqual([]);
    expect(() => f.jobs.helper("Third.", f.seat().id)).not.toThrow();
    expect(f.record("h3").status).toBe("cancelled");
  });
});

describe("jobs across a restart of the app", () => {
  // The app closes and opens again on the same project.
  const restart = (f: ReturnType<typeof fixture>, options: { kept?: any[]; readers?: any } = {}) => {
    f.jobs.stop();
    f.pool.stop();
    return fixture({ directory: f.directory, open: false, ...options });
  };
  it("delivers an answer finished before the restart once, and starts a helper that was queued", async () => {
    const f = fixture();
    f.store.update((next: any) => (next.researchSettings.helperLimit = 1));
    f.jobs.helper("First.", f.seat().id);
    f.jobs.helper("Second.", f.seat().id);
    // The researcher is paused, so the first helper's notice waits in the seat's inbox.
    f.pool.pause(f.seat().id);
    f.answer(0, "First answer.");
    // The second started when the first ended, and is cut short by the app closing.
    expect(f.supervisor.started).toHaveLength(2);
    f.jobs.helper("Third.", f.seat().id);
    const g = restart(f);
    g.jobs.recover();
    // The answer is where the session reads it, and its notice is in the inbox once.
    expect(g.shown("h1")).toMatchObject({ status: "answered", answer: "First answer." });
    const inbox = join(g.directory, "agents", g.batch().id, g.seat().id, "inbox");
    expect(readdirSync(inbox).filter((name) => name.includes("helper-h1"))).toHaveLength(1);
    // The interrupted helper starts again, and the queued one after it, in order.
    expect(g.supervisor.started.map((s) => s.prompt.split("\n").at(-1))).toEqual(["Second."]);
    expect(g.supervisor.started[0].prompt).toContain("An earlier helper on this errand was interrupted before it answered, and you are starting it again from the beginning. Sources it saved are already in the library");
    expect(g.record("h2")).toMatchObject({ status: "running", attempts: 2 });
    g.answer(0, "Second answer.");
    expect(g.supervisor.started.map((s) => s.prompt.split("\n").at(-1))).toEqual(["Second.", "Third."]);
    g.pool.resume(g.seat().id);
    const opening = g.researcher().sent[0];
    expect(opening.match(/Helper h1 has answered/g)).toHaveLength(1);
    expect(opening.match(/Helper h2 has answered/g)).toHaveLength(1);
  });
  it("starts an interrupted helper again once, and fails it the second time", async () => {
    const f = fixture();
    f.jobs.helper("Search the gazette.", f.seat().id);
    f.pool.pause(f.seat().id);
    const g = restart(f);
    g.jobs.recover();
    expect(g.record("h1")).toMatchObject({ status: "running", attempts: 2 });
    const h = restart(g);
    h.jobs.recover();
    expect(h.supervisor.started).toEqual([]);
    expect(h.record("h1")).toMatchObject({ status: "failed", problem: "it was interrupted twice before it answered" });
    expect(h.jobs.outstanding(h.seat().id)).toEqual([]);
    h.pool.resume(h.seat().id);
    expect(h.researcher().sent[0]).toContain('Helper h1 failed ("Search the gazette."): it was interrupted twice before it answered.');
  });
  it("starts a helper again when its process ends before it answers, while the app runs", () => {
    const f = fixture();
    f.jobs.helper("Search the gazette.", f.seat().id);
    f.supervisor.started[0].agent.emit("exit", { code: 1 });
    expect(f.supervisor.started).toHaveLength(2);
    expect(f.record("h1")).toMatchObject({ status: "running", attempts: 2 });
    f.supervisor.started[1].agent.emit("exit", { code: 1 });
    expect(f.record("h1")).toMatchObject({ status: "failed" });
  });
  it("takes back a helper whose process outlived the app, with its ticket and its folder", () => {
    const f = fixture();
    f.jobs.helper("Search the gazette.", f.seat().id);
    f.pool.pause(f.seat().id);
    const job = f.record("h1");
    const host = { id: "abc", key: `errand:${job.seat}:h1`, provider: "codex", meta: { project: f.directory, role: "errand", seat: job.seat, batch: job.batch, job: "h1", ticket: job.ticket, directory: f.supervisor.started[0].folder } };
    const stray = { id: "def", key: "errand:gone:h9", provider: "codex", meta: { project: f.directory, role: "errand", ticket: "no-such-ticket" } };
    const g = restart(f, { kept: [host, stray] });
    g.jobs.recover();
    expect(g.supervisor.started).toHaveLength(1);
    expect(g.supervisor.started[0].reattached).toBe(host);
    expect(g.supervisor.dismissed).toEqual([stray]);
    // It was not started again: still its first attempt.
    expect(g.record("h1")).toMatchObject({ status: "running", attempts: 1 });
    expect(g.sessions.seats.get(`helper:${job.seat}:h1`)).toMatchObject({ open: true, folder: host.meta.directory });
    g.answer(0, "Found after the restart.");
    expect(g.shown("h1")).toMatchObject({ status: "answered", answer: "Found after the restart." });
  });
  it("runs a batch of readers again when the app closed before they answered", async () => {
    const asked: any[] = [];
    let release: (value: unknown) => void = () => {};
    const slow = { ask: (given: any, context: any) => (asked.push({ given, context }), new Promise((done) => (release = done))) };
    const f = fixture({ readers: slow });
    const given = { question: "Who sold the mill?", passages: [{ label: "ledger", text: "Ada Example sold the mill." }] };
    const reading = f.jobs.reader(given, f.seat().id);
    const folder = join(f.directory, "agents", f.batch().id, f.seat().id, "jobs");
    expect(readdirSync(folder).filter((name) => name.startsWith("r-"))).toHaveLength(1);
    f.pool.pause(f.seat().id);
    // The app closes before the readers answer.
    const again: any[] = [];
    const g = restart(f, { readers: { ask: async (given2: any, context: any) => (again.push({ given: given2, context }), []) } });
    g.jobs.recover();
    expect(again).toEqual([{ given, context: { seat: g.seat().id } }]);
    await tick();
    expect(readdirSync(folder).filter((name) => name.startsWith("r-"))).toEqual([]);
    expect(g.jobs.outstanding(g.seat().id)).toEqual([]);
    // A batch that is answered leaves no record behind.
    release([{ label: "ledger", relevant: true }]);
    expect(await reading).toEqual([{ label: "ledger", relevant: true }]);
  });
});
