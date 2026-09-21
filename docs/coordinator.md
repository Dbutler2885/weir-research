# Agent-led research sessions

The coding agent opened in this repository becomes the research coordinator through `AGENTS.md` (also available as `CLAUDE.md`).
The current agent supplies judgment; the local service supplies persistence, session ownership, worker supervision, and event waiting.
No additional coordinator model is launched.

## Projects and opening

Ordinary startup is fully specified in the root `AGENTS.md`; this guide supplies details when an operation needs them.
Ask only for a topic when creating a project, then use start.
No implementation exploration or dataset preparation is needed.

```sh
npm run workspace -- start "Example Town industrial history"
npm run workspace -- resume
npm run workspace -- projects
npm run workspace -- open <project-id>
npm run workspace -- open example --no-browser
npm run workspace -- create archive /absolute/path/dataset.json "Archive research"
```

A project contains accepted data, source snapshots, investigation and proposal history, and coordinator handoffs.
The picker lists existing local workspaces and registered projects.
Opening without an ID resumes the last active project; with multiple projects and no selection, the command asks the agent to select one.
The agent handles that selection with the human when necessary.
New projects start with a title, no nodes, no sources, and a null focus.
Start derives an internal ID, creates the project, opens its service, and attaches the current agent in one command.
Resume opens and attaches to existing work.
Both return the URL, private session path, and compact project index.
If a later step fails after creation, resume the registered project instead of starting a duplicate.
Use the legacy multi-argument create form only when importing an existing structured dataset.
The model supports person, place, organization, family, event, and vessel nodes; a place or organization can be the focus.
Genealogy-specific structures remain available, but a new topic does not need them.
Arbitrary HTML import and configurable graph schemas are not implemented.
Each project has a distinct state directory and local service.
New services choose an available loopback port; existing matching services are reused.
`RESEARCH_HOME` overrides the project registry and default project location for isolation and testing.

## Attach, inspect, acknowledge, and wait

```sh
npm run coordinator -- attach "Codex research coordinator" --project <project-id>
npm run coordinator -- snapshot --session /path/returned/session.json
npm run coordinator -- ack 12 --session /path/returned/session.json
npm run coordinator -- wait --session /path/returned/session.json
npm run coordinator -- handoff /path/to/handoff.txt --session /path/returned/session.json
npm run coordinator -- detach --session /path/returned/session.json
```

Attach returns private session and snapshot paths, plus a compact summary of investigations and findings awaiting synthesis.
The snapshot is a compact index: project counts, source collections, a short research map and handoff, up to 50 active and 10 recent closed investigations, and candidate summaries.
It excludes the accepted dataset, full annotation and proposal histories, source texts, and candidate payloads.
Retrieve those only when needed for the next decision.
The public browser state contains no worker tokens or private candidate payloads.
Only one live coordinator can attach to a project.
Ownership and liveness are separate.
A session owns its project for thirty minutes of inactivity, renewed by every command, so long work does not lose it.
Liveness is the last two minutes: the browser says the coordinator is listening, or that it is working and when it was last seen.
Another coordinator may take over only when the owner has not been seen for two minutes, and takeover fences the old session as before.

Acknowledgment is explicit and advances only up to a revision actually read by that session.
Activity is delivered again until acknowledged; merely receiving a response never consumes it.
The revision is a cursor into the durable workspace state, not a separate destructive event queue.
A wait returns when that state changes or after five minutes, so the agent must continue its tool loop.
A wait that ends quietly returns only the revision.
A wait woken by activity returns just what changed since the acknowledged cursor: new messages, the investigations that moved, unassigned annotations, pending decisions, and returned candidates.
A cursor older than the server's kept history returns the full index instead.
It does not inject messages into a closed conversation or start a new agent turn after the agent has ended.
The agent instructions require it to remain in this loop while operating the research workspace.

Disconnecting leaves dispatched work, checkpoints, candidate findings, and proposals intact.
A new agent attaches after detach, session expiry, or server restart and receives an index into the saved state.
Coordinator-owned running investigations are requeued with old worker leases fenced on takeover.
Managed researchers can finish already assigned work while the coordinator is absent; their results wait for its return.
After a server restart, interrupted managed processes are paused, while completed candidates remain available for synthesis.
User-paused investigations are never automatically resumed.
To restart paused work, send `{"action":"request-resume","investigationId":"...","reason":"Why another pass or synthesis from saved evidence would help"}`.
This asks for confirmation in the browser and leaves research paused; wait for the human's decision before claiming, assigning, or publishing work.
The investigation index exposes `resumeRequest` with its pending, approved, or declined status.
The human can choose Resume research or Keep paused, and the decision survives restarts.
Do not treat elapsed time, silence, or an unlimited time setting as approval, and do not repeat a declined request without a new reason or instruction from the human.

## Learn the project progressively

```sh
npm run coordinator -- search "Alex employment" --session /path/returned/session.json
npm run coordinator -- map /path/to/research-map.txt --session /path/returned/session.json
```

Search returns bounded excerpts and stable references across entities, investigations, candidate findings, and preserved text documents.
Inspect the referenced records through command files:

```json
{"action":"inspect","kind":"entity","table":"people","id":"alex"}
```

Entity inspection returns that record, references to directly related records, and related investigations.
Use the returned IDs rather than guessing record names.
Other inspection kinds are `investigation`, `candidate`, `source`, `interface-feedback`, `map`, and the paginated `investigations` index.
Source inspection accepts `offset` and `limit` (default 6,000 characters, maximum 20,000), returns the preserved fingerprint and a next offset, and distinguishes citation metadata from locally available originals.
Search results for source text include a character offset to locate the matching passage.
Investigation inspection includes its annotations, checkpoints, and proposals without the worker's private lease or dataset snapshot.
Old candidates remain inspectable and are explicitly marked as no longer current.

The research map should state the purpose, major entities or threads, open uncertainties, and stable references to useful investigations and sources.
Keep it short and revise it as the project changes.
The recovery handoff records current coordinating decisions and immediate next steps.
Neither document is evidence: inspect the actual source and review status before relying on a claim.
Completed proposals provide discoverable, source-linked findings, including inconclusive outcomes, rather than requiring a second copy of all research in coordinator memory.

## Organize an existing graph

An explicit human request to keep certain nodes or add a named starting point authorizes an organization operation.
This is separate from evidence-backed research proposals.
Send `{"action":"organization-preview","keepIds":["existing-node-id"],"reason":"Keep the requested starting point"}` through the coordinator command interface.
The result lists exactly which nodes will remain, be added, and be removed.
Check it against the request, then send `{"action":"organization-apply","previewId":"returned-id"}`.
A preview can also include `"seed":{"name":"Example Town","kind":"place"}`; omit `keepIds` to retain all existing nodes.
The seed contains only a name and type, with no researched claims.
The live service prunes dangling relationships and saves a prior-graph snapshot while retaining sources, annotations, investigations, research maps, and handoffs.
Queued, running, and pending-review investigations pause; their prior leases and pending proposals are fenced or superseded.
Check their references and scope before resuming.
The compact project index points to the latest organization action for recovery.
Undo uses `{"action":"organization-undo","undoId":"returned-id"}` and is available until another graph change.
Any intervening workspace revision invalidates an unapplied preview; prepare a new preview instead of forcing it.
The browser Organize control exposes the same operations, and research workers cannot call them.
Do not delete and recreate a project or edit its live state files to trim the graph.

## The conversation and batches

The human writes to you in one project-wide conversation in the Annotations drawer.
A send is the human's scratch pad: its annotations may overlap, contradict, or revise one another, so read the whole send before acting.
The snapshot's `conversation` index lists `unassignedAnnotations` (sent but not yet placed in a batch), `pendingDecisions`, recent messages, and `openBatches`.
Answer every send in the conversation with your plan for it: a direct answer, research you are starting, or where later work will go.

Send these through the coordinator `command` interface:

- `{"action":"reply","text":"...","references":[{"label":"...","table":"contextEntities","recordId":"..."}]}` answers in the conversation; references become links the human can follow.
- `{"action":"open-batch","title":"...","questions":[{"title":"Coordinator-written heading","annotationIds":["..."]}],"scope":["web","imports"]}` opens a numbered batch from sent annotations.
  A batch is research one walkthrough and one graph update can coherently explain.
  The returned `investigationId` is the batch; assign or claim it as described below.
- `{"action":"add-to-batch","investigationId":"...","questions":[{"questionId":"existing","annotationIds":["..."]},{"title":"New heading","annotationIds":["..."]}]}` places later annotations that address an open batch's work.
- `{"action":"batch-ready","investigationId":"...","text":"..."}` tells the human a batch is ready to review; never leave a finished batch unannounced.
- `{"action":"retitle","investigationId":"...","title":"...","questions":[{"questionId":"...","title":"..."}]}` rewrites batch and question headings, for example the placeholder headings of converted projects, which repeat the human's own words.
- `{"action":"request-approval","title":"...","body":"...","investigationId":"..."}` asks before research the human did not request, such as following up an inconsistency.
  After the human approves, add it with `{"title":"...","approvalMessageId":"..."}` as a question without annotations; the body becomes its explanation in Findings.

Batch membership is yours to decide; tell the human your choice in the conversation so they can correct it.
A batch closes when its graph review is finished, whether its changes were approved or set aside, and related later work starts a new batch.
The service refuses a graph update for a batch whose review is finished, so open a new batch for annotations that arrive after it.
That boundary is what makes a batch mean something: one walkthrough and one graph update explain it, and then it is done.

## Assign bounded research

Write a command JSON file and send it with:

```sh
npm run coordinator -- command /path/to/command.json --session /path/returned/session.json
```

For an installed managed researcher, use:

```json
{
  "action": "assign",
  "investigationId": "the dispatched investigation ID",
  "engine": "codex",
  "brief": "Verify the identity against the permitted collection. Compare the conflicting dates from the other investigation, distinguish direct statements from inference, and preserve unresolved alternatives. Return the specified proposal shape."
}
```

The brief is the place for the coordinator's cross-investigation context and research strategy.
Read the indexed `phase` before assigning work: research passes return qualified findings without graph changes; graph passes represent exact kept `graphRequest.refs` and return coherent review groups.
Use the contracts in `docs/research-agent.md`; do not collapse these two tasks into a single proposal.
If `engine` is omitted for a managed assignment, the saved browser preference is used.
Choose native delegation only when the saved preference is manual or the human explicitly asks for that route.
Actual assignments are recorded under Investigations with their provider and model when known; missing model information remains explicitly unreported.
For native claims, supply `provider` and `model` only if the runtime establishes them.
Respect each investigation's source scope when sharing findings.
At most two managed researchers run concurrently, with no time limit by default.
The human can set an optional per-pass time limit in Research settings; it applies to new managed passes, including replacement passes, while running passes keep their original limit.
A configured limit still pauses the investigation at expiry and preserves saved checkpoints; it does not resume an investigation automatically.
An assignment records the dispatched annotation IDs, phase, and graph request; changed inputs prevent an outdated assignment from starting.
Selecting a browser engine preference in coordinator mode does not independently launch work.
Managed workers save checkpoints and return validated candidate proposals to the coordinator.
They cannot publish those candidates directly to human review in coordinator mode.

For harness-native delegation, use the same command with `"action": "claim"` and omit `engine`.
The response points to a private brief file containing the snapshot, scoped source documents, prior work, and worker lease.
Pass only research context and scoped sources to native subagents, keeping session credentials private.
The coordinator owns this claimed investigation and submits its reconciled result.
The returned lease is fenced when the coordinator is replaced.

Save native findings through a `checkpoint` command containing `investigationId`, `summary`, `findings`, and `nextSteps`.
Include source locators, failed searches, contrary evidence, and remaining questions.
This checkpoint becomes the next coordinator's recovery handoff for the investigation.
Include `accessRequest: {instruction, url?}` when the human needs to supply a document or resolve access.
That checkpoint pauses the pass and displays assistance in the browser; do not resume it until the human does.

## Reconcile and publish

Inspect each candidate and its evidence alongside the original annotations, exact source passages, and related investigations.
A candidate's existence is not evidence that its reasoning is sound.
Write the synthesis through:

```json
{
  "action": "publish",
  "investigationId": "investigation ID",
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
For coordinator-owned/native work, omit `candidateId` and provide the reconciled proposal.
Follow `docs/research-agent.md` for full evidence and change schemas.
Publishing revalidates the current lease, exact before records, source references, and quoted text before creating an immutable proposal revision.
It does not change accepted research.
When the batch's research is complete, announce it with `batch-ready`.
The human then requests a walkthrough, a graph update, or both from Review.
A fork of the coordinator writes each walkthrough, as described below.
Supervise graph work with `skills/prepare-research-graph/SKILL.md`.
The human decides each graph change in the graph review, and completing that review closes the batch.

If a candidate needs another research pass, use `{"action":"revise","investigationId":"...","notes":"What failed and what the next pass must investigate"}`.
This preserves the candidate, records the correction as a checkpoint, and requeues the investigation for a fresh assignment.
A paused or superseded candidate cannot be published.
Use `handoff` for durable project-wide decisions, relationships among investigations, and the next coordinating steps.

### Walkthroughs are written by a fork

Writing a walkthrough takes a while, and the coordinator must stay free to answer the human and supervise research.
When the snapshot marks a batch `walkthroughRequested`, make sure its inspected findings are published, then fork yourself.
A fork inherits your reconciliation, preserved ambiguities, and knowledge of what the human asked.
In Claude Code, fork with the Agent tool and `subagent_type: "fork"`.
Where the harness cannot fork, start a fresh subagent with the batch ID, its published proposal IDs, and the original questions.
Write the walkthrough yourself only when the harness has no subagents.

Tell the author that it writes the walkthrough for batch N, loads `skills/present-research/SKILL.md`, and is not the coordinator.
Load that skill only in the author, not in your own context.
Record in your handoff that the author is writing, and keep coordinating.
When it returns, read the draft at `coordinator-work/walkthroughs/batch-<number>.json` in the project directory, check its claims against the findings, and publish it with `publish-walkthrough`.
If publication is rejected, correct the draft yourself or continue the same author with the error.
After a restart, a draft file for a still-requested batch is resumable work; check and publish it rather than writing another.

## Guided research and graph review

The standard presentation flow is documented in `skills/present-research/SKILL.md` and its runtime reference.
The graph builder, which edits the graph as two tables, and the coordinator's sign-off and tour are documented in `skills/prepare-research-graph/SKILL.md`.
Use those routes for new work; the kept-finding graph request described in older contracts remains supported for existing reviews.
The snapshot exposes walkthrough revisions, graph job progress, and returned drafts awaiting your sign-off.
`inspect-flow` retrieves the preserved explanation, job packet, the candidate draft with its computed difference, and graph reviews for one investigation.
Graph workers can complete while the coordinator is disconnected; the browser then explains that the coordinator is checking the draft.
On restart, an interrupted builder picks its draft back up from its saved files, up to its attempt limit.
The browser review persists reading position, supports source inspection and annotations, and shows the draft with its changes, including removed records as ghosts.
Accepting a draft validates the base revision and that newer feedback on the draft has reached the builder, then replaces the graph and keeps an undo.

## Boundaries

During explicit application maintenance, mistakenly dispatched UI annotations can be reclassified through the user command endpoint, `POST /api/commands`, using `{"type":"reclassify-annotation","investigationId":"...","annotationId":"...","feedbackId":"..."}`.
This requires a paused investigation with no lease and an existing feedback record whose text and references exactly match the annotation.
It refuses annotations already addressed by a proposal, preserves the complete original annotation under the feedback record's `origin`, records the move in investigation history, and removes the prepared assignment so the next worker receives a fresh brief.
Use this only for explicitly authorized routing corrections; it is not a research-worker command or a way to revise sent historical instructions.

The research CLI remains available for independent mode before a coordinator has attached.
Once coordinator supervision is enabled for a project, worker API publication is disabled so researchers cannot bypass synthesis.
Application behavior does not enforce semantic quality; the coordinating agent must actually evaluate evidence and retain uncertainty.
Native delegation availability and tool-call wake behavior depend on the host harness.
The wait protocol is portable across tool-capable agents, but automatic startup requires the harness to read the repository instruction file and begin an agent turn.
No claim is made that opening an idle terminal alone runs an agent.
