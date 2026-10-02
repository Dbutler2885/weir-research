# Researchers on assignments

Status: drafted 2026-10-01 from the design discussion recorded in the agreed work list (items 12, 13, 14 and 18).
It builds on the talking to the coordinator PRD, which ends annotations doubling as research assignments.
The controlling running agents PRD builds on this one.

## Problem Statement

A batch is meant to be a body of research the coordinator organizes so that one walkthrough and one graph update can explain it, with several researchers sent out on its parts.
The human designed a setting for how many researchers could go out at once, intending it as a limit per batch.
That is not how the app works.

- A batch can have only one researcher at a time.
  The app tracks a running researcher by its batch, so the batch's lease, status, saved session and returned results all belong to one researcher.
  Batch 8 of the human's project took five passes, one after another.
- The "Workers at once" setting caps all workers across the project, and only as advice to the coordinator; nothing enforces it.
  The coordinator could send eight researchers at once, which is too many.
- A researcher's assignment is a list of the human's annotations, and its instructions say to investigate only the dispatched annotation IDs.
  The human's annotations are for the coordinator; they often mean little until the coordinator has interpreted or discussed them.
- A researcher starts from a large JSON snapshot: its batch, its batch's earlier findings, a full copy of the graph, and the source library.
  It cannot read other batches' findings or evidence, or any walkthrough, so the coordinator cannot point it at earlier work outside its batch.
- Researchers working on related questions cannot tell each other what they found.
- The Findings page heads each question with "You asked" and the human's annotations, which explains less than the direction the coordinator actually gave the researcher.

## Solution

A batch holds any number of assignments, each one researcher's bounded part of the batch, such as one question or one source.

The coordinator creates an assignment with a short title and a brief in prose: what to find, what is out of scope, and the IDs of findings, sources, graph records or passages worth looking at, written inline.
The app starts a researcher for it, up to the human's limit of researchers per batch, and starts the next waiting assignment when one finishes.
Each assignment has its own researcher, its own saved session, its own checkpoints and its own returned results, and each can be steered, stopped, resumed and reviewed on its own.

A researcher works from three things.
Its folder holds the coordinator's brief as a prose document, and its outputs.
A shared research library holds everything the project has produced, as readable files the researcher searches and reads directly: every batch's brief, every research pass's direction, findings and checkpoints, every walkthrough, the graph's tables, the source library, and the saved documents with their text.
The app keeps one library per project, current as research is saved, and every researcher can read it but not change it.

Researchers in a batch can post to the batch's board when they find something the others should know, such as a source found or ruled out or an identity settled.
The app delivers each post into the other running researchers' context at their next step, keeps it in the library for researchers who start later, and tells the coordinator.

The Findings page shows each batch's research passes, each headed by its title and the coordinator's direction, with any steering that followed and the findings it returned.

## User Stories

1. As a human, I want the coordinator to send several researchers on one batch at once, so that a batch's questions are worked in parallel.
2. As a human, I want to set how many researchers can work one batch at the same time, so that the coordinator cannot send too many.
3. As a human, I want that limit enforced by the app, so that it holds whatever the coordinator decides.
4. As a human, I want only researchers per batch limited, so that graph builders, walkthrough writers and helpers are not held back by it.
5. As a human, I want assignments beyond the limit to wait and start in the order they were made, so that nothing is dropped.
6. As a coordinator, I want to create an assignment with a title and a brief in prose, so that I can say exactly what this researcher should do.
7. As a coordinator, I want to name findings, sources, graph records and passages by ID in my brief, so that the researcher can look at what I mean.
8. As a coordinator, I want to choose the agent, model and effort for an assignment, or leave it to the human's settings, so that dispatch rules still apply.
9. As a coordinator, I want to steer, stop and resume one assignment without touching the others in its batch, so that I can redirect one part of the work.
10. As a coordinator, I want each assignment's returned results held for my review separately, so that I reconcile each researcher's work on its own.
11. As a coordinator, I want to send one assignment back for another pass, so that a weak result is redone without restarting its siblings.
12. As a researcher, I want my brief as a short prose document, so that I know my task without parsing a snapshot.
13. As a researcher, I want to read any batch's findings and evidence, so that I can build on work done before mine.
14. As a researcher, I want to read walkthroughs, so that I understand how earlier work was explained.
15. As a researcher, I want the graph as readable tables, so that I can check what the project already records.
16. As a researcher, I want the source library and the saved documents' text page by page, so that I can find and quote sources the project already holds.
17. As a researcher, I want other researchers' checkpoints, including ones still running, so that I can see dead ends and leads before repeating them.
18. As a researcher, I want to search all of it with my shell, so that I find what I need the way I search any folder.
19. As a researcher, I want the library to stay current while I work, so that I see what another researcher publishes during my pass.
20. As a researcher, I want to post to my batch's board when I find something the others should know, so that we work together.
21. As a researcher, I want posts from others in my batch delivered to me at my next step, so that I learn of them without looking.
22. As a researcher starting later, I want the board's earlier posts in the library, so that I start from what my batch has learned.
23. As a coordinator, I want to see board posts, so that I can steer the batch with what its researchers are learning.
24. As a human, I want researchers unable to change the library, so that shared research cannot be damaged by one of them.
25. As a human, I want researchers not to see my conversation or my annotations, so that they work from the coordinator's interpretation.
26. As a human, I want results the coordinator has not yet reviewed kept out of the library, so that researchers build only on checked work.
27. As a human, I want each assignment to keep its own saved session, so that an interrupted researcher picks up its own conversation.
28. As a human, I want a batch to show as running while any of its researchers run, so that its status reads correctly.
29. As a human, I want the Findings page to show each research pass with its title and the coordinator's direction, so that I understand why it returned what it did.
30. As a human, I want any steering the coordinator gave during a pass shown with it, so that I see how the direction changed.
31. As a human, I want each pass's findings under its direction, so that findings read in context.
32. As a human with an existing project, I want past passes shown as finished assignments, so that my history reads in the new layout.
33. As a human with an existing project, I want a past pass's direction shown as the annotations it was started from, since no brief was recorded, so that nothing about it is lost.
34. As a human, I want walkthroughs and graph updates to cover all of a batch's assignments, so that the batch is explained as a whole.
35. As a human, I want a mockup of the new Findings page before it is built, so that I can shape it first.

## Implementation Decisions

- An assignment is a new record within a batch: identity, title, brief, agent choice, status, creation and start times, its researcher's lease, its saved session, its checkpoints and its returned results.
  The lease, saved session and returned results move from the batch to the assignment.
- A batch's status follows from its assignments: running while any runs, waiting while any waits, and otherwise as the coordinator and the human leave it.
  Marking a batch ready, holding it and ordering the queue stay batch-level.
- Assignments replace a batch's separate questions; an assignment's title is the heading.
- The coordinator's commands create, steer, stop, resume and revise an assignment by its identity; publishing reviews one assignment's returned results.
- The researcher pool starts researchers per assignment.
  A setting for researchers per batch, defaulting to four, replaces "Workers at once", and the pool enforces it, starting waiting assignments in the order they were made.
  Nothing else is capped.
- The saved-session work from resuming interrupted researchers moves to the assignment, so any number of sessions can be saved per batch.
- A researcher's folder holds its instructions, the brief as prose, the outputs it writes, and its board posts; the JSON snapshot is removed.
- The research library is a new module that writes a project's library from its saved state and rewrites it when research is saved.
  It holds batches, each with its brief, its board, and one folder per research pass with the coordinator's direction, the returned findings with their evidence quoted with source and locator, and the checkpoints; walkthroughs; the graph's tables in the format graph builders use; the source library; and each saved document with its text by page.
  It leaves out the conversation, annotations, the coordinator's unreviewed results, and the app's internal records such as worker credentials.
- Each researcher's sandbox grants read-only access to its project's library, for both Claude Code and Codex, beside the access already granted to the app's copy of Node.
- The board belongs to a batch.
  A researcher posts by writing a post in its folder; the app records it on the batch, delivers it to the batch's other running researchers as a message at their next step, writes it into the library, and includes it in the coordinator's app news.
  Researchers are told to post only what others in the batch should know.
- The Findings page groups each batch's results by research pass, headed by the assignment's title and direction, with steering and findings.
  A mockup is reviewed with the human before it is built.
- Existing projects are converted once: each past research pass becomes a finished assignment, titled from the questions it answered, with the annotations it was started from shown as its direction; each past question without a pass becomes an assignment that never ran.
- Graph builders and walkthrough writers read a batch's findings across all its assignments.

## Testing Decisions

- Tests check behaviour a human or an agent can observe, not internal structure.
- The research library is tested as "this project in, these files out": layout, content, exclusions, and rewriting after research is saved.
- Assignments are tested as domain transitions: creation, starting within the limit, waiting beyond it, returning results, revision, and the batch status that follows.
- The researcher pool is tested end to end with the fake Claude and Codex: several assignments in one batch run together up to the limit, each resumes its own session, and a board post reaches the others.
  Prior art: the researcher tests, including resuming interrupted researchers.
- The read-only library is tested in the sandbox integration checks: a researcher can read it and cannot write to it.
  Prior art: the Codex isolation integration check.
- The conversion of existing projects is tested on a fictional project built in the old shape.
  Prior art: the migration tests.
- The Findings page is tested in the workspace interface tests once its mockup is agreed.

## Out of Scope

- What reaches the coordinator from the human and the app; see the talking to the coordinator PRD.
- Pausing, resuming and switching the model of running agents from the app; see the controlling running agents PRD.
- A lookup tool or an MCP server for researchers; the library replaces it.
- Shorter IDs.
- Limits on graph builders, walkthrough writers or helpers.

## Further Notes

- This replaces the roadmap's Scope B items on several assignments per question, progressive access to accumulated knowledge, and the researcher board with a concrete design.
- First Mate's crewmates read the real repository in their own worktree; the library gives researchers the same footing without per-researcher copies.
- The library for the human's current project is well under a megabyte of text plus 436 KB of documents.
