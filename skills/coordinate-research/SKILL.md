---
name: coordinate-research
description: "Coordinator operations beyond startup: how the app keeps you informed, organizing the graph, answering the conversation, opening batches with briefs, dividing them into researchers' assignments, reconciling and publishing findings, and assigning walkthrough writers. Load it before the first delegation or when an operation is not covered by the startup instructions."
---

# Coordinating research

The app starts you as the project's coordinator whenever it opens the project, in your own folder, and runs every worker you assign.
You supply judgment; the app supplies persistence, worker supervision, and news of every change.
Send every command with `node tools/research.mjs '<json>'`, or a file of JSON in your folder for a long one.

## How the app keeps you informed

Your first message is the startup context: what needs attention, the queue of batches, the research map, and the recent conversation.
`node tools/research.mjs snapshot` prints it again.
After that, the human's chat messages reach you as their own words, and annotations they send arrive together as one structured message, each with what it points at.
News from the app arrives as its own message, carrying only what changed: the investigations that moved, posts researchers made on their batches' boards, pending decisions, returned candidates, and changed dispatch rules.
Changes your own commands make are not sent back to you.
A message sent while you are working reaches you at your next step; when you have handled everything, end your turn.

The snapshot index excludes the accepted dataset, full annotation and proposal histories, source texts, and candidate payloads.
Retrieve those only when needed for the next decision.
The public browser state contains no worker tokens or private candidate payloads.

When the app closes, dispatched work, checkpoints, candidate findings, and proposals stay intact, and the next coordinator starts from them.
Managed workers can finish assigned work while no coordinator runs; their results wait.
After a restart, interrupted workers are paused, while completed candidates remain available for synthesis.
User-paused investigations are never automatically resumed.
To restart paused work, send `{"action":"request-resume","investigationId":"...","reason":"Why another pass or synthesis from saved evidence would help"}`.
This asks for confirmation in the browser and leaves research paused; wait for the human's decision before assigning or publishing work.
The investigation index exposes `resumeRequest` with its pending, approved, or declined status.
The human can choose Resume research or Keep paused, and the decision survives restarts.
Do not treat elapsed time, silence, or an unlimited time setting as approval, and do not repeat a declined request without a new reason or instruction from the human.

## Learn the project progressively

```sh
node tools/research.mjs search Alex employment
node tools/research.mjs '{"action":"map","notes":"Purpose, threads, uncertainties and stable references"}'
```

Search returns bounded excerpts and stable references across entities, investigations, candidate findings, and preserved text documents.
Inspect the referenced records with commands:

```json
{"action":"inspect","kind":"entity","table":"nodes","id":"alex"}
```

Entity inspection returns that record, references to directly related records, and related investigations.
Use the returned IDs rather than guessing record names.
Other inspection kinds are `investigation`, `candidate`, `source`, `interface-feedback`, `map`, and the paginated `investigations` index.
Source inspection accepts `offset` and `limit` (default 6,000 characters, maximum 20,000), returns the preserved fingerprint and a next offset, and distinguishes citation metadata from locally available originals.
Search results for source text include a character offset to locate the matching passage.
Investigation inspection includes its assignments with their briefs, steering and checkpoints, its board, and its proposals, without any worker's private lease or dataset snapshot.
Old candidates remain inspectable and are explicitly marked as no longer current.

The research map should state the purpose, major entities or threads, open uncertainties, and stable references to useful investigations and sources.
Keep it short and revise it as the project changes.
It is not evidence: inspect the actual source and review status before relying on a claim.
Completed proposals provide discoverable, source-linked findings, including inconclusive outcomes, rather than requiring a second copy of all research in coordinator memory.

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
- `{"action":"open-batch","title":"...","brief":{"purpose":"...","scope":"...","direction":"..."},"assignments":[{"title":"...","brief":"..."}],"scope":["web","imports"]}` opens a numbered batch with its first assignments, as described under "Assign bounded research".
  A batch is research one walkthrough and one graph update can coherently explain.
  The brief is required: its purpose, what is in and out of the batch, and where the work is heading now.
  A later coordinator starting fresh relies on it to know what the batch is for and where new research belongs.
  The returned `investigationId` is the batch; assign it as described below.
- `{"action":"set-brief","investigationId":"...","brief":{"direction":"..."}}` updates a brief; send only the fields that changed.
  Update the direction whenever the human redirects a batch or a pass changes what comes next.
- `{"action":"assign","investigationId":"...","title":"...","brief":"..."}` adds an assignment to an open batch.
- `{"action":"batch-ready","investigationId":"...","text":"..."}` tells the human a batch is ready to review; never leave a finished batch unannounced.
- `{"action":"retitle","investigationId":"...","title":"...","assignments":[{"assignmentId":"...","title":"..."}]}` rewrites batch and assignment headings, for example the placeholder headings of converted projects, which repeat the human's own words.
- `{"action":"request-approval","title":"...","body":"...","investigationId":"..."}` asks the human first when you want their decision, such as whether a costly follow-up is worth it.
  After the human approves, assign the work.

Batch membership is yours to decide; tell the human your choice in the conversation so they can correct it.
A batch closes when its graph review is finished, whether its changes were approved or set aside, and related later work starts a new batch.
The service refuses a graph update for a batch whose review is finished, so open a new batch for research asked for after it.
That boundary is what makes a batch mean something: one walkthrough and one graph update explain it, and then it is done.

## Assign bounded research

A batch holds any number of assignments, each one researcher's bounded part of it, such as one question, one source, or one line of inquiry.
Assign one with:

```json
{
  "action": "assign",
  "investigationId": "the batch's ID",
  "title": "Lease registers, 1880 to 1895",
  "brief": "Find who held the lease on the mill between 1880 and 1895, from the county archive's lease registers. Start from source src-county-leases, which batch 1 read only to 1879. Finding f-17 in report p-3 says the Holloways held it in 1878; test whether that continues. Out of scope: ownership of the land itself."
}
```

The title heads the assignment's research in Findings, so the human reads it as the direction of the work.
The brief is prose the researcher reads first, and the only part of the conversation it ever sees: say what to find, what is out of scope, and how this part relates to the rest of the batch.
Look up the findings, sources, graph records and passages that matter and name their IDs inline; the researcher can read each of them in the research library.
When the human pointed at something in an annotation, find its ID and put it in the brief.
Split a batch's research into several assignments when its parts can be worked separately; give each a brief that says what its siblings cover, so they do not repeat each other.
If `engine` is omitted, the project's dispatch rules choose the agent, model and effort; name `engine`, `model` and `effort` when one of their conditional rules fits this assignment.
The app starts researchers as places free up: at most the human's limit of researchers per batch at once, in the order you made the assignments, batch by batch down the queue; held batches wait.
An assignment made in a paused batch waits for the human to resume it.
The human can set an optional per-pass time limit in Research settings; it applies to new managed passes, including replacement passes, while running passes keep their original limit.
A configured limit still pauses the assignment at expiry and preserves saved checkpoints; it does not resume automatically.
Researchers save checkpoints and return validated candidate proposals to you.
They cannot publish those candidates directly to human review.

### What researchers read

Each researcher works in its own folder, with your brief as `brief.md`, and reads the project's research library, which the app keeps current and no researcher can change.
The library holds every batch's brief and board; one folder per research pass with your direction, its published findings with their evidence, and its checkpoints, including those of researchers working now; the walkthroughs; the graph as tables; the source library; and the saved documents with their text.
It leaves out the conversation, the human's annotations, and results you have not yet published.

### The board

Researchers in a batch post on its board when they find something the others should know, such as a source found or ruled out, or an identity settled.
A post reaches the batch's other running researchers at their next step, stays on the board for researchers who start later, and reaches you in the app's news.
Use posts to steer the batch: redirect a researcher whose work a post changes, or stop one a post makes unnecessary.

### Steer or stop a running researcher

When the human changes direction while a researcher is working, redirect it rather than waiting for its result:

```json
{"action":"steer","assignmentId":"...","message":"What changed and what the researcher should do now"}
```

The message reaches the researcher at its next step, and its assignment records the redirection, which the human sees in Findings.
A researcher that ends its turn without writing findings stays running and the batch records that it is waiting for instructions; steer it to continue or to write up what it has, or stop it.
A researcher that has written its findings closes on its own.
When work is clearly wrong or no longer wanted, stop it outright:

```json
{"action":"stop-researcher","assignmentId":"...","reason":"Why the researcher is being stopped"}
```

Stopping records the reason and keeps saved checkpoints; the batch's other researchers carry on, and nothing waits on the human.
A stopped assignment can be sent back for another pass with `revise`, as below.
Claude and Codex researchers are steered and stopped the same way.

Every worker is started by the app, so the live panel always shows it; you cannot start agents yourself.

## Reconcile and publish

Inspect each candidate and its evidence alongside its assignment's brief, exact source passages, and related investigations.
A candidate's existence is not evidence that its reasoning is sound.
Write the synthesis through:

```json
{
  "action": "publish",
  "candidateId": "returned candidate ID",
  "proposal": {
    "kind": "findings",
    "title": "A reviewable conclusion",
    "summary": "The evidence and the limited inference it supports.",
    "ambiguity": "What remains unresolved.",
    "evidence": [],
    "changes": [],
    "findings": [{"id":"open-question","statement":"The identity remains unresolved.","qualification":"unresolved","explanation":"No adequate evidence located in this pass.","evidenceIds":[]}]
  }
}
```

Omit `proposal` to publish the exact inspected candidate unchanged.
Follow `skills/research-contract/SKILL.md` for full evidence and change schemas.
Publishing revalidates the current lease, exact before records, source references, and quoted text before creating an immutable proposal revision.
It does not change accepted research.
When the batch's research is complete, announce it with `batch-ready`.
The human then requests a walkthrough, a graph update, or both from Review.
A walkthrough writer you assign writes each walkthrough, as described below.
Supervise graph work with `skills/prepare-research-graph/SKILL.md`.
The human decides each graph change in the graph review, and completing that review closes the batch.

If a candidate needs another research pass, use `{"action":"revise","assignmentId":"...","notes":"What failed and what the next pass must investigate"}`.
This records the correction as a checkpoint and in the assignment's steering, and sends the same assignment back to wait for a fresh researcher, who reads your brief and your notes; name `engine`, `model` and `effort` to send it to another agent.
The batch's other assignments are not touched.
A paused or superseded candidate cannot be published.

### Walkthroughs are written by a walkthrough writer

Writing a walkthrough takes a while, and the coordinator must stay free to answer the human and supervise research.
When the snapshot marks a batch `walkthroughRequested`, make sure its inspected findings are published, then assign a writer:

```json
{"action":"assign-walkthrough","investigationId":"...","engine":"claude","brief":"What the walkthrough must establish, the reconciliation and ambiguities to carry, and what the human asked"}
```

The brief carries what the writer cannot see for itself: your reconciliation, preserved ambiguities, and what the human asked.
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

Once coordinator supervision is enabled for a project, worker API publication is disabled so researchers cannot bypass synthesis.
Application behavior does not enforce semantic quality; the coordinator must actually evaluate evidence and retain uncertainty.
