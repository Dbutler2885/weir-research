---
name: research-contract
description: "The evidence, checkpoint and proposal contract for research findings: sources and quotations, qualification of statements, and what a proposal must contain. Load it before publishing findings or briefing a researcher."
---

# Research coordinator and investigator contract

This workspace is intelligent research software, not a chat transcript.
Operate through durable investigations, annotations, checkpoints, and proposals.
Keep user-facing output attached to the relevant research objects.

## Start and claim work

The app opens a project and starts its coordinator, which assigns each batch to a researcher the app launches.
A researcher works in its own folder, from the brief and scoped sources the app prepared there.
The independent mode below is also available through `npm run serve` before coordinator supervision is enabled.

```sh
npm run research -- status
npm run research -- claim "provider / investigator name"
```

Claim returns the investigation, original annotations, immutable accepted-data snapshot, previous proposals, checkpoints, source scope, and a worker lease token.
Null means no investigation is queued.
Do not claim that work is running before a researcher has claimed it.
In a coordinated project, the app prepares a scoped task directory for each researcher the coordinator assigns and launches it, with no time limit by default.
The human may configure a time limit for new managed passes in Research settings.
Follow the deadline in your pass instructions when one is set, and finish the bounded assignment when complete even without a deadline.
This uses the existing CLI account and sends the assigned research context and scoped sources to its model service.
The application does not collect account credentials.
Managed researchers write `checkpoint.json` and `result.json` in their task directory; the supervisor validates and imports those files through the same domain contract.
They do not receive the workspace API credential.
The manual CLI commands below are for externally managed researchers.

Replace researcher queues an active investigation for a fresh worker with its saved handoff.
Failures pause instead of retrying indefinitely.
A researcher the human kept running when the app closed is taken back when it opens; any other running researcher pauses and can be explicitly resumed.

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
Use direct retrieval, headless browsers, visible browsers, or computer interaction when available in that runtime and appropriate to the permitted sources.
Web-scoped researchers get the app's research browser as their browser tools, for pages that need a real browser or a sign-in the human made there.
Browser availability does not imply access to the human's authenticated session.
Do not claim universal computer-use support or bypass access controls.
When human assistance is needed, add `accessRequest: {instruction, url?}` to a checkpoint and stop the pass.
The service pauses it, fences its lease, and displays the requested assistance under Investigations.
The human can import a source or resolve access, then select the resume action with saved context intact.
Subscription services have no configured access adapter; do not imply access to full text from metadata or a saved URL.
Imported documents are available at `/api/documents/<document-id>` on the workspace URL.
Document metadata includes its SHA-256 and the immutable captured text when available.
Read each source yourself before citing it.
When you can reach a document, download and read it rather than rely on a search engine's snippet of it.
A snippet is a lead, not a reading: a quote taken from one says so in its locator, and its source's access is `abstract`.
PDF originals are preserved, and the app does not extract their text.
A scanned PDF or an image has no text inside; look at its pages with your file-reading tool, which shows them, and quote what you see.
Record the exact page, and say whether a quote was read from the page image or from extracted text.
Never invent quotations, locators, source independence, or historical certainty.
Keep what the source says separate from what it implies.
Preserve contradictory evidence and plausible alternative identities.
An inconclusive investigation is a valid outcome.

## Checkpoint during research

Save a checkpoint when you make a real discovery and before you stop: inspected sources, unsuccessful searches, and the next useful steps.
A checkpoint is recovery material for a replacement worker, not a progress report; the app reads what you are doing from your output.
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
New research returns `kind: "findings"`, with `title`, `summary`, `ambiguity`, `evidence`, and `changes`.
The coordinator preserves this report in its batch.
When the human requests them, a walkthrough writer the coordinator assigns writes the walkthrough with `skills/present-research/SKILL.md`, and the coordinator supervises the separate CSV graph builder with `skills/prepare-research-graph/SKILL.md`.
Reading the walkthrough does not require accepting findings.
The older graph proposal contract below remains available for legacy reviews.
For `kind: "findings"`, `changes` is empty and `findings` contains independently reviewable statements with `id`, `statement`, `qualification`, `explanation`, and `evidenceIds`.
Qualifications are `supported`, `reported`, `disputed`, and `unresolved`.
Keeping a finding means retaining that qualified account, not declaring its underlying assertion true.
An unresolved finding may have no evidence; other qualifications require cited passages.
Use `replaces: {proposalId, findingId}` when correcting a previous finding; the older version becomes superseded only when the human keeps the replacement.
Register newly discovered source records in `sources`, independently of graph acceptance, with stable capture IDs and accurate `access` metadata (`discovered`, `metadata`, `abstract`, or `full-text`).
Changed source captures need new IDs; do not overwrite previously cited material.

In the legacy proposal route, the human requests graph construction from selected kept findings.
The queued investigation then has `phase: "graph"` and `graphRequest.refs` containing exact proposal/finding IDs.
This is a focused representation pass, not a new search assignment.
Return `kind: "graph"`, `changes`, `groups`, and `omissions` describing findings not represented and why.
Each group has `id`, `title`, `changeIndexes`, `findingRefs`, and `dependsOn` (other group IDs).
Every change belongs to exactly one group, every group cites requested kept findings, and dependencies must be acyclic.
Declare prerequisites such as new entities needed by a relationship explicitly.
If none of the selected findings justify graph changes, return empty `groups` and `changes` with a substantive `omissions` explanation for the human to record.
Reuse evidence from kept findings, preserve qualifications in graph labels, confidence and notes, and inspect meaningful ownership, location, leasing and succession relationships.
Human review previews and applies selected groups; it never silently accepts dependencies.
Finding revisions invalidate pending representations that relied on them, while applied records remain until separately reviewed changes replace them.
The group references remain the durable link between applied graph records and findings.
Legacy proposals without `kind` retain their original whole-proposal contract and history.
The shared contract is defined in `src/domain/research.ts`.
The server assigns the proposal ID and revision and records which dispatched annotations the lease covered.

Each evidence record has an ID, an accepted or proposed source ID, an optional preserved document ID, an exact quote, surrounding context, a locator, an explicit interpretation, and a stance of `supports`, `challenges`, or `context`.
When a preserved text document is cited, the server verifies that the quote occurs in it.
This check verifies occurrence, not the truth of the inference.

Each change names a supported collection and stable record ID, the complete `before` record or null, the complete `after` record or null, a reason, and supporting evidence IDs.
The before record must match both the assigned snapshot and the current accepted research.
An ID cannot change within a replacement.
All references must remain valid after the whole proposal is applied.
Use coherent groups, allowing independent decisions without breaking graph references.
For unresolved research, return qualified findings without graph changes.

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
Agent-led sessions use the coordinator contract in `skills/coordinate-research/SKILL.md` for project recovery, research assignment, and synthesis before publication.
The app starts the coordinating agent itself, as it does every worker.
Keep that launcher replaceable; the workspace must remain intelligible after changing the coordinating model or harness.
