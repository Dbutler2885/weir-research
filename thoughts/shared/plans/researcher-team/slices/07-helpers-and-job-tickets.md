# Slice 07: Helpers and job tickets

**Type**: AFK
**Status**: To do

## Blocked by

- Slice 04: The team and the done phrase
- Slice 05: Readers and the cache

## What to build

`weir.helper` sends a helper, an agent with the web, the research browser, its own Python session and the library but no board or publishing, on an errand and returns a handle.
Every helper, reader batch and code run is a job recorded on disk when accepted, with its own ticket allowing what its role allows; pausing revokes only the researcher's lease, and stopping revokes everything.
A helper's full answer goes into the researcher's session under its handle with a one-line notice, which wakes an idle researcher; notices are held while a seat is paused.
After a restart, queued jobs start in order, interrupted readers run again, and an interrupted helper is taken back or started again once.
Helpers can save the research browser's page and an image with a transcription.
See **Depths and roles**, **Pausing and stopping** and **The Python session**.

## Acceptance criteria

- [ ] A helper's answer reaches the researcher who sent it, as a variable and a one-line notice
- [ ] A helper saves a source after its researcher is paused; code started before a pause publishes after it
- [ ] Answers and output arriving after a stop are dropped, and saved sources remain
- [ ] A finished answer is delivered once across a restart; a queued helper starts after it
- [ ] An interrupted helper starts again once and fails the second time; a seat whose only outstanding job failed can finish
- [ ] The helper limit holds further helpers in order

## User stories addressed

Reference by number from the parent PRD:

- User story 28
- User story 29
- User story 30
- User story 31
- User story 33
- User story 34
- User story 35
- User story 36
- User story 62
- User story 66
