// A document's original never changes; its text can, when it is read again. Each new
// reading is a text revision, earlier ones are kept, and every published quote that
// cites the document is checked again against the new text.
import type { ResearchDocument, ResearchState } from "./research.ts";
import { checkQuote } from "./quotes.ts";

// The file in the library that holds one revision of a document's text. Each
// revision has a file of its own, which never changes once written.
export const textFile = (d: Pick<ResearchDocument, "id" | "name" | "mime">, revision: number) => (d.mime === "text/plain" ? `documents/${d.id}${(d.name.match(/\.[^./]+$/)?.[0] || "").toLowerCase()}` : `documents/${d.id}.r${revision}.txt`);

// The conversion that made a document's current text, as far as is recorded.
export function conversionOf(d: ResearchDocument): { engine?: string; at?: string } {
  if (d.conversion) return d.conversion;
  if (d.reading?.state === "done") return { ...(d.reading.engine ? { engine: d.reading.engine } : {}), ...(d.reading.at ? { at: d.reading.at } : {}) };
  if (d.extraction) return { engine: d.extraction.processor };
  // A page's text is taken when it is saved; a PDF's reader and time are not known.
  return d.mime === "application/pdf" ? {} : { at: d.capturedAt || d.importedAt };
}

// Records the conversion behind a document's current text before another reading of
// it begins, since the reading's progress replaces what said so.
export function keepConversion(d: ResearchDocument) {
  if (d.text !== undefined) d.conversion ??= conversionOf(d);
}

/**
 * Gives a document its newly read text, in the state given. When the text differs
 * from what the document had, this is a new revision: the result names the earlier
 * revision and its text, for the caller to keep, and says how many published quotes
 * the new text no longer holds. Those keep their wording, recorded on the document
 * as corrections that are not yet reconciled against the page. conversion is the
 * reader that made the new text, and when.
 */
export function reviseText(
  next: ResearchState,
  documentId: string,
  text: string,
  conversion?: { engine?: string; at?: string },
  now = new Date().toISOString(),
  id: () => string = () => crypto.randomUUID(),
): { previous?: { revision: number; text: string }; unsettled: number } {
  const d = next.documents.find((x) => x.id === documentId);
  if (!d) return { unsettled: 0 };
  if (d.text === undefined || d.text === text) {
    // The same text again is the revision it was, made by the conversion that first gave it.
    if (conversion && (d.text === undefined || !d.conversion)) d.conversion = conversion;
    d.text = text;
    d.revision ??= 1;
    return { unsettled: 0 };
  }
  const previous = { revision: d.revision ?? 1, text: d.text };
  (d.textRevisions ||= []).push({ revision: previous.revision, ...conversionOf(d), ...(d.pages ? { pages: d.pages } : {}), size: new TextEncoder().encode(previous.text).length });
  if (conversion) d.conversion = conversion;
  else delete d.conversion;
  d.text = text;
  d.revision = previous.revision + 1;
  let unsettled = 0;
  for (const batch of next.investigations)
    for (const p of batch.proposals)
      for (const e of p.evidence) {
        if (e.documentId !== d.id || e.check !== "checked" || !e.pages) continue;
        const ref = `${p.id}/${e.id}`;
        // What is already recorded for this quote and not put right: still waiting, or
        // reconciled without the page settling it.
        const waiting = d.corrections?.find((c) => c.evidence === ref && c.status !== "reconciled");
        if (checkQuote(text, e.pages[0], e.pages[1], e.quote).found) {
          e.revision = d.revision;
          // The text holds the wording again, so there is nothing left to reconcile.
          if (waiting) Object.assign(waiting, { status: "reconciled", decision: "old", appliedIn: d.revision, reconciledAt: now, reason: `Revision ${d.revision} of the text holds this wording.` });
          continue;
        }
        if (waiting) continue;
        unsettled++;
        (d.corrections ||= []).push({
          id: id(),
          pages: e.pages,
          wording: e.quote,
          fromRevision: e.revision ?? previous.revision,
          missingFrom: d.revision,
          evidence: ref,
          status: "unreconciled",
          reason: "The document was read again and its new text words this passage differently. The quote keeps the wording it was checked against until the two are reconciled against the page.",
          at: now,
        });
        batch.events.push({ at: now, message: `"${d.name}" was read again, and its new text words a quoted passage on ${e.locator} differently. The quote keeps its wording until it is reconciled.` });
      }
  return { previous, unsettled };
}
