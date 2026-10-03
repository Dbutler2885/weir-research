# Slice 03: Publishing findings

**Type**: AFK
**Status**: To do

## Blocked by

- Slice 02: Saving sources

## What to build

`weir.publish` publishes one finding with its evidence through the finding publisher.
Each quote is checked within its cited pages of the capture's text, after whitespace is normalized, across a page break when needed; it is marked checked, or transcribed for an image's transcription.
A finding can replace an earlier one in the same batch; a second replacement of the same finding is refused, naming its replacement.
Every post and publish carries a key from its seat and content, and a repeat is refused.
Published findings record their seat and are written into the library at once.
Each batch keeps a findings revision; graph work under way is sent a graph update when it rises, and stale drafts cannot be signed off or accepted.
See **Publishing findings** and **Graph work while findings change**.

## Acceptance criteria

- [ ] A quote at its cited page passes and is marked checked; a real quote at the wrong page is refused
- [ ] A quote across a page break and one with different whitespace pass
- [ ] Transcribed evidence is marked transcribed
- [ ] A replacement supersedes the old finding; a second replacement of it is refused with the replacement's name
- [ ] A repeated publish is refused
- [ ] A finding published or replaced during graph work sends the builder a graph update and makes the stale draft impossible to sign off or accept
- [ ] A board post, checkpoint or researcher finishing leaves a draft valid

## User stories addressed

Reference by number from the parent PRD:

- User story 37
- User story 38
- User story 39
- User story 40
- User story 41
- User story 48
- User story 52
- User story 53
- User story 54
- User story 74
- User story 75
