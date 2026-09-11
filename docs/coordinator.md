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
Waiting refreshes its 90-second session lease; during active work use snapshot at least once per minute.

Acknowledgment is explicit and advances only up to a revision actually read by that session.
Activity is delivered again until acknowledged; merely receiving a response never consumes it.
The revision is a cursor into the durable workspace state, not a separate destructive event queue.
A wait returns when that state changes or after 50 seconds, so the agent must continue its tool loop.
It does not inject messages into a closed conversation or start a new agent turn after the agent has ended.
The agent instructions require it to remain in this loop while operating the research workspace.

Disconnecting leaves dispatched work, checkpoints, candidate findings, and proposals intact.
A new agent attaches after detach, session expiry, or server restart and receives an index into the saved state.
Coordinator-owned running investigations are requeued with old worker leases fenced on takeover.
Managed researchers can finish already assigned work while the coordinator is absent; their results wait for its return.
After a server restart, interrupted managed processes are paused, while completed candidates remain available for synthesis.
User-paused investigations are never automatically resumed.

## Learn the project progressively

```sh
npm run coordinator -- search "Alex employment" --session /path/returned/session.json
npm run coordinator -- map /path/to/research-map.txt --session /path/returned/session.json
```

Search returns bounded excerpts and stable references across entities, investigations, candidate findings, and preserved text documents.
Inspect the referenced records through command files:

```json
{"action":"inspect","kind":"entity","table":"people","id":"maxwell-russell-comstock"}
```

Entity inspection returns that record, references to directly related records, and related investigations.
Use the returned IDs rather than guessing record names.
Other inspection kinds are `investigation`, `candidate`, `source`, `map`, and the paginated `investigations` index.
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
Respect each investigation's source scope when sharing findings.
At most two managed researchers run concurrently, and each pass has a ten-minute limit.
An assignment records the dispatched annotation IDs; newly dispatched feedback prevents an outdated assignment from starting.
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
    "title": "A reviewable conclusion",
    "summary": "The evidence and the limited inference it supports.",
    "ambiguity": "What remains unresolved.",
    "evidence": [],
    "changes": []
  }
}
```

Omit `proposal` to publish the exact inspected candidate unchanged.
For coordinator-owned/native work, omit `candidateId` and provide the reconciled proposal.
Follow `docs/research-agent.md` for full evidence and change schemas.
Publishing revalidates the current lease, exact before records, source references, and quoted text before creating an immutable proposal revision.
It does not change accepted research.
Only the human's browser acceptance applies the proposal.

If a candidate needs another research pass, use `{"action":"revise","investigationId":"...","notes":"What failed and what the next pass must investigate"}`.
This preserves the candidate, records the correction as a checkpoint, and requeues the investigation for a fresh assignment.
A paused or superseded candidate cannot be published.
Use `handoff` for durable project-wide decisions, relationships among investigations, and the next coordinating steps.

## Boundaries

The research CLI remains available for independent mode before a coordinator has attached.
Once coordinator supervision is enabled for a project, worker API publication is disabled so researchers cannot bypass synthesis.
Application behavior does not enforce semantic quality; the coordinating agent must actually evaluate evidence and retain uncertainty.
Native delegation availability and tool-call wake behavior depend on the host harness.
The wait protocol is portable across tool-capable agents, but automatic startup requires the harness to read the repository instruction file and begin an agent turn.
No claim is made that opening an idle terminal alone runs an agent.
