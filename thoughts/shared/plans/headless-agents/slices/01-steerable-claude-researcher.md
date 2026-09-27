# Slice 01: Steerable Claude researcher

**Type**: AFK
**Status**: Done

## Blocked by

None - can start immediately

## What to build

A new agent supervisor launches Claude Code researchers in print mode with streamed JSON input and output, keeping input open.
Their actions reach the live panel from the stream, the coordinator can send a steering message that arrives at the researcher's next step, and it can stop a researcher outright.
Turn boundaries are reported so the coordinator knows when a researcher is waiting, and a finished researcher closes.
This replaces the Claude path of the researcher pool, which closes input at launch.
See the PRD's **Agent supervisor** and **Provider adapters** decisions.

## Acceptance criteria

- [x] The supervisor's interface covers start, send, steer, interrupt, stop, and subscribing to actions and turn boundaries
- [x] A Claude researcher started for a batch appears in the live panel with its role, batch and current action as a plain sentence
- [x] A redirection sent while the researcher works reaches it at its next tool step and changes what it does
- [x] The coordinator can stop a researcher mid-run, and the live panel shows it stopped
- [x] A researcher that finishes its assignment closes rather than sitting idle
- [x] Tests drive the supervisor with a fake CLI speaking Claude's stream protocol, with no real provider or quota

## User stories addressed

Reference by number from the parent PRD:

- User story 28
- User story 29
- User story 30
- User story 33
- User story 34
- User story 35
- User story 36
- User story 71
- User story 72
- User story 74
