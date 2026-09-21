# Draft graphs

Status: design agreed with the human on 2026-09-20 and revised on 2026-09-21; not implemented.
The revision reduces the graph to nodes and edges, removes unions and direct parentage, and hands the builder two editable tables that cite evidence by identifier.
A serialisation module and a diff module exist and are committed, but they were built for the earlier ten-table shape and need rework.
The builder handoff, the accept path, the review surface, and the migration are not built.

## Problem Statement

The human asked for a straightforward change to their graph.
Three facility nodes describe one building, so they should be one node.
Firms that ran a single factory should sit inside that factory rather than beside it.
A street the research places should appear as a place.

None of that happened, and it could not have happened.
A graph builder cannot merge, rename, retire, or edit anything the graph already holds.
It can only propose additions.
The builder discovered this itself, wrote the merges into its issues file as questions it was unable to act on, and returned a proposal that left the three nodes as three.

The cause is that the builder does not work on the graph.
It works on a separate proposal format whose only verb is add.
The proposal arrives as a set of tables describing new nodes, new claims, and groups of those additions with dependencies between the groups.
The application then copies the approved groups into the graph.

That second format is the source of a long tail of problems.

Three builder runs on one project failed validation because the proposal rules were nearly unsatisfiable for a graph that already had content.
A node reused by identifier was still required to supply fresh evidence.
A group could not reference a claim the graph already held, so representing work that built on existing research was impossible.
Each failure cost twenty minutes of model time and told the human only that a submission had been rejected.

Group-by-group approval created its own failures.
Declining one group could strand the groups that depended on it.
Partial approval produced graphs that no builder had designed, assembled from an arbitrary subset of its intentions.
The dependency rules, the cascade logic, and the partial-approval interface exist only because a list of additions has to be made safe to apply piecemeal.

The graph model carries a second complication.
Besides nodes and claims, the dataset holds unions and direct parentage as their own record types, a genealogical shape inherited from the project's origin.
A marriage or a parent link is a relationship between two nodes like any other, and giving it a separate structure means every part of the system has to handle it separately.

The human summarised the alternative in one sentence.
If the graph is a CSV, hand the builder a copy, let it edit the copy, and replace the original when the human accepts it.

## Solution

The graph is nodes and edges.
An edge runs from a node to another node or to a value, and its name is free text; there is no list of edge types.
A marriage is an edge named "married to", a parent link is an edge named "parent of", and a build date is an edge from a building to the value 1880.
Unions and direct parentage are removed as record types, and existing ones are converted into edges once.

When a graph job starts, the application converts the accepted graph into two tables, one of nodes and one of edges, and gives the builder a copy.
The builder edits them the way anyone edits a spreadsheet.

Every operation becomes an ordinary edit.
Adding a node is a new row.
Merging three nodes into one is deleting two rows and repointing the edges that named them.
Removing an edge is a row that is not there.
Renaming, requalifying, and rewording are edits to a cell.
There is no vocabulary for deletion because nothing is expressed as a difference.

The builder does not edit research records.
Evidence and sources are given to it as read-only reference beside the findings, and an edge cites evidence by identifier.
When a draft is accepted, the application copies any cited evidence that the graph does not yet hold from the research that produced it.

The builder hands back the edited copy.
The application converts it back into a graph, compares it against the accepted graph, and derives the change itself.
The builder never declares what it did, so it cannot misreport a change, forget to mention a deletion, or claim work it did not do.

The human is shown a draft: the graph as it would be, plus a plain statement of what is different.
Three nodes became one.
Two nodes added.
Seven edges moved.
The human reads the draft, annotates anything they disagree with, and either accepts it or sends the annotations back for a revision.
Accepting replaces the graph with the draft.

The guided tour becomes explanation rather than gatekeeping.
It walks the human through what changed and why, and it no longer carries the decision.
The decision is a single acceptance of one coherent draft.

## User Stories

1. As a researcher, I want the graph builder to be able to merge two nodes that turn out to be one thing, so that my graph stops showing three factories where the research says one building stood.
2. As a researcher, I want the builder to be able to delete a node the research has disproved, so that a mistake does not survive forever because the tool can only add.
3. As a researcher, I want the builder to be able to rename a node when the research gives a better name, so that the label reflects what is known rather than the first guess.
4. As a researcher, I want the builder to be able to change an edge's qualification when new evidence strengthens or weakens it, so that the graph tracks the state of the evidence.
5. As a researcher, I want the builder to be able to fold an organisation that ran a single site into that site, so that the graph carries one node per thing rather than one node per name.
6. As a researcher, I want to see the graph as it would be after the change, so that I am judging a result rather than a list of intentions.
7. As a researcher, I want a plain statement of what is different, in counts I can hold in my head, so that I know the scale of what I am accepting before I read the detail.
8. As a researcher, I want the statement of differences to be computed by the application rather than described by the builder, so that a builder cannot understate or forget a change.
9. As a researcher, I want a node that vanished while its edges moved elsewhere to be described as a merge, so that I see two things becoming one rather than an unexplained deletion.
10. As a researcher, I want to accept a draft in one action, so that I am not assembling a graph out of partially approved fragments.
11. As a researcher, I want to annotate any part of a draft I disagree with, so that my objection reaches the builder attached to the exact node or edge it concerns.
12. As a researcher, I want my annotations to produce a revised draft, so that disagreeing is a normal step rather than a rejection that throws the work away.
13. As a researcher, I want a revision to continue from the builder's existing work, so that a small objection does not cost a full rebuild.
14. As a researcher, I want to undo an accepted draft, so that accepting is a decision I can reverse when I see the result on screen.
15. As a researcher, I want the tour to explain what changed and why, so that I understand the reasoning rather than only the shape.
16. As a researcher, I want the tour to be separate from the decision, so that reading is not the same act as approving.
17. As a researcher, I want the builder's open questions surfaced beside the draft, so that I can see what it was unsure about without reading its files.
18. As a researcher, I want to know when a draft leaves one of my instructions unimplemented, so that I am not left to discover the omission by inspecting the graph.
19. As a researcher, I want a draft that does not hold together to be refused before it reaches me, so that I never review a graph with an edge pointing at a node that is not there.
20. As a researcher, I want a draft whose validation failed to go straight back to the builder to fix, so that bookkeeping errors do not become my problem.
21. As a researcher, I want the panel to say what the app is doing in my language, so that I read "writing the graph draft" rather than a count of representation notes.
22. As a researcher, I want to see that a merge is the removal of specific nodes, named, so that I know exactly which records will stop existing.
23. As a researcher, I want to see which edges moved to the surviving node in a merge, so that I can confirm the evidence followed the building rather than being discarded.
24. As a researcher, I want to see edges that a draft removed, so that a deletion is never silent.
25. As a researcher, I want a builder to be unable to alter or remove evidence and sources, so that accepting a structural change cannot cost me the record it was built from.
26. As a researcher, I want my earlier accepted graph reviews to remain readable, so that the history of how the graph reached its current state survives the change.
27. As a researcher, I want marriages and parent links to be ordinary edges, so that the graph has one kind of relationship and every tool treats them the same way.
28. As a researcher, I want my existing marriages and parent links converted without loss, so that removing the old structure does not remove my family research.
29. As a coordinator, I want to give a builder the graph and the research in one working directory, so that there is one description of the graph rather than a graph and a proposal about it.
30. As a coordinator, I want to pass the human's representation instructions to a builder as context, so that project-specific conventions do not have to be written into shared instructions.
31. As a coordinator, I want to write the tour from the computed differences, so that my explanation is anchored to what actually changed.
32. As a coordinator, I want to sign off a draft before the human sees it, checking its differences against the human's instructions, so that I can send it back rather than spending the human's attention on work that is not ready.
33. As a coordinator, I want to request a revision with the human's annotations attached, so that the builder receives the objection in the words it was written in.
34. As a graph builder, I want the graph handed to me as two files I can read and edit, so that I can use ordinary file tools rather than learning a proposal language.
35. As a graph builder, I want to cite evidence by identifier, so that I represent the research without copying or restating it.
36. As a graph builder, I want to state my uncertainty as questions beside the draft, so that I can make a decision provisionally rather than being blocked by it.
37. As a graph builder, I want my validation failures returned to me with the exact problems, so that I can correct my own work instead of stopping.
38. As a graph builder, I want to be scored against the rules in force now, so that I do not spend a run fixing errors that are no longer errors.
39. As a developer, I want one description of a graph in the system, nodes and edges, so that a change to the shape of the graph is made once.
40. As a developer, I want the difference between two graphs computed in one tested module, so that the panel, the tour, and the review all describe the same change.
41. As a developer, I want the group, dependency, and cascade code deleted, so that a class of bug that produced several failures this week cannot recur.
42. As a developer, I want the union and direct parentage record types deleted, so that no part of the system carries a second model of relationships.
43. As a developer, I want existing stored reviews migrated rather than orphaned, so that removing the old format does not break a project that used it.
44. As a developer, I want the round trip from graph to tables and back proven against real project data, so that a draft cannot silently corrupt a graph.

## Implementation Decisions

### Nodes and edges

The graph is nodes and edges, and nothing else carries structure.
The dataset's claims are the edges; the tables call them edges because that is how the builder and the human read them.

An edge has a source node, a free-text name, and a target that is either another node or a value.
There is no list of edge names and nothing validates a name against one.
A value target is text or a number, and the type is declared, because tables carry no types and a number written without its type would come back as a string.

Relationship rows are not stored.
The relationship view is rebuilt on read from edges whose target is a node, so it cannot drift from the edges it came from.
Where display gives some edge names a visual treatment, such as placing a married couple side by side or drawing parents above children, it reads the edge name as a display convention.
That convention never restricts what an edge may be called.

### Removing unions and direct parentage

The union and direct parentage record types are removed from the model, and every part of the system that reads them works from edges instead.
That includes the model, the layout, the renderer, the details panel, and the server.

Existing records are converted once.
A union becomes a `married_to` edge between its partners, keeping the union's identifier, and each child becomes a `parent_of` edge from each partner.
A direct parentage record becomes a `parent_of` edge, or a qualified form such as `adoptive_parent_of`, keeping its identifier.
A union's date becomes the edge's time, and its label, place, and notes become the edge's reasoning, so nothing is dropped.
Confidence maps onto qualification: established becomes supported, probable becomes inferred, disputed stays disputed, and unknown becomes unresolved.
Source identifiers carried by a union or a parent link become the edge's sources.

Older projects also stored relationship rows directly rather than deriving them from claims.
Each becomes an edge named after its label, keeping its identifier, date, confidence, notes, and sources.

Records that became edges keep their identifiers, so annotations that pointed at a union, parent link, or relationship row are retargeted to the edge by changing only their table.
The live graph and every undo snapshot are converted when a workspace is first opened, and the original workspace file is kept beside it.

The family layout recognises a small set of edge names, such as `married_to` and `parent_of`, and groups them into couples and children for display.
This grouping is computed on read and never stored.

The only affected graph today is the original Pike family map, which holds 23 unions and 4 direct parentage links across 60 people, and the example project that copies it.
The registered research projects hold none.

### The builder's tables

The builder edits two tables.

`nodes.csv` holds one row per node: identifier, kind, name, descriptor, biography, dates, birth and death for people, alternate names, research notes, and the identifiers of the sources the node cites.
Every field a node carries has a column, so a round trip loses nothing.

`edges.csv` holds one row per edge: identifier, source node, name, target type, target, qualification, time, reasoning, the evidence it cites in three columns by role (supports, challenges, and context), and the sources it cites without a specific passage.

A cell that holds several identifiers separates them with a semicolon, and a cell that holds several lines of text, such as research notes, puts one item on each line.
A model builder edits text whether it changes a cell or a row, so a list in a cell costs it nothing, and one row per edge keeps an edge readable in one place and makes the tables a plain export format.

The graph's title and starting focus are not in the builder's copy; a builder has no reason to change them.

### Evidence and sources are cited, not edited

The builder's working directory also holds the research it is representing: the findings, the evidence registry built from them, the source library, and the evidence and sources the graph already holds.
These are read-only reference.

Registry evidence is identified as the finding report and the evidence within it, such as `report/evidence`, and keeps that identifier when it enters the graph, so later drafts cite it the same way.

An edge may cite evidence the graph already holds or evidence in the registry.
A node may cite a source the graph already holds or one in the library.
A builder with nothing to cite leaves the edge out and says so as a question beside the draft; it represents research and does not produce it.

On accept, cited registry evidence the graph does not yet hold is copied into the graph with its source.
A draft never removes or alters evidence or sources, including ones that no edge cites any longer after a change.

### Reading a draft back

The application converts the tables back into a graph and refuses a draft that does not hold together.
Identifiers must be unique.
An edge's source node must exist, and a node target must name a node that exists.
A target type must be node, text, or number, and a number target must parse as one.
Every cited evidence identifier must exist in the graph or the registry, and every cited source in the graph or the library.

These checks also catch a row whose columns have shifted because of a quoting mistake in free text, since a shifted row puts prose where an identifier or a target type belongs.
An invalid draft is refused before it becomes a candidate, with each problem named.

### The difference between two graphs

A single module compares a draft against the accepted graph and returns the change.
Because the graph is only nodes and edges, the difference covers everything a builder can edit.
It reports added, removed, and renamed nodes; added, removed, moved, reworded, and requalified edges; changed citations; evidence that accepting will copy into the graph; and merges.
An edge whose source or target changed but whose text did not is moved, not reworded.

A merge is inferred rather than declared.
For each node that is gone, the module looks at where its surviving edges now point.
If they all point at one remaining node, it is reported as a merge into that node and not also as a removal.
If they point at several, it is reported once, as a removal naming each destination.
If none survived, it is a plain removal.
Each gone node is counted once in the summary.
This is the only place in the system that decides what a merge is, so the panel, the tour, and the review agree by construction.

The module also produces a one-line human summary for the panel and the top of a tour.

### The builder handoff

A graph job converts the accepted graph into the two tables in the builder's working directory, alongside the read-only research.
The builder's instructions change from writing a proposal to editing the tables in place.

The builder continues to write its own questions and representation notes.
Those are commentary about the graph, not part of it, and they travel beside the tables rather than inside them.

When the builder signals completion, the application reads the tables back, refuses a draft that does not hold together, computes the difference against the graph the job started from, and stores the draft and its difference as the candidate.

The proposal format is removed: the proposal validator, the proposal tables, the materialisation of approved groups, and the group vocabulary.
The existing correction loop is retained and now reports structural failures from reading the tables rather than from proposal validation.

### Coordinator sign-off

A draft passes two inspections before the human sees it.
The application's checks are mechanical: the tables convert back into a graph that holds together, and a failure goes straight back to the builder with each problem named.
The coordinator's review is judgement: it compares the computed difference with the human's instructions for the job.

The coordinator either sends the draft back to the builder with what is missing, or signs it off and publishes it for review.
When it signs off a draft that still leaves an instruction undone, it lists each such instruction beside the draft with the builder's reason.
This is how the human learns that an instruction was not carried out.

The review surface never receives a draft the coordinator has not signed off.

### Accepting a draft

Accepting a draft replaces the graph's nodes and edges with the draft, copies in the cited registry evidence, advances the graph revision, and saves an undo snapshot.
Accepting completes the review and closes its batch, as it does today.

The stale-graph check is retained: a draft prepared against an older graph revision cannot be accepted, and the coordinator is asked for a revised draft.

Group selection, group dependencies, cascade declines, and the applied and rejected group lists are removed.
Setting a draft aside remains, and applies to the draft as a whole.

### Annotating and revising

A human annotates a node or an edge in the draft, which are target types the annotation system already supports.
Annotations on a draft travel to the builder through the existing sequenced update channel, which the builder must consume before it can complete.

A revision continues in the same working directory with the previous draft and the builder's notes present, so a small objection does not cost a rebuild.

### The review surface

The Review panel states the phase in the application's language and carries the one-line difference summary once a draft exists.
The review screen shows the draft, what changed, and the builder's open questions, with a single acceptance for the draft as a whole.

By default the draft is shown as the graph the human would accept.
A "show changes" toggle turns on a diff view.
In it, removed nodes appear as ghost nodes, and removed edges appear as ghost edges, including the old links of a node whose neighbours moved; such a node stays a normal node.
New and moved edges are marked.
The graph is laid out from the old and new nodes together, so nothing moves when the view is toggled.
Every node and edge in the diff view can be annotated, ghosts included.

An annotation on a ghost reaches the builder marked as concerning a removed record, together with that record from the accepted graph.
The builder's working directory also keeps an untouched copy of the tables it started from, so the accepted graph is always available to it.

The tour remains a coordinator-written explanation of the change and no longer carries any decision.
It opens with the diff view on and steps through each merge and removal.

### Migration

Unions and direct parentage are converted into edges as described above, once, before the record types are deleted.

Stored graph reviews in the group format are converted once, using the existing materialisation, before it is deleted.
Each review's groups are applied to the graph revision it was built against to produce a draft, and the difference is computed and stored alongside it.
An applied review is converted using the groups that were actually applied, so its draft matches the graph as it stands.
Unpublished candidates in the old format are converted the same way.
Tour steps are unaffected because they reference nodes and claims rather than groups.
Annotations that carry a group identifier are remapped to the step that contained that group.

## Testing Decisions

A good test here exercises behaviour the human or a builder can observe, and does not reach into how a module reached its answer.
Tests use explicitly fictional fixtures, following the existing convention in this repository, and never real research.

The tables module is tested in isolation.
A round trip must return an identical graph, including quoting of commas, quotation marks, and newlines, numeric values that stay numeric, numeric-looking strings that stay strings, and citation lists in all three roles.
A merge performed by editing rows must produce the expected graph, and a removal performed by omitting a row must produce the expected graph.
A draft that does not hold together must be refused with a message that names the problem, including an unknown cited evidence or source identifier and a row whose columns have shifted.

The difference module is tested in isolation.
An untouched copy reports no change.
Additions, removals, renames, rewordings, requalifications, and citation changes are each reported in their own category.
A vanished node whose edges moved is reported as a merge and not as a removal, and a genuine deletion is reported as a removal.
An edge that only changed its ends is reported as moved, not reworded.
A vanished node whose edges went to two surviving nodes is reported once, as a removal naming both, and not as two merges.
Any draft whose canonical serialisation differs from the accepted graph is never reported as unchanged.

The union conversion is tested against a fictional family fixture: every partner pair, child, parent link, date, place, note, confidence, and source survives as edges and edge fields.

The builder handoff is tested through the existing guided flow tests, which already drive a builder pool with a fake process that writes files into the working directory.
A builder that edits the tables produces a candidate whose draft and difference match what it wrote.
A builder that writes a draft that does not hold together is sent back with the problem rather than stopping.

Acceptance is tested through the existing review flow tests.
Accepting a draft replaces the graph, copies in cited registry evidence, advances the revision, closes the batch, and leaves an undo snapshot.
Evidence and sources the graph held before are all still present afterwards.
A draft prepared against an older revision is refused.

Migration of stored reviews is tested against a stored review in the old format, asserting that the converted draft matches the graph produced by the groups that were applied, and that its tour still resolves.

Prior art for all of the above is in the existing guided flow, guided review interface, and graph proposal tests.

## Out of Scope

Giving the coordinator a way to start a graph update when the human asks for one in conversation.
The setting today is a boolean between never and automatic, with no state for "when I ask", which is worth adding separately.

Supervising the coordinator as a spawned, confined process, and giving agents read-only filesystem access to a projection of the project.
Both were designed in the same conversation and are independent of this change.

Changing what a builder is permitted to research, or how research findings are produced.

## Further Notes

The two foundation modules are committed but were built for the earlier ten-table shape, which carried unions, parentage, evidence, sources, and graph settings as editable tables.
They need rework to the two-table shape.
The built reader also had a gap that the rework must not repeat: it did not check that a cited evidence identifier or a node's source identifier named a record that exists.
The built difference module compares only nodes, claims, evidence, and sources, so a change to unions, parentage, the title, or a node's sources was reported as no change; removing everything except nodes and edges closes that.

Verifying the round trip initially used a comparison that filtered nested fields and reported a false pass, which hid a defect that converted numeric claim values to strings.
Comparisons of whole graphs should use the canonical serialisation already present in the codebase.

The human's representation conventions, such as folding a single-site organisation into its site, belong in the per-job context channel rather than in shared builder instructions.
Editing the shared instructions changes the rules for every builder in every project, which is a reviewed code change rather than a coordinator action.

The immediate motivating case is a project where three facility nodes describe one building.
Running that merge through the built modules produced three nodes merged into one, seven claims repointed, and two claims dropped because they became a node pointing at itself.
That is the result this work is meant to deliver.
