# Slice 09: Interface

**Type**: HITL
**Status**: Done

## Blocked by

- Slice 04: The team and the done phrase
- Slice 06: Passages and Jev

## What to build

Findings shows each batch's goal and one list of its findings, newest first, each with its researcher, checked and transcribed marks, and a link to the saved text.
The live panel shows each seat with its status, idle seats, and the helpers and readers running for it.
Research settings lose the time limit and gain team size, helper and reader limits and the Jev figures; dispatch settings gain the reader role.
A mockup is reviewed with the human before it is built.
See **The interface**.

## Acceptance criteria

- [ ] The human approves a mockup (replaced: the human asked for it built, to test in the app on a new project)
- [x] Findings appear as they are published, with researcher and marks
- [x] The live panel shows seats, helpers and readers
- [x] The new settings save and take effect

## How it was built

- No mockup was reviewed first: the human asked for the slice built so as to test it in the app on a new project.
  Their testing stands in for the mockup review, and the first criterion stays open until they have.

### Findings

- A team's batch shows the goal the team was given, its seats in a line each, and its findings as one list, newest first.
  Each finding says its qualification, the researcher who published it and when, and that it corrects an earlier finding where it does; a replaced finding is not listed.
- Each piece of evidence says on its line whether the quote was checked or transcribed, and under the quote what that means: that the app found the words at the page cited and the reading is the researcher's, or that it is a transcription the app cannot check.
  It shows the researcher's reading of the quote, opens the saved text, and opens the original.
- Twelve findings show at first, and the rest on request.
- A batch from before teams is shown as it was, by research pass.

### The live panel

- Each seat at work is a row under its own name, with its agent, what it is doing, and under it its helpers with their errands and current steps, the helpers waiting for a free place, the readers reading and the Python runs still going.
- A seat between turns says it is waiting for its helpers and readers, or that it is idle, having ended its turn without saying it has finished.
- A finished seat in a batch still at work is listed as waiting, since a post wakes it.
- A researcher's helper is no longer listed as helping the coordinator.
- The app reports each seat's work with every poll, so these change without a reload.

### Settings

- The time limit is gone from Research settings.
  The app still honours one saved earlier for graph work.
- "The research team" holds the team size and the helper and reader limits, saved together.
- "Jev sweeps" says how much was swept, how much went on to readers, and how many passed-over passages a reader then found relevant.
- The reader role was added to the dispatch settings in slice 05.

## Checks

The interface tests cover the team's batch, the live panel's seats, the settings and the Jev figures.
The findings page and the settings were looked at in a browser on a fictional project.
The live panel's seat rows were not seen with real agents running, only in the tests.

## User stories addressed

Reference by number from the parent PRD:

- User story 3
- User story 50
- User story 51
- User story 53
- User story 54
- User story 55
- User story 66
- User story 68
