# To do

Ideas and problems we have agreed are worth doing, but not yet.
Each item says its status and links the plans it builds on.
When an item is taken up, it gets a plan or slices of its own and a link from here.

## Customizable roles and instructions

**Status:** pending.
**Builds on:** [dispatch rules](plans/headless-agents/slices/08-dispatch-rules.md) and the [headless agents PRD](plans/headless-agents/prd.md).

The human wants some freedom to shape how the agents work, and possibly to make roles of their own.
Today the roles are fixed: coordinator, researcher, helper, graph builder and walkthrough writer.
Dispatch rules choose each role's agent, model and effort, but the app writes every role's instructions.

Each role's instructions mix two layers.
The contract is what the role hands back in a shape the app checks: a findings proposal, graph tables, a walkthrough.
The app depends on it, so it stays fixed.
The approach is how to work: depth, sources to prefer, reading page images rather than snippets, tone, when to stop.
The approach is what the human would want to shape.

Three steps, in order of payoff:

1. Editable guidance per role.
   Research settings gets a text box for each role, added to that role's instructions every time it starts.
   The coordinator can propose additions for the human to approve.
   This also gives the coordinator a real way to keep standing instructions, which it lacks today.
2. Custom roles on existing contracts.
   A role is a name, a purpose, its guidance, and a default agent and model, producing one of the app's outputs.
   The motivating case is a cheap source gatherer that finds and downloads sources and records locators without drawing conclusions, followed by an expensive analyst starting from its source pack.
   The source pack is the one new contract this needs.
   The coordinator sees the human's roles and sequences them.
3. Roles with outputs the app does not understand.
   Held back: the app could not check, show or use what they return.

Open question before step 2: whether a cheap first pass helps at all.
The human set a rule using a helper this way, but has not seen whether the expensive model used its sources or searched again.

## PDF pages for Codex researchers

**Status:** pending.

Researchers are now told to look at the page images of a scanned PDF.
A sandboxed Claude researcher can: its file-reading tool shows PDF pages.
A sandboxed Codex researcher cannot; asked to read a fictional scanned page, it answered that it could not render the PDF.
Give researchers a command in their folder that renders PDF pages to images, which Codex can then view.

## "What remains open" in walkthroughs

**Status:** pending the human's decision.

The section mixes genuine uncertainty in the sources, such as a birth year two records disagree on, with gaps in the pass's own work, such as reading a document only through search snippets.
The first belongs in a finished walkthrough; the second should have been done, or offered as a follow-up.
Proposed: the walkthrough writer keeps only genuine uncertainty there, sends anything the research skipped to the coordinator as a follow-up to offer, and drops the line "The gaps below describe what this investigation established, not what records must exist."

## Keep the computer awake while agents work

**Status:** offered, not yet asked for.

A Mac asleep with its lid closed runs nothing, so overnight research stalls until it wakes.
The app could hold off idle sleep with `caffeinate` while agents are working.
It cannot keep a closed laptop on battery awake.

## A question added to a ready batch puts it back in the queue

**Status:** to look at.

The coordinator reported that adding the human's question about a caveat to batch 6 put the ready batch back in the queue, although no new research was needed.
Check whether answering a question about a ready batch should reopen it.
