# Slice 05: Readers and the cache

**Type**: AFK
**Status**: Done

## Blocked by

- Slice 01: Python session

## What to build

A reader role joins the dispatch settings, defaulting to Codex's Luna at high effort, falling back to the project's default agent at its cheapest model.
The reader runner starts the reader's CLI with no tools, sends one prompt, takes the final text and ends it.
`weir.reader` sends one prompt, or a batch of labelled passages packed whole into prompts of about 100,000 characters, and returns answers per passage.
Every reader call is cached on disk by model, question and input, shared by the project.
The app runs at most a set number of readers at once.
See **Depths and roles**, **Readers** and **The cache**.

## Acceptance criteria

- [x] A reader answers a batch of passages, per passage, with quotes and pages
- [x] Passages are never split between prompts
- [x] A repeated call returns its cached answer
- [x] Keys differ by model, question and input
- [x] The reader limit holds further calls in order

## How it was built

- The reader role's default is worked out from what the installed CLIs offer each time a reader starts, and is not written into the project's settings, so a new Luna is picked up without anyone changing anything.
  Without Codex, the cheapest model is found by its family name: Luna, Haiku, mini or nano.
  Where the default agent lists none of those, readers use the default as it is.
- Claude Code is started with no built-in tools, no MCP servers, the reader's instructions as its whole system prompt, and no saved session.
  Codex is started with its tool features off, and with a permission profile that reads only minimal system files and its own empty folder, writes nowhere and has no network, so anything it cannot be started without has nothing to act on.
- A reader runs beneath the app itself rather than under a host of its own, and ends with the app.
  Its folder is removed when it ends, and its log is kept only when it failed.
- `weir.reader(prompt)` returns the reply as text.
  `weir.reader(question, passages)` returns one answer for each passage, in the order given: `label`, `relevant`, `answer`, `quotes` and `cached`, with anything else the caller put in the passage, such as its document.
- A passage is its text, or its pages as `weir.library.read` gives them, which the reader sees under "[Page n]" lines.
  A passage longer than a reader takes is refused with its size; cutting long runs into passages is slice 06.
- Passages are packed in the order given, each prompt taking whole passages until the next would not fit.
- The app checks each quote against the passage, spacing aside, and marks it `found` or not.
  Where the passage has pages, the quote's page is the page the words are on, whatever the reader cited.
- An answer is cached per passage, by the reader's agent, model and effort, the question and the passage's text.
  So a call that repeats some passages and adds others sends only the new ones, and a passage's label is not part of its key.
  The effort is part of the key because a human who raises it expects new answers.
- Only an answer in the form asked for is cached.
  A passage whose reader failed, or whose reply could not be read, comes back with a `problem` in place of its answer, and is asked again on the next call.
  When no reader could run at all, the call raises the reason.
- A reader that meets its usage limit is ended and the caller told when the limit resets, rather than holding the researcher's code for hours.
  A reader that has not answered in fifteen minutes is ended.
- The reader limit is `readerLimit` in the research settings, twenty by default; its control in the interface is slice 09.
- A seat's readers, running or waiting, are dropped when its session ends, as its code runs are.
  Letting them finish through a pause comes with job tickets in slice 07, as does recording each reader batch as a job on disk.
- Readers are not yet shown in the live panel; that is slice 09.

## Checks

`npm run test:live-readers` runs real readers on Claude Code and on Codex, outside `npm run check`: a batch of fictional passages, a repeat from the cache, a reader asked to make a file, and a call from a real Python session.

## User stories addressed

Reference by number from the parent PRD:

- User story 25
- User story 26
- User story 27
- User story 63
- User story 64
- User story 65
- User story 67
