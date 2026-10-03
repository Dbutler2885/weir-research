# Slice 04: The team and the done phrase

**Type**: AFK
**Status**: Done

## Blocked by

- Slice 03: Publishing findings

## What to build

The coordinator opens a batch with a title and a goal, and the app creates one seat per place in the team and starts a researcher on each.
Seats reuse assignments, titled "Researcher 1" and so on; briefs, steering and sending back are removed for seats.
`weir.post` posts to the board; every post reaches every other running or finished seat, waking finished ones, never paused, waiting or stopped ones; a resumed seat gets the posts it missed as one message.
A seat finishes when the researcher ends its turn with `RESEARCH DONE` and nothing of its own is outstanding; otherwise the app says what is outstanding, and a turn ending with neither gets one nudge.
The batch moves to Review when every seat has finished and leaves it when one wakes.
Stopping a batch ends everything under it; notices, held results and missed posts live in each seat's inbox on disk.
The coordinator's commands and news change to match.
See **The team**, **The done phrase**, **The board**, **Pausing and stopping** and **The coordinator**.

## Acceptance criteria

- [x] Opening a batch creates its seats and starts the team
- [x] The done phrase finishes a seat only with nothing outstanding
- [x] A turn without the phrase gets one nudge
- [x] A post wakes finished seats and never paused or stopped ones; a resumed seat receives the posts it missed
- [x] The batch reaches Review when every seat has finished and leaves it when one wakes
- [x] Pause, resume and switch still work on seats
- [x] The coordinator can open a batch, post to its board and stop its team, and hears of findings and finished researchers

## User stories addressed

Reference by number from the parent PRD:

- User story 1
- User story 2
- User story 4
- User story 5
- User story 6
- User story 7
- User story 8
- User story 9
- User story 10
- User story 11
- User story 42
- User story 43
- User story 44
- User story 45
- User story 46
- User story 47
- User story 56
- User story 57
- User story 58
- User story 59
- User story 60
- User story 61
- User story 77
- User story 78
- User story 79
- User story 80

## How it was built

- A batch with a goal is a team's batch; its assignments are its seats.
  A batch without one is from before teams and is kept as history: nothing starts on its assignments, and the library and the interface show it as before.
- The coordinator's `assign`, `steer`, `stop-researcher`, `revise`, `publish`, `batch-ready` and `set-brief` are gone, with the results held for its judgment.
  It has `open-batch` with a title and a goal, `post`, and the new `stop-team`.
- A seat's inbox is a folder of files in the seat's folder.
  Posts and notices are written there first and removed once they have been sent to the researcher, or, for those sent in its first message, once its conversation is under way.
- A message that reaches a researcher in the middle of a turn may arrive too late for that turn to read it.
  When such a turn ends with the done phrase, the app asks the researcher to say it again rather than finish the seat.
- The researcher is told once what is outstanding, and is nudged once per idle spell; a new post or notice allows one more of each.
- The done phrase counts when it is the turn's last line, alone; emphasis marks around it are ignored.
- Stopping a team stops every seat, finished ones too, so that no post wakes them, and the batch goes to Review with what it published.
  Posts to a stopped batch are refused.
- While the human has the whole batch paused, a post that would wake a finished seat leaves it paused, with the post in its inbox, until the human resumes the batch.
- A graph reorganization has no research, so `reorganize-graph` opens a batch of its own, with no seats, when it names none.
- A team's batch is laid out in the library as `goal.md`, `board.md`, one `findings.md` for the whole batch, newest first, and `researcher-K/checkpoints.md` for each seat.
- The coordinator's news gains `findings`, `researchersFinished` and `batchesReady`.
- A batch that reaches Review starts the automatic walkthrough and graph update when the human has them on.
- The researcher's instructions are rewritten for the team as far as this slice needs; slice 08 rewrites them in full, with the skills.
  The research-contract skill is no longer placed in a researcher's folder.
- Left for later slices: a paused seat's code runs still end with its researcher, until job tickets in slice 07; the interface shows a team's batch through the views made for assignments until slice 09; the time limit setting still applies to graph builders, and its control stays until slice 09.
- `npm run test:live-team` runs a real team of two on Claude Code and on Codex through posting, publishing, finishing, a waking post and Review.
