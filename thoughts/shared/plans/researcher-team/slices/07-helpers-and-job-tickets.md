# Slice 07: Helpers and job tickets

**Type**: AFK
**Status**: Done

## Blocked by

- Slice 04: The team and the done phrase
- Slice 05: Readers and the cache

## What to build

`weir.helper` sends a helper, an agent with the web, the research browser, its own Python session and the library but no board or publishing, on an errand and returns a handle.
Every helper, reader batch and code run is a job recorded on disk when accepted, with its own ticket allowing what its role allows; pausing revokes only the researcher's lease, and stopping revokes everything.
A helper's full answer goes into the researcher's session under its handle with a one-line notice, which wakes an idle researcher; notices are held while a seat is paused.
After a restart, queued jobs start in order, interrupted readers run again, and an interrupted helper is taken back or started again once.
Helpers can save the research browser's page and an image with a transcription.
The reconciliation job runs on the same machinery: when a new text revision changes cited text, the app starts one job per affected page, which decides between the old wording, the new, or its own transcription from the page image, and the app applies it to the text, the quotes and, where the meaning changes, the finding.
It also settles the corrections slice 03 left marked as not yet reconciled, and a researcher can ask for it through the session.
See **Depths and roles**, **Pausing and stopping**, **The Python session** and **Text revisions and reconciliation**.

## Acceptance criteria

- [x] A helper's answer reaches the researcher who sent it, as a variable and a one-line notice
- [x] A helper saves a source after its researcher is paused; code started before a pause publishes after it
- [x] Answers and output arriving after a stop are dropped, and saved sources remain
- [x] A finished answer is delivered once across a restart; a queued helper starts after it
- [x] An interrupted helper starts again once and fails the second time; a seat whose only outstanding job failed can finish
- [x] The helper limit holds further helpers in order
- [x] A reread that changes a cited passage is reconciled without the human: the right wording is kept, corrected or transcribed, a finding whose meaning changes is replaced, and the decision is recorded with its reason
- [x] A correction is reused by a later revision where its place still matches, and placed again where it does not
- [x] Researchers who read the document get a one-line notice of the new revision

## How it was built

### Jobs and tickets

- A helper is recorded in its seat's folder, under `jobs/`, when the app accepts it, before its handle is returned, with a ticket that is not the researcher's lease.
  Its handle is `h1`, `h2` and so on within the seat.
- What the researcher's session reads of a helper, its status and its answer, is a file beside the session's variables, written before the notice is sent.
  The notice has an ID of its own in the seat's inbox, so it is delivered once however often it is put there.
- A code run keeps the ticket it was accepted on until it ends: its calls to the app are made though its researcher has since been paused or switched, and are refused only once the seat is stopped.
  New code from a paused or switched researcher is refused, as before.
- A seat's Python session now outlasts a pause or a switch, and ends when the seat finishes, the team is stopped or the batch closes.
  The next researcher on the seat takes the session over as it is, with whatever is running in it.
- Output of a run whose researcher has gone goes to the seat's inbox, for whoever holds the seat next.
- A batch of readers is recorded while it runs and removed when it answers.
  One found at a restart runs again, so its answers are in the cache when the code asks again; nobody is waiting for it, since the run that asked ended with the app.
- A helper found running at a restart is taken back if its process outlived the app, which it does when the human quits and keeps workers running.
  Otherwise it starts again once, and fails the second time; a helper whose process ends while the app runs is treated the same way.
- Helpers and readers use the cheap default, Codex's Luna at high effort, unless the human chooses.
  The coordinator's own helpers share the helper role, so they use it too.

### Helpers

- A helper's session may save sources, sweep with Jev, call readers and ask for a page to be reconciled; posting, publishing and sending helpers are refused in words that say what it can do instead.
- A helper has the web only when its batch has, as its researcher does, and it keeps page retrieval.
- A helper answers with JSON: its answer and its quotes, each with the document and page.
  The app marks each quote as found or not in the saved text, as publishing will check it; a plain reply is taken as the answer with no quotes.
- A helper that ends its turn while code of its own is still running is not taken to have answered; the run's output starts its next turn.

### Saving from the browser, and images

- `weir.save_page(url)` saves the tab open at that address as it shows in the research browser: its text as displayed, and the page itself as the original.
  It is always a fresh capture, and one showing the same text as an earlier capture of the address gives that one.
- `weir.save_image(source, transcription)` keeps an image from an address or from the agent's own folder, with the transcription as its text, marked as transcribed.
- Researchers can use both as well as helpers.

### Reconciliation

- When a document read again has a new text, the app first puts back the earlier corrections whose place still matches: the wording the reader gave is there, with the same text before it.
  That is a revision of its own, after the reading's.
- One job then runs for each page that still has a quote the text no longer holds, on the helpers' machinery, with the helper role's model.
  Its folder holds the page's current text, its text when the quotes were checked, the page drawn as a picture, the quotes with their findings, and the corrections made to the page before.
- For each quote the job decides: the earlier wording was right, the new reading is, neither and it transcribes the passage, or the page does not settle it.
  For a change to the text it names the fewest words that are wrong and what the page says in their place.
- The app applies all the pages' decisions as one corrected revision, and checks each: the words to replace must be in one place on the page, and the quote as it will read must be in the corrected text at its pages.
  A decision that does not hold is not applied, the quote keeps its wording, and the record says why.
- A finding is replaced when the job says the change alters what it says and gives the finding as it should now read.
  It stays the work of the seat that published it, raises the batch's findings revision, and sends graph work under way back for revision.
  In a closed batch the finding is not replaced; the record says what it should now read.
- Each correction is kept with the document: the page, the wording before and after, the text on either side, the decision and its reason.
  The library lists them in `documents/corrections.json`, which `weir.library.corrections(id)` reads.
- A quote the page did not settle is not sent to be reconciled again by later readings; a researcher can ask for the page with `weir.reconcile(document, page, problem)`.
- Corrections left waiting, by slice 03 or by a round the app closed on, are picked up when the app opens.
- Every seat that is running or paused is told of a new revision in one line; the app does not know which researchers read the document, and a finished seat is not woken for it.

## Review fixes

- A helper's notice is recorded with its answer and marked once it is in the seat's inbox, so a restart between the two still sends it, once.
- A batch of readers the app closed on keeps its record until it has answered, however many restarts that takes; when it answers, its seat is told, so a researcher waiting on it wakes.
- Readers picked up after a restart are ended when their batch's team is stopped.
- The researcher pool leaves alone the sessions of helpers and of the app's own tasks; it had been closing the reconciliation job's session within two seconds.
- A run's calls are made from the folder of the agent that started it, though the seat has since passed to another's.
- An image file is opened once, read from that opening, and checked to be the file in the agent's folder, so a link put in its place meanwhile is not followed.
- The corrected text is built from the changes that stand, and every quote is checked against that text; a decision that does not hold is set aside and the text built again, until what is left agrees.
- A correction is put back only in its own place: where the text before it on the page matches.
- With no words given to put in their place, the earlier wording goes back whole only where the words named are as many as the quote's.
- A finding changed by two pages' decisions is replaced once: a reader puts the versions together, and without one the first stands.
- The job is given the page and the one after it, and a correction can fall on either, since a quote can run over the end of its page.
- A researcher's request reopens the quotes that page did not settle, and a quote the resulting correction unsettles is reconciled in a further pass, up to three.

## Checks

`npm run test:live-helper` sends a real helper on an errand on each CLI, and `npm run test:live-reconcile` has a real model reconcile a scanned page against its picture.
Both run outside `npm run check`.

## Known limitations

- The Firefox capture for `weir.save_page` is written but was not run here: no Firefox is installed on this machine, so the integration check covered Chromium only.
- A reconciliation job waits out a usage limit, as a helper does, so a document's quotes can stay unreconciled for hours.
- The check on an image file's path was tested against links that lead out of the folder, not against a link swapped in at the moment of reading.
- The live panel shows helpers as it shows other agents; arranging them under their seats is slice 09.

## User stories addressed

Reference by number from the parent PRD:

- User story 28
- User story 29
- User story 30
- User story 31
- User story 33
- User story 34
- User story 35
- User story 36
- User story 62
- User story 66
