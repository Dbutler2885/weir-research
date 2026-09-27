# Slice 11: Research browser

**Type**: AFK
**Status**: Done

## Blocked by

- Slice 04: Sandbox and isolation

## What to build

The app manages one research browser, driving the installed Google Chrome through Chrome DevTools MCP with its own profile separate from the human's browsers.
The human signs in to archives once and every worker gets its own window or tab.
If shared sessions prove unreliable, per-agent profiles are the fallback.
See **Research browser**.

## Acceptance criteria

- [x] Workers reach the research browser from inside their sandbox
- [x] A sign-in made once is available to every worker
- [x] Each worker uses its own window or tab
- [x] The human's own browser profiles are never touched
- [x] An integration test covers the shared profile, per-worker windows and separation

## User stories addressed

Reference by number from the parent PRD:

- User story 51
- User story 52
- User story 53
- User story 75
