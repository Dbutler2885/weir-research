// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import dataset from "./fixtures/workshop.json";
import { WorkspaceStore } from "../server/store.mjs";
import { ResearcherPool } from "../server/researchers.mjs";
import { queueOf } from "../src/domain/queue";
import { buildCoordinatorContext } from "../src/domain/coordinator-context";
import { queueSection } from "../src/ui/queue-view";

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).reverse().forEach((clean) => clean()));

// Three fictional batches, numbered 1 to 3, each with a team of one waiting to start.
function project(size = 1) {
  const directory = mkdtempSync(join(tmpdir(), "queue-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const store = new WorkspaceStore(directory, dataset);
  store.update((next: any) => (next.researchSettings = { timeLimitMinutes: null, researchersPerBatch: size }));
  const ids = ["Mill", "Ledger", "Wharf"].map((title) => (store.command({ type: "open-batch", title, goal: `Find out about the fictional ${title}.`, scope: ["imports"], choice: { engine: "claude", model: null, effort: null } }) as any).investigationId);
  const order = () => queueOf(store.state).map((b) => b.title);
  return { directory, store, ids, order };
}

describe("the queue", () => {
  it("starts in batch order, and the human can move a batch up or down", () => {
    const p = project();
    expect(p.order()).toEqual(["Mill", "Ledger", "Wharf"]);
    expect(p.store.command({ type: "queue-move", investigationId: p.ids[2], direction: "up" })).toEqual({ moved: true, place: 2 });
    expect(p.order()).toEqual(["Mill", "Wharf", "Ledger"]);
    p.store.command({ type: "queue-move", investigationId: p.ids[2], direction: "up" });
    expect(p.order()).toEqual(["Wharf", "Mill", "Ledger"]);
    // The top cannot go higher.
    expect(p.store.command({ type: "queue-move", investigationId: p.ids[2], direction: "up" })).toEqual({ moved: false });
    expect(p.store.state.investigations[2].events.at(-1).message).toBe("You moved this batch up the queue, to place 1.");
    // The order is saved.
    expect(queueOf(new WorkspaceStore(p.directory, dataset).state).map((b) => b.title)).toEqual(["Wharf", "Mill", "Ledger"]);
  });

  it("holds a batch in its place until the human releases it", () => {
    const p = project();
    p.store.command({ type: "queue-hold", investigationId: p.ids[0], held: true });
    expect(p.store.state.investigations[0].held).toBe(true);
    expect(p.order()).toEqual(["Mill", "Ledger", "Wharf"]);
    p.store.command({ type: "queue-hold", investigationId: p.ids[0], held: false });
    expect(p.store.state.investigations[0].held).toBeUndefined();
  });

  it("changes what runs next: researchers start from the top and skip a held batch", () => {
    const p = project();
    const launched: string[] = [];
    const launch = (_: string, __: string[], options: any) => {
      launched.push(options.cwd);
      return Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, kill() {} });
    };
    p.store.command({ type: "queue-move", investigationId: p.ids[2], direction: "up" });
    p.store.command({ type: "queue-move", investigationId: p.ids[2], direction: "up" });
    p.store.command({ type: "queue-hold", investigationId: p.ids[0], held: true });
    const pool = new ResearcherPool(p.store, p.directory, resolve("."), { launch: launch as any, findExecutable: (n: string) => `/test/${n}` });
    cleanups.push(() => pool.stop());
    pool.pump();
    // Wharf, now first, starts first, then Ledger; Mill is held.
    expect(launched).toHaveLength(2);
    expect(launched[0]).toContain(p.ids[2]);
    expect(launched[1]).toContain(p.ids[1]);
    expect(p.store.state.investigations[0].assignments[0].status).toBe("waiting");
    // Released, its team starts.
    p.store.command({ type: "queue-hold", investigationId: p.ids[0], held: false });
    pool.pump();
    expect(launched).toHaveLength(3);
    expect(launched[2]).toContain(p.ids[0]);
  });

  it("starts every researcher of every batch's team, at the size the team had when its batch opened", () => {
    const p = project(2);
    let launches = 0;
    const launch = () => {
      launches++;
      return Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, kill() {} });
    };
    const pool = new ResearcherPool(p.store, p.directory, resolve("."), { launch: launch as any, findExecutable: (n: string) => `/test/${n}` });
    cleanups.push(() => pool.stop());
    // A smaller team size applies to batches opened from now on.
    pool.configure({ researchersPerBatch: 1 });
    pool.pump();
    expect(launches).toBe(6);
    expect(p.store.state.investigations.map((i: any) => i.assignments.map((a: any) => a.status))).toEqual(Array(3).fill(["running", "running"]));
    p.store.command({ type: "open-batch", title: "Quay", goal: "Find out about the fictional quay.", scope: ["imports"], choice: { engine: "claude", model: null, effort: null } });
    expect(p.store.state.investigations[3].assignments).toHaveLength(1);
  });

  it("is what the coordinator reads, in the human's order with held batches marked", () => {
    const p = project();
    p.store.command({ type: "queue-move", investigationId: p.ids[1], direction: "up" });
    p.store.command({ type: "queue-hold", investigationId: p.ids[2], held: true });
    const text = buildCoordinatorContext(p.store.state).layers.find((l) => l.id === "queue")!.text;
    expect(text.indexOf("Ledger")).toBeLessThan(text.indexOf("Mill"));
    expect(text).toContain("held by the human: start nothing on it until they release it");
    expect(buildCoordinatorContext(p.store.state).text).toContain("team size: 1 researcher on each batch you open");
  });

  it("shows the human each batch in order, with controls to move and hold it", () => {
    const p = project();
    p.store.command({ type: "queue-hold", investigationId: p.ids[1], held: true });
    const page = queueSection(p.store.state);
    expect([...page.matchAll(/<strong>Batch \d · (\w+)<\/strong>/g)].map((m) => m[1])).toEqual(["Mill", "Ledger", "Wharf"]);
    expect(page).toContain("Held. Nothing starts on it until you release it.");
    expect(page).toContain('data-queue-hold="release"');
    expect(page).toMatch(/data-queue-move="up" disabled/);
  });
});
