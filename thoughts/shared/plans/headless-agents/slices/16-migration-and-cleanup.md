# Slice 16: Migration and cleanup

**Type**: AFK
**Status**: Done

## Blocked by

- Slice 05: Headless coordinator
- Slice 03: Graph builders and walkthrough writers on the supervisor

## What to build

Existing projects convert in place when first opened.
Paused native-route work stays paused and resumes through the new workers.
The researcher pool, the claim-based coordinator checkpoint and publish paths, and the researcher allowlist are removed once no project depends on them.
See **Migration** and **Remove the native route**.

## Acceptance criteria

- [x] An existing project opens and works after conversion with nothing lost
- [x] Paused native-route investigations resume through app-launched workers after approval
- [x] The old pools, claim paths and allowlist are gone, and `npm run check` passes

## User stories addressed

Reference by number from the parent PRD:

- User story 9
