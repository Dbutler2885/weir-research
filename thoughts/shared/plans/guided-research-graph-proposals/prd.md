## Problem Statement

The researcher receives a pile of findings without a clear connection between the question they asked, the answer, the evidence, and the graph those findings could produce.
Reading requires ceremonial decisions on findings even though all research is already saved.
Graph construction waits for those decisions, and the interface exposes process state without reliably explaining where to look next.
Uncertain identities and relationships are difficult to preserve without either prematurely merging entities or leaving disconnected records.

## Solution

The coordinator returns a guided explanation that begins with the original question, a short research journey, the answer, and its important caveats.
Evidence screens build understanding through meaningful transitions, at the reader's pace.
Reading and annotating the walkthrough do not require approving findings.

After writing the walkthrough, the coordinator immediately prepares an assignment for a separate graph builder.
The builder prepares a graph proposal while the human reads.
It can search the existing research graph and inspect the original evidence, and it can send specific questions to the coordinator.
The coordinator can supply updates and commission bounded follow-up research within the existing question and authorized limits.
Follow-up work remains part of the same investigation and evolving proposal.

The proposed graph is a review surface in its own right.
A graphical walkthrough introduces additions and guides attention to consequential identity, relationship, and uncertainty decisions.
Each stop focuses the relevant graph elements and opens the existing sidebar with explanation and evidence.
The human explores, annotates, and eventually applies proposed graph changes.
Applying a representation preserves its qualifications; it does not certify historical truth.

## User Stories

1. As a researcher, I want my question restated when results arrive, so that I understand what the work addresses.
2. As a researcher, I want an answer and essential caveats before detailed evidence, so that I can orient myself.
3. As a researcher, I want a brief account of meaningful research developments, so that I understand how the answer was reached.
4. As a researcher, I want connected evidence screens, so that each step prepares me for the next.
5. As a researcher, I want to inspect a source passage from a claim, so that I can assess the interpretation.
6. As a researcher, I want to annotate any part of the briefing or evidence, so that feedback stays connected to its subject.
7. As a researcher, I want to continue reading without accepting findings, so that learning is not confused with approval.
8. As a researcher, I want my reading position preserved, so that background work does not interrupt me.
9. As a researcher, I want graph preparation to begin while I read, so that I can move naturally into its review.
10. As a researcher, I want visible preparation status with a destination, so that I do not need the terminal to understand progress.
11. As a researcher, I want a graph-ready action that opens the proposal, so that notifications tell me where to look.
12. As a researcher, I want a visible paused or failed state with a recovery action, so that a stalled task is understandable.
13. As a researcher, I want explicit pauses and budgets respected, so that autonomy stays within my instructions.
14. As a researcher, I want additions and changes distinguished in a graph preview, so that I understand their effects.
15. As a researcher, I want a graphical tour that focuses new nodes and meaningful connections, so that I can grasp the overall representation.
16. As a researcher, I want the tour to explain consequential uncertainties, so that I can judge how they are represented.
17. As a researcher, I want the existing sidebar to hold tour guidance and evidence, so that multiple overlays do not compete for attention.
18. As a researcher, I want to explore freely and return to the tour, so that guidance does not constrain investigation.
19. As a researcher, I want uncertain connections to remain visible after application, so that their qualifications survive review.
20. As a researcher, I want factories, businesses, and people distinguished where needed, so that similar names do not conceal different entities.
21. As a researcher, I want plausible identity matches represented without forced merging, so that uncertainty remains investigable.
22. As a researcher, I want properties and relationships linked to evidence, so that a sidebar can explain individual assertions.
23. As a researcher, I want conflicting accounts preserved, so that revising the graph does not erase useful evidence.
24. As a researcher, I want significant unrepresented findings accounted for, so that useful research does not silently disappear.
25. As a coordinator, I want a focused builder brief with evidence references and graph access, so that the builder can retrieve what it needs.
26. As a builder, I want search, inspection, neighborhoods, and evidence tracing, so that I can resolve relevant context without loading the whole project.
27. As a builder, I want to report confusion with consequences and a provisional treatment, so that the coordinator can decide whether more research is worthwhile.
28. As a coordinator, I want to send sequenced updates to an active builder, so that annotations and research can inform the proposal without restarting all work.
29. As a researcher, I want follow-up evidence incorporated into the same proposal, so that I review changes in context.
30. As a researcher, I want a material correction to the answer brought to my attention, so that I understand changes before applying the graph.
31. As a researcher, I want proposal revisions and their differences preserved, so that I can understand how an interpretation evolved.
32. As a researcher, I want stale changes prevented from overwriting newer work, so that concurrent activity preserves my decisions.
33. As a researcher, I want coherent groups and explicit dependencies, so that partial application cannot leave broken references.
34. As a researcher, I want rejected representations and their sources retained, so that rejection does not discard research.
35. As a researcher, I want portable records and original artifacts, so that the research remains usable outside this interface.
36. As a maintainer, I want prompt inputs, raw outputs, and checks saved in isolated experiments, so that agent behavior can be evaluated before application integration.

## Implementation Decisions

- The investigation holds the enduring question, annotations, research passes, evidence, walkthroughs, and graph proposal revisions.
  The proposal is a versioned working change set that can evolve through feedback, similar to a code review, while retaining research-specific uncertainty.
- Research capture, walkthrough preparation, graph preparation, and proposal review have distinct activity states rather than a single mutually exclusive phase.
  The coordinator completes its explanatory synthesis before assigning the builder; the human's reading can overlap the builder's work.
- Single-response walkthrough generation is the current experimental baseline.
  Reader screens and model calls are independent concepts; this is not a requirement to generate every future artifact in one response.
- A provenance module stores source captures, passages, claims, qualifications, reasoning, and supersession with stable identifiers.
  Entity labels identify records; factual properties and relationships live in claims with exact evidence references.
  Relation stance belongs to the claim-evidence link, since one passage can support one assertion while challenging another.
  The source artifact and researcher return remain preserved independently of graph application.
- A query module exposes search, inspect, bounded neighborhoods, and evidence tracing through a read-only agent interface.
  Responses include relevant dates, types, qualifications, source access, and review status, with explicit pagination and truncation.
  The coordinator supplies orientation and initial references; the builder can retrieve more context itself.
- A proposal module owns immutable input revision references, changes, dependencies, omissions, and graphical walkthrough steps.
  Proposed changes are validated before publication and again before application against current base records.
  Graph construction no longer depends on finding acceptance.
- A graph builder receives a bounded assignment, the coordinator's explanation, raw research references, graph snapshot identity, scope, and update cursor.
  It produces proposed entities and claims, grouped changes, identity decisions, escalations, and notes explaining consequential representation choices.
  The coordinator inspects that proposal and writes the graphical walkthrough, maintaining the same guiding voice and progression as the evidentiary walkthrough.
  It writes proposals rather than live records.
- A builder works in a durable private output directory and saves coherent pieces and recovery checkpoints as it progresses.
  Its deliverable is CSV tables for nodes, claims, evidence links, groups, finding coverage, identity decisions, issues, and representation notes, with Markdown working notes.
  Software reads and validates those files; any internal JSON conversion is ordinary application work rather than a second model generation.
  It chooses the work division; the output need not fit into a single response.
  The harness preserves streamed messages and resumable session state where available, while saved artifacts support replacement sessions across providers.
  Progress and completion are explicit signals separate from the deliverable; a turn ending or process exit alone does not establish completion.
  Completion identifies the submitted artifacts, input revisions, and consumed update cursor.
  The orchestration module freezes that submission and validates the assembled proposal before the coordinator inspects it and prepares the graphical walkthrough.
  Interrupted work stays recoverable without being published as a completed proposal.
- An orchestration module routes annotations and research returns to their investigation and proposal.
  Updates have IDs, sequence numbers, base revision, affected references, and acknowledged consumption.
  A builder declares which updates it consumed and flags unresolved dependencies; the coordinator reconciles later material before publication or application.
  An annotation alone does not invalidate every graph element or require restarting the builder.
- Builder escalations distinguish research uncertainty, missing retrievable context, and representation limitations.
  The coordinator may commission bounded in-scope research within user limits; explicit pauses retain the existing human-confirmed resume rule.
  Broad scope expansions return to the human, while unresolved research may remain as an uncertain connection.
  Only dependent changes need to wait for a blocking issue.
- New follow-up evidence can feed the builder after coordinator assessment without a mandatory second full walkthrough.
  Its effect is explained at the relevant graph review stop; a material change to the answer is surfaced prominently with comparison and evidence.
- The review module renders the walkthrough and graph proposal, preserves navigation position, and directs status actions to their actual destination.
  A graph tour includes an orientation, grouped additions, consequential questions, and a conclusion leading to application.
  Each stop has focused node/claim IDs and sidebar content, with source inspection and the existing annotation interaction.
  The user can leave and rejoin the tour without a modal trapping focus.
- Application is an explicit human action over the previewed revision and chosen coherent groups.
  Dependencies are displayed and selected explicitly; applying is atomic and creates an auditable revision.
  Uncertainty styling and claim provenance remain accessible on the applied graph.
- A local relational implementation with indexed relationships is the proposed storage baseline; a dedicated graph database is not required for the first implementation.
  The query contract remains independent of storage, and exports preserve IDs and provenance.
  Database migration is implementation work beyond the current headless experiment.

## Testing Decisions

Tests assert externally observable behavior and meaningful invariants rather than exact prose or internal helper structure.
The proposed test scope is provenance integrity, graph queries, proposal revisions and application, coordinator/builder updates, and a browser flow for the combined review experience.
This module division and test scope were presented to the human for optional adjustment during PRD preparation.

- Provenance tests cover exact capture references, supporting and challenging evidence on the same claim, supersession, and retained originals.
- Query tests cover aliases, distinct entities with shared names, qualification preservation, bounded neighborhoods, and explicit pagination.
- Proposal tests cover unresolved identity without forced merging, dependency validation, orphan prevention, stale inputs, atomic application, and retained uncertain claims.
- Orchestration tests cover updates arriving during generation, consumed update cursors, duplicate delivery, focused escalation, in-scope follow-up, and explicit pause approval.
  File-delivery tests cover quoted and multiline CSV text, incomplete submissions, frozen revisions, dangling evidence references, and preservation of work across interruption.
- Browser tests cover reading while the builder works, graph-ready navigation, camera focus plus sidebar guidance, annotations in a proposal, and a contextual revision without losing reading position.
- Existing findings tests provide prior art for coherent groups and evidence validation.
  Existing coordinator and researcher tests provide prior art for leases, pause/recovery, and publication boundaries.
  Existing workspace UI tests and integration scripts provide starting points for navigation and end-to-end review behavior.
- The first experiment runs the builder against an immutable private research snapshot and checks its proposed graph references.
  The coordinator then prepares a separate graphical walkthrough from the graph and builder notes, with validated focus references.
  All raw outputs remain preserved.
  Public test fixtures are fictional.
  Model output quality is reviewed separately from structural validation, since valid references do not establish historical truth.

## Out of Scope

This preparation task does not implement or migrate the application, alter a live investigation, or apply generated graph records.
It does not select a hosted graph database, implement the full source-acquisition subsystem, or expose Git terminology to users.
It does not resolve all historical questions or require all uncertainty to be settled before graph creation.
Detailed notification styling and the full annotation-response experience will be tested in the application phase.

## Further Notes

The current implementation already has evidence-bearing findings, graph groups, source records, coordinator candidates, and contextual inspection.
It still gates graph requests on kept findings, uses broad record-level confidence for context connections, and renders finding arrays largely directly.
Its graph tour and claim-level property provenance have not yet been implemented.

The headless graph contract is an experimental design artifact, not an accepted payload for the existing live proposal API.
The first real research example has an empty accepted graph, so it tests initial construction but cannot establish the quality of searching or deduplicating an existing graph.
Those capabilities require later fictional nonempty fixtures and query integration.

The guiding metaphors are a patient guide who explains what to expect and a string of magnetic balls whose connections hold only when the reader can follow each transition.
These apply to the graphical walkthrough as much as to the evidentiary one.
