// @vitest-environment node
import { assignQueued } from "./fixtures/assign";
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AgentSupervisor } from "../server/agents/supervisor.mjs";
import { LiveActivity, fileDescriber, researcherFiles } from "../server/live-activity.mjs";

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).reverse().forEach((clean) => clean()));
const until = async (check: () => unknown, tries = 500) => {
  for (let n = 0; n < tries && !check(); n++) await new Promise((done) => setTimeout(done, 20));
  expect(check()).toBeTruthy();
};
const steps = (list: object[]) => `steps:${JSON.stringify(list)}`;
const read = (file: string, delay = 0) => ({ tool: "Read", input: { file_path: file }, delay });

function place() {
  const root = mkdtempSync(join(tmpdir(), "hosts-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const folder = join(root, "agent");
  require("node:fs").mkdirSync(folder);
  const hosts = { registry: join(root, "registry"), sockets: join(root, "s"), heartbeat: 200, timeout: 1500 };
  // One app's supervisor; a second one stands for the app opened again.
  const app = () => {
    const live = new LiveActivity();
    const supervisor = new AgentSupervisor({ live, hosts, stopGrace: 200, quotaWait: { unknown: 30 * 60_000, margin: 0 } });
    cleanups.push(() => clearInterval(supervisor.beat));
    return { live, supervisor };
  };
  const pidOf = (record: any) => JSON.parse(readFileSync(join(hosts.registry, `${record.id}.json`), "utf8")).pid;
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  return { root, folder, hosts, app, pidOf, alive };
}
const start = (supervisor: any, folder: string, prompt: string) =>
  supervisor.start({
    key: "research:hosted",
    provider: "claude",
    executable: resolve("tests/fixtures/fake-claude.mjs"),
    folder,
    prompt,
    meta: { role: "researcher", investigationId: "hosted" },
    live: { role: "researcher", name: "Claude researcher", investigationId: "hosted" },
    describe: fileDescriber(researcherFiles),
  });

describe("agents under their own host process", () => {
  it("behave like local agents: actions, steering and turn ends reach the app", async () => {
    const p = place();
    const { live, supervisor } = p.app();
    const agent = start(supervisor, p.folder, steps([read("brief.json", 400), read("findings.ts", 400)]));
    cleanups.push(() => agent.stop());
    const actions: string[] = [];
    agent.on("action", (text: string) => actions.push(text));
    await until(() => actions.length === 1);
    expect(live.list()[0]!.latest!.text).toBe("Reading its assignment");
    agent.steer(steps([read("types.ts")]));
    const turn = await new Promise<any>((done) => agent.once("turn", done));
    expect(turn).toMatchObject({ outcome: "done" });
    expect(actions).toEqual(["Reading its assignment", "Reading the findings format"]);
    const exit = new Promise<any>((done) => agent.once("exit", done));
    agent.finish();
    expect(await exit).toMatchObject({ code: 0 });
    expect(live.list()).toEqual([]);
  }, 20_000);

  it("stop their agent when the app's heartbeat stops", async () => {
    const p = place();
    const { supervisor } = p.app();
    const agent = start(supervisor, p.folder, steps([read("brief.json", 20_000)]));
    await new Promise((done) => agent.once("action", done));
    const pid = p.pidOf(agent.record);
    expect(p.alive(pid)).toBe(true);
    // The app closes or crashes: no more heartbeats.
    clearInterval(supervisor.beat);
    agent.socket.destroy();
    agent.ended = true;
    await until(() => !p.alive(pid));
  }, 20_000);

  it("keep their agent through the computer sleeping", async () => {
    const p = place();
    const { supervisor } = p.app();
    const agent = start(supervisor, p.folder, steps([read("brief.json", 20_000)]));
    cleanups.push(() => agent.stop());
    await new Promise((done) => agent.once("action", done));
    const pid = p.pidOf(agent.record);
    // Asleep, the host hears no heartbeat for well past the timeout; on waking, the
    // app's heartbeat arrives only after the host has looked at the clock.
    process.kill(pid, "SIGSTOP");
    await new Promise((done) => setTimeout(done, 4000));
    process.kill(pid, "SIGCONT");
    await new Promise((done) => setTimeout(done, 2000));
    expect(p.alive(pid)).toBe(true);
    expect(agent.ended).toBe(false);
  }, 20_000);

  it("keep running when kept, and are taken back by the app when it opens again", async () => {
    const p = place();
    const first = p.app();
    const agent = start(first.supervisor, p.folder, steps([read("brief.json", 1500), read("types.ts")]));
    await new Promise((done) => agent.once("action", done));
    // The human quits, keeping workers running.
    first.supervisor.keep();
    await new Promise((done) => setTimeout(done, 100));
    clearInterval(first.supervisor.beat);
    agent.socket.destroy();
    agent.ended = true;
    const pid = p.pidOf(agent.record);
    // Well past the heartbeat timeout, it is still working, and finishes its turn alone.
    await new Promise((done) => setTimeout(done, 2500));
    expect(p.alive(pid)).toBe(true);
    // The app opens again and takes the agent back, hearing what it missed.
    const second = p.app();
    const [record] = second.supervisor.hosted((r: any) => r.key === "research:hosted");
    expect(record.meta).toEqual({ role: "researcher", investigationId: "hosted" });
    const back = second.supervisor.reattach(record, { live: { role: "researcher", name: "Claude researcher", investigationId: "hosted" } });
    const missed: string[] = [];
    back.on("action", (text: string) => missed.push(text));
    const turn = await new Promise<any>((done) => back.once("turn", done));
    expect(turn).toMatchObject({ outcome: "done" });
    expect(missed).toEqual(["Reading the findings format"]);
    expect(second.live.list()[0]!.latest!.text).toBe("Reading the findings format");
    const exit = new Promise((done) => back.once("exit", done));
    back.finish();
    await exit;
    second.supervisor.forget(record);
    expect(existsSync(join(p.hosts.registry, `${record.id}.json`))).toBe(false);
  }, 20_000);
});

describe("a worker kept running while the app is closed", () => {
  it("waits out a usage limit and carries on at the reset on its own", async () => {
    const p = place();
    const first = p.app();
    const agent = start(first.supervisor, p.folder, steps([read("brief.json", 300), { quota: 1 }]));
    await new Promise((done) => agent.once("action", done));
    first.supervisor.keep();
    await new Promise((done) => setTimeout(done, 100));
    clearInterval(first.supervisor.beat);
    agent.socket.destroy();
    agent.ended = true;
    // With the app closed, it hits the limit, waits for the reset, and carries on.
    await new Promise((done) => setTimeout(done, 3500));
    const second = p.app();
    const [record] = second.supervisor.hosted((r: any) => r.key === "research:hosted");
    const back = second.supervisor.reattach(record);
    const seen: string[] = [];
    for (const type of ["paused", "resumed", "turn"]) back.on(type, () => seen.push(type));
    await until(() => seen.includes("turn"));
    expect(seen).toEqual(["paused", "resumed", "turn"]);
    back.finish();
    await new Promise((done) => back.once("exit", done));
  }, 20_000);
});

describe("a researcher pool opening again", () => {
  it("takes back a kept researcher instead of pausing its batch, and receives its findings", async () => {
    const { WorkspaceStore } = await import("../server/store.mjs");
    const { ResearcherPool } = await import("../server/researchers.mjs");
    const dataset = (await import("./fixtures/workshop.json")).default;
    const p = place();
    const store = new WorkspaceStore(join(p.root, "project"), dataset);
    const executable = resolve("tests/fixtures/fake-claude.mjs");
    const first = p.app();
    const pool = new ResearcherPool(store, join(p.root, "project"), resolve("."), { supervisor: first.supervisor, live: first.live, findExecutable: () => executable });
    const { investigationId: id } = store.command({ type: "annotate", question: "Q", target: { label: "R" }, dispatch: true, scope: ["imports"] }) as any;
    assignQueued(store, pool, "claude");
    await until(() => first.live.list()[0]);
    // The human quits, keeping the researcher running.
    first.supervisor.keep();
    await new Promise((done) => setTimeout(done, 100));
    clearInterval(first.supervisor.beat);
    clearInterval(pool.timer);
    for (const task of pool.active.values()) {
      task.agent.socket?.destroy();
      task.agent.ended = true;
    }
    // The app opens again.
    const second = p.app();
    const reopened = new ResearcherPool(store, join(p.root, "project"), resolve("."), { supervisor: second.supervisor, live: second.live, findExecutable: () => executable });
    cleanups.push(() => reopened.stop());
    expect(store.state.investigations[0].status).toBe("running");
    expect(second.live.list()).toMatchObject([{ role: "researcher", investigationId: id }]);
    // Its first turn ended with no findings; the pool hears that and it waits.
    await until(() => store.state.investigations[0].events.some((e: any) => e.message.includes("waiting for instructions")));
    const result = JSON.stringify({ title: "Unresolved", summary: "Kept", ambiguity: "Open", evidence: [], changes: [] });
    reopened.steer(id, steps([{ tool: "Write", input: { file_path: "result.json" }, writes: { "result.json": result } }]));
    await until(() => store.state.investigations[0].status === "review");
    expect(store.state.investigations[0].proposals[0].title).toBe("Unresolved");
  }, 30_000);
});
