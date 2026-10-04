# Slice 08: Instructions

**Type**: AFK
**Status**: Done

## Blocked by

- Slice 07: Helpers and job tickets

## What to build

The researcher's instructions are rewritten around the goal, the board, the library, the session and its package, describing tools rather than a procedure, without the bounded framing, retrieval limit, time limit or result.json.
The helper's instructions describe an errand.
The coordinator's instructions, the coordinate-research skill and its startup context are rewritten for opening batches with goals.
The research-contract skill is updated for saved-document evidence, transcribed evidence and publishing one finding at a time.
See **The researcher's and helper's instructions** and **The coordinator**.

## Acceptance criteria

- [x] No retrieval or time limit and no bounded framing remain in any instruction
- [x] A real researcher on a fictional project uses the session, saves sources, posts and publishes
- [x] A real coordinator opens a batch with a plain goal and does not divide it

## How it was built

Much of the wording arrived with the slices that built each tool, so this slice was a pass over all of it against what real agents did with it.

### The researcher

- The instructions open with the goal and say at once that there is no limit on sources or time.
- The session's calls are grouped by what they are for: reading the library, saving sources, reading at scale, and publishing and the board.
  Each says what it returns and what it is good for, and a paragraph before them says the choice of how to break a task down is the researcher's.
- They say the session is where the material lives: source text, search results and sub-call answers stay in variables, and only what decides the next step is printed.
- They say to work out dates, weekdays and sums in code.
- The opening post names the part of the goal a researcher is taking first, and when two take the same part the one whose post comes later on the board takes another.
- A post is for what helps a teammate choose what to do next, and finishing takes no post, since every post wakes the teammates who had finished.
- Before publishing, a researcher prints the batch's findings; what a teammate has already published is added to by replacing it.
  Sources that disagree are published as a disputed finding of its own.

### What real researchers showed, and what changed for it

The first live run, on the wording as it stood, passed its mechanics and showed four faults.

- Both researchers published the same findings, and then said on the board that they had removed their duplicates, which nothing lets them do.
  `weir.findings()` now gives a researcher's code the findings that stand in its batch, with their IDs, and the instructions put it just before publishing.
  The second run published five findings and no duplicates.
- A researcher could not find the ID of a finding to replace, and guessed the report's ID.
  `replaces` now takes the report's ID alone as well, since a team's finding is the only one in its report, and a refusal says where the IDs are listed.
- `findings.md` said each statement three times and called every finding "kept by the human".
  A team's finding is now one heading, one line saying who published it and when, its explanation and its evidence.
- Researchers printed whole documents into their conversations, and finished with rounds of "complete" posts that woke each other.
  The wording above is the answer to both.

### The helper, the reader and the reconciliation job

- The helper's instructions describe one errand: do it, save every source relied on, and answer with exact quotes and document IDs.
- Each role is told what its work is, in place of being told it is not a coding agent.

### The coordinator

- The goal is the human's request restated plainly and whole, and the instructions now add: keep to what the human said, since how to go about the research is the team's to choose.
  The first run's goal had added a method and a list of what to produce; the second's did not.
- In the first run the coordinator saw duplicated findings and assigned each researcher a part on the board.
  A post of the coordinator's now says what the human said or what it noticed, to the whole team, and who takes it up is the team's to settle.
  The live check fails if a coordinator's post gives a named researcher a part.
- The startup context needed no change: it already gives each batch's goal, seats, findings and board, and the commands for opening a batch and posting.

### The research-contract skill

- It is rewritten as what a finding and its evidence must be: evidence from saved documents only, the check at the cited page, transcribed evidence, what happens when a document's text changes, the four qualifications, one finding at a time, and replacement.
- The proposal format of older batches and of projects run without a coordinator is kept at the end, under its own heading, since that code is still there.
- Its section on Firstmate is gone; it described a launcher that no longer exists.

### Also fixed

- A research browser that could not be started, such as one removed since the app found it, ended the whole app with an unhandled error.
  It now fails that one start with a plain reason, and the researcher starts without a browser.
- The README and the guide said the coordinator briefs each researcher on a part; they now describe goals and teams.

## Checks

`npm run test:live-research` runs the whole app on a fictional project: a real coordinator and a real team of two, on Claude Code and then on Codex, against a small archive site the script serves.
It checks that the coordinator opens one batch whose goal says what the human asked and where to look, and that its posts leave who does what to the team; and that the researchers save the site's pages, post, publish findings whose quotes are checked against the saved pages, and finish.
It runs outside `npm run check`.
`tests/instructions.test.ts` reads every instruction the research agents work from and fails on a retrieval or time limit, a bounded pass, or the files of the old route.

## Known limitations

- A published finding can be replaced but not withdrawn, and one finding replaces one finding, so two duplicates cannot be merged into one.
  The instructions now keep duplicates from being published; the app does not refuse them.
- The live check judges the mechanics; whether a finding's interpretation is sound is the reader's to judge.
  In the first run both researchers and the coordinator agreed on a weekday's date that was wrong.
- The live check runs researchers on the cheapest models, where wording matters most; the default models were not run.
- The time limit setting is still in Research settings, where it now applies to graph work only; removing it is slice 09.
- The coordinator takes a turn for every finding and post in the app's news, most of which end with nothing to do.

## User stories addressed

Reference by number from the parent PRD:

- User story 7
- User story 8
- User story 32
- User story 49
