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
const proposal = {
  title: "Unresolved identity",
  summary: "No primary evidence yet",
  ambiguity: "Two people may share this name.",
  evidence: [],
  changes: [],
};
describe("research coordination", () => {
  it("answers a quiet wait with its revision alone and a wake with only what changed", () => {
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
    f.run({ action: "handoff", notes: "Still mine." });
    expect(f.coordinator.status()).toMatchObject({ attached: true, connected: true });
  });

  it("shows the human's chat messages to the coordinator it wakes", () => {
    const f = fixture();
    f.store.command({ type: "send", text: "Can you see this message?" });
    const snapshot = f.coordinator.snapshot(f.secret);
    const shown = snapshotView(snapshot, "session.json", "snapshot.json", -1);
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
    expect(() =>
      f.run({ action: "claim", investigationId: id, brief: "Continue" }),
    ).toThrow("queued");
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
    expect(() =>
      f.run({
        action: "claim",
        investigationId: id,
        brief: "Prepare review from saved evidence",
      }),
    ).not.toThrow();
  });
  it("archives misrouted feedback and excludes it from replacement assignments", () => {
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
    f.run({
      action: "assign",
      investigationId: id,
      engine: "claude",
      brief: "Check the source",
    });
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
    expect(f.store.state.coordination.assignments[id]).toBeUndefined();
    expect(() => f.store.command(move)).toThrow("Unknown annotation");
    const reopened = new WorkspaceStore(f.directory, dataset);
    expect(reopened.state.interfaceFeedback[0].origin.annotation).toEqual(
      original,
    );
    f.store.command({ type: "resume", investigationId: id });
    const next = f.run({
      action: "claim",
      investigationId: id,
      brief: "Continue the research",
    });
    expect(next.investigation.lease.annotationIds).not.toContain(original.id);
    expect(next.investigation.annotations).toHaveLength(1);
  });
  it("requires exclusive live ownership and fences the previous session after recovery", () => {
    const f = fixture();
    const id = f.queue();
    const brief = f.run({
      action: "claim",
      investigationId: id,
      brief: "Check the source",
    }) as any;
    f.run({
      action: "checkpoint",
      investigationId: id,
      summary: "Checked",
      findings: "One source inspected",
      nextSteps: "Check second source",
    });
    f.store.command({
      type: "annotate",
      investigationId: id,
      target: { label: "Later" },
      question: "Do not send this yet",
      dispatch: false,
    });
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
    expect(f.store.state.investigations[0]!.checkpoints).toHaveLength(1);
    expect(
      f.store.state.investigations[0]!.annotations[1]!.dispatchedAt,
    ).toBeUndefined();
    expect(() =>
      f.store.command({
        type: "checkpoint",
        investigationId: id,
        token: brief.investigation.lease.token,
        summary: "late",
        findings: "late",
        nextSteps: "late",
      }),
    ).toThrow("lease");
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
  it("holds worker findings for synthesis and only the human acceptance closes the review", () => {
    const f = fixture();
    const id = f.queue();
    const claimed = f.store.command({
      type: "claim",
      investigationId: id,
      worker: "Codex researcher",
    }) as any;
    f.coordinator.receive(
      { id, token: claimed.investigation.lease.token },
      proposal,
    );
    expect(f.store.state.investigations[0]!.proposals).toHaveLength(0);
    expect(f.coordinator.snapshot(f.secret).candidates).toHaveLength(1);
    expect(JSON.stringify(f.store.publicState())).not.toContain(
      claimed.investigation.lease.token,
    );
    const candidate = f.coordinator.candidates()[0]!;
    const result = f.run({
      action: "publish",
      investigationId: id,
      candidateId: candidate.id,
      proposal: {
        ...proposal,
        summary: "Coordinator compared the conflicting identities.",
      },
    }) as any;
    expect(f.store.state.investigations[0]!.status).toBe("review");
    expect(f.store.state.dataset).toEqual(dataset);
    expect(() =>
      f.run({
        action: "accept",
        investigationId: id,
        proposalId: result.proposalId,
      }),
    ).toThrow("cannot accept");
    f.store.command({
      type: "accept",
      investigationId: id,
      proposalId: result.proposalId,
    });
    expect(f.store.state.investigations[0]!.status).toBe("closed");
  });
  it("preserves candidates and project memory across a server replacement", () => {
    const f = fixture();
    const id = f.queue();
    const claimed = f.store.command({
      type: "claim",
      investigationId: id,
      worker: "Claude Code researcher",
    }) as any;
    f.coordinator.receive(
      { id, token: claimed.investigation.lease.token },
      proposal,
    );
    f.run({
      action: "handoff",
      notes:
        "Compare this identity with the second investigation before publication.",
    });
    const recovered = new Coordinator(new WorkspaceStore(f.directory, dataset));
    const index = recovered.attach("Replacement", randomUUID());
    expect(index.candidates).toHaveLength(1);
    expect(index.coordinator.handoff).toContain("second investigation");
    expect(index.investigations[0]!.status).toBe("running");
  });
  it("keeps unsent feedback out of assignments and invalidates a brief on newly dispatched feedback", () => {
    const f = fixture();
    const id = f.queue();
    f.run({
      action: "assign",
      investigationId: id,
      engine: "codex",
      brief: "First annotation only",
    });
    f.store.command({
      type: "annotate",
      investigationId: id,
      target: { label: "More" },
      question: "Saved only",
      dispatch: false,
    });
    expect(f.coordinator.ready(f.store.state.investigations[0])).toBe(true);
    f.store.command({ type: "dispatch", investigationId: id });
    expect(f.coordinator.ready(f.store.state.investigations[0])).toBe(false);
  });
  it("rejects stale candidates after user pause and preserves user-paused work on takeover", () => {
    const f = fixture();
    const id = f.queue();
    const claimed = f.store.command({
      type: "claim",
      investigationId: id,
      worker: "Codex researcher",
    }) as any;
    f.coordinator.receive(
      { id, token: claimed.investigation.lease.token },
      proposal,
    );
    const candidate = f.coordinator.candidates()[0]!;
    f.store.command({ type: "pause", investigationId: id });
    expect(() =>
      f.run({
        action: "publish",
        investigationId: id,
        candidateId: candidate.id,
      }),
    ).toThrow("current researcher");
    f.advance();
    f.coordinator.attach("Replacement", randomUUID());
    expect(f.store.state.investigations[0]!.status).toBe("paused");
  });
});
