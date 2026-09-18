// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import dataset from "./fixtures/workshop.json";
import { WorkspaceStore } from "../server/store.mjs";
import { Coordinator } from "../server/coordinator.mjs";
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
    expect(JSON.stringify(index).length).toBeLessThan(6000);
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
