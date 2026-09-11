# Research workspace: first working slice

## Agreed product contract

The research artifact is the interface; there is no chat transcript or general chat composer.
Research, Ongoing work, Review, and Sources & access are persistent views of one workspace.
Explore is the default mode; an explicit button and keyboard shortcut enable element and text annotation.
Investigations are durable units of work, annotations direct them, and proposals are immutable revisions within them.
Annotations made on a proposal stay within its investigation and retain the proposal revision they address.
Queue and Investigate now control dispatch, not investigation identity.
Accepted research changes only when the user accepts the exact reviewed proposal.
Ambiguity, contrary evidence, prior proposals, and review decisions remain inspectable.
Source access and investigation scope are managed in the application.

## Architecture

Retain the existing D3/ELK genealogy explorer and its paper, sea-green, and rust visual language.
Reuse Lavish's MIT-licensed annotation engine in a research-specific host with no chat chrome.
A loopback Node service owns durable state, source imports, task leases, proposal validation, and atomic acceptance.
Store a working dataset separately from the checked-in historical seed.
Use one serialized writer and atomic file replacement; fail on corrupt state instead of silently resetting it.
Research workers read a bounded brief and snapshot, checkpoint progress, and return structured proposals through a small CLI.
Replacement workers receive saved work and a new lease; stale workers cannot publish results.
Reuse Firstmate's task-brief, checkpoint, delegation, and recovery principles without worktrees or PR delivery.
Do not fork its entire software fleet runtime before verifying the narrow research contract.

## First slice

- [x] Persistent investigations, grouped annotations, dispatch, pause, resume, and replacement-worker leases.
- [x] Structured proposal revisions with evidence, explicit ambiguity, before/after changes, and recorded acceptance or rejection.
- [x] Research host with four views and Lavish element/text annotation on graph and proposal content.
- [x] Local document import, folder registration, source capability indicators, and per-investigation scope.
- [x] Agent CLI and coordinator instructions with a checkpoint and provider-switch handoff contract.
- [x] Browser walkthrough and tests of persistence, grouped feedback, stale-worker exclusion, stale proposals, and acceptance.

## Deliberate first-slice limits

Connected subscription services require separately verified adapters; do not imply JSTOR access from a saved URL.
Text and Markdown are readable locally; PDF originals can be imported and viewed, with extraction capability described honestly.
The first apply operation accepts a coherent proposal atomically; independent decisions should be separate proposals.
Automatic source-lineage discovery and a general graph ontology are future extensions.
The first worker boundary is harness-neutral and explicit; UI status must never suggest an agent is running when none has claimed work.
Incremental polling updates badges and availability without replacing the active review or unfinished annotation.

## Verification scenario

Select a relationship, annotate it, and queue or dispatch an investigation.
Claim it, checkpoint a finding, replace the worker, and prove the old lease cannot publish.
Return a proposal with evidence and an unresolved alternative.
Make three follow-up annotations on that proposal and dispatch them as one investigation.
Return a revised proposal, accept it, and verify the exact change and retained history survive a server restart.
Confirm Explore permits normal navigation and Annotate intercepts graph elements and source/review text without navigating.

## Verification status

All 36 automated domain, persistence, graph, and process-supervision tests pass, along with TypeScript checking and the production build.
Browser checks cover graph exploration, element and text annotation, grouped proposal feedback, and preserved source quotations.
An isolated local HTTP walkthrough verified checkpoint recovery, stale-worker rejection, and a revised proposal addressing all four annotations.
Accepting that revision in the browser changed only the proposed record and preserved both proposal revisions, four annotations, and two checkpoints across a server restart.
The user authorized a live Codex trial on 2026-09-10; it completed successfully against the example’s imported-source scope.
The process lifecycle is tested with local simulated researchers.

## Agent-led startup and coordination

- [x] Repository instructions for research startup and a separate explicit development mode, with a Claude-compatible instruction entry point.
- [x] Project discovery, selection, topic-only empty creation, optional dataset import, service reuse, browser opening, and separate persisted project state.
- [x] Exclusive coordinator sessions, compact recovery indexes, explicit revision acknowledgments, and a browser-event wait loop.
- [x] Targeted search and inspection of entities, investigations, candidate findings, and preserved source passages, with a durable research map and coordinating handoff.
- [x] Coordinator-directed researcher briefs and a synthesis step before findings become human-review proposals.
- [x] Local integration verification of startup, event replay, session replacement, project isolation, and restart persistence.

The active coding agent supplies coordinating judgment and remains in a tool-call wait loop while the browser is in use.
A closed conversation is not automatically restarted; its work is retained for the next session.
The startup index excludes full datasets, source texts, and proposal histories; the coordinator retrieves relevant context as needed.
The latest verification comprises 43 automated tests, TypeScript checking, a production build, and the local CLI/HTTP integration scenario.
A live Codex researcher completed the imported-source example in approximately 103 seconds, saved three checkpoints, and returned a validated candidate.
Coordinator review verified both quotations and their line locators and published proposal revision 2 addressing all four annotations.
The proposal remains pending human review, with the accepted graph unchanged.
This verifies the configured Codex path for local-source research; web research and the Claude adapter still need separate live trials.

## Startup and organization repair

- [x] Put the complete ordinary startup procedure in AGENTS.md, shared with Claude through CLAUDE.md, and load specialized research contracts only when needed.
- [x] Create and attach from the human's topic alone, with automatic internal IDs and no speculative seed records.
- [x] Support an empty annotatable research surface and a place or organization as the graph focus.
- [x] Preview and apply graph organization in place, retaining sources and investigation history, with undo and stale-worker fencing.
- [x] Exercise topic-only CLI startup, live organization, resume, and the browser controls using isolated projects.
