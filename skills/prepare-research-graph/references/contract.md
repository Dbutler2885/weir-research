# Experimental graph-builder contract, version 1

This is a proposed research representation for an isolated experiment.
It is not compatible with the live application's graph-publication API yet.

## Input

The packet supplies a question, walkthrough, research revision, base graph revision, existing nodes and claims, exact finding and evidence registries, source records, coordinator notes, and sequenced updates.
Registry keys are opaque stable strings; copy them exactly.
Evidence records retain source IDs, quotes, locators, access notes, and the researcher's interpretation.
The available retrieval capabilities and whether the graph snapshot is complete are explicit.

## Deliverable: CSV files

Create and edit these files in the supplied working directory using the available file tools.
Save coherent pieces as you work; choose your own order and how much to complete per tool call.
The files are the deliverable, and the final conversational response can simply point to them.
The runner reads the CSVs directly; it generates any internal JSON representation itself.

Use UTF-8 CSV with the exact headers below, comma delimiters, and standard CSV quoting.
Quote cells containing commas, quotes, or newlines; escape a quote by doubling it.
Keep an empty cell for absent optional values.
Fields listing IDs use `|` between IDs, with an empty cell for no IDs; use IDs without `|` or whitespace.
The `alternatives` cell contains one alternative per line inside a quoted cell.
Include the header even when a table has no rows.

| File | Header |
| --- | --- |
| proposal.csv | schemaVersion,baseGraphRevision,researchRevision,consumedUpdateSequence,title,summary |
| nodes.csv | id,kind,label,existingId |
| node-evidence.csv | nodeId,evidenceRef |
| claims.csv | id,subjectId,predicate,objectType,objectValue,qualification,time,reasoning |
| claim-evidence.csv | claimId,evidenceRef,role |
| groups.csv | id,title,nodeIds,claimIds,dependsOn |
| identities.csv | nodeIds,decision,reason,evidenceRefs |
| coverage.csv | findingRef,nodeIds,claimIds,omissionReason |
| issues.csv | id,kind,question,nodeIds,claimIds,evidenceRefs,provisionalTreatment,requestedResearch,blocksGroupIds |
| representation-notes.csv | id,nodeIds,claimIds,issueIds,decision,alternatives,reason |

`proposal.csv` has one metadata row.
In `claims.csv`, `objectType` is `entity`, `text`, or `number`; `objectValue` contains the target node ID or literal value.
`node-evidence.csv` and `claim-evidence.csv` have one row per evidence link.
Keep longer working explanations in `notes.md` and recovery state in `checkpoint.md`.
You can update `status.txt` with a short meaningful progress message.
When every file is ready for inspection, write exactly `done` to `submission.txt` and finish the turn.
The runner validates and freezes the files after the worker exits; it reports incomplete or invalid submissions to the coordinator for recovery or correction.
If asked to revise a submission, clear `submission.txt` first and write `done` again when the revision is ready.

## Record meanings

The following describes the records assembled by software from those CSV tables.
Array-valued record fields correspond to the ID lists or evidence-link rows above.

- `schemaVersion`: `1`.
- `baseGraphRevision` and `researchRevision`: copy the input revision values.
- `consumedUpdateSequence`: the last update sequence incorporated, or `0`.
- `title` and `summary`: a short account of the proposed graph.
- `nodes`: records with `id`, `kind`, `label`, `existingId` (null for new nodes), and `evidenceRefs` (registry keys).
  Kinds are `person`, `organization`, `facility`, `place`, `event`, or `observation`.
  Keep historical details in claims rather than unqualified descriptions on the node.
- `claims`: records with `id`, `subjectId`, `predicate`, `object`, `qualification`, `time`, `reasoning`, and `evidence`.
  `object` is exactly one of `{"entityId":"node-id"}` or `{"value":"literal statement, date, or quantity"}`.
  `qualification` is `supported`, `reported`, `inferred`, `disputed`, or `unresolved`.
  `time` is null or a human-readable temporal scope such as an exact date, interval, or approximate period.
  `evidence` is a list of `{"ref":"evidence-registry-key","role":"supports|challenges|context"}`.
  A literal can be a number as well as a string.
  An unresolved claim can have no evidence only with substantive reasoning identifying the open question.
  Entity-valued claims form visible graph connections; literal-valued claims form inspectable properties or observations.
- `groups`: records with `id`, `title`, `nodeIds`, `claimIds`, and `dependsOn` (group IDs).
  Each proposed node and claim belongs to exactly one group.
  Cross-group references to new nodes require explicit dependencies.
- `identityDecisions`: records with `nodeIds`, `decision`, `reason`, and `evidenceRefs`.
  `decision` is `reuse`, `distinct`, or `possible-match`.
- `coverage`: one record for every supplied finding key, with `findingRef`, `nodeIds`, `claimIds`, and `omissionReason`.
  Use a substantive omission reason when no node or claim represents the finding.
  Background can remain in the research without becoming graph clutter.
- `issues`: records with `id`, `kind`, `question`, `nodeIds`, `claimIds`, `evidenceRefs`, `provisionalTreatment`, `requestedResearch`, and `blocksGroupIds`.
  `kind` is `research`, `context`, or `representation`.
  `requestedResearch` can be null when uncertainty can simply remain.
- `representationNotes`: records with `id`, `nodeIds`, `claimIds`, `issueIds`, `decision`, `alternatives`, and `reason`.
  These explain representation choices to the coordinator, who writes the user-facing graphical walkthrough separately.
  `alternatives` is a list of strings describing plausible alternatives considered.

## Boundary and validation

All references must resolve in the proposal or supplied existing graph.
The validator checks structure, reference integrity, coverage, group dependencies, and input revisions.
When a supplied source registry omits records referenced by used evidence, the validator reports warnings for coordinator resolution while preserving the structurally valid draft.
Structural validity alone does not authorize publication or establish source completeness.
Semantic review checks whether the evidence supports the predicates and qualifications, whether useful relationships are missing, and whether representation notes expose consequential choices for the coordinator.
For this initial experiment, nodes and claims are proposed additions; removals, merging existing records, and changing existing assertions require a future explicit before/after change contract.
Report a representation issue rather than silently replacing an existing identity.
