# One shared research project

Status: discovery draft, 2026-09-18.
The product direction and interaction decisions below are established; detailed layout, migration, scheduling defaults, and implementation boundaries remain under discussion.
See [the workstream map](roadmap.md) for the nine recorded directions and their two work scopes.

## Problem Statement

Follow-up questions belong to the research the human is already exploring, but the application creates separate investigations and requires switching between them.
This hides preceding work, multiplies review ceremonies, and makes graph annotations feel like unrelated new projects.
The same boundary limits researcher context: previous findings from the assigned investigation are supplied, while findings elsewhere are not automatically supplied.
Merely hiding the investigation dropdown would leave the underlying fragmentation intact.

## Solution

The project is the durable home of the accumulated research.
Questions, contributions, evidence, sources, and the graph remain connected and discoverable across assignments.
The human follows the subject and its development rather than selecting an investigation container before interacting.

Questions and assignments remain identifiable records for provenance, progress, recovery, and scope.
Their identities do not determine visibility or permission to inspect other relevant project knowledge.
A new question within a project does not automatically create a separate graph or review workspace.
Distinct projects remain separate unless the human explicitly requests cross-project access or reuse.

## Proposed product boundaries

- One project has one accumulating graph, with findings and sources remaining useful even when they have no graph representation.
- An annotation identifies the material and revision it addresses when applicable.
  A freeform contribution does not require a selected object or an investigation choice.
- Follow-up work preserves links to the original question and relevant earlier contributions without enclosing its results in an exclusive container.
- Earlier explanations and evidence remain accessible when later work arrives.
  Findings remain historical returns rather than records continually rewritten into the latest interpretation.
- Progress belongs to bounded tasks; the project need not have a single running, paused, or finished research state.
  Existing explicit pause and resume-consent requirements remain in force.
- UI navigation can filter by question or show a question's history, but the filter does not establish a separate knowledge boundary.
- The project can contain several questions without requiring multiple concurrent workers in the first implementation.
- Updates guide the human to affected records without automatically replacing the current reading position.
  The exact update presentation and return-navigation behavior belong to the adjacent interaction workstream.
- Walkthroughs can cover a question or a meaningful set of developments.
  A full walkthrough is not required for every answer, and research need not produce graph changes.

## Agreed interaction and information model

### Findings and walkthroughs

Findings is a project-wide historical record of researcher returns, not a coordinator summary or a continually maintained current-truth surface.
The graph provides the maintained representation; walkthroughs explain discoveries and corrections.
Do not require per-finding supersession bookkeeping as part of this design.

Group findings by sent batch at the outermost level, because walkthroughs and graph preparation both use batch boundaries.
Within each batch, organize findings under readable question headings written by the coordinator from individual submitted queue items.
Preserve the exact human text and selected material for inspection beneath those headings.
Show assignment scope and researcher attribution alongside the returned work.
A left-hand table of contents scrolls within the accumulated findings with three levels: batches, questions within each batch, and expandable assignment headings beneath questions.
Where one batch ends and the next begins must be unmistakable in both the table of contents and the findings, for example by presenting each batch as a card containing its questions rather than relying on heading size alone.
Batch, question, and assignment headings organize navigation without restricting access to other research.

Keep the existing guided walkthrough experience, including the relevant supporting material displayed on the walkthrough page itself.
Displaying a saved finding there does not remove it from Findings or require a separately maintained copy.
Saved walkthroughs are independently accessible as a collection.

### Sending and grouping

One project-wide queue accepts annotations on sources, graph objects, findings, and walkthroughs, as well as freeform questions.
Any item can be sent immediately or queued with items from other surfaces.
Pressing Send queue establishes the batch boundary for a resulting walkthrough; Send now creates a one-item batch.
Later batches can be sent while earlier work continues.

Several researcher assignments may address one question, and an assignment may address more than one question when useful.
Preserve those associations independently of presentation grouping.
A dedicated walkthrough agent is an agreed direction for later execution work, allowing the coordinator to keep coordinating while presentations are authored.
The coordinator remains responsible for reconciliation and the delivered explanation.

### Cost control and graph preparation

The human must be able to prioritize research and inspect findings and sources without paying immediately for walkthrough or graph generation.
Automatic versus on-request defaults and their controls remain undecided.
A batch identifies a natural presentation boundary without requiring all output types to run immediately or finish simultaneously.

Graph preparation can catch up across several batches using the existing builder.
Capture a fixed research snapshot and starting graph revision when work starts, with a human-readable timestamp.
The builder can consult all research in that snapshot, including older evidence behind the current graph; newly added research is a starting point rather than the limit of its reasoning.
On successful application, record the incorporated snapshot boundary without requiring a disposition ledger for every finding.
An interrupted run does not advance that boundary.
One active graph builder per project is a proposed scheduling approach, not yet a finalized implementation decision.

The builder can surface inconsistencies to the coordinator and human.
Focused follow-up research remains linked to the originating questions and batch, with its actual cause recorded rather than attributed to a new human request.
Explicit snapshot supplements are a proposed way to incorporate such results into an active builder without silently including unrelated incoming research.
The autonomy and budget rules for commissioning this follow-up still require design.

### Persistent coordinator conversation

Use the existing annotations panel for a persistent project-wide conversation history alongside annotation composition and the unsent queue.
The coordinator can initiate a question; the human can reply and continue a short exchange without creating a new investigation or formal research workflow.
Messages retain references to the issue and research that prompted them.

A lightweight notification announces that the coordinator has a question and offers an action to open it.
That action opens the annotations panel at the relevant message in its history.
The notification itself is not a floating chat window.
Dismissing it does not discard the question; unread questions remain discoverable in the panel.

Messages can navigate the main surface to relevant graph objects, findings, or sources while the conversation remains available in the panel.
Preserve a return path to the human's previous location.
Distinguish input that would help from a decision required before affected work can proceed, and leave independent work usable.
The exact arrangement of conversation, composer, and queue within the panel remains to be designed.

## User Stories

1. As a researcher, I want to ask a follow-up while viewing existing work, so that the earlier evidence stays in context.
2. As a researcher, I want to annotate several graph objects without assigning investigations, so that I can express connected thoughts naturally.
3. As a researcher, I want earlier findings to remain discoverable, so that a new question does not hide what we already learned.
4. As a researcher, I want findings without graph representations preserved, so that uncertainty and textual explanations remain useful.
5. As a researcher, I want to understand which question prompted a finding, so that shared knowledge retains its original scope.
6. As a researcher, I want corrections connected to earlier statements, so that I can understand a changed interpretation.
7. As a researcher, I want updates to open the affected material, so that I can inspect their implications.
8. As a researcher, I want to return to my previous reading position, so that following an update does not derail my exploration.
9. As a researcher, I want to see outstanding work across questions, so that I can steer the project without switching workspaces.
10. As a coordinator, I want access to findings across prior assignments, so that I can answer or delegate using accumulated knowledge.
11. As a researcher agent, I want access to relevant project knowledge beyond my assignment's originating question, so that I do not repeat completed research.
12. As a returning user, I want existing research and references to survive this change, so that the new interaction does not discard prior work.

## Implementation Decisions

No migration or API contract is approved yet.
Current investigations bundle annotations, proposals, checkpoints, events, a worker lease, and review flows.
The project already stores a shared dataset and registered source library; this is not a proposal to merge multiple existing project graphs.

Candidate responsibilities for the design are project knowledge access, question and assignment provenance, and navigation through contributions and updates.
Existing investigation IDs may remain valid historical references during a staged transition.
Implementation must preserve evidence references, annotation targets, saved research, and recovery behavior rather than flattening everything into one oversized investigation record.
The later progressive-disclosure tooling can improve retrieval; the first scope must still establish project-wide discoverability and access.

## Testing Decisions

Proposed acceptance scenarios, to refine with the design:

- Follow an initial question with annotations on several graph objects and verify that earlier material stays accessible without an investigation selection.
- Ask a related question and retrieve an earlier finding that never entered the graph.
- Follow a correction to its affected record and return to the previous reading position.
- Open an existing project after migration and resolve its old evidence and annotation references.
- Keep explicitly paused work paused while inspecting and contributing elsewhere in the project.

Reuse fictional fixtures for application tests.
Live research is not test fixture material.

## Out of Scope

Multiple-worker scheduling, researcher board delivery, semantic retrieval, a redesigned acquisition subsystem, and a new graph builder are outside this first design scope.
The existing graph builder will need integration changes, which are tracked separately.
Removing internal safety checks or deleting historical data is not implied by removing user-facing approval ceremonies.

## Open Design Questions

1. What is the default project view that keeps current work and earlier contributions understandable without becoming a chat transcript or an endless activity feed?
2. How are conversation history, annotation composition, and the queue arranged within the existing panel?
3. Batches order the findings chronologically at the outermost level.
   How does a question that receives follow-up work in a later batch appear: repeated under each batch with links between occurrences, or in some other way?
   How are assignments spanning questions displayed within a batch?
4. What minimum project-wide knowledge access must ship in this scope before the fuller index and `read(id)` interface?
5. Which graph changes can arrive directly, and which consequential identity or removal decisions deserve explicit human attention?
6. How do old pending reviews and investigation states map into the new experience while preserving existing user choices?
7. What are the automatic versus on-request defaults for walkthrough and graph generation, and how does the human control spending and follow-up research?

## Further Notes

The immediate design exercise is one follow-up interaction within an established project.
Define what stays on screen, where the response appears, what it references, and how the human follows any changes.
Use that interaction to resolve the shared-project boundary before specifying the later agent infrastructure.
