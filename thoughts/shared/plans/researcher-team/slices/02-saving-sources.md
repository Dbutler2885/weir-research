# Slice 02: Saving sources

**Type**: AFK
**Status**: To do

## Blocked by

- Slice 01: Python session

## What to build

`weir.save` saves a URL as a library document through the app: the app downloads it outside any sandbox, converts HTML to readable text, sends a PDF through the existing PDF text extraction, and registers the source.
Every capture keeps its own ID and never changes; a repeated URL returns the existing capture unless a fresh one is asked for, and a fresh capture with identical content returns the earlier one.
A failed download or a page with no readable text returns a plain error.
Saved documents appear in the library at once.
Researchers lose WebFetch in Claude Code and keep web search.
See **Saving sources**.

## Acceptance criteria

- [ ] An HTML page and a PDF save as library documents with pages
- [ ] A repeated URL returns the existing capture; a fresh capture deduplicates by content
- [ ] A failing URL and a page without readable text return plain errors
- [ ] A researcher has no WebFetch, and can still search the web
- [ ] Researchers cannot change the library except through the app

## User stories addressed

Reference by number from the parent PRD:

- User story 17
- User story 18
- User story 19
- User story 20
- User story 55
- User story 72
