# Coordinator context

Status: mostly built on 2026-09-24 behind a switch; see Progress at the end for what remains.
This PRD covers what a coordinator knows when it starts.
It is separate from, and a prerequisite for, the headless agents work, and it can be built and tested with today's attached coordinator.

## Problem Statement

A coordinator that starts fresh on an existing project should be able to pick up work immediately, as if it had never left.
Today it cannot do that reliably.

The human needs to be able to start the coordinator fresh at any time, whether after closing the app, after a crash, or because its context has grown large.
The app starts a new coordinator every time it opens, so this context is what every session begins with.
For that to feel seamless, what a new coordinator reads at startup has to tell it what the project is for, what is in progress, what is waiting on whom, and what to do next.

A review of what a fresh coordinator received for the Lubec project on 2026-09-24 found:

- The startup output is organized by data type, not by what needs doing.
  The same batch appears in two lists, one with its findings and no number, the other with its number and questions.
  Next actions are buried inside individual batches.
- Most of the space goes to finished detail.
  One batch that was already fully written up took about a third of the startup output, mostly as the full text of 30 findings.
- Old history is mixed with current state.
  A long-finished builder job and its resolved quota message still appear, and a batch closed three days earlier is listed as queued.
- Batches have no stated purpose.
  Their "questions" are often converted raw notes, such as "This is your quesiton", so a new coordinator cannot tell what a batch is for or what belongs in it.
- The layer that orients a coordinator is the thinnest part.
  The research map and handoff together were about 3,000 characters of a 67,000-character output.
- Some useful facts are dropped, such as the saved researcher preference.
- Instruction documents are reached only through prose in the project instructions, not through an index of what each is for.

The handoff, written at the end of a session, is the main record of "where we are".
It is only as good as the last session's final act, and it is missing entirely after a crash.

## Solution

The app builds a startup context for the coordinator from the project's durable state, in layers ordered by urgency.
It does not depend on anything written at the end of a session.

1. **Needs attention now:** notes not yet placed in a batch, pending decisions, drafts waiting for sign-off, access and resume requests, and anything else waiting on the coordinator.
2. **The queue:** one short block per open batch, in order, with its number, status, brief, current workers, and next action.
3. **Orientation:** the project's purpose, the research map, and the conclusions the human has accepted.
4. **Recent conversation:** the last few exchanges with the human.
5. **How to get more:** how to inspect any batch, finding, source or record in detail, and an index of instruction skills with when to use each.

Every batch gets a **brief**: its purpose, what is in and out of scope, and its current direction.
The coordinator writes the brief when it opens a batch and updates it whenever the direction changes.
Together, the briefs and batch statuses are the project's queue, kept current as work happens, like the backlog in firstmate.
This makes the end-of-session handoff optional: a fresh coordinator learns where things stand from the queue.

Instruction documents become project skills.
The app places them where each installed agent CLI looks for folder-level skills, so the coordinator sees their names and when to use them, and loads a full skill only when it needs it.
Nothing is installed globally.

The new context is built alongside the existing startup output, not in place of it.
It replaces the old output only after an evaluation shows that fresh coordinators pick up work at least as well, from less context.

## User Stories

1. As a researcher, I want to start the coordinator fresh at any time, so that I can clear a long session without losing my place.
2. As a researcher, I want a fresh coordinator to know what is in progress without my explaining it, so that restarting costs me nothing.
3. As a researcher, I want a fresh coordinator to answer my waiting notes first, so that nothing I sent is forgotten across a restart.
4. As a researcher, I want a fresh coordinator to place a new note in the right batch, so that related work stays together.
5. As a researcher, I want a fresh coordinator to ask me when a note could belong to more than one batch, so that it does not guess wrongly.
6. As a researcher, I want a fresh coordinator to know which batches are waiting on me, so that it does not start work I have not approved.
7. As a researcher, I want a fresh coordinator to know which batches are paused and why, so that it does not resume them without asking.
8. As a researcher, I want each batch to state its purpose and scope, so that I can see at a glance what it is for.
9. As a researcher, I want a batch's stated direction to change when I redirect it, so that the record matches what is actually happening.
10. As a researcher, I want the queue of batches to be current at every moment, so that a crash never loses where things stand.
11. As a researcher, I want closed batches to stop appearing as active work, so that the coordinator's picture is accurate.
12. As a researcher, I want finished detail kept out of startup and available on request, so that the coordinator's context is spent on what matters.
13. As a researcher, I want the conclusions I have accepted to be part of the coordinator's orientation, so that it builds on settled research.
14. As a researcher, I want pending findings to be summarized at startup rather than reproduced, so that a finished batch does not crowd out current work.
15. As a researcher, I want the coordinator to know my saved preferences, so that it follows them from its first action.
16. As a researcher, I want to see how large the coordinator's startup context is, so that I understand what a fresh start costs.
17. As a researcher, I want to review exactly what a fresh coordinator would read, so that I can judge whether it makes sense.
18. As a researcher, I want the new startup context proven on my real project before it replaces the old one, so that a change never makes the coordinator worse.
19. As a researcher, I want the coordinator to find detailed instructions when it needs them, so that it follows the right procedure for walkthroughs and graph updates.
20. As a researcher, I want those instructions to come with the app, so that the project works without anything installed separately.
21. As a coordinator, I want the most urgent items first, so that I can act without reading everything.
22. As a coordinator, I want each batch described once, in one place, so that I do not have to reconcile two lists.
23. As a coordinator, I want each batch's next action stated, so that I know what to do with it.
24. As a coordinator, I want stable IDs for everything shown, so that I can retrieve the detail behind any line.
25. As a coordinator, I want a clear way to read more about any batch, finding, source or record, so that summaries are never a dead end.
26. As a coordinator, I want an index of instruction skills with when to use each, so that I load the right one at the right time.
27. As a coordinator, I want to write and update a batch's brief with a simple command, so that keeping the queue current is cheap.
28. As a coordinator, I want to be told when a batch has no brief, so that I can write one before relying on it.
29. As a coordinator, I want the research map to be part of orientation, so that I know the project's major threads and open questions.
30. As a coordinator, I want the startup context to stay within a size budget as the project grows, so that it never crowds out the work.
31. As a coordinator, I want recent conversation included, so that I know the tone and latest intent of the human.
32. As a coordinator, I want to know which workers are running and what they are doing, so that I do not duplicate or contradict them.
33. As a developer, I want the startup context built by one function from saved state, so that it is easy to test and reason about.
34. As a developer, I want to generate the old and new startup contexts for the same project side by side, so that I can compare them.
35. As a developer, I want a repeatable evaluation that starts fresh coordinators on each context and checks their answers, so that improvements are measured, not guessed.
36. As a developer, I want the evaluation to report size and accuracy together, so that a smaller context never passes by knowing less.
37. As a developer, I want existing batches without briefs to get one during migration, so that old projects benefit immediately.
38. As a developer, I want the old startup output to keep working until the new one is accepted, so that research continues during the change.

## Implementation Decisions

**Context builder.**
A single pure module takes the saved project state and returns the startup context as ordered layers.
It has one entry point and returns both the rendered text for the coordinator and a structured form for tests and for the review view.
It never writes state.
Each layer has a size budget; when a layer exceeds its budget, the builder summarizes and points to the detail instead of truncating mid-item.
The overall target is well under half of today's startup output for the Lubec project, with no loss of accuracy in the evaluation.

**Layer contents.**
- Needs attention now: unplaced sent notes, pending decisions, graph drafts returned for sign-off, pending access and resume requests, and batches whose next action belongs to the coordinator.
- The queue: every open batch once, in queue order, with number, title, status, brief, current workers and what each is doing, and next action.
  Closed batches appear only as a short "recently closed" list with one line each.
- Orientation: the project purpose, the research map, and accepted conclusions summarized one line each with IDs.
  Pending findings are counted and summarized per batch, not reproduced.
- Recent conversation: the last few exchanges, with long notes shortened and their IDs kept.
- How to get more: the inspection commands, with worked examples, and the skill index.

**Batch briefs.**
A brief has three short fields: purpose, scope (what is in and out), and current direction.
A new coordinator command sets or updates a batch's brief; opening a batch requires a brief.
The builder flags any open batch without a brief in the "needs attention" layer.
Existing batches get a brief during migration, written by a coordinator from each batch's history and then shown to the human.

**The queue.**
Batches have an explicit order.
Until the queue controls in the headless agents PRD arrive, that order is the batch number.
The queue is the batch list in that order with statuses and briefs; no separate queue record is kept.
Closing a batch sets its status to closed, and a one-time repair fixes batches that were closed without that status.

**Next actions.**
Each batch's next action is derived from its state by one function, replacing the scattered hints inside today's index entries.
It names who the batch is waiting on: the coordinator, a worker, or the human.

**Handoff.**
The handoff remains available for notes the queue cannot express, but the context no longer depends on it.
The builder includes the latest handoff under orientation, marked with its date.

**Instruction skills.**
The coordinator's instruction documents, such as the walkthrough and graph-update procedures, become project skills with a name and a "when to use" description.
They live in the repository's skills folder and are linked where each CLI reads folder-level skills: `.claude/skills` for Claude Code and `.agents/skills` for Codex, confirmed from the Codex binary.
The links are committed, so a fresh clone has them.
The skill index is part of the "how to get more" layer, so it works even for a CLI that does not support skills.

**Preferences.**
Saved settings the coordinator must follow, such as the researcher preference, are part of orientation.

**Review view.**
A command writes the startup context for any project to a folder under the private research directory, with a stats file listing each layer's size and estimated tokens, for the human to read.

**Rollout.**
The new builder ships behind a switch, defaulting to the old output.
The switch is the `COORDINATOR_CONTEXT=layered` environment variable; while it is off, the saved snapshot file leaves the new context out.
After the evaluation passes and the human has reviewed the output for the Lubec project, the switch defaults to the new context, and the old output is removed in a later change.

## Testing Decisions

Good tests check what the coordinator would read and what it would do, not how the builder is written internally.

**Context builder tests** use fictional project fixtures, following the existing fixture-based tests of research state and coordinator snapshots.
They check that:
- each open batch appears exactly once, with its number;
- a closed batch never appears as active;
- unplaced notes and pending decisions appear in the first layer;
- a batch without a brief is flagged;
- pending findings are summarized, not reproduced;
- every summarized item carries an ID that the inspection commands can retrieve;
- each layer stays within its budget for a large fixture project.

**Next-action tests** cover each batch state and check who the batch is waiting on.

**Brief command tests** check that opening a batch without a brief is refused, and that an update replaces the current direction and is recorded in the batch history.

**Evaluation.**
The evaluation must run the coordinator exactly as it will work, or it measures nothing useful.
For each context, it starts a real coordinator: Claude Code in a root that links the app's code and skills, whose only research folder is a copy of the project.
The copy leaves out the live connection, lock and sessions, so it starts its own service and nothing can reach the real project or the developer's own notes.
The human's first message is "Resume research" followed by a fixed set of questions, and the coordinator inspects whatever it needs before answering:
- What is in progress, and who is each batch waiting on?
- What needs your attention first?
- Where does this new note belong? (several prepared notes, including an ambiguous one)
- What should happen next in batch N?
- What has the human already accepted about topic X?
- Which researcher should you use?

A separate grader scores the answers against an answer key written by the human.
The report shows, for each context, the score, the tool calls, the reads after startup, the tokens ingested across all model calls, the peak context, and the cost.
Tokens ingested is a running total, since every model call re-sends the whole context; peak context is the size that matters for compaction.
The new context is accepted only if it scores at least as well as the old one with fewer reads and a smaller peak, and the human agrees after reading its output.

## Out of Scope

- Starting the coordinator headless, compaction settings (default 200k tokens for a Claude or Codex coordinator, or the model's limit if lower), context alerts, and the "start fresh" control; those belong to the headless agents PRD and build on this one.
- Worker (researcher and builder) startup context.
- Semantic search or automatic retrieval of relevant research.
- A researcher board for sharing discoveries between workers.
- UI for reordering or holding batches in the queue, beyond the explicit order this PRD adds.

## Further Notes

The 2026-09-24 review of a fresh coordinator's context for the Lubec project is kept in the private research directory, with the files it read and a stats summary.
It is the baseline this work is measured against.

The human's personal startup additions, such as their own hooks, are outside the app and are not part of the context the app builds.

This PRD takes the "progressive access to accumulated knowledge" direction from the shared-research roadmap: a thin index with stable IDs, and a common way to read detail on request.

## Progress

Built on 2026-09-24, behind the switch:
- the context builder with its five layers and budgets;
- batch briefs, required when opening a batch, and the set-brief command;
- the next-action function;
- the repair of batches closed without their status;
- the instruction documents moved into skills and linked for both CLIs;
- the review command (`npm run context:review`) and the evaluation (`npm run context:eval`).

The first isolated evaluation on the Lubec project, scored against a draft key, gave the old output 10 of 16 with 17 reads, 907,000 tokens ingested and a 69,000-token peak, and the new context 15 of 16 with 11 reads, 402,000 tokens ingested and a 44,000-token peak.

Remaining:
1. Let the coordinator's command take its JSON inline, so an inspection is one call; the evaluated coordinator could not write a command file and fell back to searching raw files.
2. Record who paused a batch and why, and show it in the queue.
3. Write briefs for the existing Lubec batches with a coordinator, and show them to the human.
4. The human writes the Lubec answer key; rerun the evaluation.
5. Make the new context the default, then remove the old output in a later change.
