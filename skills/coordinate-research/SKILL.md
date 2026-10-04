---
name: coordinate-research
description: "Coordinator operations beyond startup: how the app keeps you informed, organizing the graph, answering the conversation, opening batches with a goal for a team of researchers, posting to a batch's board, stopping a team, and assigning walkthrough writers. Load it before opening your first batch or when an operation is not covered by the startup instructions."
---

# Coordinating research

The app starts you as the project's coordinator whenever it opens the project, in your own folder, and runs every researcher, writer and builder.
You supply judgment; the app supplies persistence, worker supervision, and news of every change.
Send every command with `node tools/research.mjs '<json>'`, or a file of JSON in your folder for a long one.

## How the app keeps you informed

Your first message is the startup context: what needs attention, the queue of batches, the research map, and the recent conversation.
`node tools/research.mjs snapshot` prints it again.
After that, the human's chat messages reach you as their own words, and annotations they send arrive together as one structured message, each with what it points at.
News from the app arrives as its own message, carrying only what changed: the batches that moved, findings researchers published, posts they made on their batches' boards, researchers that finished and batches that reached Review, pending decisions, and changed dispatch rules.
Changes your own commands make are not sent back to you.
A message sent while you are working reaches you at your next step; when you have handled everything, end your turn.

The snapshot index excludes the accepted dataset, full annotation and finding histories, and source texts.
Retrieve those only when needed for the next decision.
The public browser state contains no worker tokens.

When the app closes, batches, checkpoints and published findings stay intact, and the next coordinator starts from them.
Researchers carry on and publish while no coordinator runs.
After a restart, interrupted researchers are paused, each keeping its conversation and its Python session's variables, until the human resumes them.
A batch the human paused stays paused until they resume it.
To ask for paused work to restart, send `{"action":"request-resume","investigationId":"...","reason":"Why resuming would help"}`.
This asks for confirmation in the browser and leaves research paused; wait for the human's decision.
The investigation index exposes `resumeRequest` with its pending, approved, or declined status.
The human can choose Resume research or Keep paused, and the decision survives restarts.
Do not treat elapsed time, silence, or an unlimited time setting as approval, and do not repeat a declined request without a new reason or instruction from the human.

## Learn the project progressively

```sh
node tools/research.mjs search Alex employment
node tools/research.mjs '{"action":"map","notes":"Purpose, threads, uncertainties and stable references"}'
```

Search returns short excerpts and stable references across entities, batches with their findings, and preserved text documents.
Inspect the referenced records with commands:

```json
{"action":"inspect","kind":"entity","table":"nodes","id":"alex"}
```

Entity inspection returns that record, references to directly related records, and related investigations.
Use the returned IDs rather than guessing record names.
Other inspection kinds are `investigation`, `source`, `interface-feedback`, `map`, and the paginated `investigations` index.
Source inspection accepts `offset` and `limit` (default 6,000 characters, maximum 20,000), returns the preserved fingerprint and a next offset, and distinguishes citation metadata from locally available originals.
Search results for source text include a character offset to locate the matching passage.
Investigation inspection includes the batch's goal, its researchers with their checkpoints, its board, and its published findings with their evidence, without any worker's private lease or dataset snapshot.

The research map should state the purpose, major entities or threads, open uncertainties, and stable references to useful investigations and sources.
Keep it short and revise it as the project changes.
It is not evidence: inspect the actual source and review status before relying on a claim.
Published findings are discoverable and source-linked, so the map points to them rather than repeating them.

## Organize an existing graph

An explicit human request to keep certain nodes or add a named starting point authorizes an organization operation.
This is separate from evidence-backed research proposals.
Send `{"action":"organization-preview","keepIds":["existing-node-id"],"reason":"Keep the requested starting point"}` through the coordinator command interface.
The result lists exactly which nodes will remain, be added, and be removed.
Check it against the request, then send `{"action":"organization-apply","previewId":"returned-id"}`.
A preview can also include `"seed":{"name":"Example Town","type":"place"}`; omit `keepIds` to retain all existing nodes.
The seed contains only a name and type, with no researched claims.
The live service prunes dangling relationships and saves a prior-graph snapshot while retaining sources, annotations, investigations, and research maps.
Queued, running, and pending-review investigations pause; their prior leases and pending proposals are fenced or superseded.
Check their references and scope before resuming.
The compact project index points to the latest organization action for recovery.
Undo uses `{"action":"organization-undo","undoId":"returned-id"}` and is available until another graph change.
Any intervening workspace revision invalidates an unapplied preview; prepare a new preview instead of forcing it.
Research workers cannot call these operations.
Do not delete and recreate a project or edit its live state files to trim the graph.

## The conversation and batches

The human writes to you in one project-wide conversation: chat messages, and annotations they collect and send together.
A set of annotations is the human's scratch pad: they may overlap, contradict, or revise one another, so read them all before acting, and reply to them as a whole.
Not every annotation needs research; one may be praise, or only connect two others, and needs nothing more than your reply.
The snapshot's `conversation` index lists `pendingDecisions`, recent messages, and `openBatches`.
Answer what the human sends with your plan for it: a direct answer, research you are starting, or where later work will go.

Send these through the command tool:

- `{"action":"reply","text":"...","references":[{"label":"...","table":"nodes","recordId":"..."}]}` answers in the conversation; references become links the human can follow.
- `{"action":"open-batch","title":"...","goal":"...","scope":["web","imports"]}` opens a numbered batch and starts its team, as described under "Open a batch for a team".
  A batch is research one walkthrough and one graph update can coherently explain.
  The returned `investigationId` is the batch.
- `{"action":"post","investigationId":"...","text":"..."}` posts on a batch's board, to its whole team.
- `{"action":"stop-team","investigationId":"...","reason":"..."}` ends a batch's research when the human asks.
- `{"action":"retitle","investigationId":"...","title":"..."}` rewrites a batch's heading.
- `{"action":"request-approval","title":"...","body":"...","investigationId":"..."}` asks the human first when you want their decision, such as whether a costly follow-up is worth it.
  After the human approves, open the batch.

Batch membership is yours to decide; tell the human your choice in the conversation so they can correct it.
A batch closes when its graph review is finished, whether its changes were approved or set aside, and related later work starts a new batch.
The service refuses a graph update for a batch whose review is finished, so open a new batch for research asked for after it.
That boundary is what makes a batch mean something: one walkthrough and one graph update explain it, and then it is done.

## Open a batch for a team

A batch is worked by a team of researchers who share one goal and organize themselves.
Open one with:

```json
{
  "action": "open-batch",
  "title": "Who held the mill lease, 1880 to 1895",
  "goal": "The human wants to know who held the lease on the mill between 1880 and 1895. Finding f1 in report p-3 says the Holloways held it in 1878, from source src-county-leases, which was read only to 1879; they want to know whether that continued and who followed. They mentioned the county archive's lease registers and the 1880s newspapers as places to look."
}
```

The goal is the human's request, restated plainly and whole, up to a few thousand characters.
Every researcher in the team reads it, and it is all they have of the conversation: say what the human wants to know, what they already have, and where they suggested looking.
When the human pointed at something in an annotation, find its ID and name it in the goal; the researchers can read each of them in the research library.
State the goal and leave the dividing to the team: the researchers post their opening plans on the board and spread out across the goal themselves.
Keep to what the human said: how to go about the research, which sources to read first and what to produce are the team's to choose.
The app creates one researcher per place in the team, as many as the human's team size setting, and starts them all at once; a held batch waits until the human releases it.
If `engine` is omitted, the project's dispatch rules choose the researchers' agent, model and effort; name `engine`, `model` and `effort` when one of their conditional rules fits this batch.

### What researchers do

Each researcher works in its own folder with a Python session of its own, and reads the project's research library, which the app keeps current.
The library holds every batch's goal and board, every published finding with its evidence, every researcher's checkpoints, the walkthroughs, the graph as tables, the source library, and the saved documents with their text.
A researcher saves each source it reads into the library, so the whole team shares one copy, and publishes each finding as soon as it has its evidence.
The app checks every quote against the saved text at its cited page, and the finding appears to the human at once.
A researcher can replace an earlier finding of its batch, its own or a teammate's, with a correction.
Each published finding reaches you in the app's news with its statement, its qualification and who published it.

### The board

The team organizes on the batch's board: opening plans, sources found or ruled out, identities settled, leads left for someone else.
Every post reaches every other researcher in the batch at once, stays on the board for any who start later, and reaches you in the app's news.
Post yourself with `{"action":"post","investigationId":"...","text":"..."}` when the team should know something: a source the human supplied, a correction to the goal, a decision that changes their work.
Your post reaches every researcher and wakes those who had finished, which is how the human's "keep going" reaches the team: post what they want pursued further.
A post of yours says what the human said, or what you noticed in the team's findings, to the whole team; who takes it up is the team's to settle on the board.

### Finishing, Review and stopping

A researcher works for as long as leads remain, with no limit on time or sources, and finishes by saying so once nothing it or the board offers is left to pursue.
A later post wakes it with its conversation and its variables intact.
When every researcher in a batch has finished, the batch moves to Review on its own, and the app's news tells you; tell the human, who then requests a walkthrough, a graph update, or both.
A post that wakes a researcher takes the batch out of Review until the team finishes again.
When the human asks you to stop a batch's research, send `{"action":"stop-team","investigationId":"...","reason":"..."}`.
The whole team ends at once; what it published and saved stays, the batch goes to Review with what it has, and further research on the subject opens a new batch.

The human can pause, resume, or switch to another agent or model any researcher, graph builder or walkthrough writer, and switch you.
Each of these is recorded in the batch's activity, which reaches you as news.
A paused researcher keeps its conversation; posts it misses reach it together when the human resumes it.
A switched one starts again on its new agent: with the same program it keeps its conversation, and with another it starts afresh from its checkpoints, with its Python session's variables intact.

Every worker is started by the app, so the live panel always shows it.

## Review

The human requests a walkthrough, a graph update, or both from Review, once a batch is there.
A walkthrough writer you assign writes each walkthrough, as described below.
Supervise graph work with `skills/prepare-research-graph/SKILL.md`.
A finding published or replaced while graph work is under way goes to the builder on its own, and a draft built on findings that have since changed cannot be signed off or accepted until its revision arrives.
The human decides each graph change in the graph review, and completing that review closes the batch.

### Walkthroughs are written by a walkthrough writer

Writing a walkthrough takes a while, and the coordinator must stay free to answer the human and supervise research.
When the snapshot marks a batch `walkthroughRequested`, read its published findings, then assign a writer:

```json
{"action":"assign-walkthrough","investigationId":"...","engine":"claude","brief":"What the walkthrough must establish, the reconciliation and ambiguities to carry, and what the human asked"}
```

The brief carries what the writer cannot see for itself: how the findings fit together, the ambiguities to preserve, and what the human asked.
The app launches the writer with the batch's published findings and `skills/present-research/SKILL.md`; it appears in the live panel.
If `engine` is omitted, the project's dispatch rules choose the agent, model and effort; name `engine`, `model` and `effort` when one of their conditional rules fits this assignment.
To redirect a running writer, send `{"action":"walkthrough-update","investigationId":"...","message":"..."}`; it arrives at the writer's next step.
The app checks the draft when the writer's turn ends and sends any problem back to it, up to three times.
When the writer hands in a draft, `inspect-flow` shows it as `writer.draft`.
Check its claims against the findings, then publish it with `publish-walkthrough`: omit `walkthrough` to publish the draft as it stands, or send a corrected one.
If the writer stops, its `writer.progress` says why; assign a writer again with a brief that addresses it.

### Correcting a published walkthrough

A published walkthrough stays the batch's explanation, so keep it true.
Each batch's current walkthrough is a file in your folder, `walkthroughs/batch-<number>.json`.
When a later check or the human's question changes what it says, edit that file with your file tools; the human does not need to ask first.
Change only the words: the title, question, journey, answer, caveats, closing, and each step's title, body and transition.
Keep the steps, their order, their IDs and their evidence as they are; restructuring a walkthrough needs a writer the human asks for.
At the end of your turn, the app shows each changed passage to the human as a suggested edit, which they accept, decline, or comment on.
Tell the human in the conversation what you changed and why; the app announces the edits in the walkthrough itself.
Until they decide, the file shows your suggestions in place.
A comment on an edit reaches you in the conversation: answer it, and if it calls for different wording, edit the file again, and the edit is shown as revised.
If the app cannot use your change, it tells you why and puts the file back as it was.

## Guided research and graph review

The standard presentation flow is documented in `skills/present-research/SKILL.md` and its runtime reference.
The graph builder, which edits the graph and the project's types as tables, and the coordinator's sign-off and tour are documented in `skills/prepare-research-graph/SKILL.md`.
Use those routes for new work; the kept-finding graph request described in older contracts remains supported for existing reviews.
The snapshot exposes walkthrough revisions, graph job progress, and returned drafts awaiting your sign-off.
`inspect-flow` retrieves the preserved explanation, job packet, the candidate draft with its computed difference, and graph reviews for one investigation.
Graph workers can complete while no coordinator runs; the browser then explains that the coordinator is checking the draft.
On restart, an interrupted builder picks its draft back up from its saved files, up to its attempt limit.
The browser review persists reading position, supports source inspection and annotations, and shows the draft with its changes, including removed records as ghosts.
Accepting a draft validates the base revision and that newer feedback on the draft has reached the builder, then replaces the graph and keeps an undo.

## Boundaries

During explicit application maintenance, mistakenly dispatched UI annotations can be reclassified through the user command endpoint, `POST /api/commands`, using `{"type":"reclassify-annotation","investigationId":"...","annotationId":"...","feedbackId":"..."}`.
This requires a paused investigation with no researcher running and an existing feedback record whose text and references exactly match the annotation.
It refuses annotations already addressed by a proposal, preserves the complete original annotation under the feedback record's `origin`, and records the move in investigation history.
Use this only for explicitly authorized routing corrections; it is not a research-worker command or a way to revise sent historical instructions.

The app checks that each quote is in its source at the cited page; whether the quote supports the finding is the researcher's claim, so read findings critically when you talk about them with the human.
