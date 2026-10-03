// A document's original never changes; its text can, when it is read again. Each new
// reading is a text revision, earlier ones are kept, and every published quote that
// cites the document is checked again against the new text.
import type { ResearchState } from "./research.ts";
import { checkQuote } from "./quotes.ts";

/**
 * Gives a document its newly read text, in the state given. When the text differs
 * from what the document had, this is a new revision: the result names the earlier
 * revision and its text, for the caller to keep, and says how many published quotes
 * the new text no longer holds. Those keep their wording, recorded on the document
 * as corrections that are not yet reconciled against the page.
 */
export function reviseText(next: ResearchState, documentId: string, text: string, now = new Date().toISOString(), id: () => string = () => crypto.randomUUID()): { previous?: { revision: number; text: string }; unsettled: number } {
  const d = next.documents.find((x) => x.id === documentId);
  if (!d) return { unsettled: 0 };
  if (d.text === undefined || d.text === text) {
    d.text = text;
    d.revision ??= 1;
    return { unsettled: 0 };
  }
  const previous = { revision: d.revision ?? 1, text: d.text };
  (d.textRevisions ||= []).push({ revision: previous.revision, at: d.reading?.at || d.importedAt, ...(d.reading?.engine ? { engine: d.reading.engine } : {}), ...(d.pages ? { pages: d.pages } : {}), size: new TextEncoder().encode(previous.text).length });
  d.text = text;
  d.revision = previous.revision + 1;
  let unsettled = 0;
  for (const batch of next.investigations)
    for (const p of batch.proposals)
      for (const e of p.evidence) {
        if (e.documentId !== d.id || e.check !== "checked" || !e.pages) continue;
        if (checkQuote(text, e.pages[0], e.pages[1], e.quote).found) {
          e.revision = d.revision;
          continue;
        }
        const ref = `${p.id}/${e.id}`;
        if (d.corrections?.some((c) => c.evidence === ref)) continue;
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
