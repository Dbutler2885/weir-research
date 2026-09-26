// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSample } from "../server/sample-project.mjs";
import { flowCommand } from "../server/review-flow.mjs";
import { applyEdits, editPage, editsBetween, walkthroughText } from "../src/domain/walkthrough-edits";

const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((fn) => fn()));
function sample() {
  const directory = mkdtempSync(join(tmpdir(), "walkthrough-edits-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const store: any = buildSample(directory);
  const batch = () => store.state.investigations[0];
  const latest = () => batch().reviewFlow.walkthroughs.at(-1);
  const suggest = (change: (text: any) => void) => {
    const text = walkthroughText(latest());
    change(text);
    return flowCommand(store, { action: "suggest-walkthrough-edits", investigationId: batch().id, walkthrough: text });
  };
  const review = (decisions: any) => flowCommand(store, { action: "review-walkthrough-edits", investigationId: batch().id, decisions }, "human") as any;
  return { store, batch, latest, suggest, review };
}

describe("edits to a walkthrough's file", () => {
  it("become one edit per changed passage, and apply back to the same walkthrough", () => {
    const { latest } = sample();
    const w = latest();
    const text = walkthroughText(w);
    text.caveats[1] = "The two household lists disagree; the later one may be a copying error.";
    text.caveats.push("A third list has not been searched.");
    text.steps[1]!.body = "The household list shows the family together on Harbour Row.";
    const edits = editsBetween(w, text);
    expect(edits.map((e) => [e.id, e.where])).toEqual([
      ["caveats.1", "What remains open"],
      ["caveats.2", "What remains open"],
      ["steps.household.body", 'Step "The family at home", explanation'],
    ]);
    expect(edits[1]).toMatchObject({ before: "", after: "A third list has not been searched." });
    expect(applyEdits(w, edits)).toEqual(text);
    expect(editPage(w, "caveats.1")).toBe(0);
    expect(editPage(w, "steps.household.body")).toBe(2);
    expect(editPage(w, "closing")).toBe(w.steps.length + 1);
    // Removing a caveat is an edit that leaves it empty.
    const fewer = walkthroughText(w);
    fewer.caveats.pop();
    const [removal] = editsBetween(w, fewer);
    expect(removal).toMatchObject({ id: "caveats.1", after: "" });
    expect(applyEdits(w, [removal!]).caveats).toEqual([w.caveats[0]]);
  });

  it("refuse changes to the steps or their evidence", () => {
    const { latest } = sample();
    const w = latest();
    const reordered = walkthroughText(w);
    reordered.steps.reverse();
    expect(() => editsBetween(w, reordered)).toThrow("Keep the steps as they are");
    const recited = walkthroughText(w);
    recited.steps[0]!.evidenceRefs = [];
    expect(() => editsBetween(w, recited)).toThrow("Keep the evidence of step");
    expect(() => editsBetween(w, "not json")).toThrow("JSON object");
  });
});

describe("reviewing suggested edits", () => {
  it("accepts, declines and comments in one review: a new revision, a note to the coordinator, and the commented edit kept open", () => {
    const s = sample();
    const first = s.latest();
    s.suggest((t) => {
      t.answer = "Edith's parents were Thomas Marrow, a net maker, and Ann Holt of Saltmere.";
      t.caveats[1] = "The household lists disagree about Thomas's birthplace.";
      t.closing = "We have both parents and one open question.";
    });
    expect(s.batch().reviewFlow.edits.edits).toHaveLength(3);
    expect(() => s.review({})).toThrow("Decide at least one edit");
    const result = s.review({
      answer: { decision: "accept" },
      "caveats.1": { decision: "decline" },
      closing: { decision: "comment", comment: "Say which question is open." },
    });
    const revised = s.latest();
    expect(result.walkthroughId).toBe(revised.id);
    expect(revised).toMatchObject({ revision: 2, answer: "Edith's parents were Thomas Marrow, a net maker, and Ann Holt of Saltmere.", caveats: first.caveats, closing: first.closing, steps: first.steps });
    expect(s.batch().reviewFlow.walkthroughs[0]).toEqual(first);
    // The comment reaches the coordinator; its edit stays open against the new revision.
    expect(s.store.state.conversation.at(-1)).toMatchObject({ author: "human", text: expect.stringContaining('(What we can build on): Say which question is open.') });
    expect(s.batch().reviewFlow.edits).toMatchObject({ basedOnWalkthroughId: revised.id, edits: [{ id: "closing", comment: "Say which question is open." }] });
    expect(s.batch().events.at(-1).message).toBe("You reviewed the walkthrough edits: 1 edit accepted as revision 2, 1 declined, 1 comment sent.");
    // The coordinator answers by changing its suggestion: shown as revised, with what it suggested before.
    s.suggest((t) => {
      t.closing = "We have both parents; where Thomas was born is still open.";
    });
    expect(s.batch().reviewFlow.edits.edits).toEqual([expect.objectContaining({ id: "closing", after: "We have both parents; where Thomas was born is still open.", earlier: "We have both parents and one open question." })]);
    s.review({ closing: { decision: "accept" } });
    expect(s.latest()).toMatchObject({ revision: 3, closing: "We have both parents; where Thomas was born is still open." });
    expect(s.batch().reviewFlow.edits).toBeUndefined();
  });

  it("leaves the coordinator to publish a rewrite only when the human asked for one", () => {
    const s = sample();
    const w = s.latest();
    const { id: _id, revision: _revision, createdAt: _createdAt, ...rest } = w;
    expect(() => flowCommand(s.store, { action: "publish-walkthrough", investigationId: s.batch().id, walkthrough: rest, basedOnWalkthroughId: w.id })).toThrow(
      "Batch 1 already has a walkthrough. To correct it, edit walkthroughs/batch-1.json in your folder; the human reviews each change.",
    );
    expect(() => flowCommand(s.store, { action: "review-walkthrough-edits", investigationId: s.batch().id, decisions: {} })).toThrow("other review role");
  });
});
