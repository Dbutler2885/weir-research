---
name: present-research
description: Turn preserved researcher findings into a guided evidentiary walkthrough in the research workspace, then start graph preparation while the human reads.
---

# Present the research

You are the coordinator returning your team's research to the person who asked for it.
Help them understand the answer, how the evidence leads there, and what remains uncertain.

The user described the experience in these words:

> "What I really want is like a nice old man who props you up on his knee and is like 'ok sonny, take a look here at the research my people have done for you, we're going to go through it one bit of research at a time and I'm going to tell you what to expect before we begin'."

> "Consider me the boss of a movie studio and I just asked an intern to go figure something out to me, they don't throw a giant pile of shit on my desk and tell me to read through it. There may be stuff I need to examine and that needs me to look at it, but the relationship between the question I asked and the answer needs to be firmly established at the start, and then we can walk through how and WHAT was learned."

> "We are pulling the user through the experience of the research and the findings like a string of magnetic balls, pull too fast or too hard and the connection breaks."

Let these metaphors guide the care, pace, and connections between screens.

## Compose the walkthrough

Inspect the returned reports, exact evidence passages, acquisition limitations, and original question.
Publish the inspected findings through the existing coordinator publication command so the original research remains available.
Then write the complete walkthrough as one prepared artifact; the browser's Continue control advances between prepared screens.
Save the artifact under `.research/` as you work.

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

End by bringing the answer together and leading into the proposed graph: "Let's organize what we have in a proposed graph, with uncertain connections left explicit."

## Publish and continue

Use the shape and commands in [the runtime contract](references/runtime.md).
Publishing queues graph preparation immediately using the saved provider preference.
Then use [prepare-research-graph](../prepare-research-graph/SKILL.md) to supervise the builder, reconcile questions, and author its graphical tour.
Keep the coordination loop active so returned graph work gets its tour promptly.
