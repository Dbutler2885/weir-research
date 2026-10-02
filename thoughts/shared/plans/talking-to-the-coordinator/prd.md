# Talking to the coordinator

Status: drafted 2026-10-01 from the design discussion recorded in the agreed work list (items 6 to 11).
It comes first of three PRDs; researchers on assignments and controlling running agents build on it.
It assumes the branch that makes graph updates wait for the coordinator's brief has merged, with the message-ID citation for graph requests removed.

## Problem Statement

The human talks to the coordinator in two ways: chat messages, and annotations pinned to things on the page and collected in a queue.
Both reach the coordinator in a shape that gets in the way.

- Pressing Send in the chat also sends every queued annotation, with nothing on screen saying so.
  The human cannot write a quick chat message without emptying a queue they were still building.
- A chat message reaches the coordinator wrapped in an app update headed "The project changed", as a JSON entry with a long ID, a timestamp and an author field, beside whatever else changed.
  The human wrote a sentence; the coordinator receives a record.
- Every update carries the same fields whether or not they hold anything, such as empty lists of unplaced annotations and pending decisions.
- Every sent annotation is an obligation: it counts as handled only once the coordinator places it in a batch, and until then it is listed in every update and at the top of a fresh coordinator's startup summary.
  An annotation that needs no research, such as "this is great" or one that only connects two others, can never be cleared except by inventing a batch for it.
  Organizing everything into batches takes the coordinator's attention away from thinking about what the human said.
- Research the human asks for in a plain chat message becomes a batch question only by the coordinator citing that message's ID.
- The coordinator keeps "handoff notes" for its successor, but nothing asks for them when a coordinator is replaced.
  In practice it rewrites them at the end of most turns as a status log of what the project already records.
- A "no reply yet" reminder was added for messages a closed or paused coordinator never answered; a fresh coordinator already sees the human's last message in the recent conversation.

## Solution

The chat and the annotation queue become two separate ways of sending, and each reaches the coordinator as itself.

Pressing Send in the chat sends only what the human typed.
The annotation queue goes only when the human presses Send queue on the Annotations tab, and a single annotation can still go at once with Send now.

The coordinator receives the human's chat message as the human's words alone, as a plain message.
A sent queue arrives as one structured message listing each annotation's words and what it points at, because several annotations with their references are organized data.
News from the app, such as a batch moving or a researcher returning results, arrives as its own message, clearly the app's and never mixed with the human's words, carrying only the parts that changed.

Annotations carry no bookkeeping.
The coordinator reads what the human sent, all at once, and replies to it as a whole: a direct answer, research it is starting, or where later work will go.
Nothing has to be placed in a batch, and nothing is listed as outstanding.
When the coordinator opens research, it words the question itself, and it can attach what an annotation pointed at when that helps the work.

Handoff notes and the "no reply yet" reminder are removed.
A fresh coordinator works from the project's saved state, each batch's brief, and the recent conversation.

## User Stories

1. As a human, I want pressing Send in the chat to send only what I typed, so that I can write a quick message without sending annotations I am still collecting.
2. As a human, I want my queued annotations to go only when I press Send queue, so that I decide when they are ready.
3. As a human, I want Send now on a single annotation to keep sending just that annotation, so that an urgent one does not wait for the rest.
4. As a human, I want the queue to stay exactly as it was after I send a chat message, so that I can keep working on it.
5. As a human, I want my chat message to reach the coordinator as my words alone, so that it reads me the way a person would.
6. As a coordinator, I want the human's chat message as a plain message, so that I do not have to find their words inside a record of IDs and timestamps.
7. As a coordinator, I want a sent queue as one structured message, so that I can see every annotation and what it points at together.
8. As a coordinator, I want each annotation's references in that message, such as the finding, graph record, walkthrough step or selected text it was pinned to, so that I know exactly what the human was looking at.
9. As a coordinator, I want app news in a separate message from the human's words, so that I never mistake a researcher's return for something the human said.
10. As a coordinator, I want app news to carry only what changed, so that empty lists do not fill my context.
11. As a coordinator, I want app news to say plainly what kind of news it is, so that I do not read "The project changed" when the human wrote to me.
12. As a coordinator, I want to reply to a whole set of annotations at once, so that I can treat related thoughts together.
13. As a coordinator, I want no obligation to place each annotation in a batch, so that a comment needing no research costs me nothing.
14. As a coordinator, I want to word a batch question myself, so that research the human asked for in chat or in annotations becomes a clear heading.
15. As a coordinator, I want to attach what an annotation pointed at to research I open, so that the work can start from the record the human was looking at.
16. As a human, I want annotations that need no research to be answered and left alone, so that the coordinator does not invent batches to clear them.
17. As a coordinator starting fresh, I want the recent conversation to show the human's messages and annotations in their own words, so that I can see what was said last.
18. As a coordinator starting fresh, I want no list of unplaced annotations, so that my attention goes to what matters now.
19. As a coordinator starting fresh, I want no stale handoff notes, so that I rely on the project's saved state, which is always current.
20. As a human, I want no handoff notes to maintain or wonder about, so that there is one source of truth: the project and its batches.
21. As a human, I want my sent annotations kept in the conversation history as I sent them, so that I can see what I said.
22. As a human, I want a coordinator paused by its usage limit to still try my chat message and my sent queue at once, so that the change in shape keeps the behaviour that a person's message can lift a pause.
23. As a human, I want app news to keep waiting during a usage-limit pause, so that it does not pile up refused messages in the coordinator's conversation.
24. As a human with an existing project, I want my old conversation and batches to keep working, so that nothing I did before is lost.
25. As a human with an existing project, I want annotations that were never placed in a batch to simply stop being listed, so that old obligations do not carry over.
26. As a developer, I want what the coordinator receives decided in one place, so that its shape can be tested and changed without touching delivery.
27. As a developer, I want the coordinator's instructions and skills to describe the new messages, so that it does not look for fields that no longer exist.

## Implementation Decisions

- The conversation domain separates the two sends.
  A chat send carries text only and never takes the queue.
  A queue send carries every queued annotation, or the ones named, and may carry no text.
  Send now carries one annotation, as today.
- Annotations keep their stored identity for the app's own use, such as editing or removing a queued one, but the coordinator never needs an annotation's ID.
  What an annotation points at keeps its reference, so the coordinator can pass it on.
- A new coordinator inbox module turns what changed since the coordinator last heard into the messages it receives, in order.
  Each human chat message becomes a plain message of the human's words.
  Each sent queue, or Send now annotation, becomes one structured message introducing the annotations and listing, for each, its words and its references.
  Everything else becomes one app-news message, with an introduction saying it is news from the app and a structured body containing only the parts that changed.
  Each message is marked as from the human or from the app, so delivery can let the human's messages try through a usage-limit pause and hold the app's.
- The coordinator host delivers the inbox's messages instead of a single combined update.
- The coordinator's change summary drops the unplaced-annotation list, and the pending-decisions list appears only when a decision is pending.
- Batch questions are worded by the coordinator.
  The question forms that took annotation IDs or a message ID are removed; a question takes a title and the coordinator's account of what is asked, and may carry references copied from annotations.
  Questions created from annotations before this change keep their links.
- The startup summary drops the unplaced-annotation block, the "no reply yet" block, the handoff notes, and message IDs in the recent conversation.
- The handoff command and the stored handoff are removed; the research map stays.
- The coordinator's standing instructions and the coordinate-research skill are rewritten for the new messages and the end of per-annotation placement.
- Existing projects need no conversion: their conversations and batches read as before, and their unplaced annotations are no longer listed.

## Testing Decisions

- Tests check what the human does and what the coordinator receives, not how the code is arranged.
- The conversation rules are tested as domain transitions: a chat send leaves the queue untouched, a queue send takes the queue, Send now takes one annotation, and a send with nothing in it is refused.
  Prior art: the conversation domain tests.
- The coordinator inbox is tested as a pure function: given a change, the exact messages, their order, and which are the human's.
  Cases include chat alone, a queue alone, chat and a queue in one change, app news alone, and empty parts left out.
- Delivery is tested end to end with the fake Claude, recording exactly what the coordinator received, including during a usage-limit pause.
  Prior art: the coordinator host tests.
- The startup summary is tested for the removed blocks and the human's words in the recent conversation.
  Prior art: the coordinator context tests.
- The chat and queue buttons are tested in the workspace interface tests.

## Out of Scope

- What researchers receive, assignments, the research library and the Findings page; see the researchers on assignments PRD.
- Pausing, resuming and switching the model of running agents; see the controlling running agents PRD.
- Shorter IDs for the records that still need them.
- A judge model checking whether the human asked for something.
- Moving the coordinator's commands from its script to another mechanism.

## Further Notes

- The human chose "annotations" as the name for what is pinned to the page; chat messages are messages.
- Removing the message-ID citation for starting graph updates belongs to the branch this PRD assumes; the rule that the coordinator starts a graph update only when the human clearly asked lives in its instructions.
- Until the researchers on assignments PRD lands, a question the coordinator words from a chat request shows in Findings as the coordinator's question.
