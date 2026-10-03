# Slice 01: Python session

**Type**: AFK
**Status**: Done

## Blocked by

- None

## What to build

Each researcher seat gets a Python session: a long-running Python process the app starts, owns and keeps, separate from the agent's own process.
The researcher sends code to it with a small command tool in its folder and gets back what the code printed, truncated beyond a fixed length with a note.
Code that runs longer than a few minutes keeps running; the tool returns with a note, and the output arrives later as a message.
After every completed run the session saves its variables with dill, and a new session loads them back; values that cannot be saved are named.
A run interrupted by a restart is never replayed, and the researcher is told.
The session is confined by an app-enforced macOS sandbox profile, and refuses to start where that sandbox is missing.
The command tool and the session reach the app only through files in the seat's folder, and every request carries the researcher's lease; a stale lease is refused.
The session's package, `weir`, starts with reading the library: listing documents and reading a document's text as pages.
See **The Python session** and **The session's library**.

## Acceptance criteria

- [x] Variables persist between runs, across the session's process being replaced, and across an app restart
- [x] Only what the code prints returns, truncated beyond a fixed length with a note
- [x] Unsaveable values are skipped and named in the run's output
- [x] Long code returns a note at once and its output later as a message to the researcher
- [x] An interrupted run is reported and not replayed
- [x] A request from a researcher whose lease was revoked is refused
- [x] The session can read the library and write its folder, and cannot read the home folder, write the library, or reach the internet
- [x] `weir.library` lists documents and reads a document's pages into a variable

## Known limitation

Until slice 07, pausing or switching a researcher ends a run in progress, which is then reported as interrupted.
Slice 07's job tickets let accepted work finish during a pause, as the PRD requires.

## User stories addressed

Reference by number from the parent PRD:

- User story 12
- User story 13
- User story 14
- User story 15
- User story 16
- User story 71
