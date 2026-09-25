# Slice 11: Research browser

**Type**: AFK
**Status**: Not started

## Blocked by

- Slice 04: Sandbox and isolation

## What to build

The app manages one research browser, driving the installed Google Chrome through Chrome DevTools MCP with its own profile separate from the human's browsers.
The human signs in to archives once and every worker gets its own window or tab.
If shared sessions prove unreliable, per-agent profiles are the fallback.
See **Research browser**.

## Acceptance criteria

- [ ] Workers reach the research browser from inside their sandbox
- [ ] A sign-in made once is available to every worker
- [ ] Each worker uses its own window or tab
- [ ] The human's own browser profiles are never touched
- [ ] An integration test covers the shared profile, per-worker windows and separation

## User stories addressed

Reference by number from the parent PRD:

- User story 51
- User story 52
- User story 53
- User story 75
