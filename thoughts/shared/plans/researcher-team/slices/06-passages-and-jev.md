# Slice 06: Passages and Jev

**Type**: AFK
**Status**: To do

## Blocked by

- Slice 05: Readers and the cache

## What to build

The passage builder turns a document's chunks and flags into passages: widened, merged, capped with overlap, or the whole document when most is flagged, each with pages, line range and label.
The Jev client calls TypeSafe's endpoint with `jev-latest` and `TYPESAFE_API_KEY` from the app's environment; the sweep chunks a document, asks all questions per chunk, runs within the rate limits, retries with backoff, and flags at a threshold.
Each sweep records the sizes it let through and samples unflagged chunks to a reader to record misses.
Without a key, a sweep refuses plainly and the setup screen says so.
See **Passages and Jev**.

## Acceptance criteria

- [ ] The passage builder's widening, merging, cap with overlap, whole-document case, pages and labels
- [ ] The sweep's chunking, question batching, threshold, retry and recorded figures, with a fake client
- [ ] Unflagged samples go to a reader and misses are recorded
- [ ] A missing key refuses with a plain message
- [ ] One live check against TypeSafe runs only with the key, outside `npm run check`

## User stories addressed

Reference by number from the parent PRD:

- User story 21
- User story 22
- User story 23
- User story 24
- User story 68
- User story 69
- User story 70
