# Slice 03: Publishing findings

**Type**: AFK
**Status**: Done

## Blocked by

- Slice 02: Saving sources

## What to build

`weir.publish` publishes one finding with its evidence through the finding publisher.
Each quote is checked within its cited pages of the capture's text, after whitespace is normalized, across a page break when needed; it is marked checked, or transcribed for an image's transcription.
A finding can replace an earlier one in the same batch; a second replacement of the same finding is refused, naming its replacement.
Every post and publish carries a key from its seat and content, and a repeat is refused.
Published findings record their seat and are written into the library at once.
Each batch keeps a findings revision; graph work under way is sent a graph update when it rises, and stale drafts cannot be signed off or accepted.
Each reading of a PDF produces a text revision, and earlier revisions are kept; the library lists a document's revision and a session's read returns it.
A new revision rechecks every published quote citing the document: one that matches after whitespace is normalized needs nothing, and any other keeps its old wording as a recorded correction marked as not yet reconciled, for slice 07's reconciliation job.
See **Publishing findings**, **Text revisions and reconciliation** and **Graph work while findings change**.

## Acceptance criteria

- [x] A quote at its cited page passes and is marked checked; a real quote at the wrong page is refused
- [x] A quote across a page break and one with different whitespace pass
- [x] Transcribed evidence is marked transcribed
- [x] A replacement supersedes the old finding; a second replacement of it is refused with the replacement's name
- [x] A repeated publish is refused
- [x] A finding published or replaced during graph work sends the builder a graph update and makes the stale draft impossible to sign off or accept
- [x] Reading a cited PDF again keeps the earlier text revision; a published quote the new text still holds is checked in the new revision, and one it words differently keeps its wording, checked in the earlier revision and recorded as not yet reconciled
- [x] A board post, checkpoint or researcher finishing leaves a draft valid

## How it was built

- A published finding is a one-finding report in its batch, kept at once, so walkthroughs, graph work, the library and the interface read it as they read findings now.
  Its ID is the report's ID and the finding's, as `<report>/f1`, which is what a replacement names.
- A refused quote says where the quote is when it is on another page, and otherwise gives the nearest passage on the cited pages.
- Once a batch has a findings revision, the graph builder's inputs hold all of the batch's findings as they stand, not only those its walkthrough named.
- A paused graph job takes the update and stays paused.
- Every revision of a document's text, the current one included, is its own file in the library, `<id>.r<n>.txt`, which never changes once written.
  `documents.csv` names the current revision and its file, so a read gets the text of the revision it reports.
  A change to a document's text is always a new revision; slice 07's reconciliation must keep to that.
- A document records the conversion that made its current text, the reader and the time, apart from the progress of a later reading, so an earlier revision is recorded with what made it.
- A findings file says which revision each quote was checked in and names that revision's file, and says so when the document has been read again and words the passage differently.
  A quote refused because it comes from an earlier revision is refused with that explanation and the current revision's file.

## Left for later slices

- Board posts get their key in slice 04, when posting moves to `weir.post`.
- Evidence is marked as transcribed whenever its document is a transcription; saving one arrives in slice 07.
- The interface shows the checked and transcribed marks in slice 09; until then they are in the library's findings files and the project's data.
- The coordinator's result review and result.json stay until slice 04 removes them.

## User stories addressed

Reference by number from the parent PRD:

- User story 37
- User story 38
- User story 39
- User story 40
- User story 41
- User story 48
- User story 52
- User story 53
- User story 54
- User story 74
- User story 75
