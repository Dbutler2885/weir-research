// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import dataset from "./fixtures/workshop.json";
import { WorkspaceStore } from "../server/store.mjs";
import { Coordinator } from "../server/coordinator.mjs";
import { snapshotView } from "../scripts/coordinator-view.mjs";
import { FindingPublisher } from "../server/finding-publisher.mjs";
const cleanup: string[] = [];
afterEach(() =>
  cleanup.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true })),
);
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "research-coordinator-"));
  cleanup.push(directory);
  const store = new WorkspaceStore(directory, dataset);
  let now = 0;
  const coordinator = new Coordinator(store, { now: () => now, ttl: 100 });
  const secret = randomUUID();
  coordinator.attach("First", secret);
  const run = (data: any) => coordinator.command({ ...data, session: secret });
  const queue = () =>
    (
      store.command({
        type: "annotate",
        target: { label: "Research target" },
        question: "Check identity",
        dispatch: true,
      }) as any
    ).investigationId;
  return {
    directory,
    store,
    coordinator,
    secret,
    run,
    queue,
    advance: () => {
      now += 101;
    },
  };
}
describe("research coordination", () => {
  it("says nothing changed with the revision alone, and otherwise sends only what changed", () => {
    const f = fixture();
    const start = f.coordinator.snapshot(f.secret).revision;
    // Nothing happened: the coordinator is told the revision and no more.
    expect(f.coordinator.delta(f.secret, start)).toEqual({ revision: start, unchanged: true });
    f.store.command({ type: "send", text: "Have a look at the mill ledger." });
    const woken: any = f.coordinator.delta(f.secret, start);
    expect(woken.changed.messages.at(-1)).toMatchObject({
      author: "human",
      text: "Have a look at the mill ledger.",
    });
    expect(woken.changed.investigations).toEqual([]);
    // A wake stays small; the full index is a separate snapshot.
    expect(JSON.stringify(woken).length).toBeLessThan(
      JSON.stringify(f.coordinator.snapshot(f.secret)).length / 4,
    );
    const id = f.queue();
    const afterMessage = woken.revision;
    const second: any = f.coordinator.delta(f.secret, afterMessage);
    expect(second.changed.investigations.map((i: any) => i.id)).toEqual([id]);
    expect(second.changed.messages).toEqual([]);
    // Findings are counted, not re-sent; inspection retrieves them.
    expect(second.changed.investigations[0]).not.toHaveProperty("findings");
    expect(second.changed.investigations[0]).toHaveProperty("findingCount");
  });

  it("tells the coordinator when the human changes who does which job", () => {
    const f = fixture();
    const start = f.coordinator.snapshot(f.secret).revision;
    f.store.update((next: any) => {
      next.dispatch = { default: { agent: "codex" }, roles: {}, rules: [] };
    });
    expect((f.coordinator.delta(f.secret, start) as any).changed.dispatch).toEqual({ default: { agent: "codex" }, roles: {}, rules: [] });
  });

  it("ignores its own replies but wakes when the human decides a request", () => {
    const f = fixture();
    const start = f.coordinator.snapshot(f.secret).revision;
    f.run({ action: "reply", text: "Looking into it now." });
    expect(f.coordinator.delta(f.secret, start)).toMatchObject({ unchanged: true });
    const asked: any = f.run({
      action: "request-approval",
      title: "Read the 1884 register?",
      body: "Two sources disagree.",
    });
    expect(f.coordinator.delta(f.secret, start)).toMatchObject({ unchanged: true });
    const afterAsking = f.coordinator.snapshot(f.secret).revision;
    f.store.command({ type: "decide", messageId: asked.messageId, decision: "approve" });
    const woken: any = f.coordinator.delta(f.secret, afterAsking);
    expect(woken.changed.decisions).toEqual([
      { messageId: asked.messageId, title: "Read the 1884 register?", status: "approved" },
    ]);
  });

  it("sends the whole index when the cursor is older than the kept fingerprints", () => {
    const f = fixture();
    expect(f.coordinator.delta(f.secret, -1)).toHaveProperty("project");
  });

  it("keeps a busy coordinator's project while reporting that it is not listening", () => {
    const f = fixture();
    f.advance();
    const status = f.coordinator.status();
    expect(status).toMatchObject({ attached: true, connected: false, name: "First" });
    expect(status.lastSeenSecondsAgo).toBeGreaterThanOrEqual(0);
    // Its own commands still work; only its liveness lapsed.
    f.run({ action: "map", notes: "Still mine." });
    expect(f.coordinator.status()).toMatchObject({ attached: true, connected: true });
  });

  it("shows the human's chat messages to the coordinator it wakes", () => {
    const f = fixture();
    f.store.command({ type: "send", text: "Can you see this message?" });
    const snapshot = f.coordinator.snapshot(f.secret);
    const shown = snapshotView(snapshot, "session.json", "snapshot.json");
    expect(shown.conversation.recentMessages.at(-1)).toMatchObject({
      author: "human",
      text: "Can you see this message?",
    });
  });

  it("requires human confirmation before a coordinator can resume paused work", () => {
    const f = fixture();
    const id = f.queue();
    f.store.command({ type: "pause", investigationId: id });
    const requested = f.run({
      action: "request-resume",
      investigationId: id,
      reason: "Finish the review using saved evidence.",
    });
    expect(f.store.state.investigations[0].status).toBe("paused");
    expect(
      f.coordinator.snapshot(f.secret).investigations[0]!.resumeRequest.status,
    ).toBe("pending");
    expect(
      f.run({
        action: "request-resume",
        investigationId: id,
        reason: "Duplicate request",
      }).requestId,
    ).toBe(requested.requestId);
    expect(() => f.run({ action: "resume", investigationId: id })).toThrow(
      "Unknown coordinator action",
    );
    f.store.command({
      type: "resume-decision",
      investigationId: id,
      requestId: requested.requestId,
      decision: "decline",
    });
    expect(f.store.state.investigations[0].status).toBe("paused");
    const next = f.run({
      action: "request-resume",
      investigationId: id,
      reason: "New evidence is available.",
    });
    expect(() =>
      f.store.command({
        type: "resume-decision",
        investigationId: id,
        requestId: requested.requestId,
        decision: "approve",
      }),
    ).toThrow("no longer pending");
    expect(
      new WorkspaceStore(f.directory, dataset).state.investigations[0]
        .resumeRequest.id,
    ).toBe(next.requestId);
    f.store.command({
      type: "resume-decision",
      investigationId: id,
      requestId: next.requestId,
      decision: "approve",
    });
    expect(f.store.state.investigations[0].status).toBe("queued");
    expect(f.store.state.investigations[0].resumeRequest.status).toBe(
      "approved",
    );
  });
  it("archives misrouted feedback, moving it out of the research", () => {
    const f = fixture();
    const id = f.queue();
    const refs = [{ label: "Toolbar" }];
    f.store.command({
      type: "annotate",
      investigationId: id,
      question: "Simplify this toolbar",
      references: refs,
      dispatch: true,
    });
    const original = structuredClone(
      f.store.state.investigations[0].annotations[1],
    );
    f.store.command({
      type: "interface-feedback",
      question: original.question,
      references: refs,
    });
    const feedbackId = f.store.state.interfaceFeedback[0].id;
    const move = {
      type: "reclassify-annotation",
      investigationId: id,
      annotationId: original.id,
      feedbackId,
    };
    expect(() => f.store.command(move)).toThrow("Pause the investigation");
    f.store.command({ type: "pause", investigationId: id });
    expect(() => f.store.command({ ...move, feedbackId: "wrong" })).toThrow(
      "matching interface feedback",
    );
    f.store.command(move);
    expect(f.store.state.investigations[0].annotations).toHaveLength(1);
    expect(f.store.state.investigations[0].status).toBe("paused");
    expect(f.store.state.interfaceFeedback).toHaveLength(1);
    expect(f.store.state.interfaceFeedback[0].origin.annotation).toEqual(
      original,
    );
    expect(() => f.store.command(move)).toThrow("Unknown annotation");
    const reopened = new WorkspaceStore(f.directory, dataset);
    expect(reopened.state.interfaceFeedback[0].origin.annotation).toEqual(
      original,
    );
  });
  it("requires exclusive live ownership, and a takeover ends the previous session", () => {
    const f = fixture();
    f.queue();
    expect(() => f.coordinator.attach("Second", randomUUID())).toThrow(
      "Another coordinator",
    );
    f.advance();
    const second = randomUUID();
    f.coordinator.attach("Second", second);
    expect(() => f.run({ action: "handoff", notes: "late" })).toThrow(
      "expired",
    );
    expect(f.store.state.investigations[0]!.status).toBe("queued");
  });
  it("starts with a small index and retrieves source passages and investigations only on request", () => {
    const f = fixture();
    const id = f.queue();
    f.store.update((s: any) => {
      s.dataset.sources.push({ id: "preserved", title: "Identity register" });
      s.documents.push({
        id: "preserved",
        collectionId: "imports",
        name: "register.txt",
        mime: "text/plain",
        text: "Unique archival passage ".repeat(2000),
      });
    });
    f.run({
      action: "map",
      notes:
        "Purpose: resolve identities. Start with the register, source preserved.",
    });
    const index = f.coordinator.snapshot(f.secret);
    expect(JSON.stringify(index)).not.toContain("Unique archival passage");
    expect(JSON.stringify(index)).not.toContain("lease");
    expect(index.project.researchMap).toContain("resolve identities");
    // The old index and the layered context are two views of the same project; each stays small.
    const { context, ...oldIndex } = index as any;
    expect(JSON.stringify(oldIndex).length).toBeLessThan(6000);
    expect(context.text).toContain("resolve identities");
    expect(context.text).not.toContain("Unique archival passage");
    expect(context.text.length).toBeLessThan(6000);
    const source = f.run({
      action: "inspect",
      kind: "source",
      id: "preserved",
      offset: 0,
      limit: 100,
    }) as any;
    expect(source.text.length).toBe(100);
    expect(source.nextOffset).toBe(100);
    const found = f.run({
      action: "search",
      query: "Unique archival passage",
    }) as any;
    expect(
      found.hits.some((h: any) => h.kind === "source" && h.id === "preserved"),
    ).toBe(true);
    const investigation = f.run({
      action: "inspect",
      kind: "investigation",
      id,
    }) as any;
    expect(investigation.annotations[0].question).toBe("Check identity");
  });
  it("opens a batch with a goal for a team, and no longer assigns, steers, publishes or marks ready", () => {
    const f = fixture();
    const { investigationId, researchers } = f.run({ action: "open-batch", title: "The mill's buyer", goal: "Find who bought the fictional mill.", engine: "claude" }) as any;
    expect(researchers).toHaveLength(4);
    const batch = f.store.state.investigations[0];
    expect(batch).toMatchObject({ id: investigationId, goal: "Find who bought the fictional mill.", status: "running" });
    expect(batch.assignments.every((a: any) => a.choice.engine === "claude" && a.status === "waiting")).toBe(true);
    expect(f.coordinator.status().latest!.text).toBe("Starting a team on a batch of research");
    const assignmentId = batch.assignments[0].id;
    for (const data of [
      { action: "assign", investigationId, title: "A part", brief: "Look." },
      { action: "steer", assignmentId, message: "Look elsewhere." },
      { action: "stop-researcher", assignmentId, reason: "No longer wanted." },
      { action: "revise", assignmentId, notes: "Again." },
      { action: "publish", candidateId: "c" },
      { action: "batch-ready", investigationId, text: "Done." },
      { action: "set-brief", investigationId, brief: { direction: "Elsewhere." } },
    ])
      expect(() => f.run(data)).toThrow(/Unknown (coordinator action|investigation)/);
    expect(() => f.run({ action: "open-batch", engine: "claude", title: "Old", goal: "G", assignments: [{ title: "A part", brief: "Look." }] })).toThrow("A batch opens with a title and a goal");
  });
  it("hears of each published finding, each board post, each researcher finishing and a batch reaching Review", () => {
    const f = fixture();
    f.store.update((next: any) => {
      next.researchSettings = { timeLimitMinutes: null, researchersPerBatch: 2 };
      next.documents.push({ id: "deed", collectionId: "web", name: "Deed.pdf", mime: "application/pdf", size: 1, sha256: "x", importedAt: "t", text: "[Page 1]\nSold to Ann Example in 1896.", pages: 1, revision: 1 });
    });
    const { investigationId } = f.run({ action: "open-batch", title: "The mill's buyer", goal: "Find who bought the fictional mill.", engine: "claude" }) as any;
    const [first, second] = f.store.state.investigations[0].assignments.map((a: any) => a.id);
    const start = f.coordinator.snapshot(f.secret).revision;
    const publisher = new FindingPublisher(f.store);
    const receipt = publisher.publish(first, { statement: "Ann Example bought the mill in 1896.", qualification: "supported", explanation: "The deed says so.", evidence: [{ document: "deed", page: 1, quote: "Sold to Ann Example in 1896.", interpretation: "The sale." }] } as any);
    f.store.command({ type: "post", assignmentId: second, text: "The directories add nothing.", key: "k" });
    // The coordinator's own post is not news to it.
    f.store.command({ type: "coordinator-post", investigationId, text: "The human has the 1895 directory." });
    const news = (f.coordinator.delta(f.secret, start) as any).changed;
    expect(news.findings).toEqual([{ investigationId, id: receipt.id, from: "Researcher 1", statement: "Ann Example bought the mill in 1896.", qualification: "supported" }]);
    expect(news.boardPosts).toEqual([{ investigationId, from: "Researcher 2", text: "The directories add nothing." }]);
    expect(news.researchersFinished).toBeUndefined();
    // One finishes, then the other: the batch is ready for review.
    const finish = (assignmentId: string) => {
      const token = (f.store.command({ type: "claim", investigationId, assignmentId, worker: "Claude Code researcher" }) as any).assignment.lease.token;
      f.store.command({ type: "seat-finished", assignmentId, token });
    };
    const before = f.store.state.revision;
    finish(first);
    const one = (f.coordinator.delta(f.secret, before) as any).changed;
    expect(one.researchersFinished).toEqual([{ investigationId, researcher: "Researcher 1" }]);
    expect(one.batchesReady).toBeUndefined();
    expect(one.findings).toBeUndefined();
    const then = f.store.state.revision;
    finish(second);
    const both = (f.coordinator.delta(f.secret, then) as any).changed;
    expect(both.researchersFinished).toEqual([{ investigationId, researcher: "Researcher 2" }]);
    expect(both.batchesReady).toEqual([{ investigationId, title: "The mill's buyer" }]);
    expect(both.investigations[0]).toMatchObject({ status: "review", ready: true, findingCount: 1 });
  });
  it("keeps project memory across a server replacement, and preserves user-paused work on takeover", () => {
    const f = fixture();
    const { investigationId } = f.run({ action: "open-batch", title: "The mill's buyer", goal: "Find who bought the fictional mill.", engine: "claude" }) as any;
    f.run({ action: "map", notes: "Compare this identity with the second batch." });
    f.store.command({ type: "pause", investigationId });
    const recovered = new Coordinator(new WorkspaceStore(f.directory, dataset));
    const index = recovered.attach("Replacement", randomUUID());
    expect(recovered.store.state.coordination.researchMap).toContain("second batch");
    expect(index.investigations[0]).toMatchObject({ status: "paused", goal: "Find who bought the fictional mill." });
    expect(JSON.stringify(index)).not.toContain("candidates");
  });
});
