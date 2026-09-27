# Slice 05: Headless coordinator

**Type**: AFK
**Status**: Done

## Blocked by

- Slice 04: Sandbox and isolation

## What to build

The app starts a fresh coordinator whenever it opens a project, from the coordinator context PRD's startup context, in the app's own agent folder with the same sandbox as workers and no agent-spawning tools.
Conversation messages, finished turns and other events are sent to it as messages that arrive at its next step, even mid-turn, replacing the wait and acknowledge commands.
The live panel shows what the coordinator is doing from its stream.
See **Remove the native route** and **The coordinator host**.

## Acceptance criteria

- [x] Opening a project starts a coordinator with no terminal involved, and reopening starts a fresh one
- [x] A note sent while the coordinator is mid-turn reaches it at its next step
- [x] The live panel shows the coordinator's current action from its stream
- [x] The coordinator has no agent-spawning tools and cannot start agents from its shell
- [x] The wait and acknowledge commands are removed
- [x] Tests cover fresh start on opening and events delivered as messages

## User stories addressed

Reference by number from the parent PRD:

- User story 21
- User story 22
- User story 23
- User story 24
- User story 25
- User story 26
- User story 27
