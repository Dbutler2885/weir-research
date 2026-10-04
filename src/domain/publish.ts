// Publishing one finding with its evidence: a researcher's finding in; a published
// finding, or a reason for refusal, out. Each quote is checked against the saved text
// of the document it cites, at the pages it cites. Publishing counts as keeping, so a
// finding it replaces is superseded at once.
import type { ResearchState, Proposal, Evidence } from "./research.ts";
import { getFinding, type Finding, type FindingRef } from "./findings.ts";
import { checkQuote } from "./quotes.ts";
import { textFile } from "./text-revisions.ts";

export interface EvidenceInput {
  document: string;
  // The page the quote is on, or the first and last page of a range.
  page?: number;
  pages?: [number, number];
  quote: string;
  interpretation: string;
  stance?: Evidence["stance"];
  context?: string;
}
export interface FindingInput {
  statement: string;
  qualification: Finding["qualification"];
  explanation: string;
  evidence: EvidenceInput[];
  // The finding this one replaces, as "<report id>/<finding id>".
  replaces?: string;
}
export interface PublishedReceipt {
  id: string;
  statement: string;
  evidence: { document: string; pages: [number, number]; check: "checked" | "transcribed" }[];
  replaced?: string;
}

function refuse(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function words(value: unknown, label: string): asserts value is string {
  refuse(typeof value === "string" && value.trim().length > 0 && value.length <= 50_000, `${label} is required, as text.`);
}
export const findingId = (ref: FindingRef) => `${ref.proposalId}/${ref.findingId}`;

// What a finding says, in one fixed form, so the same finding from the same seat is known again.
export const findingContent = (input: FindingInput) =>
  JSON.stringify([
    input?.statement,
    input?.qualification,
    input?.explanation,
    input?.replaces ?? null,
    (Array.isArray(input?.evidence) ? input.evidence : []).map((e) => [e?.document, e?.pages ?? e?.page, e?.quote, e?.interpretation, e?.stance ?? "supports", e?.context ?? ""]),
  ]);

/**
 * Publishes a seat's finding into its batch, changing the state given, and returns
 * its receipt. Throws, with the reason, when it is refused. key names this seat and
 * content; a finding already published under it is not published again. earlierText
 * gives the kept text of a document's earlier revision, so a quote taken from text
 * read before the document was read again is refused with that explanation.
 */
export function publishFinding(
  next: ResearchState,
  assignmentId: string,
  input: FindingInput,
  key: string,
  now = new Date().toISOString(),
  id: () => string = () => crypto.randomUUID(),
  earlierText: (documentId: string, revision: number) => string | undefined = () => undefined,
): PublishedReceipt {
  const batch = next.investigations.find((i) => i.assignments?.some((a) => a.id === assignmentId));
  const seat = batch?.assignments?.find((a) => a.id === assignmentId);
  refuse(batch && seat, "This researcher has no place in a batch.");
  refuse(batch.status !== "closed", "This batch is closed, so nothing more is published to it.");
  refuse(input && typeof input === "object", "Give the finding: its statement, qualification, explanation and evidence.");
  const repeat = batch.proposals.find((p) => p.key === key);
  refuse(!repeat, `This finding was already published, as ${repeat?.id}/${repeat?.findings?.[0]?.id}; it was not published again.`);
  words(input.statement, "The finding's statement");
  words(input.explanation, "The finding's explanation");
  refuse(["supported", "reported", "disputed", "unresolved"].includes(input.qualification), 'The qualification is one of "supported", "reported", "disputed" and "unresolved".');
  refuse(Array.isArray(input.evidence) && input.evidence.length > 0, "Every finding needs evidence: at least one quote from a saved document, with its page.");

  const evidence: Evidence[] = input.evidence.map((e, n) => {
    const label = `Evidence ${n + 1}`;
    refuse(e && typeof e === "object", `${label} needs a document, a page, a quote and an interpretation.`);
    const document = next.documents.find((d) => d.id === e.document);
    refuse(document, `${label} cites ${JSON.stringify(e.document)}, which is not a saved document. Save the source first, and cite the document's ID.`);
    words(e.quote, `${label}'s quote`);
    words(e.interpretation, `${label}'s interpretation`);
    const stance = e.stance ?? "supports";
    refuse(["supports", "challenges", "context"].includes(stance), `${label}'s stance is one of "supports", "challenges" and "context".`);
    const range = Array.isArray(e.pages) ? e.pages : [e.page, e.page];
    const [from, to] = range as [number, number];
    refuse(range.length === 2 && Number.isInteger(from) && Number.isInteger(to) && from >= 1 && to >= from, `${label} needs the page its quote is on, as page, or as pages with the first and last page.`);
    refuse(document.text !== undefined, `${label} cites ${document.id}, whose text has not been read yet, so its quote cannot be checked.`);
    const check = checkQuote(document.text, from, to, e.quote);
    if (!check.found) {
      // From a variable read before the document was read again, most likely.
      const current = document.revision ?? 1;
      const earlier = [...(document.textRevisions || [])].reverse().find((r) => {
        const text = earlierText(document.id, r.revision);
        return text !== undefined && checkQuote(text, from, to, e.quote).found;
      });
      throw new Error(
        `${label} was not found in ${document.id} (${document.name}). ${check.reason}${
          earlier
            ? ` The quote does match revision ${earlier.revision} of the text (${textFile(document, earlier.revision)}), but the document has been read again since. Read revision ${current} (${textFile(document, current)}), which weir.library.read gives, and quote that.`
            : ""
        }`,
      );
    }
    return {
      id: `e${n + 1}`,
      sourceId: document.id,
      documentId: document.id,
      quote: e.quote,
      context: typeof e.context === "string" ? e.context : "",
      locator: from === to ? `page ${from}` : `pages ${from}-${to}`,
      interpretation: e.interpretation,
      stance,
      pages: [from, to],
      // A transcription is the reading of whoever saved it, which the app cannot check
      // against the image.
      check: document.transcribed ? "transcribed" : "checked",
      revision: document.revision ?? 1,
    };
  });

  let replaces: FindingRef | undefined;
  if (input.replaces !== undefined && input.replaces !== null) {
    refuse(typeof input.replaces === "string" && input.replaces.trim(), 'Name the finding to replace by its ID, as weir.findings() lists it, such as "<report>/f1".');
    // A team's finding is the only one in its report, so the report's ID alone names it.
    const [proposalId, replacedId = "f1"] = input.replaces.trim().split("/") as [string, string?];
    input = { ...input, replaces: `${proposalId}/${replacedId}` };
    replaces = { proposalId, findingId: replacedId };
    const old = getFinding(batch, replaces);
    refuse(old, `No finding ${input.replaces} is published in this batch, so there is nothing to replace. weir.findings() lists the batch's findings with their IDs.`);
    if (old.status === "superseded") {
      const by = batch.proposals.flatMap((p) => (p.findings || []).map((f) => ({ p, f }))).find(({ f }) => f.replaces && findingId(f.replaces) === input.replaces && f.status !== "deferred");
      throw new Error(`Finding ${input.replaces} was already replaced${by ? `, by ${by.p.id}/${by.f.id}: "${by.f.statement}". Replace that one instead` : ""}.`);
    }
    old.status = "superseded";
    old.decidedAt = now;
    // Graph proposals in the older form that rest on it are set aside with it.
    for (const graph of batch.proposals.filter((p) => p.kind === "graph" && p.status === "pending"))
      if (graph.groups?.some((g) => g.status === "pending" && g.findingRefs.some((r) => getFinding(batch, r)?.status !== "kept"))) graph.status = "superseded";
  }

  const proposal: Proposal = {
    kind: "findings",
    findings: [{ id: "f1", statement: input.statement.trim(), qualification: input.qualification, explanation: input.explanation.trim(), evidenceIds: evidence.map((e) => e.id), ...(replaces ? { replaces } : {}), status: "kept", decidedAt: now }],
    id: id(),
    revision: batch.proposals.length + 1,
    title: input.statement.trim(),
    summary: input.explanation.trim(),
    ambiguity: "",
    evidence,
    changes: [],
    addressedAnnotationIds: [],
    assignmentId,
    key,
    createdAt: now,
    status: "accepted",
    decidedAt: now,
  };
  batch.proposals.push(proposal);
  // Raised when a finding is published or replaced, and only then.
  batch.findingsRevision = (batch.findingsRevision ?? 0) + 1;
  batch.events.push({ at: now, message: `${seat.title} published a finding: ${proposal.title}` });
  return {
    id: `${proposal.id}/f1`,
    statement: proposal.title,
    evidence: evidence.map((e) => ({ document: e.documentId!, pages: e.pages!, check: e.check! })),
    ...(replaces ? { replaced: input.replaces } : {}),
  };
}
