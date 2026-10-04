// Publishes a researcher's finding: one finding with its evidence in; a published
// finding, or the reason it was refused, out. The app checks every quote against the
// saved text itself, so no one stands between a researcher's finding and the human.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findingContent, publishFinding } from "../src/domain/publish.ts";
import { findingsChanged } from "./review-flow.mjs";

export class FindingPublisher {
  // published() runs after a finding is published, to bring the library's files up
  // to date at once. directory is the project's folder, where the earlier revisions
  // of a document's text are kept.
  /** @param {any} store @param {{published?: () => void, directory?: string}} [options] */
  constructor(store, { published = () => {}, directory } = {}) {
    this.store = store;
    this.published = published;
    this.directory = directory;
  }
  earlierText(documentId, revision) {
    if (!this.directory) return undefined;
    try {
      return readFileSync(join(this.directory, "documents", `${documentId}.r${revision}.txt`), "utf8");
    } catch {
      return undefined;
    }
  }
  // The findings that stand in the seat's batch, newest first: what a researcher reads
  // before it publishes, and where it finds the ID of one to replace.
  findings(assignmentId) {
    const batch = this.store.state.investigations.find((i) => i.assignments?.some((a) => a.id === assignmentId));
    if (!batch) throw new Error("This session's seat is in no batch.");
    const by = (p) => batch.assignments.find((a) => a.id === p.assignmentId)?.title || "an earlier researcher";
    return batch.proposals
      .filter((p) => p.kind === "findings" || !p.kind)
      .flatMap((p) =>
        (p.findings || [])
          .filter((f) => f.status !== "superseded" && f.status !== "deferred")
          .map((f) => ({
            id: `${p.id}/${f.id}`,
            by: by(p),
            at: p.createdAt,
            statement: f.statement,
            qualification: f.qualification,
            explanation: f.explanation,
            evidence: f.evidenceIds.map((id) => p.evidence.find((e) => e.id === id)).filter(Boolean).map((e) => ({ document: e.documentId ?? null, pages: e.pages ?? null, quote: e.quote })),
            ...(f.replaces ? { replaces: `${f.replaces.proposalId}/${f.replaces.findingId}` } : {}),
          })),
      )
      .reverse();
  }
  // Publishes the finding for the seat, and resolves with its receipt; throws with
  // the reason when it is refused. Findings are applied one at a time.
  publish(assignmentId, finding) {
    // The seat and what the finding says: the same finding from the same seat, say
    // from code run a second time, is published once.
    const key = createHash("sha256").update(`${assignmentId}\n${findingContent(finding)}`).digest("hex");
    const receipt = this.store.update((next) => {
      const published = publishFinding(next, assignmentId, finding, key, undefined, undefined, (id, revision) => this.earlierText(id, revision));
      const batch = next.investigations.find((i) => i.assignments?.some((a) => a.id === assignmentId));
      // Graph work under way for the batch was built from findings that have now changed.
      findingsChanged(next, batch.id, `${published.replaced ? `Finding ${published.replaced} was replaced by ${published.id}` : `A new finding was published, ${published.id}`}: "${published.statement}". packet.json holds the batch's findings as they stand now; revise the draft to match them.`);
      return published;
    });
    this.published();
    return receipt;
  }
}
