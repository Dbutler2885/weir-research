import type { Walkthrough } from "./review-flow";

// Edits the coordinator suggests to a published walkthrough, each one passage, for
// the human to accept, decline or comment on. The coordinator makes them by editing
// the walkthrough's file; the app reads the passages that changed.
export interface WalkthroughEdit {
  // Where the passage is, which also identifies the edit: "answer", "caveats.2",
  // "steps.<step id>.body".
  id: string;
  // The passage's place, in the reader's words.
  where: string;
  before: string;
  after: string;
  // The human's comment, sent to the coordinator, while the edit stays open.
  comment?: string;
  // What the coordinator suggested before it revised the edit after a comment.
  earlier?: string;
}
export interface WalkthroughEdits {
  basedOnWalkthroughId: string;
  suggestedAt: string;
  edits: WalkthroughEdit[];
}
export type EditDecision = { decision: "accept" | "decline" | "comment"; comment?: string };

// What the coordinator can change: the text, never the steps or their evidence.
export type WalkthroughText = Pick<Walkthrough, "title" | "question" | "journey" | "answer" | "caveats" | "closing" | "correction"> & {
  steps: { id: string; title: string; body: string; transition: string; evidenceRefs: string[] }[];
};

const TOP: [keyof WalkthroughText, string][] = [
  ["title", "Title"],
  ["question", "You asked"],
  ["correction", "What changed"],
  ["journey", "How we got here"],
  ["answer", "What we found"],
  ["closing", "What we can build on"],
];
const STEP: ["title" | "body" | "transition", string][] = [["title", "title"], ["body", "explanation"], ["transition", "where it leads"]];

// The walkthrough as the coordinator's file holds it.
export function walkthroughText(w: Walkthrough): WalkthroughText {
  return {
    title: w.title,
    question: w.question,
    ...(w.correction !== undefined ? { correction: w.correction } : {}),
    journey: w.journey,
    answer: w.answer,
    caveats: [...w.caveats],
    steps: w.steps.map((s) => ({ id: s.id, title: s.title, body: s.body, transition: s.transition, evidenceRefs: [...s.evidenceRefs] })),
    closing: w.closing,
  };
}

const said = (value: unknown) => (typeof value === "string" ? value.trim() : null);

// The passages an edited file changes, one edit each. A file that changes the steps
// or their evidence, rather than their words, is refused.
export function editsBetween(w: Walkthrough, edited: unknown): WalkthroughEdit[] {
  if (!edited || typeof edited !== "object") throw new Error("The file must hold the walkthrough as a JSON object.");
  const e = edited as Record<string, unknown>;
  const edits: WalkthroughEdit[] = [];
  const compare = (id: string, where: string, before: string, value: unknown) => {
    const after = said(value);
    if (after === null) throw new Error(`${where} must be text.`);
    if (after !== before.trim()) edits.push({ id, where, before, after });
  };
  for (const [key, where] of TOP) {
    if (key === "correction" && w.correction === undefined && e.correction === undefined) continue;
    if (key === "correction" && w.correction === undefined) throw new Error("A correction note cannot be added by editing; describe changes in the conversation.");
    compare(key, where, String(w[key as keyof Walkthrough] ?? ""), e[key]);
  }
  if (!Array.isArray(e.caveats)) throw new Error("caveats must be a list of text.");
  const caveats = e.caveats;
  for (let n = 0; n < Math.max(w.caveats.length, caveats.length); n++) {
    const after = n < caveats.length ? said(caveats[n]) : "";
    if (after === null) throw new Error("caveats must be a list of text.");
    const before = w.caveats[n] ?? "";
    if (after !== before.trim()) edits.push({ id: `caveats.${n}`, where: "What remains open", before, after });
  }
  const steps = e.steps;
  if (!Array.isArray(steps) || steps.length !== w.steps.length || steps.some((s, n) => (s as { id?: unknown })?.id !== w.steps[n]!.id))
    throw new Error("Keep the steps as they are, in the same order with the same IDs; edit only their words. Restructuring a walkthrough needs a writer.");
  w.steps.forEach((step, n) => {
    const s = steps[n] as Record<string, unknown>;
    const refs = s.evidenceRefs;
    if (!Array.isArray(refs) || refs.length !== step.evidenceRefs.length || refs.some((r, i) => r !== step.evidenceRefs[i]))
      throw new Error(`Keep the evidence of step "${step.title}" as it is; edit only its words.`);
    for (const [key, name] of STEP) compare(`steps.${step.id}.${key}`, `Step "${step.title}", ${name}`, step[key], s[key]);
  });
  return edits;
}

// The walkthrough with some edits applied; a caveat whose edit leaves it empty goes.
export function applyEdits(w: Walkthrough, edits: WalkthroughEdit[]): WalkthroughText {
  const next = walkthroughText(w);
  const byId = new Map(edits.map((e) => [e.id, e.after]));
  for (const [key] of TOP) if (byId.has(key)) (next as Record<string, unknown>)[key] = byId.get(key);
  const count = Math.max(w.caveats.length, ...edits.filter((e) => e.id.startsWith("caveats.")).map((e) => Number(e.id.slice(8)) + 1));
  next.caveats = Array.from({ length: count }, (_, n) => byId.get(`caveats.${n}`) ?? w.caveats[n] ?? "").filter((c) => c.trim());
  next.steps = next.steps.map((s) => ({
    ...s,
    ...Object.fromEntries(STEP.flatMap(([key]) => (byId.has(`steps.${s.id}.${key}`) ? [[key, byId.get(`steps.${s.id}.${key}`)]] : []))),
  }));
  return next;
}

// Which page of the walkthrough shows an edit: the opening, a step, or the closing.
export function editPage(w: Walkthrough, id: string): number {
  if (id === "closing") return w.steps.length + 1;
  if (id.startsWith("steps.")) return w.steps.findIndex((s) => id.startsWith(`steps.${s.id}.`)) + 1;
  return 0;
}
