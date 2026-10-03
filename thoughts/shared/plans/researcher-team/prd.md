# Researcher team

Status: drafted 2026-10-03 from a design discussion with the human, on the experimental branch `researcher-team`.
It replaces the researchers on assignments PRD's division of a batch into coordinator-written assignments.
It keeps the research library, the board, and the controls for pausing, resuming and switching running agents.

## Problem Statement

The human asks for research and gets back findings that say, in effect, "we did not find what you were looking for".
When the human sends researchers back at the same question, they come back with more, so the material was there and the researchers stopped early.

The app tells them to stop.
A researcher is "a bounded research investigator" limited to 20 source retrievals and a time limit, told to finish when its bounded assignment is complete, and offered "unresolved" as a normal way to finish.
Nobody holds the human's actual goal: each researcher holds a slice, the coordinator reconciles slices, and only the human notices that the goal was not met.

The coordinator also decides too much.
It divides a batch into assignments before anyone has searched, and writes each researcher's scope, including what is out of scope.
Research like this is a search of a space whose shape is learned by searching it, and the lead that matters often crosses a line drawn in advance.
A researcher never sees the human's words, only the coordinator's brief.

Finally, a researcher reads every source it opens into its own context.
Twenty documents in one context is exactly the kind of growing, cluttered context that makes a model worse as it works.

## Solution

A batch is worked by a team of researchers, four by default, who share one goal and organize themselves.

The coordinator opens a batch with the human's goal, restated plainly, and the app starts the team on it.
There are no assignments, no briefs and no scope.
Each researcher reads the goal and the board, posts what it means to try first, and adjusts to what the others post.
Every post on the board reaches every teammate.

A researcher does not read sources into its own context.
It works the way a Recursive Language Model does: the material lives outside its context, in files and in variables, and it writes code to look at it and to hand pieces of it to cheaper models.

- Each researcher has its own Python session, held by the app, whose variables last for the life of the batch: across steps, pauses, model switches, and restarts of the app.
- Sources are saved as text in the project's library by whoever reads them, so the whole team shares one copy and every quote can be checked.
- Jev, TypeSafe AI's typed-decision model, sweeps a long document cheaply with yes-or-no questions and finds the passages likely to matter.
- A reader is a single prompt and response from a cheap model: a passage or several in, a short structured answer out, into a variable rather than into the researcher's context.
- A helper is a smaller researcher, an agent with its own context, the web and the research browser, sent on errands such as searching an archive; it saves what it reads, and its answer goes into the researcher's session, with a one-line notice to the researcher.

These are tools, not a procedure: the researcher decides how to break its work down and which tools to use.

A researcher publishes each finding as it makes it.
The app checks that every quote appears in the saved text, and the finding appears to the human at once.
Researchers produce findings and nothing else: no report, and no finding that only says nothing was found.

There is no retrieval limit and no time limit.
A researcher that has nothing left to pursue says a fixed done phrase and stops.
A later post on the board wakes it, and it either takes up what the post offers or says the phrase again.
When every researcher on the team has said it, the batch is ready for Review.
The human can stop the team, or tell the coordinator to keep going, at any time.

The coordinator talks with the human, opens batches, and moves the project between stages.

## User Stories

1. As a human, I want to say what I want researched in the conversation, so that I do not fill in forms.
2. As a human, I want the coordinator to restate my goal plainly when it opens a batch, so that the researchers work from a clear statement of what I asked.
3. As a human, I want to see the goal the researchers were given, so that I can correct it if the coordinator misread me.
4. As a human, I want a team of researchers to start on a batch as soon as it opens, so that research begins without further steps.
5. As a human, I want to set the team's size in Research settings, so that I control cost and the load on my machine.
6. As a human, I want four researchers by default, so that a new project works well without settings.
7. As a researcher, I want the whole goal rather than a slice of it, so that I can follow any lead that serves it.
8. As a researcher, I want no out-of-scope list, so that I can follow a lead wherever it goes when it serves the goal.
9. As a researcher, I want to post my opening plan on the board and read my teammates' plans, so that we spread out instead of repeating each other.
10. As a researcher, I want every teammate's post delivered to me while I work, so that I learn of a source found or ruled out without looking.
11. As a researcher starting or resuming later, I want the board's earlier posts in the library, so that I start from what the team has learned.
12. As a researcher, I want a Python session whose variables persist between my steps, so that I can build on earlier results without saving and reloading them.
13. As a researcher, I want my session's variables, as of my last completed run, to survive being paused, switched to another model, woken by a post, or the app restarting, so that I never redo finished work.
14. As a researcher, I want only what my code prints to enter my context, so that large material never crowds it.
15. As a researcher, I want long-running code to keep running and report back as a message when it finishes, so that I am not blocked by a slow step.
16. As a researcher, I want to read any library document's text into a variable, page by page, so that I can work with it in code.
17. As a researcher, I want to save a web page or PDF into the library with one call, so that the team shares it and its quotes can be checked.
18. As a researcher, I want saving a source a teammate already saved to give me the existing document, unless I ask for a fresh capture, so that the team keeps one copy of each source.
19. As a researcher, I want a fresh capture whose content is identical to an earlier one to return that earlier capture, so that the library holds no duplicates.
20. As a researcher, I want sources my teammates save to appear in the library at once, so that I can use them too.
21. As a researcher, I want to sweep a long document with several yes-or-no questions using Jev and get back the passages likely to matter, so that I find the relevant parts cheaply.
22. As a researcher, I want flagged chunks widened by their neighbours and merged into passages, so that text crossing a chunk boundary is not lost.
23. As a researcher, I want passages capped at the size a reader handles well, so that one passage never grows to the whole document.
24. As a researcher, I want a document read whole when most of it is flagged, so that filtering does not waste effort when it cannot help.
25. As a researcher, I want to send passages to readers in batches, each passage labelled, and get answers per passage, so that every quote comes back with its page.
26. As a researcher, I want readers to return structured answers into variables, so that I can filter, count and join them in code.
27. As a researcher, I want a repeated Jev or reader call to return its earlier answer at no cost, so that re-running code never pays twice.
28. As a researcher, I want to send a helper on an errand, such as searching an archive or a database through the research browser, so that messy browsing happens in another context.
29. As a researcher, I want to send several helpers at once and keep working, so that I am never blocked waiting.
30. As a researcher, I want each helper's full answer kept in my session and only a one-line notice sent to me, so that helper answers do not crowd my context.
31. As a researcher, I want a helper's notice to wake me if I have ended my turn, so that I can wait for answers without polling.
32. As a researcher, I want the tools described rather than a procedure prescribed, so that I choose how to break down each task.
33. As a helper, I want the same session, library and tools as a researcher, except the board and publishing, so that I can do real research on my errand.
34. As a helper, I want to save every source I read, including the page open in the research browser, so that the researcher who sent me can cite it.
35. As a helper, I want to save a scanned image with my transcription of it, so that a record with no text can still be cited.
36. As a helper, I want to call readers but not other helpers, so that the work stays bounded.
37. As a researcher, I want to publish a finding as soon as I have its evidence, so that the human and my teammates see it at once.
38. As a researcher, I want a finding refused with a clear reason when a quote does not appear in the saved text, so that I can fix it.
39. As a researcher, I want to correct an earlier finding, mine or a teammate's, by publishing one that replaces it, so that the findings stay right.
40. As a researcher, I want a replacement of a finding that was already replaced refused with the name of its replacement, so that two of us never replace the same finding at once.
41. As a researcher, I want a quote checked at the page I cite, so that a real quote with a wrong page is caught.
42. As a researcher, I want no retrieval limit and no time limit, so that I stop when the leads are spent rather than when a budget is.
43. As a researcher, I want to say a fixed phrase when I have nothing left to pursue, so that the app knows I have finished.
44. As a researcher, I want to be told when I say the phrase while my helpers, readers or code are still running, and to stay at work until they finish, so that their results are not lost.
45. As a researcher, I want a nudge when I end my turn with nothing pending and without the phrase, so that I do not sit idle by mistake.
46. As a researcher, I want a new board post to wake me after I have finished, so that I can take up a lead a teammate found.
47. As a researcher who was paused, I want the posts I missed delivered as one message when I am resumed, so that I catch up at once.
48. As a researcher, I want code interrupted by a restart reported as interrupted rather than run again, so that nothing is posted or published twice.
49. As a researcher, I want to ask the human for access to a source, as researchers do now, so that a sign-in does not end the search.
50. As a human, I want to see each finding as soon as it is published, so that I can follow the research while it happens.
51. As a human, I want a batch's findings as one list, newest first, each showing which researcher found it, so that I read the team's work as one body.
52. As a human, I want every quote checked by the app against the saved text at its cited page, so that I can trust quotes without a coordinator in between.
53. As a human, I want a checked quote marked as checked, apart from whether it supports the finding, so that I know which part the app verified and which is the researcher's claim.
54. As a human, I want evidence taken from a transcribed image marked as transcribed, so that I know the app could not check it against the original.
55. As a human, I want to open the saved text or image of any cited source, so that I can read a quote in context.
56. As a human, I want the batch to move to Review on its own when every researcher has finished, so that I do not wait for anyone to announce it.
57. As a human, I want to tell the coordinator to keep going, and have it wake the whole team, so that I can send them back at a goal without restating it.
58. As a human, I want to tell the coordinator to stop a batch, so that I can end research I no longer want.
59. As a human, I want stopping a batch to end its researchers, helpers, readers and running code, and anything that arrives afterwards dropped, so that a stopped batch stays stopped.
60. As a human, I want to pause, resume and switch the model of any one researcher, as I can now, so that I keep control of each agent.
61. As a human, I want board posts never to wake a researcher I paused or stopped, so that my controls win over the team's activity.
62. As a human, I want a paused researcher's helpers and running code allowed to finish, including saving sources and publishing findings, with their results held until I resume it, so that pausing loses nothing.
63. As a human, I want to choose the agent, model and effort for researchers, helpers and readers separately in the settings, so that I can spend where it matters.
64. As a human, I want helpers and readers to default to Luna at high effort, so that heavy reading costs little without my setting anything.
65. As a human, I want everything to run on my existing Claude Code and Codex sign-ins, so that I need no API keys beyond TypeSafe's.
66. As a human, I want to see in the live panel each researcher, what it is doing, and its helpers and readers, so that I know what is running.
67. As a human, I want a limit on how many helpers and how many readers run at once across the project, so that a fan-out cannot swamp my machine or my plans' quotas.
68. As a human, I want to see how much text Jev let through and how much it missed in samples, so that I can judge whether it is worth using.
69. As a human, I want my TypeSafe key to stay with the app, never in an agent's sandbox, so that no agent can read or leak it.
70. As a human, I want the app to tell me plainly when the key is missing or rejected, so that I can fix it.
71. As a human, I want researchers' Python sessions confined as strictly as the researchers themselves, so that their code cannot read my files or reach the internet.
72. As a human, I want researchers unable to change the library except through the app, so that one researcher cannot damage shared research.
73. As a human with an existing project, I want past batches and their passes kept as history, so that nothing I have is lost.
74. As a human, I want walkthroughs and graph updates to work from a batch's published findings, so that the later stages carry on as they do now.
75. As a human, I want graph work revised whenever its batch's findings change before I decide on the draft, and a stale draft impossible to sign off or accept, so that I never accept a graph built on findings that have since changed.
76. As a human, I want to rerun past batches that came back empty-handed and compare the results, so that I can judge whether this design is better before it is merged.
77. As a coordinator, I want to open a batch with a title and a plain goal, so that the team starts without my dividing the work.
78. As a coordinator, I want to post on a batch's board, waking the whole team, so that I can pass on something the human said or send the team back to work.
79. As a coordinator, I want news of each published finding, each board post and each researcher finishing, so that I can answer the human.
80. As a coordinator, I want to stop a batch's team when the human asks, so that the human's word ends the work.

## Implementation Decisions

### The team

- A batch has a goal in place of a brief: the coordinator's plain restatement of what the human asked for, up to a few thousand characters.
- A batch gets one researcher seat per place in the team, created when the batch opens, from the human's team size setting (the existing researchers-per-batch setting, default four).
- A seat reuses the assignment record and everything built on it: the lease, the saved session, checkpoints, pausing, resuming, switching agent or model, and access requests.
  Its title is the researcher's name in the team, such as "Researcher 2".
  Coordinator-written briefs, steering and sending a pass back are removed.
- A seat's statuses are waiting, running, finished, paused and stopped.
  The returned and published statuses no longer arise for seats, because findings are published as they are made.
- The batch's status follows its seats: running while any seat runs or waits, and ready for Review when every seat has finished.
  A finished seat that is woken makes the batch running again and leaves Review until it finishes.

### The done phrase

- A researcher finishes by ending its turn with the exact line `RESEARCH DONE`.
- The pool reads it from the turn's final text, which the supervisor already reports.
- The seat is finished only when it has said the phrase and nothing of its own is outstanding: no helper, reader or code run under way, and no notice or post waiting to be delivered to it.
  If the researcher says the phrase while work is outstanding, the app tells it what is outstanding and keeps the seat running; each result's notice wakes it as usual.
- A turn that ends without the phrase, with nothing outstanding, gets one nudge: carry on, or say the phrase.
  A seat that ignores the nudge stays running and idle, and the live panel shows it as idle.
- The phrase is not a post and carries no report.

### The board

- Every post on a batch's board is delivered to every other running or finished seat in the batch: as a message at its next step if it is working, and as a new turn if it is idle.
- A post wakes every finished seat, which resumes its saved session with the post as its message.
- A post never wakes a paused, waiting or stopped seat.
  A paused seat receives the posts it missed, as one message, when the human resumes it.
- The coordinator's post does the same, which is how "keep going" reaches the team.
- There are no direct messages between researchers.

### Pausing and stopping

- The human's controls take precedence over the team's activity.
- Pausing a seat stops its researcher's process and keeps its session; its helpers, readers and code runs are allowed to finish, and their results and notices are held until the seat resumes.
- Every helper, reader batch and code run gets its own job ticket when the app accepts it, before it starts, tied to its seat but separate from the researcher's lease; a job queued before a pause can therefore still start and finish during it.
  Pausing or switching a seat revokes only the researcher's lease, so the old researcher process can no longer act, while jobs already accepted keep their tickets until they finish.
  A ticket allows exactly what its job's role allows: a code run in a researcher's session can do anything the researcher can, including posting and publishing; a code run in a helper's session and a helper itself can save, read and call readers, but not post or publish; a reader has no tools, so its ticket only lets the app run it.
  Stopping a batch revokes every lease and job ticket under it.
  A job's ticket ends when the job does.
- Stopping a batch ends its seats' researchers, helpers, readers and code runs at once, and ends their Python sessions.
  A result that arrives after the stop is dropped, except sources already saved to the library.
- Notices, held results and missed posts are kept on disk in each seat's inbox, so they survive a restart of the app and are delivered once.

### Depths and roles

- There are three depths, each a role in the dispatch settings with its own agent, model and effort menus.
- Researcher: the root, one per seat, on the project's default unless set otherwise.
- Helper: an agent a researcher sends on an errand, with the web, the research browser, its own Python session and the same library, but without the board or publishing.
  A helper can call readers but not helpers.
- Reader: one prompt and one response, with no tools and no access to files, the web or the library; it sees only what is passed to it.
  A reader's input is held to about 100,000 characters.
- Helpers and readers default to Codex's Luna model at high effort; where Codex is not installed they fall back to the project's default agent at its cheapest listed model.
- All three run on the human's existing Claude Code and Codex sign-ins through the supervisor; nothing needs a model API key.
- The app runs at most a set number of helpers and a set number of readers at once across the project, eight helpers and twenty readers by default, adjustable in Research settings; further calls wait in order.

### The Python session

- Each researcher seat and each helper has a Python session: a long-running Python process the app starts, owns and keeps, separate from the agent's own process.
- It uses the Python environment the app already manages for PDF conversion, extended with the session's own package.
- The agent sends code to its session with its command tool and receives what the code prints, truncated beyond a fixed length with a note saying so.
  Code that runs longer than a few minutes keeps running; the tool returns at once with a note, and the output arrives later as a message.
- After every completed run the session saves its variables to the seat's folder with dill, and a new session loads them back.
  The guarantee is the variables as of the last completed run, across pauses, model switches, wakes and restarts of the app.
  Values that cannot be saved are skipped and named in the run's output.
- A run interrupted by a restart is never replayed.
  The researcher is told it was interrupted and that its variables are as of the run before.
- Every post and publish carries a key made from its seat and content, and the app refuses a repeat of a key it has already accepted, so a re-run never posts or publishes twice.
- Every helper and reader call is recorded on disk as a job when the app accepts it, before its handle is returned, whether it starts at once or waits for a free place.
  Its answer is written to disk before it is delivered, so a restart neither loses a finished answer nor delivers it twice.
- A job is queued, running, answered, failed or cancelled, and every job ends answered, failed or cancelled; a handle is never left outstanding.
- After a restart, queued jobs keep their place and start in order.
  A reader interrupted before answering runs again, since a reader call has no effects beyond its answer.
  A helper interrupted before answering is taken back if its process outlived the app, as researchers are; otherwise it starts again from the beginning once, with a note that an earlier attempt was interrupted and that sources it saved are already in the library.
  A helper interrupted a second time fails.
- A failed job delivers a notice saying why, and a cancelled one, from a stopped batch, delivers nothing; either way it no longer counts as outstanding, so it never keeps a seat from finishing.
- A session ends when its batch closes or its seat is stopped.
- The session is confined by an app-enforced macOS sandbox profile: it can read the library and the app's Python, read and write its seat's folder, reach the app over loopback, and nothing else, including the human's home folder and the internet.
  On a platform without that sandbox, the session refuses to start rather than run unconfined.

### The session's library

- The session's package, `weir`, gives code everything the researcher needs, each call going through the app over loopback with the researcher's lease or the job's ticket:
  - `library`: list and search the project's documents and sources, and read a document's text as pages.
  - `save`: save a URL, or the page open in the research browser, or an image with a transcription, as a library document, returning its ID.
  - `jev`: sweep a document and return passages.
  - `reader`: send one prompt, or a batch of labelled passages with a question, and receive answers.
  - `helper`: send a helper on an errand and get a handle; the full answer is put in the session under that handle, and the researcher receives only a one-line notice naming the handle, the number of quotes and the sources saved.
  - `post` and `publish`: post to the board and publish a finding (researchers only).
- The same package is the only way the session reaches the app, and every call is checked against the researcher's lease or the job's ticket; a revoked lease or ticket is refused.
- Posting moves from post.md to the package; checkpoint.json stays as it is.

### Saving sources

- The source saver is a new module: a URL, a captured browser page, or an image and transcription in; a library document, its text, a registered source and a short receipt out.
- The app downloads URLs itself, outside any sandbox.
  HTML is converted to readable text; a PDF goes through the existing PDF text extraction and keeps its pages.
- A page open in the research browser is saved from the browser as the reader sees it, sign-ins included, with its URL and the time of capture.
- An image is saved as it is, with the transcription given by the agent that read it, and is marked as transcribed.
- Saved sources become project documents in the library, beside imported ones, so every teammate can use them.
- Every capture has its own ID and never changes once saved.
- Saving a URL already saved returns the existing capture without fetching it again, unless the caller asks for a fresh capture.
- A fresh capture whose content is identical to an earlier capture of the same URL returns the earlier one; different content becomes a new capture.
- A capture from the research browser is always a fresh capture, since a signed-in view can differ from what a plain download sees, and is deduplicated by content in the same way.
- A download that fails, or a page with no readable text, returns a plain error, and the agent can ask the human for access or use the research browser.
- Researchers lose WebFetch in Claude Code, so a page's raw text never enters a researcher's context.
  Researchers keep web search, since its results are short; helpers keep WebFetch, since reading is their job.

### Passages and Jev

- Sweeping with Jev is one tool among several; the researcher may instead read a document whole, chunk it its own way, search it, or anything else its code can do.
- The passage builder is a new module, pure and independent of Jev: a document's chunks and their flags in; passages out.
  - Each flagged chunk is widened by one chunk on each side.
  - Overlapping or adjacent widened chunks merge into one passage.
  - A passage is capped at a reader's input size; a longer run is cut at chunk boundaries with one chunk of overlap.
  - Each passage keeps its pages and line range and a label.
  - When most of a document is flagged, the builder returns the whole document as consecutive passages at the cap.
- The Jev sweep cuts a document into small chunks, about a page or two each, sends all the questions about a chunk in one request, runs requests in parallel within TypeSafe's published rate limits, and retries on rate limiting and overload with backoff.
- A chunk is flagged when any question's probability passes a threshold, 0.3 by default, which the caller can set.
- Each sweep records the document's size and the size of the passages it let through.
  A small random sample of unflagged chunks, a few per sweep, also goes to a reader with the same questions, and each sample a reader finds relevant is recorded as a miss.
  Research settings show these figures per project.
- Jev sits behind a small client with one call, so tests can replace it with a fake.
  The client uses TypeSafe's official endpoint, model alias `jev-latest`, and the key from the app's environment as `TYPESAFE_API_KEY`.
- Without a key, a sweep refuses with a message the researcher can relay, and the setup screen says the key is missing.

### Readers

- A batch of passages is packed into reader prompts as labelled sections, as many whole passages as fit the input size, never splitting a passage; each reader is asked to answer per passage.
- Readers are asked for short, structured answers with exact quotes, page by page, and to say plainly when a passage does not answer the question.
- The reader runner starts the reader's CLI with no tools, sends one prompt, takes the final text, and ends it.

### The cache

- Every Jev and reader call is cached on disk by its model, its question and its input, so a repeated call returns its earlier answer at once and costs nothing.
- The cache belongs to the project, so teammates share it.

### Publishing findings

- The finding publisher is a new module: one finding with its evidence in; a published finding, or a reason for refusal, out.
- Every finding needs evidence.
  Each piece of evidence cites a capture and a page or page range, and its quote must appear within those pages of the capture's text, or in its transcription for an image, after whitespace is normalized.
  A quote that runs across a page break passes when it appears across the cited page and the next.
- Evidence that passes is marked as a checked quote.
  The interface shows that mark apart from the finding's qualification, since whether the quote supports the finding remains the researcher's claim.
- Evidence from a transcription is marked as transcribed rather than checked.
- The qualifications stay: supported, reported, disputed and unresolved, where unresolved means the sources conflict or are ambiguous, never that nothing was found.
- A finding can replace an earlier published finding in the same batch, by any researcher.
  Publishing counts as keeping, so the replaced finding is superseded at once; graph work built on it is revised as described under graph work while findings change.
- The app applies changes one at a time, so of two replacements of the same finding the second is refused, naming the finding that replaced it; the researcher can replace that one instead.
- Correcting a published walkthrough that a replaced finding changes stays the coordinator's job, as it is now.

### Graph work while findings change

- Today a finding can be replaced while its batch's graph draft is being prepared or awaits review, and the stale draft can still be accepted: the replacement rule sets aside only the older graph proposals, and the builder's freshness check compares the draft with the inputs it was given, not with the batch's current findings.
  This branch fixes that, since a woken team can publish while graph work is under way.
- Each batch keeps a findings revision, a counter raised whenever a finding is published or replaced, and only then; board posts, checkpoints and changes in researchers' status leave it alone.
- A graph builder's inputs record the findings revision they were built from, and so does every draft it returns.
- When the findings revision rises while graph work for that batch is under way, the app sends the builder a graph update on its own, as the coordinator's graph update does now: the builder's inputs are rebuilt from the current findings, a running builder is told what changed, a returned draft goes back for revision, and a draft awaiting the human's review is marked as being revised and cannot be accepted until the new one replaces it.
- As a backstop, the coordinator's sign-off and the human's acceptance are both refused when the draft's findings revision is not the batch's current one, with a message saying the findings changed and a revised draft is on its way.
- A published finding records the seat that published it.
- Published findings are written into the library at once, so teammates see them.
- The coordinator no longer receives, inspects or publishes results, and result.json is removed.

### The coordinator

- Opening a batch takes a title and a goal; the coordinator's instructions say to restate the human's request plainly and not to divide or scope the work.
- The coordinator keeps: conversation with the human, opening batches, posting to a board, stopping a batch's team, access requests, helpers for itself, walkthroughs, graph updates and project organization.
- It loses: assigning, steering a single researcher, stopping a single researcher, sending work back, publishing results and marking a batch ready.
- Its news gains published findings and researchers finishing, beside board posts.
- Its instructions, the coordinate-research skill and its startup context are rewritten to match.

### The researcher's and helper's instructions

- The researcher's instructions are rewritten around the goal, the board, the library, the Python session and its package.
- They describe the tools and what each is good for, not a procedure: the board, search, saving, the session and its package, Jev, readers, helpers, and publishing.
  They ask the researcher to keep source text and sub-call answers in its session and print only what it needs to decide its next step.
- They drop the bounded framing, the retrieval limit, the time limit and result.json.
- They say to say the done phrase only when nothing the researcher or the board offers is left to pursue.
- The helper's instructions describe an errand: do it, save every source read, and answer with exact quotes and source IDs.
- The research-contract skill is updated for evidence that cites saved documents only, transcribed evidence, and publishing one finding at a time.

### The interface

- Findings shows each batch's goal and one list of its findings, newest first, each with the researcher who found it.
- The live panel shows each seat with its status, and the helpers and readers running for it.
- The time limit setting is removed; the team size, helper limit and reader limit settings are added to Research settings, with the Jev figures.
- The dispatch settings gain the reader role.

### Existing projects

- Past batches keep their assignments, briefs and published findings as history, shown as they are now.
- A batch still running old assignments when the app opens has them stopped, keeping their checkpoints, and is shown as paused; the coordinator can open a new batch for the same work.

## Testing Decisions

- Tests check behaviour a human or an agent can observe, not internal structure.
- The team lifecycle is tested as domain transitions: opening a batch creates its seats; a seat finishes only with nothing outstanding; a post wakes finished seats and never paused or stopped ones; a resumed seat receives the posts it missed; the batch reaches Review only when every seat has finished and leaves it when one wakes; pause, resume and switch still work on seats.
  Prior art: the assignment tests.
- Stopping is tested end to end: a helper's answer and a run's output arriving after the human stops the batch are dropped, and the saved sources remain.
- Pausing is tested end to end: a helper saves a source after its researcher is paused and the save succeeds; code started before a pause publishes a finding after it; the old researcher process's lease is refused after a pause or switch; every ticket is refused after a stop.
- Restarts are tested end to end: an interrupted run is reported and not replayed; a helper answer finished before the restart is delivered once after it; a repeated post or publish is refused; a queued helper whose handle was already returned starts after the restart; an interrupted reader runs again; an interrupted helper starts again once and fails the second time; and a seat whose only outstanding job failed can finish.
- The passage builder is tested as "these chunks and flags in, these passages out": widening, merging, the cap with overlap, the whole-document case, pages and labels.
- The Jev sweep is tested with a fake client: chunking, batching of questions, the threshold, retry on rate limiting, the figures it records, and the sample of unflagged chunks.
- The source saver is tested against a local fixture server: an HTML page, a PDF, a repeated URL, a fresh capture with unchanged and with changed content, a failing URL, a page with no readable text, and an image with a transcription.
  Prior art: the PDF reading tests.
- The finding publisher is tested as "this finding and these documents in, this result out": a quote at its cited page, a real quote at the wrong page, a quote across a page break, whitespace differences, transcribed evidence, a replacement, a second replacement of the same finding, a graph draft marked for revision by a replacement, and a finding without evidence.
  Prior art: the findings tests.
- The cache is tested for hits, misses, and keys that differ by model, question or input.
- Graph work under changing findings is tested through the real research and graph-review commands, with fictional fixtures: a finding replaced while its graph draft is being prepared, a finding replaced while its draft awaits review, and a new finding published in each of those two moments.
  In every case the builder is sent the change, the stale draft cannot be signed off or accepted, and the revised draft can.
  A board post, a checkpoint or a researcher finishing during graph work leaves the draft valid.
  Prior art: the guided flow tests.
- The Python session is tested end to end: variables persist between runs, survive the session's process being replaced, and survive an app restart; unsaveable values are named; long code returns a note and its output later; a stale lease is refused.
- The session's sandbox is tested in the integration checks: it can read the library and write its folder, and cannot read the home folder, write the library, or reach the internet.
  Prior art: the Codex isolation integration check.
- The reader runner and the researcher pool are tested end to end with the fake Claude and Codex: a team starts on a new batch, the done phrase finishes a seat, a post wakes a finished seat, a helper's answer reaches the researcher who sent it, readers answer a batch of passages, and the batch moves to Review.
  Prior art: the researcher tests.
- The research library test covers goals, board posts, saved documents, transcriptions and findings published during a batch.
- The sandbox integration checks also confirm a researcher has no WebFetch.
- One live check against TypeSafe's API runs only when the key is present and is kept out of `npm run check`.

### Evaluating the experiment

- The tests establish the mechanics; whether researchers stop too early is judged by the human on real work.
- Two or three of the human's past batches that came back without what was asked for are run again on this branch, with the same request.
- The human compares the findings with the originals and judges which is better.
- For each run the app records: findings published, new sources saved, posts that duplicated a teammate's work, helper, reader and Jev calls, model usage, and each researcher's context size over time.
- The context sizes test the design's central claim: as the material grows, the work should grow in sessions and sub-calls while each researcher's context stays manageable.

## Out of Scope

- A separate checker that judges whether a goal has been met; it waits until we see whether researchers still stop early.
- Direct messages between researchers.
- Researchers starting their own researchers, and helpers starting helpers.
- Retrieval, time or cost limits per researcher.
- Python sessions on platforms other than macOS.
- Using Jev for anything but sweeping documents.
- Merging this branch back; that waits on the experiment's result.

## Further Notes

- The design draws on Recursive Language Models (Zhang, Kraska and Khattab), where the model decides how to break a problem down and keeps raw material out of its own context; on "Language model harnesses are compositional generalizers" (Zhang and Khattab, July 2026), which argues that programmatic sub-calls matter as much as keeping material out of context; and on reports of OpenAI's Navier-Stokes agent swarm, which gave agents a messaging tool instead of a coordinator that assigns work.
- The team of peers is the swarm idea, and each researcher's session is the Recursive Language Model idea; the design deliberately combines them.
- The RLM project's current prompt advises about 100,000 characters per sub-call, about twenty sub-calls per batch, prompts packed full rather than many tiny ones, and filtering first when the material is larger; the reader size, batch size and Jev sweep follow that advice.
- A first test call to TypeSafe on 2026-10-02 answered three yes-or-no questions correctly for 330 input tokens.
- The human's key is in their shell profile as `JEV_API_KEY`; TypeSafe's SDK and this PRD use `TYPESAFE_API_KEY`, so the profile entry is to be renamed.
