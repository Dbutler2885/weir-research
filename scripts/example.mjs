import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { initialState, transition } from "../src/domain/research.ts";

// An isolated example uses only statements already present in the supplied dataset.
// It adds a provenance note, not a newly researched historical assertion.
const directory = resolve(process.env.RESEARCH_STATE_DIR || ".research/demo");
mkdirSync(directory, { recursive: true });
if (!existsSync(join(directory, "workspace.json"))) {
  const original = readFileSync("tests/fixtures/workshop.json", "utf8");
  const dataset = JSON.parse(original);
  dataset.title = "Fictional workshop · Workflow example";
  let state = initialState(dataset);
  const documentId = "example-baseline";
  const source = dataset.sources.find((s) => s.id === "register");
  const before = state.dataset.claims.find((c) => c.id === "employment");
  const now = new Date().toISOString();
  state.dataset.sources.push({
    id: documentId,
    title: "Existing research dataset (walkthrough baseline)",
    repository: "This workspace",
    note: "A preserved dataset snapshot, not an original historical document.",
  });
  state.documents.push({
    id: documentId,
    collectionId: "imports",
    name: "existing-research-dataset.txt",
    mime: "text/plain",
    size: Buffer.byteLength(original),
    sha256: createHash("sha256").update(original).digest("hex"),
    importedAt: now,
    text: original,
  });
  mkdirSync(join(directory, "documents"), { recursive: true });
  writeFileSync(join(directory, "documents", documentId), original);
  const run = (command) => {
    const result = transition(state, command);
    state = result.state;
    return result.result;
  };
  const { investigationId } = run({
    type: "annotate",
    question:
      "Example: can I inspect the original evidence for Alex’s employment?",
    target: {
      table: "claims",
      recordId: before.id,
      label: "Alex Example → Example Workshop",
      text: "Worked for many years · Established",
    },
    scope: ["imports"],
    dispatch: true,
  });
  const first = run({
    type: "claim",
    investigationId,
    worker: "Example provenance auditor",
  });
  run({
    type: "checkpoint",
    investigationId,
    token: first.assignment.lease.token,
    summary: "The relationship cites an register summary",
    findings:
      "The fictional dataset has a source record titled “Fictional workshop register.” It contains a summary but no source URL, scan, or precise passage locator. This audit has inspected only the dataset.",
    nextSteps:
      "Preserve the source-access limitation in a proposal. A later historical investigation should locate the original register.",
  });
  run({
    type: "propose",
    investigationId,
    token: first.assignment.lease.token,
    proposal: {
      title: "Make the missing original evidence visible",
      summary:
        "The employment relationship has a citation, but this workspace currently holds only a summary of that citation. This example proposes recording the access gap alongside the relationship.",
      ambiguity:
        "The employment relationship may be correct. The missing original does not disprove it. Its exact wording, publication, and surrounding context remain unverified in this workspace.",
      evidence: [
        {
          id: "baseline-note",
          sourceId: documentId,
          documentId,
          quote: source.note,
          context: `This is the complete note field on source ${source.id} in the existing dataset. It is not a quotation from the register itself. The source record has a title and date but no URL or page locator.`,
          locator: "Sources → register → note",
          interpretation:
            "The dataset records an register-based employment claim. It does not preserve the original document needed to inspect that claim directly.",
          stance: "context",
        },
      ],
      changes: [
        {
          table: "claims",
          recordId: before.id,
          before,
          after: {
            ...before,
            reasoning: [
              before.reasoning,
              "Original-evidence access gap: this workspace cites an register summary but has not preserved the original register or an exact passage locator. Locate the original before treating this as passage-verified evidence.",
            ].filter(Boolean).join("\n"),
          },
          reason:
            "Expose the source-access limitation while preserving the existing relationship and its current confidence designation.",
          evidenceIds: ["baseline-note"],
        },
      ],
    },
  });
  writeFileSync(
    join(directory, "workspace.json"),
    JSON.stringify(state, null, 2),
  );
}
process.env.RESEARCH_STATE_DIR = directory;
process.env.RESEARCH_PORT ||= "4319";
await import("../server/main.mjs");
