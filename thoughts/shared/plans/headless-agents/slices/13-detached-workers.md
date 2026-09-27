# Slice 13: Detached workers

**Type**: AFK
**Status**: Done

## Blocked by

- Slice 12: Quota

## What to build

Each agent runs under a small host process that owns its input and output, writes its stream to disk, and accepts messages over a local socket.
The app sends a heartbeat; hosts stop their agents when it stops, unless the human chose on quitting to keep workers running.
On opening, the app reconnects to running hosts from a registry and replays their streams, and a kept-running worker keeps its launch instructions and holds its own quota pause until the reset time.
See **Detached workers** and **Quota**.

## Acceptance criteria

- [x] Quitting asks whether workers should keep running
- [x] Workers stop when the app closes or crashes unless kept running
- [x] Reopening reconnects to kept-running workers and shows their activity
- [x] A kept-running worker finishes with the instructions and app version it started with
- [x] A kept-running worker that hits its quota resumes at the reset time with the app closed

## User stories addressed

Reference by number from the parent PRD:

- User story 67
- User story 68
- User story 69
- User story 70
