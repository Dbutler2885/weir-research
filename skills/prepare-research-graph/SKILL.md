---
name: prepare-research-graph
description: Prepare a separate graph-builder assignment after synthesizing a research walkthrough, reconcile its proposed entities, claims, and uncertainties, and write the coordinator-owned graphical review tour. Use for research graph preparation and isolated graph-builder experiments.
---

# Prepare a research graph

Help the builder turn the research into a useful, evidence-linked graph that the human can explore.
The coordinator first explains the research through a guided walkthrough, then assigns graph preparation while the human reads.
Reading progress is separate from permission to apply graph changes.

## Assemble the assignment

Supply the actual research question, the walkthrough and its revision, exact researcher returns, and an evidence registry keyed by immutable capture and record IDs.
Include the graph base revision, initial relevant records, the source scope, and the read-only query interface available in this run.
The builder can use search, inspect, neighborhood, and evidence-trace operations to expand context; the brief is a starting point rather than the boundary of accessible research.
Distinguish empty graphs from truncated snapshots.

Read [the experimental contract](references/contract.md) and use [the builder system prompt](references/graph-builder-system.md) when preparing a headless trial.
Pass packet-specific contradictions, source-access limits, and user corrections as context in the assignment.
Keep them separate from reusable instructions.
Use the user's configured model and effort, preserving the provider authorization already established in the session.

## Provide a durable working session

Give the builder an isolated output directory and working tools for saving proposal pieces, checkpoints, and status.
Use the CSV tables in the contract as its deliverable, with Markdown for working notes.
Let it choose how to divide its work and when to save each piece.
Preserve the complete response stream as it arrives and retain resumable session state where the harness supports it.
Saved artifacts and the checkpoint also support recovery in a replacement model session.
Receive progress and completion through a separate status channel; a conversational turn ending is not proof that the proposal is complete.
The completion signal identifies the exact artifact set and input revision to validate and review.
Freeze that submitted revision before inspection so later edits cannot change the proposal under review.
Interrupted work remains available for recovery without publishing an incomplete graph.

For an isolated Claude trial, run `node skills/prepare-research-graph/scripts/run-csv-experiment.mjs <new-run-directory> <packet.json>` from the repository root.
The runner requires Node, Python 3 for standard CSV parsing, and the configured Claude CLI account.
It provides file tools confined by Claude's restricted mode to the private working directory, records every streamed message, and preserves the session ID.
To resume, supply the same directory plus a packet and a third argument pointing to a text file with the follow-up assignment.
Use the existing packet for recovery, or a coordinator-prepared revised packet with sequenced updates when supplying additional context.
The runner preserves the previous packet and captures the new input for that attempt before the worker starts.
Read `status.txt`, the attempt's `result.json` and `validation.json`, and the working checkpoint before choosing a recovery action.
Each attempt preserves its own logs; completed submissions contain frozen CSVs plus software-generated validation and internal graph records.
This runner demonstrates the file-delivery protocol; it does not yet implement a live coordinator watcher or application publication.

## Coordinate updates and questions

Pass newly dispatched annotations and research returns as sequenced updates tied to exact references.
Have the builder state the input revision and update cursor it used.
Its representation notes and questions should identify the affected representation, evidence, provisional treatment, and what information would change the decision.
Decide whether bounded in-scope follow-up would materially improve the proposal or whether explicit uncertainty is the useful result.
Keep existing pauses and user limits in force.
Return further research to the same investigation and route it back to the builder; surface consequential discoveries in the proposal's graphical review.

## Review the returned proposal

Check that the graph expresses relationships as well as entities, preserves qualifications on individual assertions, and references the evidence it actually uses.
Inspect identity decisions, unrepresented findings, and builder questions.
After inspecting the graph, the coordinator writes the graphical walkthrough using [the tour guidance](references/coordinator-graph-tour.md).
Introduce the whole addition, then focus on new records and consequential uncertainties with stable focus IDs and sidebar explanations.
Use the builder's notes as material for synthesis while retaining the coordinator's guiding voice and understanding of the research.
Preserve the raw output and validation results before any revision.

## Use the integrated application

After publishing the walkthrough, use `inspect-flow` with the investigation ID to inspect jobs, packets, and returned candidates.
Managed jobs start automatically with the saved provider preference.
For a manual job, send `claim-graph` with investigationId and jobId; give the returned working directory and its AGENTS.md to a bounded native builder.
When it signals completion, send `submit-graph-files` with those IDs.
The host validates and freezes its CSVs before exposing the candidate.

The candidate contains `graph`, `packet`, and `graphSha256`.
Read the issues, coverage, identity decisions, and representation notes, then write the tour using the guidance above.
Send `publish-graph-review` with investigationId, jobId, and `tour: {graphSha256, introduction, steps}`.
Each tour step supplies id, title, focusNodeIds, focusClaimIds, explanation, issueIds, and transition.
The browser moves the graph camera and opens the relevant record in its single guidance sidebar.
The final screen offers coherent groups for explicit application with dependencies and evidence intact.

Send `graph-update` with investigationId, jobId, message, and the relevant dispatched annotationIds for new context before publication.
If the explanation materially changes, include a complete revised walkthrough in that update.
Workers receive updated packet.json and updates.json and record the consumed sequence in their CSVs.
An older completed submission is preserved and queued for an update rather than silently published.
For already published graph work, publish a new walkthrough revision to create a fresh builder job against the current graph.

Use `request-graph-resume` with investigationId, jobId, and reason when graph preparation is paused.
Wait for browser approval before proceeding.
The files, checkpoints, full streamed output, attempt inputs, and frozen submissions live under the project's private graph-builders directory.
The configured optional time limit applies per attempt; its default is unlimited.
