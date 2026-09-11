# Research workspace: thinking after the first real trial

Working notes for future design and implementation, recorded September 11, 2026.
This is a synthesis of the discussion, not a finished specification or a commitment to every interaction described below.
It develops the earlier vision and revises assumptions that the first real trial exposed.
The original note preceded implementation; the implementation checkpoint below records the subsequent changes.

## Product intention

The product is intelligent research software operated through its browser surface.
The human explores material, asks questions, compares evidence, directs investigations, and decides what enters the graph.
The CLI agent supplies coordination and reasoning, but ordinary use should not require returning to its terminal.
A text input is useful; a chatbot transcript should not become the application's organizing structure.

Annotations are the central interaction, with or without selected references.
An investigation is the durable container for a question, its related instructions, research passes, findings, and reviews.
Its unit of execution can differ from the user's unit of work.
Several annotations on a returned finding can remain part of the same investigation rather than becoming unrelated jobs.

Ambiguity is useful research material, not a failure state to filter out.
The tool must preserve an attributed assertion even when it cannot establish that assertion as historical fact.
Finishing a research pass does not mean settling its question.

## What the first trial showed

A real investigation produced several revisions and substantial evidence, but its accepted graph contained only four entities and no relationships.
The review preserved evidence and history, but mixed older interpretations with their corrections and required excessive scrolling.
Source records were present without preserved originals, while the Sources tab primarily exposed imports.
The private trial observations and original notes are retained under `.research/archive/notes/`.
The actual worker route and provider selection remain to be verified.

## Direction: separate investigation from graph construction

The earlier design made a single proposal explain research, hold evidence, specify graph operations, and act as one acceptance unit.
The trial makes that combination look too restrictive.

Use an explicit investigation/synthesis phase and an explicit graph-construction phase.
An agent naturally working sequentially is not enough to establish this separation.
Each phase needs a clear task and saved inputs and outputs so the model can concentrate on the job at hand.

### Investigation and synthesis

Researchers gather material under bounded briefs.
The coordinator compares sources, develops findings and arguments, identifies holes, and directs further passes.
The human reviews findings, questions interpretations, accepts some, sets others aside, and adds missing questions.
Graph design is not a required output of every research pass.

Findings need a durable, inspectable home outside the temporary presentation of a proposed graph patch.
Retain supported conclusions, source-reported assertions, contested interpretations, and unresolved alternatives with evidence references.
Review acceptance should mean the finding accurately records what was learned, including its limits; it must not automatically declare every underlying assertion true.
The exact vocabulary and controls for this distinction remain to be designed.

### Graph construction

A separate pass takes a specific revision of selected findings plus the relevant existing graph.
Its job is representation: identify entities, distinguish sites from businesses and people, resolve references where justified, propose properties and relationships, preserve qualifications, and connect the representation to evidence.
It should identify meaningful findings it cannot represent instead of silently dropping them.

This pass may use a dedicated agent, but a separate model process is not the essential requirement.
The essential requirements are a focused brief, bounded context, durable output, and traceability to the findings it used.
The coordinator remains responsible for overall intention and research decisions.

The human should be able to request graph construction from a useful subset of findings while other research remains open.
Do not require exhausting an entire research space first.
Do not automatically turn every name mentioned in prose into a node.
Check for meaningful missing relationships such as ownership, location, leasing, and successive site uses.

### Graph review

Preferred direction: show proposed additions and revisions on the actual graph, clearly distinguished from accepted content.
The human explores and annotates that proposal using familiar graph interactions before applying changes.
Graph construction gets its own review without requiring a separate technical patch-reading experience.

Keep an explicit application boundary for now.
Continuous annotatability alone does not justify silently modifying the accepted graph.
The exact comparison presentation, treatment of removals, and acceptance granularity need prototyping.

## Partial acceptance and revision

Whole-proposal acceptance is insufficient.
The human needs to keep some findings, question others, request absent work, and continue accepting useful results as an investigation develops.
An investigation can contain a mixture of accepted, pending, deferred, and superseded findings.
Its overall work status should not stand in for those individual decisions.

For graph review, aim for meaningful assertions or coherent changes rather than raw database operations as the decision unit.
Accepting an ownership relationship may require introducing its person and mill; dependencies need to be visible and handled without three disconnected approvals.
Existing entities should be reused when their identity is established.
Do not silently accept unresolved dependencies or imply certainty that the source does not support.

Follow-up annotations reference the exact finding or graph-proposal revision questioned.
Previously accepted material stays accepted until an explicit subsequent change alters it.
Pending representations based on findings that change need reconciliation before application.
Existing immutable revisions, stale-result checks, and atomic application are useful foundations to retain while changing the acceptance unit.

## Evidence, findings, and graph objects

Do not equate a persistent data object with a required visible graph node.
A source can be a node in an optional source layer.
A passage can remain an addressable part of a source, linked to findings.
A claim may be represented by a relationship, a property, or a qualified assertion rather than a separate visible claim node.

For example, ownership can be an edge between a person and a mill, with its date, evidence, qualification, and originating investigation inspectable from the edge.
An uncertain founding date can remain a source-attributed assertion rather than becoming the mill's unqualified date.
The precise representation of competing assertions is still open.
Preserving them only in long prose would leave the underlying problem unresolved.

Accepted findings should remain discoverable from the sources, entities, and relationships they inform.
The current investigation record and its revision history serve different purposes: current understanding versus how understanding changed.
Preserve both, without making the human reconcile withdrawn and current interpretations in one undifferentiated evidence list.

## Review presentation

Support a focused card view and a continuous reading view over the same review units.
Cards should group a meaningful finding or decision with its relevant evidence, uncertainty, and, in graph review, proposed graph consequences.
Do not merely put the existing 28 evidence entries into a carousel while leaving the synthesis and consequences elsewhere.

Make changes since the previous review apparent so follow-ups do not require rereading everything.
Support moving forward, going back, jumping to an item, and setting something aside.
Navigation through cards is not itself acceptance.
Stable references must survive switching between card and continuous views.

Preserve paragraph breaks and provide readable hierarchy immediately when implementing review changes.
An accepted investigation should read as a durable research record, with its conclusion and open questions easy to find.
Process history and correction narratives remain available without dominating that record.

## Sources and access

The Sources tab should primarily show the sources collected during research, including web source records, rather than only import controls and access collections.
Selecting a source should expose its material when available, recorded passages, related findings, and connections to graph content.
Sources should be annotatable research objects.
Importing documents, scanning folders, and configuring access remain supporting controls in this area.

Distinguish discovery, metadata-only access, abstract access, full-text inspection, and preservation of an original where relevant.
Do not let an article found in a catalog quietly become evidence for uninspected contents.
Recording a source does not require endorsing its claims or waiting for graph acceptance.
Live pages, archived captures, editions, and reused quotations need enough identity to locate what was actually read.
The exact source/capture data model and supported file-reading capabilities require implementation investigation.

An optional source layer on the graph remains a promising direction.
Start by revealing sources relevant to a selected entity, relationship, or finding; opening a source could reveal the other subjects it informs.
Showing every evidence connection at once may obscure the research graph.
The source inspector and durable connections should precede deciding the full visualization.

## Researcher tools and coordination visibility

Researchers should be able to use direct retrieval, headless browsers, visible browsers, and computer interaction where the runtime provides it.
The trial record already reports browser and archive use after human prompting; the gap is not simply total absence of browser capability.
Inspect available tools, worker instructions, and delegation paths before deciding what must be added.

Access failures should produce actionable requests for help in the application, such as opening an institutional session or supplying a document.
Other investigations can continue while one waits for access.
Successful intervention should allow that investigation to resume with its context intact.
Available tools, source access, and an agent's ability to use a particular signed-in session are distinct capabilities.

Make the actual assigned researcher/provider/model visible, as far as runtime metadata establishes it.
Clarify how the saved provider preference affects managed workers versus native delegation.
Model preferences must not appear to control a route that ignores them.
Preserve recovery and switching between coding-agent sessions without introducing another coordinator underneath the current agent.

## Annotations and the Lavish UI Review inspiration

Inspected `/Users/davidb/Documents/Code/lavish-axi-fork`, including its actual interface in an isolated local session.
The useful mechanisms are multiple references attached to one instruction, a queue visible before sending, direct text without selection, and a collapsible panel outside the inspected surface.
The fork combines a selection editor, general message input, conversation log, and queued previews.
Its inspected queue visibly supports removal and its code supports keyed replacement; a complete general inline-editing flow was not verified.
Do not assume all desired editing behavior is available to copy unchanged.

Provide one annotation composer for zero, one, or several references.
A reference-free question still belongs to a project or investigation.
Multiple references are especially useful for comparing passages, asking whether two records describe the same entity, or investigating an apparent contradiction.
One instruction with several references remains one instruction; several instructions sent together remain distinct.

Show readable, removable reference chips and the instruction's destination.
Adding references or navigating between cards should preserve the draft.
References should use stable research identities and exact revisions where available, with text selections and DOM anchors supplying additional precision.
Cross-surface selection is useful but its behavior still needs testing.

Before sending, allow editing wording, references, and destination, and deleting drafts.
After sending, preserve what the worker received and record amendments rather than silently rewriting an active assignment.
The annotation list belongs in Investigations, alongside sent status and history.
The composer supports creating or editing from wherever the human is working.
Queue and Send now should remain available while unrelated research runs; the fork's global working-state send block does not fit this workflow.

### Composer placement remains provisional

A popup over the surface obstructs selection of additional references.
That was the reason the human moved composition into a sidebar in Lavish UI Review.
Do not repeat the popup recommendation without solving that problem.

The current graph already has a right-side node inspector.
Two permanent right-side drawers would compete for space and attention.
A permanent conversation panel could also overpower the tab-based research workflow.

Current candidate: a docked annotation panel that opens when needed, resizes the surface instead of covering it, and preserves drafts when closed.
It might share one right-hand column with the node inspector, with inspectable details above the composer during selection.
This was an assistant suggestion, not a settled user decision.
Test the space available for reading long node details, selecting additional targets, and writing before committing to it.
Collapsibility is a means of controlling attention and space, not a product requirement to copy for its own sake.

## Navigation and progression

Working tab names are Graph, Investigations, Review, and Sources.
Graph is clearer than Research because every surface participates in research.
Investigations is a candidate replacement for Ongoing work, which also contains completed material and annotation history.
Names remain adjustable.

Tabs are stable destinations, not a mandatory linear wizard.
Within each investigation, make the current phase and available next action clear.
Contextual actions can connect evidence review, further investigation, graph construction, and graph review.
Different investigations and different findings may be at different stages simultaneously.
Do not force a simple global progression onto that mixed state.

## Using the tool to improve its own interface

The human wants to capture product feedback in context during real research because there are too many observations to remember afterward.
Use the same annotation mechanism with an explicit interface-feedback destination.
Keep those instructions distinct from historical research assignments.
Drawing and region markup are promising for interface feedback; ordinary research can begin with text and object references.
The exact development feedback storage and coding-agent handoff have not been designed.

## Implementation guidance and remaining design work

Use the saved private trial as a realistic fixture for design and read-only inspection.
Preserve the user's actual project, accepted research, and review history while developing and testing changes.
Do not rewrite historical proposals merely to make their current presentation cleaner.
Retain the topic-only empty startup, browser-first workflow, progressive coordinator context, source scoping, and recovery already built.

An implementation dependency is emerging: durable reviewable findings and their identities underpin partial acceptance, source inspection, annotation references, and the separate graph pass.
Define the smallest coherent contracts for those objects and transitions before wiring all the screens together.
This does not require finalizing the entire ontology or interface in advance.

Questions to resolve through implementation and prototypes include:

- What exactly does keeping or accepting a finding assert, and how is that distinct from historical confidence?
- How are competing assertions represented and inspected without forcing every assertion into a visible node?
- How does partial graph acceptance handle shared entities and dependent relationships?
- How does a revised finding affect pending or already applied graph representations?
- How can current understanding be reconciled while retaining immutable historical reasoning?
- Can node inspection and multi-reference composition share a column comfortably?
- What source material can be preserved and rendered by the available runtimes?
- Which worker route actually ran in the trial, and how should preferences govern future assignments?

These are design tasks to work through, not a request for another exhaustive user interview before progress.
The current agreement is strongest on separating research from graph construction, preserving ambiguity, allowing partial review, making sources accessible as research objects, and providing annotations without mandatory selections.
The composer layout, detailed state vocabulary, source-graph visualization, and graph acceptance mechanics remain hypotheses to test.

## Implementation checkpoint: September 11, 2026

The first Git commit captures the existing application after separating private research under ignored `.research/` storage.
This second implementation preserves historical proposals while adding a distinct contract for new research.

- [x] Keep qualified findings independently of graph changes, with replacement references and preserved history.
- [x] Request a separate graph pass from exact kept findings, with explicit dependencies, partial application, and recorded omissions.
- [x] Show graph previews with changed content distinguished, and retain an explicit application boundary.
- [x] Support card and continuous review, readable paragraphs, stable references, and historical review navigation.
- [x] Expose a source library, recorded passages, related findings, accepted graph connections, and access metadata.
- [x] Support reference-free and multiple-reference instructions, persistent drafts, unsent edits and moves, and immutable sent amendments.
- [x] Dock composition outside the reviewed surface and share its column with node inspection.
- [x] Store interface feedback separately and make it inspectable in Investigations and through coordinator inspection.
- [x] Give researcher passes distinct instructions, honor the managed provider preference, and show actual assignment metadata when known.
- [x] Pause for source-access assistance and resume from saved context through the browser.
- [x] Verify domain transitions, local HTTP/CLI integration, graph preview, draft retention, source inspection, and narrow-screen layout using fictional material.

Keeping a finding retains its qualified account, including unresolved or disputed assertions.
Graph acceptance applies selected coherent groups; declared dependencies require explicit selection or previous acceptance.
Corrections supersede earlier findings only when kept, invalidate pending representations based on them, and leave applied records for explicit subsequent review.
Legacy reviews keep their original whole-proposal behavior instead of receiving fabricated structured findings.

The optional source graph layer and drawing annotations remain design experiments, not implemented controls.
The source inspector and durable links provide the foundation for deciding whether that visualization helps.
Browser and computer interaction depend on the research runtime; this change enables available browser tooling and assistance requests, not a universal desktop automation service or institutional login integration.
The historical trial's actual model identity remains unverified; new assignments record the provider and identify unreported model metadata honestly.
The docked layout is implemented and browser-tested, but its usefulness during sustained real research still needs the human's judgment.
