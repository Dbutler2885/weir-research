# Slice 05: Readers and the cache

**Type**: AFK
**Status**: To do

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

- [ ] A reader answers a batch of passages, per passage, with quotes and pages
- [ ] Passages are never split between prompts
- [ ] A repeated call returns its cached answer
- [ ] Keys differ by model, question and input
- [ ] The reader limit holds further calls in order

## User stories addressed

Reference by number from the parent PRD:

- User story 25
- User story 26
- User story 27
- User story 63
- User story 64
- User story 65
- User story 67
