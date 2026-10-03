// Publishes a researcher's finding: one finding with its evidence in; a published
// finding, or the reason it was refused, out. The app checks every quote against the
// saved text itself, so no one stands between a researcher's finding and the human.
import { createHash } from "node:crypto";
import { findingContent, publishFinding } from "../src/domain/publish.ts";
import { findingsChanged } from "./review-flow.mjs";

export class FindingPublisher {
  // published() runs after a finding is published, to bring the library's files up
  // to date at once.
  /** @param {any} store @param {{published?: () => void}} [options] */
  constructor(store, { published = () => {} } = {}) {
    this.store = store;
    this.published = published;
  }
  // Publishes the finding for the seat, and resolves with its receipt; throws with
  // the reason when it is refused. Findings are applied one at a time.
  publish(assignmentId, finding) {
    // The seat and what the finding says: the same finding from the same seat, say
    // from code run a second time, is published once.
    const key = createHash("sha256").update(`${assignmentId}\n${findingContent(finding)}`).digest("hex");
    const receipt = this.store.update((next) => {
      const published = publishFinding(next, assignmentId, finding, key);
      const batch = next.investigations.find((i) => i.assignments?.some((a) => a.id === assignmentId));
      // Graph work under way for the batch was built from findings that have now changed.
      findingsChanged(next, batch.id, `${published.replaced ? `Finding ${published.replaced} was replaced by ${published.id}` : `A new finding was published, ${published.id}`}: "${published.statement}". packet.json holds the batch's findings as they stand now; revise the draft to match them.`);
      return published;
    });
    this.published();
    return receipt;
  }
}
