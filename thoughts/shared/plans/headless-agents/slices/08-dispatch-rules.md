# Slice 08: Dispatch rules

**Type**: AFK
**Status**: Done

## Blocked by

- Slice 05: Headless coordinator

## What to build

Each project has a dispatch rules JSON document with the roles coordinator, researcher, graph builder, walkthrough writer and helper, all defaulting to the first CLI signed in with its own default model and effort.
The coordinator adds or updates entries through a command when the human states a preference, and names the agent, model and effort when starting a worker.
The settings view is rendered from the document; the human can add, change or remove any entry with menus listing every agent, model and effort available, and is told that more specific rules can be asked of the coordinator.
Codex models and efforts come from `codex debug models`.
See **Dispatch rules**.

## Acceptance criteria

- [x] A new project's rules use one CLI and its defaults for every role
- [x] A preference stated in the conversation becomes a visible entry in settings
- [x] The human can add, change and remove entries from settings menus
- [x] Menus list only models the installed CLIs offer
- [x] A malformed rule is refused with a clear message
- [x] A helper role exists for small tasks

## User stories addressed

Reference by number from the parent PRD:

- User story 12
- User story 13
- User story 14
- User story 15
- User story 16
- User story 17
- User story 18
- User story 19
- User story 20
- User story 73
