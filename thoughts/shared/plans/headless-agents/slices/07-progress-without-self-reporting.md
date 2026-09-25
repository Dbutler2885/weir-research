# Slice 07: Progress without self-reporting

**Type**: AFK
**Status**: Not started

## Blocked by

- Slice 03: Graph builders and walkthrough writers on the supervisor

## What to build

Workers stop writing status files; the live panel reads progress from their streams.
Checkpoints remain for recovery but are written only at real discoveries and before a worker stops.
See **Progress without self-reporting**.

## Acceptance criteria

- [ ] No worker instruction asks for status files, and the app no longer polls them
- [ ] Live panel progress for every role comes from the stream
- [ ] Checkpoints contain discoveries, not running commentary

## User stories addressed

Reference by number from the parent PRD:

- User story 40
- User story 41
