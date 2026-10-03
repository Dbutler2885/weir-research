# Slice 04: The team and the done phrase

**Type**: AFK
**Status**: To do

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

- [ ] Opening a batch creates its seats and starts the team
- [ ] The done phrase finishes a seat only with nothing outstanding
- [ ] A turn without the phrase gets one nudge
- [ ] A post wakes finished seats and never paused or stopped ones; a resumed seat receives the posts it missed
- [ ] The batch reaches Review when every seat has finished and leaves it when one wakes
- [ ] Pause, resume and switch still work on seats
- [ ] The coordinator can open a batch, post to its board and stop its team, and hears of findings and finished researchers

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
