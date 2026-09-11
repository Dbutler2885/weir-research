// @vitest-environment node
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import dataset from "./fixtures/workshop.json";
import type { FamilyDataset } from "../src/domain/types";
import {
  initialState,
  transition,
  type ResearchState,
  type ResearchCommand,
} from "../src/domain/research";
import { WorkspaceStore } from "../server/store.mjs";

function fixture() {
  let state = initialState(dataset as FamilyDataset);
  const run = (command: ResearchCommand) => {
    const output = transition(state, command);
    state = output.state;
    return output.result as any;
  };
  const { investigationId } = run({
    type: "annotate",
    question: "Verify this name",
    target: {
      table: "people",
      recordId: dataset.people[0]!.id,
      label: dataset.people[0]!.name,
    },
    dispatch: true,
  });
  const claim = () =>
    run({ type: "claim", worker: "test researcher", investigationId });
  const proposal = () => ({
    title: "Name correction",
    summary:
      "A fixture tests the review contract; it is not historical evidence.",
    ambiguity: "Identity remains provisional.",
    changes: [
      {
        table: "people",
        recordId: state.dataset.people[0]!.id,
        before: state.dataset.people[0],
        after: { ...state.dataset.people[0], name: "Fixture corrected name" },
        reason: "Test fixture",
        evidenceIds: ["e1"],
      },
    ],
    evidence: [
      {
        id: "e1",
        sourceId: state.dataset.sources![0]!.id,
        quote: "Fixture passage",
        context: "Fixture context",
        locator: "Fixture page",
        interpretation: "Fixture interpretation",
        stance: "supports",
      },
    ],
  });
  return {
    get state() {
      return state;
    },
    run,
    investigationId,
    claim,
    proposal,
  };
}
describe("research lifecycle", () => {
  it("keeps three proposal annotations in one investigation and preserves accepted research", () => {
    const f = fixture();
    const lease = f.claim().investigation.lease;
    const { proposalId } = f.run({
      type: "propose",
      investigationId: f.investigationId,
      token: lease.token,
      proposal: f.proposal(),
    });
    for (let n = 0; n < 3; n++)
      f.run({
        type: "annotate",
        investigationId: f.investigationId,
        target: { label: "Interpretation", proposalId },
        question: `Check interpretation ${n}`,
      });
    expect(f.state.investigations).toHaveLength(1);
    expect(f.state.investigations[0]!.annotations).toHaveLength(4);
    expect(f.state.dataset.people[0]!.name).toBe(dataset.people[0]!.name);
    expect(() =>
      f.run({ type: "accept", investigationId: f.investigationId, proposalId }),
    ).toThrow("newer feedback");
    f.run({ type: "dispatch", investigationId: f.investigationId });
    expect(f.state.investigations[0]!.proposals[0]!.status).toBe("superseded");
    const nextLease = f.claim().investigation.lease;
    const revised = f.run({
      type: "propose",
      investigationId: f.investigationId,
      token: nextLease.token,
      proposal: f.proposal(),
    });
    f.run({
      type: "accept",
      investigationId: f.investigationId,
      proposalId: revised.proposalId,
    });
    expect(f.state.dataset.people[0]!.name).toBe("Fixture corrected name");
    expect(f.state.investigations[0]!.proposals.map((p) => p.status)).toEqual([
      "superseded",
      "accepted",
    ]);
    expect(f.state.investigations[0]!.proposals[1]!.ambiguity).toBe(
      "Identity remains provisional.",
    );
    expect(() =>
      f.run({
        type: "accept",
        investigationId: f.investigationId,
        proposalId: revised.proposalId,
      }),
    ).toThrow("no longer");
  });
  it("keeps queued notes unsent when a separate immediate annotation is dispatched", () => {
    const f = fixture();
    f.run({
      type: "annotate",
      investigationId: f.investigationId,
      target: { label: "Queued selection" },
      question: "Save this for later",
    });
    f.run({
      type: "annotate",
      investigationId: f.investigationId,
      target: { label: "Immediate selection" },
      question: "Start this now",
      dispatch: true,
    });
    const lease = f.claim().investigation.lease;
    expect(lease.annotationIds).toHaveLength(2);
    expect(
      f.state.investigations[0]!.annotations[1]!.dispatchedAt,
    ).toBeUndefined();
  });
  it("fences replaced workers while handing checkpoints to their replacement", () => {
    const f = fixture();
    const first = f.claim().investigation.lease;
    f.run({
      type: "checkpoint",
      investigationId: f.investigationId,
      token: first.token,
      summary: "Directory checked",
      findings: "No matching entry",
      nextSteps: "Inspect next year",
    });
    f.run({ type: "resume", investigationId: f.investigationId });
    const replacement = f.claim();
    expect(replacement.investigation.checkpoints[0].nextSteps).toBe(
      "Inspect next year",
    );
    expect(replacement.investigation.lease.token).not.toBe(first.token);
    expect(() =>
      f.run({
        type: "propose",
        investigationId: f.investigationId,
        token: first.token,
        proposal: f.proposal(),
      }),
    ).toThrow("lease");
    expect(() =>
      f.run({
        type: "checkpoint",
        investigationId: f.investigationId,
        token: first.token,
        summary: "Late",
        findings: "Late",
        nextSteps: "Late",
      }),
    ).toThrow("lease");
  });
  it("rejects an already claimed task and fences a paused worker", () => {
    const f = fixture();
    const lease = f.claim().investigation.lease;
    expect(() => f.claim()).toThrow("not queued");
    f.run({ type: "pause", investigationId: f.investigationId });
    expect(() =>
      f.run({
        type: "propose",
        investigationId: f.investigationId,
        token: lease.token,
        proposal: f.proposal(),
      }),
    ).toThrow("lease");
  });
  it("does not overwrite an accepted change when another proposal becomes stale", () => {
    const f = fixture();
    const original = f.proposal();
    const lease = f.claim().investigation.lease;
    const first = f.run({
      type: "propose",
      investigationId: f.investigationId,
      token: lease.token,
      proposal: original,
    });
    const second = f.run({
      type: "annotate",
      question: "Second investigation",
      target: { label: "Same record" },
      dispatch: true,
    });
    const secondLease = f.run({
      type: "claim",
      worker: "another",
      investigationId: second.investigationId,
    }).investigation.lease;
    const secondProposal = f.run({
      type: "propose",
      investigationId: second.investigationId,
      token: secondLease.token,
      proposal: original,
    });
    f.run({
      type: "accept",
      investigationId: f.investigationId,
      proposalId: first.proposalId,
    });
    expect(() =>
      f.run({
        type: "accept",
        investigationId: second.investigationId,
        proposalId: secondProposal.proposalId,
      }),
    ).toThrow("Research changed");
    expect(f.state.investigations[1]!.proposals[0]!.status).toBe("pending");
  });
  it("rejects missing evidence and invalid graph references before review", () => {
    const f = fixture();
    const token = f.claim().investigation.lease.token;
    const p = f.proposal();
    p.changes[0]!.evidenceIds = ["missing"];
    expect(() =>
      f.run({
        type: "propose",
        investigationId: f.investigationId,
        token,
        proposal: p,
      }),
    ).toThrow("identified evidence");
    const invalid = f.proposal();
    (invalid.changes[0]!.after as any).sourceIds = ["unknown-source"];
    expect(() =>
      f.run({
        type: "propose",
        investigationId: f.investigationId,
        token,
        proposal: invalid,
      }),
    ).toThrow();
    expect(f.state.investigations[0]!.proposals).toHaveLength(0);
  });
  it("records an unresolved outcome without changing the graph", () => {
    const f = fixture();
    const token = f.claim().investigation.lease.token;
    const p = f.proposal();
    p.changes = [];
    p.evidence = [];
    const result = f.run({
      type: "propose",
      investigationId: f.investigationId,
      token,
      proposal: p,
    });
    f.run({
      type: "accept",
      investigationId: f.investigationId,
      proposalId: result.proposalId,
    });
    expect(f.state.dataset).toEqual(dataset);
    expect(f.state.datasetRevision).toBe(0);
    expect(f.state.investigations[0]!.proposals[0]!.ambiguity).toBeTruthy();
  });
  it("rejects orphaned proposal annotations", () => {
    const f = fixture();
    expect(() =>
      f.run({
        type: "annotate",
        question: "Check this",
        target: { label: "Proposal", proposalId: "missing" },
      }),
    ).toThrow("belong");
  });
});

describe("durable state", () => {
  it("recovers investigations, checkpoints and the lease after a restart without exposing worker tokens to the UI", () => {
    const dir = mkdtempSync(join(tmpdir(), "pike-store-"));
    try {
      const first = new WorkspaceStore(dir, dataset);
      const result = first.command({
        type: "annotate",
        question: "Find the source",
        target: { label: "Record" },
        dispatch: true,
      }) as { investigationId: string };
      first.command({
        type: "claim",
        worker: "old provider",
        investigationId: result.investigationId,
      });
      const token = first.state.investigations[0]!.lease!.token;
      first.command({
        type: "checkpoint",
        investigationId: result.investigationId,
        token,
        summary: "Progress",
        findings: "Source found",
        nextSteps: "Inspect page",
      });
      const recovered = new WorkspaceStore(dir, dataset);
      expect(recovered.state.investigations[0]!.checkpoints[0]!.nextSteps).toBe(
        "Inspect page",
      );
      expect(JSON.stringify(recovered.publicState())).not.toContain(token);
      expect(
        JSON.parse(readFileSync(join(dir, "workspace.json"), "utf8")).revision,
      ).toBe(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("preserves a corrupt state file instead of resetting research", () => {
    const dir = mkdtempSync(join(tmpdir(), "pike-corrupt-"));
    try {
      writeFileSync(join(dir, "workspace.json"), "broken state");
      expect(() => new WorkspaceStore(dir, dataset)).toThrow();
      expect(readFileSync(join(dir, "workspace.json"), "utf8")).toBe(
        "broken state",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
