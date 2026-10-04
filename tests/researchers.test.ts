// @vitest-environment node
import { openTeam, assignmentOf } from "./fixtures/assign";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import dataset from "./fixtures/workshop.json";
import { WorkspaceStore } from "../server/store.mjs";
import { ResearcherPool, DONE_PHRASE } from "../server/researchers.mjs";
import { FindingPublisher } from "../server/finding-publisher.mjs";
import { until } from "./fixtures/until";

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups
    .splice(0)
    .reverse()
    .forEach((clean) => clean());
});
const tick = () => new Promise((done) => setImmediate(done));

interface Launch {
  child: any;
  options: any;
  executable: string;
  args: string[];
  // The messages the app sent this researcher, in order.
  sent: string[];
}
// A project whose researchers are stand-in processes the test speaks for, as Claude
// Code would: init gives its conversation an ID, and say ends a turn with those words.
function fixture({ sessions, directory = mkdtempSync(join(tmpdir(), "weir-pool-")) }: { sessions?: any; directory?: string } = {}) {
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const store = new WorkspaceStore(directory, dataset);
  const launches: Launch[] = [];
  const launch = (executable: string, args: string[], options: any) => {
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      exitCode: null,
      killed: false,
      kill() {
        if (this.killed) return;
        this.killed = true;
        this.exitCode = 1 as any;
        (this as unknown as EventEmitter).emit("close", 1);
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
    launches.push({ child, options, executable, args, sent });
    return child;
  };
  const pool = new ResearcherPool(store, directory, resolve("."), {
    launch: launch as any,
    findExecutable: (name: string) => `/test/${name}`,
    sessions,
  });
  cleanups.push(() => pool.stop());
  const batch = () => store.state.investigations[0];
  const seats = () => batch().assignments;
  const statuses = () => seats().map((a: any) => a.status);
  // The latest process started for a seat, by its place in the team.
  const of = (place: number) => launches.filter((l) => l.options.cwd.includes(seats()[place].id)).at(-1)!;
  const init = (l: Launch, id: string) => l.child.stdout.write(`${JSON.stringify({ type: "system", subtype: "init", session_id: id })}\n`);
  const say = (l: Launch, text: string, event: object = {}) => l.child.stdout.write(`${JSON.stringify({ type: "result", subtype: "success", result: text, ...event })}\n`);
  // A team of the given size, each researcher's conversation under way.
  const team = (size: number, options: object = {}) => {
    const opened = openTeam(store, pool, "claude", { size, goal: "Find who bought the fictional Example mill, and when.", title: "The Example mill", ...options });
    launches.forEach((l, n) => init(l, `session-${n + 1}`));
    return opened;
  };
  const inbox = (place: number) => {
    const folder = join(directory, "agents", batch().id, seats()[place].id, "inbox");
    return existsSync(folder) ? readdirSync(folder).filter((name) => name.endsWith(".json")) : [];
  };
  return { directory, store, pool, launches, batch, seats, statuses, of, init, say, team, inbox, live: pool.live };
}
// A stand-in for the app's Python sessions, recording each seat the pool opens.
function fakeSessions() {
  const seats = new Map<string, any>();
  const running = new Map<string, number>();
  return {
    seats,
    running: (key: string) => running.get(key) ?? 0,
    setRunning: (key: string, n: number) => running.set(key, n),
    // A session still starting, until the test lets it finish.
    startingNow: null as Promise<void> | null,
    starting(_key: string) {
      return this.startingNow;
    },
    open: (key: string, seat: any) => seats.set(key, { ...seat, open: true }),
    keys: () => [...seats.entries()].filter(([, seat]) => seat.open).map(([key]) => key),
    close: (key: string) => seats.has(key) && (seats.get(key).open = false),
    closeAll: () => seats.forEach((seat) => (seat.open = false)),
  };
}

describe("a team of researchers", () => {
  it("starts on every seat when the batch opens, each with the goal, its name and the board", () => {
    const f = fixture();
    const { investigationId } = f.team(3);
    expect(f.launches).toHaveLength(3);
    expect(f.statuses()).toEqual(["running", "running", "running"]);
    expect(f.batch().status).toBe("running");
    // Each has its own folder under its seat, and its own lease.
    expect(new Set(f.launches.map((l) => l.options.cwd)).size).toBe(3);
    f.launches.forEach((l, n) => {
      const seat = f.seats()[n];
      expect(l.options.cwd).toBe(join(f.directory, "agents", investigationId, seat.id, seat.lease.token));
      expect(l.options.env.WEIR_LEASE).toBe(seat.lease.token);
      const instructions = l.args.join(" ");
      expect(instructions).toContain(`You are Researcher ${n + 1}, one of a team of 3 researchers`);
      expect(instructions).toContain("## The goal\n\nFind who bought the fictional Example mill, and when.");
      expect(instructions).toContain("The whole goal is yours");
      expect(instructions).toContain("weir.post(text)");
      expect(instructions).toContain(`library/batches/batch-1/board.md`);
      expect(instructions).toContain("There is no limit on how many sources you read or how long you work");
      expect(instructions).toContain(`end your turn with this line, alone, as the last line of your reply:\n\n${DONE_PHRASE}`);
      // Nothing of the bounded pass is left: no brief, retrieval limit or result file.
      expect(instructions).not.toMatch(/brief\.md|result\.json|post\.md|bounded|20 distinct|out of scope/);
      expect(l.sent[0]).toContain(`You are Researcher ${n + 1} on batch 1, "The Example mill".`);
      expect(l.sent[0]).toContain("post what you mean to try first with weir.post");
      expect(readFileSync(join(l.options.cwd, "AGENTS.md"), "utf8")).toContain("## The goal");
      expect(existsSync(join(l.options.cwd, "brief.md"))).toBe(false);
    });
    // The library holds the goal before anyone reads it.
    expect(readFileSync(join(f.directory, "library", "batches", "batch-1", "goal.md"), "utf8")).toContain("Find who bought the fictional Example mill");
  });

  it("is as large as the human's setting, and runs on the agent the batch was opened with", () => {
    const f = fixture();
    expect(() => f.pool.configure({ researchersPerBatch: 0 })).toThrow("from 1 to 20");
    f.pool.configure({ researchersPerBatch: 2 });
    expect(f.store.state.researchSettings).toEqual({ timeLimitMinutes: null, researchersPerBatch: 2 });
    // How many readers run at once is a setting beside it.
    expect(() => f.pool.configure({ readerLimit: 0 })).toThrow("The reader limit must be a whole number from 1 to 100.");
    expect(f.pool.configure({ readerLimit: 5 })).toEqual({ timeLimitMinutes: null, researchersPerBatch: 2, readerLimit: 5 });
    f.store.update((next: any) => delete next.researchSettings.readerLimit);
    const coordinator = openTeam(f.store, f.pool, "codex", { size: 2 }).coordinator;
    expect(f.launches).toHaveLength(2);
    expect(f.launches[0]!.executable).toBe("/test/codex");
    expect(f.launches[0]!.args[0]).toBe("app-server");
    // A second batch's team starts beside the first.
    coordinator.command({ action: "open-batch", session: coordinator.session.secret, engine: "claude", title: "Another", goal: "Another fictional goal." });
    f.pool.pump();
    expect(f.launches).toHaveLength(4);
    expect(f.launches[2]!.executable).toBe("/test/claude");
  });

  it("works with no time limit, even where one is still set for graph work", () => {
    const f = fixture();
    f.pool.configure({ timeLimitMinutes: 1 });
    f.team(1);
    expect(f.launches[0]!.args.join(" ")).not.toMatch(/time limit|deadline/);
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 7 * 24 * 60 * 60_000);
    cleanups.push(() => clock.mockRestore());
    f.pool.pump();
    expect(f.launches[0]!.child.killed).toBe(false);
    expect(f.statuses()).toEqual(["running"]);
  });

  it("starts nothing on assignments from before teams, which are kept as history", () => {
    const f = fixture();
    f.store.command({ type: "annotate", question: "An old question", target: { label: "Fixture record" }, dispatch: true });
    f.store.update((next: any) => {
      next.investigations[0].number = 1;
      next.investigations[0].assignments = [{ id: "old", title: "An old part", brief: "Look.", status: "waiting", createdAt: "2026-01-01T00:00:00Z", checkpoints: [], steering: [] }];
    });
    f.pool.pump();
    expect(f.launches).toHaveLength(0);
  });
});

describe("the done phrase", () => {
  it("finishes a seat, keeping its conversation, and the batch reaches Review when every seat has finished", async () => {
    const sessions = fakeSessions();
    const f = fixture({ sessions });
    f.team(2);
    f.say(f.of(0), `The deeds are read and published.\n\n${DONE_PHRASE}`);
    expect(f.statuses()).toEqual(["finished", "running"]);
    expect(f.seats()[0]).toMatchObject({ session: { engine: "claude", id: "session-1" } });
    expect(f.seats()[0].lease).toBeUndefined();
    // Its process and its Python session end; its variables stay on disk for a wake.
    expect(f.of(0).child.killed).toBe(true);
    expect(sessions.seats.get(f.seats()[0].id).open).toBe(false);
    expect(f.pool.active.has(f.seats()[0].id)).toBe(false);
    expect(f.batch().status).toBe("running");
    expect(f.batch().readyAt).toBeUndefined();
    f.say(f.of(1), DONE_PHRASE);
    expect(f.statuses()).toEqual(["finished", "finished"]);
    expect(f.batch().status).toBe("review");
    expect(f.batch().readyAt).toBeTruthy();
    expect(f.batch().events.map((e: any) => e.message)).toEqual(expect.arrayContaining(["Researcher 1 finished.", "Researcher 2 finished.", "Every researcher has finished; the batch is ready for review."]));
  });

  it("is the exact line, alone, at the end of the turn", async () => {
    const f = fixture();
    f.team(1);
    for (const text of [`I am not ${DONE_PHRASE} yet.`, `${DONE_PHRASE}.`, `${DONE_PHRASE}\nOne more thing to check.`, "research done"]) {
      f.say(f.of(0), text);
      expect(f.statuses()).toEqual(["running"]);
    }
    f.say(f.of(0), `Nothing is left.\n  ${DONE_PHRASE}  \n\n`);
    expect(f.statuses()).toEqual(["finished"]);
  });

  it("keeps the seat at work while its code is still running, says so once, and finishes it once the output has reached it", async () => {
    const sessions = fakeSessions();
    const f = fixture({ sessions });
    f.team(1);
    const seat = f.seats()[0].id;
    sessions.setRunning(seat, 1);
    f.say(f.of(0), DONE_PHRASE);
    await tick();
    expect(f.statuses()).toEqual(["running"]);
    expect(f.of(0).sent.at(-1)).toContain(`You said ${DONE_PHRASE}, but a Python run of yours is still going, and its output will reach you as a message.`);
    // Saying it again changes nothing, and is not answered again.
    const heard = f.of(0).sent.length;
    f.say(f.of(0), DONE_PHRASE);
    await tick();
    expect(f.statuses()).toEqual(["running"]);
    expect(f.of(0).sent).toHaveLength(heard);
    // The run finishes; its output wakes the researcher, which then finishes.
    sessions.setRunning(seat, 0);
    sessions.seats.get(seat).deliver("Your long Python run has finished. Its output:\n\n40 pages");
    await tick();
    expect(f.of(0).sent.at(-1)).toBe("Your long Python run has finished. Its output:\n\n40 pages");
    f.say(f.of(0), DONE_PHRASE);
    expect(f.statuses()).toEqual(["finished"]);
  });

  it("asks again when a message reached the researcher as it was finishing", async () => {
    const f = fixture();
    f.team(2);
    // A post arrives while Researcher 2 is mid-turn, and its turn then ends with the phrase.
    f.pool.post(f.seats()[0].id, "The 1896 deed names the buyer.");
    await tick();
    expect(f.of(1).sent.at(-1)).toContain("A post on your batch's board, from Researcher 1:\n\nThe 1896 deed names the buyer.");
    f.say(f.of(1), DONE_PHRASE);
    await tick();
    expect(f.statuses()[1]).toBe("running");
    expect(f.of(1).sent.at(-1)).toContain("A message reached you as you were finishing.");
    f.say(f.of(1), DONE_PHRASE);
    expect(f.statuses()[1]).toBe("finished");
  });

  it("waits for a Python session that is still starting before it finishes the seat, since a run cut short may yet be reported", async () => {
    const sessions = fakeSessions();
    const f = fixture({ sessions });
    f.team(1);
    const seat = f.seats()[0].id;
    let started = () => {};
    sessions.startingNow = new Promise<void>((done) => (started = done));
    f.say(f.of(0), DONE_PHRASE);
    await tick();
    expect(f.statuses()).toEqual(["running"]);
    // The session starts and reports the run the restart cut short.
    sessions.seats.get(seat).deliver("Your last Python run was interrupted before it finished.");
    sessions.startingNow = null;
    started();
    await tick();
    expect(f.statuses()).toEqual(["running"]);
    expect(f.of(0).sent.at(-1)).toBe("Your last Python run was interrupted before it finished.");
    f.say(f.of(0), DONE_PHRASE);
    expect(f.statuses()).toEqual(["finished"]);
  });

  it("nudges once a turn that ends without it, and leaves a seat that ignores the nudge running and idle", async () => {
    const f = fixture();
    f.team(1);
    f.say(f.of(0), "I have read the deeds.");
    await tick();
    expect(f.of(0).sent).toHaveLength(2);
    expect(f.of(0).sent[1]).toContain(`You ended your turn without saying whether you have finished. Carry on with the goal, or, when nothing you or the board offers is left to pursue, end your turn with the line ${DONE_PHRASE}.`);
    f.say(f.of(0), "Still thinking.");
    await tick();
    expect(f.of(0).sent).toHaveLength(2);
    expect(f.statuses()).toEqual(["running"]);
    expect(f.of(0).child.killed).toBe(false);
    // Something new to act on earns one more.
    f.pool.announce(f.batch().id, "The human asks about the 1890s.");
    await tick();
    f.say(f.of(0), "Looked; nothing there.");
    await tick();
    expect(f.of(0).sent.map((m) => m.slice(0, 24))).toEqual(["You are Researcher 1 on ", "You ended your turn with", "A post on your batch's b", "You ended your turn with"]);
    // That it was nudged is kept with the seat, so a restart does not nudge it again.
    expect(JSON.parse(readFileSync(join(f.directory, "agents", f.batch().id, f.seats()[0].id, "idle.json"), "utf8"))).toEqual({ nudged: true, told: false });
  });

  it("does not finish or nudge a turn that was interrupted, or one that ended to ask the human for access", async () => {
    const f = fixture();
    f.team(1);
    const agent = f.pool.active.get(f.seats()[0].id).agent;
    agent.interrupt();
    f.say(f.of(0), DONE_PHRASE);
    await tick();
    expect(f.statuses()).toEqual(["running"]);
    expect(f.of(0).sent).toHaveLength(1);
    writeFileSync(join(f.of(0).options.cwd, "checkpoint.json"), JSON.stringify({ summary: "Needs the archive", findings: "Login wall", nextSteps: "Read vol. 5", accessRequest: { instruction: "Sign in to the county archive.", url: "https://archive.example/" } }));
    f.say(f.of(0), "I have asked for access.");
    await tick();
    expect(f.statuses()).toEqual(["paused"]);
    expect(f.batch().accessRequest).toMatchObject({ instruction: "Sign in to the county archive." });
    expect(f.of(0).sent).toHaveLength(1);
    // While the human has the whole batch paused, answering the request starts nothing.
    f.store.command({ type: "pause", investigationId: f.batch().id });
    f.store.update((next: any) => (next.investigations[0].accessRequest = { instruction: "Sign in to the county archive.", url: "https://archive.example/", assignmentId: next.investigations[0].assignments[0].id }));
    f.store.command({ type: "resolve-access", investigationId: f.batch().id });
    f.pool.pump();
    expect(f.statuses()).toEqual(["paused"]);
    expect(f.launches).toHaveLength(1);
    expect(() => f.pool.resume(f.seats()[0].id)).toThrow("The whole batch is paused");
    expect(() => f.store.command({ type: "claim", investigationId: f.batch().id, assignmentId: f.seats()[0].id, worker: "x" })).toThrow("This batch is paused");
    f.store.command({ type: "resume", investigationId: f.batch().id });
    f.pool.pump();
    f.init(f.of(0), "session-1");
    f.pool.pause(f.seats()[0].id);
    f.store.update((next: any) => (next.investigations[0].accessRequest = { instruction: "Sign in to the county archive.", url: "https://archive.example/", assignmentId: next.investigations[0].assignments[0].id }));
    // The human could not get in: it carries on, told so, with its conversation.
    f.store.command({ type: "resolve-access", investigationId: f.batch().id, outcome: "unavailable" });
    f.pool.pump();
    expect(f.launches).toHaveLength(3);
    expect(f.of(0).args).toContain("--resume");
    expect(f.of(0).sent[0]).toContain("the human could not get in");
    expect(f.of(0).sent[0]).toContain("https://archive.example/: Sign in to the county archive.");
  });
});

describe("the board", () => {
  it("takes a researcher's post from its session, delivers it to every other researcher at work, and refuses a repeat", async () => {
    const f = fixture();
    f.team(3);
    const coordinator = f.pool.coordinator;
    const before = f.store.state.revision;
    expect(f.pool.post(f.seats()[0].id, "  The 1881 register is missing from the scans.  ")).toEqual({ posted: true, id: expect.any(String) });
    await tick();
    expect(f.batch().board).toEqual([expect.objectContaining({ assignmentId: f.seats()[0].id, text: "The 1881 register is missing from the scans." })]);
    expect(f.of(0).sent).toHaveLength(1);
    for (const place of [1, 2]) expect(f.of(place).sent.at(-1)).toBe("A post on your batch's board, from Researcher 1:\n\nThe 1881 register is missing from the scans.");
    // Each keeps the post in its inbox until the turn after it was sent has ended, so
    // a post the app closed on before it arrived would be sent again, never lost.
    expect([f.inbox(0), f.inbox(1), f.inbox(2)].map((i) => i.length)).toEqual([0, 1, 1]);
    f.say(f.of(1), "Noted.");
    expect(f.inbox(1)).toEqual([]);
    expect(f.of(1).sent.filter((m) => m.includes("The 1881 register"))).toHaveLength(1);
    // The same post from the same seat, as when code is run again, is refused.
    expect(() => f.pool.post(f.seats()[0].id, "The 1881 register is missing from the scans.")).toThrow("already posted exactly this");
    expect(f.batch().board).toHaveLength(1);
    // The coordinator hears of it, and the library keeps it for those who start later.
    expect(coordinator.delta(coordinator.session.secret, before).changed.boardPosts).toEqual([{ investigationId: f.batch().id, from: "Researcher 1", text: "The 1881 register is missing from the scans." }]);
    expect(readFileSync(join(f.directory, "library", "batches", "batch-1", "board.md"), "utf8")).toContain("Nothing posted yet.");
    const { writeLibrary } = await import("../server/research-library.mjs");
    writeLibrary(f.store.state, f.directory);
    expect(readFileSync(join(f.directory, "library", "batches", "batch-1", "board.md"), "utf8")).toContain("from Researcher 1\n\nThe 1881 register is missing");
  });

  it("gives the coordinator's post to the whole team, and keeps it from the coordinator's own news", async () => {
    const f = fixture();
    const { coordinator, session, investigationId } = f.team(2);
    const before = f.store.state.revision;
    coordinator.command({ action: "post", session, investigationId, text: "The human has added the 1891 directory to Sources." });
    await tick();
    for (const l of f.launches) expect(l.sent.at(-1)).toBe("A post on your batch's board, from the coordinator:\n\nThe human has added the 1891 directory to Sources.");
    expect(f.batch().board).toEqual([expect.objectContaining({ author: "coordinator", text: "The human has added the 1891 directory to Sources." })]);
    expect(coordinator.delta(coordinator.session.secret, before).changed?.boardPosts).toBeUndefined();
    expect(coordinator.status().latest!.text).toBe("Posting to batch 1's board");
  });

  it("wakes a finished seat, which resumes its conversation with the post as its message, and takes the batch out of Review", async () => {
    const f = fixture();
    const { coordinator, session, investigationId } = f.team(2);
    f.say(f.of(0), DONE_PHRASE);
    f.say(f.of(1), DONE_PHRASE);
    expect(f.batch().status).toBe("review");
    expect(f.launches).toHaveLength(2);
    // The human says keep going; the coordinator's post wakes the whole team.
    coordinator.command({ action: "post", session, investigationId, text: "The human wants the 1890s followed too." });
    expect(f.statuses()).toEqual(["running", "running"]);
    expect(f.batch().status).toBe("running");
    expect(f.batch().readyAt).toBeUndefined();
    expect(f.launches).toHaveLength(4);
    [0, 1].forEach((place) => {
      const woken = f.of(place);
      // The same conversation, in the same folder.
      expect(woken.args.slice(woken.args.indexOf("--resume"), woken.args.indexOf("--resume") + 2)).toEqual(["--resume", `session-${place + 1}`]);
      expect(woken.options.cwd).toBe(f.launches[place]!.options.cwd);
      expect(woken.sent).toHaveLength(1);
      expect(woken.sent[0]).toContain("Your conversation has been picked up again in the same folder, and your Python session's variables are as your last completed run left them.");
      expect(woken.sent[0]).toContain("A post on your batch's board, from the coordinator:\n\nThe human wants the 1890s followed too.");
      expect(woken.sent[0]).toContain(`or end your turn with ${DONE_PHRASE} when nothing is left to pursue`);
    });
    // The post waits in each inbox until the woken researcher's turn has ended.
    f.init(f.of(0), "session-1");
    expect(f.inbox(0)).toHaveLength(1);
    // One finishes again and the other posts: only the finished one is woken.
    f.init(f.of(1), "session-2");
    f.say(f.of(0), DONE_PHRASE);
    expect(f.inbox(0)).toEqual([]);
    expect(f.statuses()).toEqual(["finished", "running"]);
    f.pool.post(f.seats()[1].id, "A sale notice names the buyer.");
    expect(f.statuses()).toEqual(["running", "running"]);
    expect(f.launches).toHaveLength(5);
    expect(f.of(0).sent[0]).toContain("A post on your batch's board, from Researcher 2:\n\nA sale notice names the buyer.");
    // A researcher's own post does not wake its own seat.
    f.init(f.of(0), "session-1");
    f.say(f.of(0), DONE_PHRASE);
    f.say(f.of(1), DONE_PHRASE);
    expect(f.batch().status).toBe("review");
  });

  it("never wakes a paused seat, and gives it the posts it missed as one message when the human resumes it", async () => {
    const f = fixture();
    f.team(2);
    f.pool.pause(f.seats()[1].id);
    expect(f.statuses()).toEqual(["running", "paused"]);
    expect(f.of(1).child.killed).toBe(true);
    f.pool.post(f.seats()[0].id, "The 1881 register is missing from the scans.");
    f.pool.announce(f.batch().id, "The human has the 1895 directory on paper.");
    f.pool.pump();
    expect(f.statuses()).toEqual(["running", "paused"]);
    expect(f.launches).toHaveLength(2);
    // They wait on disk, in its seat's inbox, and survive the app restarting.
    expect(f.inbox(1)).toHaveLength(2);
    f.pool.stop();
    const again = fixture({ directory: f.directory });
    again.pool.coordinator = f.pool.coordinator;
    again.pool.resume(again.seats()[1].id);
    expect(again.launches).toHaveLength(1);
    expect(again.launches[0]!.args).toContain("--resume");
    expect(again.launches[0]!.sent).toHaveLength(1);
    const message = again.launches[0]!.sent[0]!;
    expect(message).toContain("While you were away:");
    expect(message.indexOf("from Researcher 1:\n\nThe 1881 register is missing from the scans.")).toBeGreaterThan(0);
    expect(message.indexOf("from the coordinator:\n\nThe human has the 1895 directory on paper.")).toBeGreaterThan(message.indexOf("from Researcher 1"));
    // Delivered once: not sent again while they wait, and gone once its turn has ended.
    again.init(again.launches[0]!, "session-2");
    again.pool.pump();
    await tick();
    expect(again.launches[0]!.sent).toHaveLength(1);
    again.say(again.launches[0]!, "Noted; carrying on.");
    expect(again.inbox(1)).toEqual([]);
  });

  it("still delivers a post the app closed on after saving it and before giving it to the team", async () => {
    const f = fixture();
    f.team(2);
    f.pool.pause(f.seats()[1].id);
    // The post is saved with the board, and the app ends before it reaches any inbox.
    f.pool.stop();
    f.store.command({ type: "post", assignmentId: f.seats()[0].id, text: "The 1896 deed names the buyer.", key: "k" });
    expect(f.inbox(1)).toEqual([]);
    const again = fixture({ directory: f.directory });
    expect(again.inbox(1)).toHaveLength(1);
    // Put there once, however often the app looks.
    again.pool.pump();
    expect(again.inbox(1)).toHaveLength(1);
    expect(again.inbox(0)).toEqual([]);
    again.pool.coordinator = f.pool.coordinator;
    again.pool.resume(again.seats()[1].id);
    expect(again.of(1).sent[0]).toContain("from Researcher 1:\n\nThe 1896 deed names the buyer.");
  });

  it("holds a post for a seat woken while the human has the whole batch paused", async () => {
    const f = fixture();
    const { investigationId } = f.team(2);
    f.say(f.of(0), DONE_PHRASE);
    f.store.command({ type: "pause", investigationId });
    f.pool.pump();
    expect(f.statuses()).toEqual(["finished", "paused"]);
    f.pool.announce(investigationId, "A new lead.");
    expect(f.statuses()).toEqual(["paused", "paused"]);
    expect(f.launches).toHaveLength(2);
    f.store.command({ type: "resume", investigationId });
    f.pool.pump();
    expect(f.statuses()).toEqual(["running", "running"]);
    expect(f.of(0).sent[0]).toContain("from the coordinator:\n\nA new lead.");
    expect(f.of(1).sent[0]).toContain("from the coordinator:\n\nA new lead.");
  });
});

describe("a batch reaching Review", () => {
  it("starts what the human set to follow automatically, once its team has finished with findings", () => {
    const f = fixture();
    f.store.update((next: any) => {
      next.reviewSettings = { autoWalkthrough: true, autoGraph: false };
      next.documents.push({ id: "deed", collectionId: "web", name: "Deed.pdf", mime: "application/pdf", size: 1, sha256: "x", importedAt: "t", text: "[Page 1]\nSold to Ann Example in 1896.", pages: 1, revision: 1 });
    });
    f.team(1);
    new FindingPublisher(f.store).publish(f.seats()[0].id, { statement: "Ann Example bought the mill in 1896.", qualification: "supported", explanation: "The deed says so.", evidence: [{ document: "deed", page: 1, quote: "Sold to Ann Example in 1896.", interpretation: "The sale." }] } as any);
    expect(f.batch().walkthroughRequestedAt).toBeUndefined();
    f.say(f.of(0), DONE_PHRASE);
    expect(f.batch().status).toBe("review");
    expect(f.batch().walkthroughRequestedAt).toBeTruthy();
  });
});

describe("stopping a batch's team", () => {
  it("ends every researcher and its session at once, drops what waited for them, and keeps what they published", async () => {
    const sessions = fakeSessions();
    const f = fixture({ sessions });
    f.store.update((next: any) => {
      next.reviewSettings = { autoWalkthrough: true, autoGraph: false };
      next.documents.push({ id: "deed", collectionId: "web", name: "Deed.pdf", mime: "application/pdf", size: 1, sha256: "x", importedAt: "t", text: "[Page 1]\nSold to Ann Example in 1896.", pages: 1, revision: 1 });
    });
    const { coordinator, session, investigationId } = f.team(3);
    const publisher = new FindingPublisher(f.store);
    const finding = { statement: "Ann Example bought the mill in 1896.", qualification: "supported", explanation: "The deed says so.", evidence: [{ document: "deed", page: 1, quote: "Sold to Ann Example in 1896.", interpretation: "The sale." }] } as any;
    publisher.publish(f.seats()[0].id, finding);
    f.say(f.of(1), DONE_PHRASE);
    f.pool.pause(f.seats()[2].id);
    f.pool.post(f.seats()[0].id, "The deed is published.");
    expect(f.statuses()).toEqual(["running", "running", "paused"]);
    expect(f.inbox(2)).toHaveLength(1);
    const leases = f.seats().map((a: any) => a.lease?.token);
    expect(coordinator.command({ action: "stop-team", session, investigationId, reason: "The human no longer wants this." })).toEqual({ stopped: true });
    expect(coordinator.status().latest!.text).toBe("Stopping the team on batch 1");
    expect(f.statuses()).toEqual(["stopped", "stopped", "stopped"]);
    for (const l of f.launches) expect(l.child.killed).toBe(true);
    for (const seat of sessions.seats.values()) expect(seat.open).toBe(false);
    expect(f.pool.active.size).toBe(0);
    expect([f.inbox(0), f.inbox(1), f.inbox(2)]).toEqual([[], [], []]);
    // A stopped batch stays stopped: its leases are refused, and no post reaches or wakes it.
    expect(sessions.seats.get(f.seats()[0].id).authorize(leases[0])).toBe(false);
    expect(() => f.pool.post(f.seats()[0].id, "A late post.")).toThrow("team was stopped");
    expect(() => coordinator.command({ action: "post", session, investigationId, text: "Keep going." })).toThrow("team was stopped");
    f.pool.pump();
    expect(f.launches).toHaveLength(4);
    // What the team published stays, for Review.
    expect(f.batch().proposals).toHaveLength(1);
    expect(f.batch().status).toBe("review");
    // What the human set to follow Review automatically starts, as when a team finishes.
    expect(f.batch().walkthroughRequestedAt).toBeTruthy();
  });
});

describe("researchers' Python sessions", () => {
  it("open with the researcher, answer only its lease, and are described to it", async () => {
    const sessions = fakeSessions();
    const f = fixture({ sessions });
    const { investigationId: id } = f.team(1);
    const assignment = assignmentOf(f.store, id);
    const seat = sessions.seats.get(assignment.id);
    expect(seat).toMatchObject({ open: true, folder: f.of(0).options.cwd, seat: join(f.directory, "agents", id, assignment.id) });
    expect(seat.authorize(assignment.lease.token)).toBe(true);
    expect(seat.authorize("someone-else")).toBe(false);
    const instructions = f.launches[0]!.args.join(" ");
    expect(instructions).toContain("node tools/python.mjs");
    // Pages are saved into the library through the session, not read into the conversation.
    expect(instructions).toContain("weir.save(url)");
    expect(instructions).toContain("weir.publish(statement, qualification, explanation, evidence)");
    const args = f.launches[0]!.args;
    expect(JSON.parse(args[args.indexOf("--settings") + 1]!).permissions.deny).toContain("WebFetch");
    // Long output reaches the researcher as a message.
    seat.deliver("Your long Python run has finished. Its output:\n\n40 pages");
    await tick();
    expect(f.of(0).sent.at(-1)).toContain("40 pages");
    // Paused, the researcher's lease no longer runs code, but the seat's session stays,
    // so code already running there can finish; what it has for the seat waits in its inbox.
    const token = assignment.lease.token;
    f.pool.pause(assignment.id);
    expect(seat.authorize(token)).toBe(false);
    expect(seat.open).toBe(true);
    expect(seat.live()).toBe(true);
    seat.deliver("A Python run started before this seat's researcher was paused or switched has finished. Its output:\n\n12 rows");
    const before = f.launches.length;
    f.pool.resume(assignment.id);
    expect(f.launches).toHaveLength(before + 1);
    expect(f.launches.at(-1)!.sent[0]).toContain("12 rows");
    // Stopped, the seat can no longer act, and its session ends.
    f.pool.stopTeam(id, "The human stopped the batch.");
    expect(sessions.seats.get(assignment.id).open).toBe(false);
    expect(sessions.seats.get(assignment.id).live()).toBe(false);
  });

  it("stay with the seat when the human switches its researcher to another agent", () => {
    const sessions = fakeSessions();
    const f = fixture({ sessions });
    const { investigationId: id } = f.team(1);
    const assignment = assignmentOf(f.store, id);
    const before = sessions.seats.get(assignment.id);
    f.pool.switch(assignment.id, { agent: "codex" }, "Codex");
    const after = sessions.seats.get(assignment.id);
    expect(f.launches).toHaveLength(2);
    expect(f.launches[1]!.executable).toBe("/test/codex");
    expect(after.open).toBe(true);
    expect(after.folder).not.toBe(before.folder);
    expect(after.seat).toBe(before.seat);
  });
});

describe("a researcher that is cut short", () => {
  it("saves the checkpoints it writes, and waits paused rather than being started again", () => {
    const f = fixture();
    f.team(2);
    writeFileSync(join(f.of(0).options.cwd, "checkpoint.json"), JSON.stringify({ summary: "Searched", findings: "No original found", nextSteps: "Inspect archive" }));
    f.pool.pump();
    f.pool.pump();
    expect(f.seats()[0].checkpoints).toHaveLength(1);
    f.of(0).child.emit("close", 1);
    f.pool.pump();
    expect(f.statuses()).toEqual(["paused", "running"]);
    expect(f.batch().events.at(-1).message).toBe("claude stopped work as Researcher 1 before it had finished. Resume to pick up its conversation where it left off.");
    expect(f.launches).toHaveLength(2);
    // Its teammate carries on, so the batch still runs.
    expect(f.batch().status).toBe("running");
  });

  it("is paused when the app restarts, so its old lease cannot act", () => {
    const f = fixture();
    const { investigationId: id } = f.team(1);
    const token = assignmentOf(f.store, id).lease.token;
    writeFileSync(join(f.of(0).options.cwd, "checkpoint.json"), JSON.stringify({ summary: "Found the deed", findings: "Registry book 4, page 12", nextSteps: "Check the tax rolls" }));
    // The app ends without stopping its researchers, as a crash would.
    clearInterval(f.pool.timer);
    const reopened = new ResearcherPool(f.store, f.directory, resolve("."));
    cleanups.push(() => reopened.stop());
    expect(f.batch().status).toBe("paused");
    expect(f.batch().events.at(-1).message).toBe("The app closed while Researcher 1 was working. Resume to pick up its conversation where it left off.");
    expect(f.seats()[0].checkpoints.map((c: any) => c.summary)).toEqual(["Found the deed"]);
    expect(f.seats()[0].session).toMatchObject({ id: "session-1" });
    expect(() => f.store.command({ type: "checkpoint", investigationId: id, token, summary: "late", findings: "late", nextSteps: "late" })).toThrow("lease");
  });

  it("waits for the human to switch it when its agent is not installed", () => {
    const f = fixture();
    f.pool.findExecutable = (name: string) => (name === "codex" ? null : `/test/${name}`);
    openTeam(f.store, f.pool, "codex", { size: 1 });
    expect(f.launches).toHaveLength(0);
    expect(f.statuses()).toEqual(["paused"]);
    expect(f.batch().events.at(-1).message).toBe("Researcher 1 could not start: codex is not installed. Switch it to an installed agent, then resume it.");
    f.pool.switch(f.seats()[0].id, { agent: "claude" }, "Claude Code");
    f.pool.resume(f.seats()[0].id);
    expect(f.launches).toHaveLength(1);
  });
});

describe.each(["claude", "codex"] as const)("a team of %s researchers, end to end", (engine) => {
  const executables = { claude: resolve("tests/fixtures/fake-claude.mjs"), codex: resolve("tests/fixtures/fake-codex.mjs") };
  // The stand-in researcher reads its instructions on its first turn, taking as long
  // as the test says, and says the done phrase when asked whether it has finished or
  // sent a post.
  const reading = (delay: number) => (engine === "claude" ? { tool: "Read", input: { file_path: "AGENTS.md" }, delay } : { command: "cat AGENTS.md", delay });
  async function running(size = 2, delay = 400) {
    const directory = mkdtempSync(join(tmpdir(), "weir-team-"));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    const script = join(directory, "script.json");
    // The stand-in reads its script afresh for every message, so a test can change it.
    const first = (delay: number) =>
      writeFileSync(
        script,
        JSON.stringify({
          "post what you mean to try first": [reading(delay)],
          "without saying whether you have finished": [{ say: `The leads are spent.\n\n${DONE_PHRASE}` }],
          "A post on your batch's board": [{ say: `Noted; it changes nothing.\n\n${DONE_PHRASE}` }],
          default: [],
        }),
      );
    first(delay);
    for (const name of ["FAKE_CLAUDE_STEPS", "FAKE_CODEX_STEPS"]) process.env[name] = script;
    for (const name of ["FAKE_CLAUDE_RECORD", "FAKE_CODEX_RECORD"]) process.env[name] = "1";
    cleanups.push(() => ["FAKE_CLAUDE_STEPS", "FAKE_CODEX_STEPS", "FAKE_CLAUDE_RECORD", "FAKE_CODEX_RECORD"].forEach((name) => delete process.env[name]));
    const store = new WorkspaceStore(directory, dataset);
    const start = () => {
      const pool = new ResearcherPool(store, directory, resolve("."), { findExecutable: (name: string) => (executables as any)[name] });
      cleanups.push(() => pool.stop());
      return pool;
    };
    const pool = start();
    const opened = openTeam(store, pool, engine, { size, scope: ["imports"] });
    const batch = () => store.state.investigations[0];
    const statuses = () => batch().assignments.map((a: any) => a.status);
    const received = (place: number) => {
      const file = join(batch().assignments[place].session?.directory || "", "received.jsonl");
      return existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line).text as string) : [];
    };
    const models = (place: number) => readFileSync(join(batch().assignments[place].session.directory, "models.txt"), "utf8").trim().split("\n");
    return { ...opened, directory, store, pool, start, batch, statuses, received, models, first };
  }

  it("starts on a new batch, finishes with the done phrase, is woken by a post, and the batch moves to Review each time", async () => {
    const r = await running();
    // Both researchers start. Their first turns end without the phrase; nudged, they
    // say it, and the batch reaches Review.
    await until(() => r.batch().status === "review");
    expect(r.statuses()).toEqual(["finished", "finished"]);
    await until(() => r.pool.active.size === 0);
    expect(r.pool.live.list()).toEqual([]);
    for (const place of [0, 1]) {
      expect(r.received(place)[0]).toContain(`You are Researcher ${place + 1} on batch 1`);
      expect(r.received(place)[1]).toContain("You ended your turn without saying whether you have finished");
      expect(r.models(place)).toEqual(["start default"]);
    }
    // The coordinator's post wakes both, in their own conversations.
    r.coordinator.command({ action: "post", session: r.session, investigationId: r.investigationId, text: "The human wants the 1890s followed too." });
    expect(r.batch().status).toBe("running");
    await until(() => r.batch().status === "review");
    for (const place of [0, 1]) {
      expect(r.models(place)).toEqual(["start default", "resume default"]);
      expect(r.received(place).at(-1)).toContain("from the coordinator:\n\nThe human wants the 1890s followed too.");
    }
    await until(() => r.pool.active.size === 0);
  });

  it("keeps its conversation when the app closes, and picks it up in the same folder when the human resumes it", async () => {
    // Its first turn is still under way when the app closes.
    const r = await running(1, 60_000);
    await until(() => r.batch().assignments[0].session);
    const session = r.batch().assignments[0].session;
    expect(session).toMatchObject({ engine, directory: expect.stringContaining(r.investigationId) });
    // The human closes the app and chooses to stop its workers.
    r.pool.stop();
    await until(() => r.batch().status === "paused");
    expect(r.batch().events.at(-1).message).toContain("Resume to pick up its conversation where it left off.");
    expect(r.batch().assignments[0].session).toEqual(session);
    const pool = r.start();
    pool.coordinator = r.coordinator;
    pool.resume(r.batch().assignments[0].id);
    // The same session, in the same folder, rather than a fresh researcher.
    expect([...pool.active.values()][0].directory).toBe(session.directory);
    await until(() => r.models(0).length === 2);
    expect(r.models(0)).toEqual(["start default", "resume default"]);
    // It is told its conversation was picked up, and that messages it has not acted on still stand.
    await until(() => r.received(0).some((text) => text.includes("Your conversation has been picked up again")));
    expect(r.received(0).find((text) => text.includes("picked up again"))).toContain("Any message above that you have not acted on still stands");
    await until(() => r.batch().status === "review");
    expect(r.batch().assignments[0].session).toMatchObject({ id: session.id, directory: session.directory });
  });

  it("starts a fresh researcher from the checkpoints when its conversation cannot be picked up", async () => {
    const r = await running(1, 60_000);
    await until(() => r.batch().assignments[0].session);
    r.pool.stop();
    await until(() => r.batch().status === "paused");
    r.first(0);
    const old = r.batch().assignments[0].session;
    r.store.update((next: any) => {
      next.investigations[0].assignments[0].session.id = "a-session-that-is-gone";
    });
    const pool = r.start();
    pool.coordinator = r.coordinator;
    pool.resume(r.batch().assignments[0].id);
    await until(() => r.batch().events.some((e: any) => e.message.includes("could not be picked up")));
    await until(() => r.batch().assignments[0].session?.id && r.batch().assignments[0].session.id !== "a-session-that-is-gone");
    expect(r.batch().assignments[0].session.directory).not.toBe(old.directory);
    await until(() => r.batch().status === "review");
  });

  it("stops mid-run when the coordinator stops the team", async () => {
    const r = await running(2, 60_000);
    await until(() => r.pool.live.list().length === 2 && r.pool.live.list().every((w: any) => w.latest?.text === "Reading its instructions"));
    r.coordinator.command({ action: "stop-team", session: r.session, investigationId: r.investigationId, reason: "Wrong direction." });
    await until(() => r.pool.active.size === 0);
    expect(r.statuses()).toEqual(["stopped", "stopped"]);
    expect(r.batch().events.map((e: any) => e.message)).toContain("The coordinator stopped this batch's team: Wrong direction.");
    expect(r.pool.live.list()).toEqual([]);
  });
});

describe("the research browser for web researchers", () => {
  it("gives a web researcher the browser, and tells it to keep to its own tab", async () => {
    const f = fixture();
    // A stand-in for the app's research browser.
    const server = { command: "/bin/node", args: ["chrome-devtools-mcp.js", "--browserUrl", "http://127.0.0.1:9333"], env: {} };
    f.pool.browser = { available: true, open: async () => "http://127.0.0.1:9333", mcpServer: () => server } as any;
    openTeam(f.store, f.pool, "claude");
    await new Promise((done) => setTimeout(done, 10));
    const args = f.launches[0]!.args;
    expect(JSON.parse(args[args.indexOf("--mcp-config") + 1]!)).toEqual({ mcpServers: { browser: server } });
    expect(JSON.parse(args[args.indexOf("--settings") + 1]!).permissions.allow).toContain("mcp__browser");
    expect(args.join(" ")).toContain("Open your own tab with new_page");
  });

  it("gives a researcher confined to local documents no browser", async () => {
    const f = fixture();
    let opened = false;
    f.pool.browser = { available: true, open: async () => ((opened = true), "http://127.0.0.1:9333"), mcpServer: () => ({}) } as any;
    openTeam(f.store, f.pool, "claude", { scope: ["imports"] });
    await new Promise((done) => setTimeout(done, 10));
    expect(opened).toBe(false);
    const args = f.launches[0]!.args;
    expect(JSON.parse(args[args.indexOf("--mcp-config") + 1]!)).toEqual({ mcpServers: {} });
    expect(args.join(" ")).toContain("The project's saved documents are in scope");
  });
});
