---
name: prepare-research-graph
description: Supervise a graph builder that edits the research graph as two tables, sign off or send back its draft against the human's instructions, and write the coordinator-owned tour of what the draft changes. Use for research graph updates.
---

# Prepare a research graph

Help the builder turn the research into a useful, evidence-linked graph that the human can explore.
The graph is nodes and edges.
A builder edits a copy of it as two tables, and the application works out what changed.
The human accepts or sets aside the whole draft; reading the tour is separate from that decision.

## How a graph job runs

A graph job is queued when the human requests a batch's graph update from Review, or automatically when they have turned that on.
It represents all of the batch's findings, with its latest walkthrough when one exists.
Only one graph update runs at a time across the project, and a pending review blocks the next.

When the job starts, the application writes the accepted graph into the builder's working directory as `nodes.csv` and `edges.csv`, with an untouched copy under `start/`.
Beside them it writes `packet.json` with the research: the question, the walkthrough, the findings, the evidence registry, and the source library.
[The builder contract](references/contract.md) describes the tables, and [the builder system prompt](references/graph-builder-system.md) is its standing instruction.

Jobs start automatically with the saved provider preference.
For a job waiting for a builder, send `assign-graph` with investigationId, jobId and `engine` of claude or codex.

When the builder finishes, the application reads the tables back.
A draft that does not hold together goes straight back to the builder with every problem listed, up to three times.
A draft that holds together becomes the job's candidate, with the computed difference and a one-line summary.

## Pass the human's instructions as context

The human's representation conventions, such as folding a single-site organisation into its site, belong to the job, not to the shared instructions.
Send them with `graph-update` (investigationId, jobId, message, and the relevant dispatched annotationIds).
The builder receives them as sequenced updates and reports the last one it incorporated; a draft written before the latest update is kept but queued to incorporate it.
If the explanation materially changes, include a complete revised walkthrough in that update.
Editing this skill or its references changes the rules for every builder in every project, which is a reviewed code change rather than a coordinator action.

## Sign off or send back

Use `inspect-flow` with the batch's investigation ID to read the candidate: `draft`, `diff`, `summary`, `questions`, and `notes`.
Check the difference against the human's instructions for this job and against the findings.
Check that the draft expresses relationships as well as entities, preserves qualifications, and cites the evidence it actually uses.
Removals and merges deserve the closest reading, because the human is asked to accept records disappearing.

If the draft does not yet do what was asked, send it back with `graph-update`, naming what is missing.
The builder continues from its own draft in the same directory.

When the draft is ready, write the tour using [the tour guidance](references/coordinator-graph-tour.md) and send `publish-graph-review` with investigationId, jobId, `tour`, and `undone`.
`undone` lists each instruction the draft still leaves undone as `{instruction, reason}`, with the builder's reason; it is empty when everything was done.
This is how the human learns that an instruction was not carried out.
The human never sees a draft you have not signed off.
Signing off is refused when the accepted graph changed after the draft was prepared; send a graph update so the builder redrafts against it.

## After the human decides

Accepting replaces the graph with the draft, copies cited research into it, closes the batch, and keeps an undo.
Setting the draft aside closes the batch without changing the graph; a note the human leaves arrives as new work.
Undoing an accepted draft reopens the batch for a revised draft.
New feedback the human sends about a published draft holds its acceptance until you handle it, and the review tells the human their note is with you.
If the draft needs changing, send it back with `graph-update`, naming the note's annotationIds; the review shows it as being revised, and the next draft you sign off replaces it.
If the note needs only an answer, reply in the conversation and send `answer-draft-feedback` with investigationId, graphReviewId and annotationIds, which releases the draft for a decision.

Use `request-graph-resume` with investigationId, jobId, and reason when graph preparation is paused, and wait for browser approval before proceeding.
The tables, checkpoints, full streamed output, attempt inputs, and frozen submissions live under the project's private graph-builders directory.
The configured optional time limit applies per attempt; its default is unlimited.
