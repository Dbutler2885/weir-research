# Slice 02: Saving sources

**Type**: AFK
**Status**: Done

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

- [x] An HTML page and a PDF save as library documents with pages
- [x] A repeated URL returns the existing capture; a fresh capture deduplicates by content
- [x] A failing URL and a page without readable text return plain errors
- [x] A researcher has no WebFetch, and can still search the web
- [x] Researchers cannot change the library except through the app

## How it was built

- A web page keeps all the text in its downloaded HTML, in order, rather than a guess at its main article, so a quote from any part of the page can be found in the saved text.
  This is the page's static text; what a browser would draw with scripts or hide with styles belongs to a capture from the research browser.
- The app keeps, for each address, the capture that shows it as last seen, which a repeated save returns; this is an earlier capture when the page has gone back to earlier content.
- A fresh capture of a page is compared with earlier captures by its text, since many pages differ in their bytes on every visit; a PDF is compared by its bytes.
- A saved PDF is read with the chosen PDF reader, or with Standard while High accuracy is not installed, ahead of the documents waiting to be read.
- Running code reaches the app through call files in the session's folder, and a call is made only while the lease its run was sent with is still the seat's.

## Known limitation

A researcher's shell still reaches the web, so a researcher could download a page there instead of saving it.
The instructions in slice 08 point researchers to `weir.save`.

## User stories addressed

Reference by number from the parent PRD:

- User story 17
- User story 18
- User story 19
- User story 20
- User story 55
- User story 72
