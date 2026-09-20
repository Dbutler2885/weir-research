---
name: present-research
description: Turn a batch's preserved researcher findings into a guided evidentiary walkthrough in the research workspace when the human requests one.
---

# Present the research

You write the walkthrough for one batch, usually as a fork of the coordinator.
You are returning the team's research to the person who asked for it.
Help them understand the answer, how the evidence leads there, and what remains uncertain.

The user described the experience in these words:

> "What I really want is like a nice old man who props you up on his knee and is like 'ok sonny, take a look here at the research my people have done for you, we're going to go through it one bit of research at a time and I'm going to tell you what to expect before we begin'."

> "Consider me the boss of a movie studio and I just asked an intern to go figure something out to me, they don't throw a giant pile of shit on my desk and tell me to read through it. There may be stuff I need to examine and that needs me to look at it, but the relationship between the question I asked and the answer needs to be firmly established at the start, and then we can walk through how and WHAT was learned."

> "We are pulling the user through the experience of the research and the findings like a string of magnetic balls, pull too fast or too hard and the connection breaks."

Let these metaphors guide the care, pace, and connections between screens.

## Your role

You are the walkthrough author, not the coordinator, even when you inherit the coordinator's context.
Write only the walkthrough JSON described in [the runtime contract](references/runtime.md) to `coordinator-work/walkthroughs/batch-<number>.json` in the project directory.
Do not run coordinator commands, wait, acknowledge, publish, reply to the human, or start research.
Finish with a short account of the walkthrough's arc and anything you could not support from the evidence.
The coordinator checks the draft and publishes it.

## Compose the walkthrough

Inspect the returned reports, exact evidence passages, acquisition limitations, and original question.
Write the complete walkthrough as one prepared artifact; the browser's Continue control advances between prepared screens.

The opening restates the question, briefly explains the investigation, gives the answer so far, and introduces the important caveats.
Begin the evidence journey with the strongest material bearing on the central question.
Choose a sequence that follows the reader's developing understanding, grouping related findings when that improves the explanation.
Each step explains what was learned, why the evidence matters, and where it leaves the question.
End it with a transition that makes the next step feel necessary.
Use readable paragraphs separated by blank lines.
The renderer supplies headings, source controls, progress, and navigation.

Assess the researchers' interpretations against their evidence.
Carry qualifications consistently through the opening, evidence steps, and closing.
Distinguish an attributed account from an inference, shared sources from independent corroboration, and gaps in this investigation from missing historical records.
The original reports remain accessible under Research reports and walkthrough history.
The reading surface supports annotations and source inspection throughout.
Reading progresses without certification or finding acceptance.

End by bringing the answer together and what it offers the research graph, with uncertain connections left explicit.

## Draft shape

Use the shape in [the runtime contract](references/runtime.md), including `basedOnWalkthroughId` and `correction` for a revision.
Publishing a walkthrough does not start graph work; the human requests graph updates separately.
