// @vitest-environment node
import { assignQueued } from "./fixtures/assign";
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

// Three fictional batches, numbered 1 to 3, waiting for researchers.
function project() {
  const directory = mkdtempSync(join(tmpdir(), "queue-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const store = new WorkspaceStore(directory, dataset);
  const ids = ["Mill", "Ledger", "Wharf"].map((title) => (store.command({ type: "annotate", question: title, target: { label: title }, dispatch: true, scope: ["imports"] }) as any).investigationId);
  store.update((next: any) => next.investigations.forEach((i: any, n: number) => Object.assign(i, { number: n + 1, title: ["Mill", "Ledger", "Wharf"][n] })));
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
    assignQueued(p.store, pool, "claude");
    // Wharf, now first, starts first, then Ledger; Mill is held.
    expect(launched).toHaveLength(2);
    expect(launched[0]).toContain(p.ids[2]);
    expect(launched[1]).toContain(p.ids[1]);
    expect(p.store.state.investigations[0].status).toBe("queued");
  });

  it("lets the coordinator run more workers than the setting when the human asks for more on a job", async () => {
    const { Coordinator } = await import("../server/coordinator.mjs");
    const p = project();
    let launches = 0;
    const launch = () => {
      launches++;
      return Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, kill() {} });
    };
    const coordinator = new Coordinator(p.store);
    const session = "coordinator-session-for-queue-0001";
    coordinator.attach("Test", session);
    const pool = new ResearcherPool(p.store, p.directory, resolve("."), { launch: launch as any, findExecutable: (n: string) => `/test/${n}`, coordinator } as any);
    cleanups.push(() => pool.stop());
    pool.configure({ maxWorkers: 1 });
    for (const id of p.ids) coordinator.command({ action: "assign", session, investigationId: id, engine: "claude", brief: "One agent per person, as the human asked." });
    pool.pump();
    // The setting guides the coordinator; the app does not cap what it assigns.
    expect(launches).toBe(3);
  });

  it("is what the coordinator reads, in the human's order with held batches marked", () => {
    const p = project();
    p.store.command({ type: "queue-move", investigationId: p.ids[1], direction: "up" });
    p.store.command({ type: "queue-hold", investigationId: p.ids[2], held: true });
    const text = buildCoordinatorContext(p.store.state).layers.find((l) => l.id === "queue")!.text;
    expect(text.indexOf("Ledger")).toBeLessThan(text.indexOf("Mill"));
    expect(text).toContain("held by the human: start nothing on it until they release it");
    expect(buildCoordinatorContext(p.store.state).text).toContain("workers at once: at most 4, unless the human asks for more for a particular job");
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
