# Slice 14: Queue controls

**Type**: AFK
**Status**: Not started

## Blocked by

- Slice 05: Headless coordinator
- The coordinator context PRD's queue

## What to build

The human can move a batch up or down the queue and hold it, building on the queue from the coordinator context PRD.
The coordinator's instructions default to at most four workers at once, a Research setting changes that, and the human can ask for more for a particular job.
Blocked also by the coordinator context PRD's queue.
See **Concurrency and the queue**.

## Acceptance criteria

- [ ] The queue shows batches in order with status
- [ ] Moving and holding a batch changes what the coordinator runs next
- [ ] The worker default is a Research setting, passed to the coordinator
- [ ] A request for more workers on one job is honored

## User stories addressed

Reference by number from the parent PRD:

- User story 42
- User story 43
- User story 44
- User story 45
- User story 46
- User story 47
