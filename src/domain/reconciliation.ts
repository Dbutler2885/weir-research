// Reconciling a document's text with the quotes published from it. When a document
// is read again and its new text words a quoted passage differently, a model the app
// starts looks at the page itself and decides, for each quote: the earlier wording
// was right, the new reading is, or neither, and it transcribes the passage. The app
// checks each decision and applies it here: a corrected revision of the text, the
// quotes updated, and a finding replaced where the change alters what it says.
// Every change is recorded with the document, with the text around it, so a later
// reading can be corrected the same way where its place still matches.
import type { Evidence, Investigation, Proposal, ResearchDocument, ResearchState, TextCorrection } from "./research.ts";
import type { Finding } from "./findings.ts";
import { checkQuote, pagesOf } from "./quotes.ts";
import { reviseText } from "./text-revisions.ts";

const flat = (value: string) => value.replace(/\s+/g, " ").trim();
const CONTEXT = 60;
const QUALIFICATIONS = ["supported", "reported", "disputed", "unresolved"];

// What the model decided about one quote.
export interface QuoteDecision {
  evidence: string;
  decision: "old" | "new" | "transcribed" | "unsettled";
  // The words of the current text that are wrong, and what the page says in their place.
  replaces?: string;
  wording?: string;
  // The quote as it should now read, where it changes.
  quote?: string;
  reason: string;
  // The finding as it should now read, where the change alters what it says.
  finding?: { statement: string; explanation: string; qualification: Finding["qualification"] } | null;
}
// A correction to the text that no quote asked for.
export interface TextFix {
  page: number;
  replaces: string;
  wording: string;
  reason: string;
}

// A quote the current text no longer holds, with what holds it.
export interface OpenQuote {
  ref: string;
  correction: TextCorrection;
  batch: Investigation;
  proposal: Proposal;
  evidence: Evidence;
  finding: Finding | undefined;
}

// The quotes of a document still waiting to be reconciled, by the first page each cites.
export function openQuotes(state: ResearchState, documentId: string): Map<number, OpenQuote[]> {
  const d = state.documents.find((x) => x.id === documentId);
  const byPage = new Map<number, OpenQuote[]>();
  for (const correction of d?.corrections || []) {
    if (correction.status !== "unreconciled" || !correction.evidence) continue;
    const [proposalId, evidenceId] = correction.evidence.split("/");
    for (const batch of state.investigations) {
      const proposal = batch.proposals.find((p) => p.id === proposalId);
      const evidence = proposal?.evidence.find((e) => e.id === evidenceId);
      if (!proposal || !evidence) continue;
      const finding = proposal.findings?.find((f) => f.evidenceIds.includes(evidence.id));
      const list = byPage.get(correction.pages[0]) || [];
      list.push({ ref: correction.evidence, correction, batch, proposal, evidence, finding });
      byPage.set(correction.pages[0], list);
    }
  }
  return byPage;
}

// A page's place in a document's text: where its own text starts and ends.
function pageSpan(text: string, page: number): { start: number; end: number } | null {
  const marks = [...text.matchAll(/^\[Page (\d+)\]\n/gm)];
  if (!marks.length) return page === 1 ? { start: 0, end: text.length } : null;
  const n = marks.findIndex((mark) => Number(mark[1]) === page);
  if (n < 0) return null;
  const start = marks[n]!.index! + marks[n]![0].length;
  const end = n + 1 < marks.length ? marks[n + 1]!.index! : text.length;
  return { start, end };
}

// Where some wording is on a page: its exact characters, or the same words with other
// spacing. With several places, the one whose text before it matches the context.
// strict takes only a place whose text before it matches the context, where there is one.
function place(text: string, page: number, wording: string, context = "", strict = false): { at: number; length: number } | null {
  const span = pageSpan(text, page);
  if (!span || !wording.trim()) return null;
  const within = text.slice(span.start, span.end);
  const pattern = new RegExp(flat(wording).split(" ").map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+"), "g");
  const found = [...within.matchAll(pattern)];
  if (!found.length) return null;
  const wanted = flat(context).slice(-20);
  const chosen = (wanted && found.find((m) => flat(within.slice(Math.max(0, m.index! - CONTEXT - 20), m.index!)).endsWith(wanted))) || (found.length === 1 && !(strict && wanted) ? found[0] : null);
  return chosen ? { at: span.start + chosen.index!, length: chosen[0].length } : null;
}

// The text with some wording on a page replaced, and the text that was around it.
function replaceOn(text: string, page: number, replaces: string, wording: string, context = "", strict = false): { text: string; fix: NonNullable<TextCorrection["fix"]> } | null {
  const found = place(text, page, replaces, context, strict);
  const span = pageSpan(text, page);
  if (!found || !span) return null;
  return {
    text: text.slice(0, found.at) + wording + text.slice(found.at + found.length),
    // The text on either side, within the page: another page's words are not its place.
    fix: { page, before: text.slice(found.at, found.at + found.length), after: wording, context: { before: text.slice(Math.max(span.start, found.at - CONTEXT), found.at), after: text.slice(found.at + found.length, Math.min(span.end, found.at + found.length + CONTEXT)) } },
  };
}

// A new reading with the document's earlier corrections put back wherever their place
// still matches: the wording the reader gave is there, with the same text before it.
// Returns the corrected text, or nothing when no correction applies.
export function reuseCorrections(d: Pick<ResearchDocument, "corrections">, text: string): { text: string; reused: string[] } | null {
  let corrected = text;
  const reused: string[] = [];
  for (const c of d.corrections || []) {
    if (!c.fix || c.status !== "reconciled" || c.fix.before === c.fix.after) continue;
    // The new reading already has the corrected wording there.
    if (place(corrected, c.fix.page, c.fix.after, c.fix.context.before, true)) continue;
    // Only in its own place: the same words elsewhere on the page are another matter.
    const next = replaceOn(corrected, c.fix.page, c.fix.before, c.fix.after, c.fix.context.before, true);
    if (!next) continue;
    corrected = next.text;
    reused.push(c.id);
  }
  return reused.length ? { text: corrected, reused } : null;
}

export interface Reconciled {
  // The revision the text had before, kept by the caller, when the text changed.
  previous?: { revision: number; text: string };
  revision: number;
  // What was decided, for the record and the notice.
  outcomes: { ref?: string; decision: TextCorrection["decision"]; reason: string; finding?: TextCorrection["finding"] }[];
  // Batches whose findings changed, for graph work under way to be revised.
  changed: { batchId: string; replaced: string; by: string; statement: string }[];
}

/**
 * Applies the decisions about a document's open quotes, and any other corrections to
 * its text, in the state given. A decision the text does not bear out is not applied:
 * the quote keeps its wording, and the record says why.
 */
export function applyReconciliation(
  next: ResearchState,
  documentId: string,
  decisions: QuoteDecision[],
  fixes: TextFix[] = [],
  now = new Date().toISOString(),
  id: () => string = () => crypto.randomUUID(),
): Reconciled {
  const d = next.documents.find((x) => x.id === documentId);
  if (!d || d.text === undefined) throw new Error("This document has no text to reconcile.");
  const open = new Map([...openQuotes(next, documentId).values()].flat().map((q) => [q.ref, q]));
  type Settled = { quote: OpenQuote; decision: QuoteDecision; change?: { replaces: string; wording: string }; fix?: TextCorrection["fix"]; wording?: string; problem?: string };
  const settled: Settled[] = [];
  for (const decision of decisions) {
    const quote = open.get(decision.evidence);
    if (!quote || settled.some((s) => s.quote === quote)) continue;
    const unsettled = (problem: string) => settled.push({ quote, decision: { ...decision, decision: "unsettled" }, problem });
    if (decision.decision === "unsettled") settled.push({ quote, decision });
    else if (decision.decision === "new") {
      // The quote takes the new reading's wording, which must be there.
      const wording = (decision.quote || "").trim();
      if (!wording) unsettled("The reconciliation chose the new reading without saying how the quote should now read.");
      else settled.push({ quote, decision, wording });
    } else {
      // The earlier wording, or a transcription, replaces what the new reading has.
      const given = (decision.wording || "").trim();
      const replaces = (decision.replaces || "").trim();
      // With no words given to put in their place, the earlier wording goes back whole,
      // which holds only where the words named stand for the whole quote: the same
      // number of words. Fewer would repeat the rest of the quote in the text.
      const whole = !given && decision.decision === "old" && flat(replaces).split(" ").length === flat(quote.evidence.quote).split(" ").length;
      const wording = given || (whole ? quote.evidence.quote : "");
      if (!replaces || !wording) unsettled(`The reconciliation ${decision.decision === "old" ? "kept the earlier wording" : "transcribed the passage"} without naming the words of the new reading that are wrong and what the page says in their place.`);
      else settled.push({ quote, decision, change: { replaces, wording }, wording: decision.decision === "old" ? quote.evidence.quote : (decision.quote || "").trim() || wording });
    }
  }
  // The corrected text is built from the document's text and the changes that stand,
  // and every quote is checked against that text. A change that cannot be placed, or a
  // quote the text then does not hold, is set aside and the text built again without
  // it, until what is left agrees.
  const extra: TextCorrection[] = [];
  let text = d.text;
  for (let stable = false; !stable; ) {
    stable = true;
    text = d.text;
    for (const s of settled) {
      delete s.fix;
      if (s.decision.decision === "unsettled" || !s.change) continue;
      // A quote may run over the end of its last cited page onto the next.
      const [from, to] = s.quote.correction.pages;
      let replaced = null;
      for (let page = from; page <= to + 1 && !replaced; page++) replaced = replaceOn(text, page, s.change.replaces, s.change.wording);
      if (replaced) {
        text = replaced.text;
        s.fix = replaced.fix;
        continue;
      }
      s.problem = "The words the reconciliation named as wrong are not in one place on the page, so the text was not changed.";
      s.decision = { ...s.decision, decision: "unsettled" };
      stable = false;
    }
    // Corrections nobody's quote asked for: a researcher noticed a problem in the text.
    extra.length = 0;
    for (const fix of fixes) {
      const replaced = fix.replaces && fix.wording?.trim() ? replaceOn(text, fix.page, fix.replaces, fix.wording.trim()) : null;
      if (!replaced) continue;
      text = replaced.text;
      extra.push({ id: id(), pages: [fix.page, fix.page], wording: replaced.fix.before, fromRevision: d.revision ?? 1, missingFrom: d.revision ?? 1, status: "reconciled", decision: "transcribed", reason: fix.reason, at: now, fix: replaced.fix, reconciledAt: now });
    }
    for (const s of settled) {
      if (s.decision.decision === "unsettled" || !s.wording) continue;
      const [from, to] = s.quote.correction.pages;
      if (checkQuote(text, from, to, s.wording).found) continue;
      s.problem = "The wording the reconciliation gave for the quote is not in the corrected text at the pages cited.";
      s.decision = { ...s.decision, decision: "unsettled" };
      stable = false;
    }
  }
  // The quotes change before the text is rechecked, so the recheck finds them.
  for (const s of settled) {
    if (s.decision.decision === "unsettled" || !s.wording || s.wording === s.quote.evidence.quote) continue;
    s.quote.correction.quote = { before: s.quote.evidence.quote, after: s.wording };
    s.quote.evidence.quote = s.wording;
  }
  let previous: Reconciled["previous"];
  if (text !== d.text) ({ previous } = reviseText(next, documentId, text, { engine: "reconciliation", at: now }, now, id));
  d.corrections = [...(d.corrections || []), ...extra.map((c) => ({ ...c, appliedIn: d.revision ?? 1 }))];
  const result: Reconciled = { ...(previous ? { previous } : {}), revision: d.revision ?? 1, outcomes: extra.map((c) => ({ decision: c.decision, reason: c.reason })), changed: [] };
  for (const s of settled) {
    const { quote, decision } = s;
    const kept = decision.decision === "unsettled";
    Object.assign(quote.correction, {
      status: kept ? "unsettled" : "reconciled",
      decision: decision.decision,
      reason: kept ? `${s.problem || decision.reason || "The page did not settle it."} The quote keeps the wording it was checked against.` : decision.reason,
      ...(s.fix ? { fix: s.fix } : {}),
      appliedIn: d.revision ?? 1,
      reconciledAt: now,
    });
    if (!kept) quote.evidence.revision = d.revision ?? 1;
    // Where the change alters what the finding says, the finding is replaced.
    const asked = !kept && decision.finding && quote.finding;
    if (asked) {
      const f = decision.finding!;
      const ref = `${quote.proposal.id}/${quote.finding!.id}`;
      const wellFormed = typeof f.statement === "string" && f.statement.trim() && typeof f.explanation === "string" && f.explanation.trim() && QUALIFICATIONS.includes(f.qualification);
      if (!wellFormed) quote.correction.finding = { replaced: ref, note: "The reconciliation said the finding changes, without giving the finding as it should now read." };
      else if (quote.batch.status === "closed" || quote.finding!.status === "superseded")
        quote.correction.finding = { replaced: ref, note: quote.batch.status === "closed" ? `Its batch is closed, so the finding was not replaced. It should now read: ${f.statement.trim()}` : "The finding had already been replaced." };
      else {
        const by = replaceFinding(quote, f, now, id);
        quote.correction.finding = { replaced: ref, by };
        result.changed.push({ batchId: quote.batch.id, replaced: ref, by, statement: f.statement.trim() });
      }
    }
    result.outcomes.push({ ref: quote.ref, decision: decision.decision, reason: quote.correction.reason, ...(quote.correction.finding ? { finding: quote.correction.finding } : {}) });
    quote.batch.events.push({ at: now, message: `A quoted passage on ${quote.evidence.locator} of "${d.name}" was reconciled against the page: ${kept ? "the page did not settle it, and the quote keeps its wording" : decision.decision === "old" ? "the earlier wording was right, and the text was corrected" : decision.decision === "new" ? "the new reading was right, and the quote was updated" : "the passage was transcribed from the page"}.` });
  }
  return result;
}

// Publishes the finding as it now reads, in place of the one the change altered, with
// the same evidence. It stays the work of the seat that published it.
function replaceFinding(quote: OpenQuote, f: NonNullable<QuoteDecision["finding"]>, now: string, id: () => string): string {
  const { batch, proposal } = quote;
  const old = quote.finding!;
  old.status = "superseded";
  old.decidedAt = now;
  const evidence = proposal.evidence.filter((e) => old.evidenceIds.includes(e.id)).map((e) => ({ ...e }));
  const replacement: Proposal = {
    kind: "findings",
    findings: [{ id: "f1", statement: f.statement.trim(), qualification: f.qualification, explanation: f.explanation.trim(), evidenceIds: evidence.map((e) => e.id), replaces: { proposalId: proposal.id, findingId: old.id }, status: "kept", decidedAt: now }],
    id: id(),
    revision: batch.proposals.length + 1,
    title: f.statement.trim(),
    summary: f.explanation.trim(),
    ambiguity: "",
    evidence,
    changes: [],
    addressedAnnotationIds: [],
    ...(proposal.assignmentId ? { assignmentId: proposal.assignmentId } : {}),
    createdAt: now,
    status: "accepted",
    decidedAt: now,
  };
  batch.proposals.push(replacement);
  batch.findingsRevision = (batch.findingsRevision ?? 0) + 1;
  batch.events.push({ at: now, message: `A finding was replaced after its source was reconciled against the page: ${replacement.title}` });
  return `${replacement.id}/f1`;
}

// The text of one page of a document's text.
export const pageOf = (text: string, page: number) => pagesOf(text).find((p) => p.page === page)?.text ?? "";
