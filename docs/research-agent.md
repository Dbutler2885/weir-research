# Research coordinator and investigator contract

This workspace is intelligent research software, not a chat transcript.
Operate through durable investigations, annotations, checkpoints, and proposals.
Keep user-facing output attached to the relevant research objects.

## Start and claim work

The normal entry point is an agent opened in this repository, following `AGENTS.md` and `docs/coordinator.md`.
That agent opens a project, attaches as coordinator, and remains in the browser-event loop.
The independent mode below is also available through `npm start` before coordinator supervision is enabled.
An agent started in this repository reads this contract, then uses the research CLI.

```sh
npm run research -- status
npm run research -- claim "provider / investigator name"
```

Claim returns the investigation, original annotations, immutable accepted-data snapshot, previous proposals, checkpoints, source scope, and a worker lease token.
Null means no investigation is queued.
Do not claim that work is running before a researcher has claimed it.
Alternatively, the user selects an installed Codex or Claude engine in Ongoing work.
The local supervisor prepares a scoped task directory and launches up to two researchers, with a ten-minute limit per pass.
This uses the existing CLI account and sends the assigned research context and scoped sources to its model service.
The application does not collect account credentials.
Managed researchers write `checkpoint.json` and `result.json` in their task directory; the supervisor validates and imports those files through the same domain contract.
They do not receive the workspace API credential.
The manual CLI commands below are for externally managed researchers.

Changing engines affects new assignments; Replace researcher queues an active investigation for a fresh worker with its saved handoff.
Failures pause instead of retrying indefinitely.
On server restart, managed running investigations become paused and can be explicitly resumed.
The Codex adapter uses its documented [noninteractive execution mode](https://developers.openai.com/codex/noninteractive).

## Preserve intent and divide work

An investigation is the persistent user-facing unit.
Several annotations on its proposal remain in that investigation.
Only annotations listed in the lease's `annotationIds` have been dispatched; other saved annotations are context awaiting user dispatch and must not initiate new work.
Related investigations may share findings, but never silently merge or rename the user's units of work.
Workers may delegate bounded independent source retrieval, identity checks, or contradiction searches when the host harness supports delegation.
The coordinating worker owns reconciliation and the final proposal; sub-agents never mutate accepted records.
Allocate a bounded search effort and checkpoint before extending it.
Follow leads necessary to answer the question, but propose unrelated expansion as future work.

## Sources and evidence

Honor the investigation's source scope.
Public web access depends on the worker's actual tools.
Subscription services have no configured access adapter; do not imply access to full text from metadata or a saved URL.
Imported documents are available at `/api/documents/<document-id>` on the workspace URL.
Document metadata includes its SHA-256 and the immutable captured text when available.
PDF originals are preserved, but this first version does not extract PDF text or generate page-region highlights.
If the worker has a PDF reader, record the exact page and distinguish visual inspection from extracted text.
Never invent quotations, locators, source independence, or historical certainty.
Keep what the source says separate from what it implies.
Preserve contradictory evidence and plausible alternative identities.
An inconclusive investigation is a valid outcome.

## Checkpoint during research

Save meaningful discoveries, inspected sources, unsuccessful searches, and the next useful steps.
Do not wait until the final report to save the recovery handoff.
Write a JSON file containing these fields, then call the CLI with its path.

```json
{
  "investigationId": "returned investigation ID",
  "token": "returned worker lease token",
  "summary": "What was completed",
  "findings": "Inspected sources, locators, findings, failed searches, and access limitations",
  "nextSteps": "Remaining questions and concrete leads for a replacement researcher"
}
```

```sh
npm run research -- checkpoint /path/to/checkpoint.json
```

The application can pause an investigation or queue it for a replacement researcher.
Either operation invalidates the prior lease.
On a lease rejection, stop publishing under that token.
Do not automatically reclaim work that the user paused.
Checkpointing cannot recover unsaved internal agent context, but a replacement worker can continue from the durable evidence and leads.

## Return a proposal

Submit a JSON file with `investigationId`, `token`, and `proposal`.
The proposal contains `title`, `summary`, `ambiguity`, `evidence`, and `changes`.
The shared contract is defined in `src/domain/research.ts`.
The server assigns the proposal ID and revision and records which dispatched annotations the lease covered.

Each evidence record has an ID, an accepted or proposed source ID, an optional preserved document ID, an exact quote, surrounding context, a locator, an explicit interpretation, and a stance of `supports`, `challenges`, or `context`.
When a preserved text document is cited, the server verifies that the quote occurs in it.
This check verifies occurrence, not the truth of the inference.

Each change names a supported collection and stable record ID, the complete `before` record or null, the complete `after` record or null, a reason, and supporting evidence IDs.
The before record must match both the assigned snapshot and the current accepted research.
An ID cannot change within a replacement.
All references must remain valid after the whole proposal is applied.
Use one coherent atomic proposal; do not bundle unrelated decisions merely because they were researched together.
For an unresolved outcome, submit no changes and explicitly describe the remaining ambiguity.

```sh
npm run research -- propose /path/to/proposal.json
```

Workers can checkpoint and submit proposals, but the worker API credential cannot accept or reject them.
The browser displays the exact persisted proposal and applies it only after the user's acceptance.
Follow-up annotations remain attached to the relevant immutable proposal revision.
New feedback blocks acceptance until it has been addressed in a subsequent pass.

## Current boundary with Firstmate

This runtime adopts Firstmate's brief, supervision-state, checkpoint, and recovery concepts.
It does not vendor or run Firstmate's fleet scripts.
It does not create Git worktrees, branches, PRs, or software-delivery tasks for research.
The current launcher maps local CLI processes and completion files onto this contract.
Agent-led sessions now use the coordinator contract in `docs/coordinator.md` for project recovery, research assignment, and synthesis before publication.
The current coding agent supplies that judgment; the service does not launch a separate coordinating model.
Keep that launcher replaceable; the workspace must remain intelligible after changing the coordinating model or harness.
