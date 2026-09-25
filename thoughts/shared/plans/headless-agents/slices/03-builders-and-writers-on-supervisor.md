# Slice 03: Graph builders and walkthrough writers on the supervisor

**Type**: AFK
**Status**: Not started

## Blocked by

- Slice 01: Steerable Claude researcher

## What to build

Graph builders and walkthrough writers launch through the supervisor instead of their own pool.
Feedback the human adds to a draft being built reaches the builder mid-run, both roles appear in the live panel, and a draft graph is shown only once it is ready with its tour.

## Acceptance criteria

- [ ] Feedback added to a draft under construction reaches the builder at its next step
- [ ] Builders and walkthrough writers appear in the live panel with plain-sentence actions
- [ ] The human never sees a draft graph change under them; it appears once, with its tour
- [ ] The separate graph builder pool is removed

## User stories addressed

Reference by number from the parent PRD:

- User story 31
- User story 37
- User story 38
- User story 39
