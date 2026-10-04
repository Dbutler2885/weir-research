# Slice 06: Passages and Jev

**Type**: AFK
**Status**: Done

## Blocked by

- Slice 05: Readers and the cache

## What to build

The passage builder turns a document's chunks and flags into passages: widened, merged, capped with overlap, or the whole document when most is flagged, each with pages, line range and label.
The Jev client calls TypeSafe's endpoint with `jev-latest` and `TYPESAFE_API_KEY` from the app's environment; the sweep chunks a document, asks all questions per chunk, runs within the rate limits, retries with backoff, and flags at a threshold.
Each sweep records the sizes it let through and samples unflagged chunks to a reader to record misses.
Without a key, a sweep refuses plainly and the setup screen says so.
See **Passages and Jev**.

## Acceptance criteria

- [x] The passage builder's widening, merging, cap with overlap, whole-document case, pages and labels
- [x] The sweep's chunking, question batching, threshold, retry and recorded figures, with a fake client
- [x] Unflagged samples go to a reader and misses are recorded
- [x] A missing key refuses with a plain message
- [x] One live check against TypeSafe runs only with the key, outside `npm run check`

## How it was built

- A chunk is about 4,000 characters, cut at line ends: small pages share a chunk, a long page is several, and only a line longer than a chunk is itself cut, at a space.
  Each chunk knows its pages and lines, so every passage says where it starts and ends, and its label is that range: "doc-1, page 11 line 1 to page 13 line 1".
- A passage is in the form `weir.reader` takes: its text page by page.
  The sweep adds the questions that flagged it and the highest probability in it.
- "Most of the document" is more than half of its chunks.
  The whole document then comes back as consecutive passages with nothing shared between them; a run cut at the cap shares one chunk across each cut.
- `weir.jev(document, questions, threshold=0.3)` returns the passages with the sweep's figures: chunks, chunks flagged, characters in the document and characters let through.
  Questions are a list, or a dict of name to question, up to twenty in one sweep.
- Each answer is cached per chunk and per question, so a repeated sweep costs nothing and a sweep with one new question asks only that one.
  The cache is keyed under `jev-latest`; when TypeSafe moves that alias to a new model, earlier answers are still returned.
- TypeSafe publishes 80 requests and 100,000 tokens a second and says both may change without notice.
  The sweep stays at 60 requests and 80,000 estimated tokens a second with at most 32 requests under way, and a request that is told to wait holds the others back too.
- A request is tried again on 408, 429, any 5xx and a failed connection, up to six times, waiting half a second and doubling to thirty, or as long as TypeSafe's `retry-after` says.
- The totals are kept in the project's state as `jevFigures`; each sweep and each sample is also written in detail to `jev/sweeps.jsonl` in the project's folder.
  Showing them in Research settings is slice 09.
- Three chunks the sweep passed over, chosen at random, go to one reader with the same questions.
  The sweep does not wait for them, and nothing is sampled when the whole document went through.
- The human gives the key as `TYPESAFE_API_KEY` in the environment of whatever starts the app.
  Whatever starts one of the app's services first moves the key into a file of the app's own, `typesafe-key` in the app's folder, readable only by the human's account, and takes it out of the environment.
  The services read the file.
  Deleting the variable inside a running service is not enough: on macOS a process's first environment can be read by other processes, such as with `ps`, for as long as it runs, so the services are started without the key in theirs.
  No agent's sandbox reaches the app's folder, as the isolation checks confirm for the Codex sign-in kept beside it.
- A key with a space or line break in it is not a key, and is not kept.
  A failed connection is reported by its kind only, since its own words can hold the request, key and all.
- The setup screen has a row for the key, saying whether it is set and how to set it; it shows only whether there is one.

## Checks

`npm run test:live-jev` sweeps a fictional ledger with TypeSafe's real API, outside `npm run check`, and is skipped without the key.
On 2026-10-03 it swept 110,000 characters in 28 chunks in under a second, for about 36,000 input tokens, and found the one page that mattered.

## Review fixes

- Passages cut from one very long line have the same line range, so each also says which part it is.
- Blank stretches inside a document stay in its passages; Jev is not asked about a chunk with nothing in it.
- The document's size and the size let through are both counted over the document's own text, page by page.
- A wait that TypeSafe asks for also delays requests already waiting their turn, and a retry cannot take a place beyond the limit of requests under way.
- What the answered requests cost is recorded even when another request fails the sweep.
- Questions too long for one reader's question are sampled in turns, and a chunk is counted once.

## Known limitations

The app has the key once it has been started from a shell that has it; after that it keeps it, and a start from a shell without it still finds it.
To stop the app using a key, delete `typesafe-key` from the app's folder.
A service run by hand as `node server/main.mjs` with the key in its environment keeps the key in its first environment for as long as it runs; `npm start` and the workspace commands do not.

## User stories addressed

Reference by number from the parent PRD:

- User story 21
- User story 22
- User story 23
- User story 24
- User story 68
- User story 69
- User story 70
