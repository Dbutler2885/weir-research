# Interactive Genealogy Explorer

## Implementation Progress

- [x] Phase 1: Establish the local application, normalized genealogy model, and validation.
- [x] Phase 2: Implement focus projection and deterministic full-network layout.
- [x] Phase 3: Build the interactive graph, search, biography panel, and navigation.
- [x] Phase 4: Package one portable artifact and verify direct Brave and Lavish operation.
- [ ] Phase 5: Complete automated, visual, accessibility, and performance verification.

## Problem Statement

The current Example family research is represented as a Mermaid diagram.
Mermaid can display the recorded relationships, but it cannot organize a large intermarried family network clearly enough for exploratory research.
The diagram becomes a fixed, sprawling composition in which marriages, parentage, collateral lines, uncertain relationships, biographies, and sources compete for space.
Zooming into that composition does not solve the problem because the layout still reflects the original global hierarchy rather than the person the researcher is currently investigating.

Genealogy is not strictly a tree.
Each person can belong to a birth family, form one or more unions, connect multiple surnames, and participate in relationships whose certainty varies.
The visualization therefore needs to treat the data as a relationship graph while presenting each selected portion with the readability of a family tree.

The researcher needs to click any person and have the whole composition reorganize around that person's family context.
The selected person's parents, spouses, children, siblings, and nearby generations should become immediately legible.
More distant people should generally remain present, but move toward the visual perimeter and receive less emphasis.
This is a new layout around the selected person, not merely a pan or zoom operation over a fixed diagram.

The researcher also needs biographical and evidentiary context without forcing all of it into graph nodes.
A person should expose a biography, key facts, relationship qualifications, research notes, and sources on demand.
The visualization must distinguish verified facts from disputed, probable, incomplete, or unsourced claims.

This is a private, local research tool rather than a public genealogy service or a data-entry product.
It should run in Brave without an account, hosted backend, or network dependency.
At the same time, the resulting artifact should remain portable enough to open directly and export for sharing later.

The Lavish Editor fork already provides a useful local research shell around arbitrary HTML artifacts.
It supplies browser hosting, exploration and annotation modes, drawing tools, an agent conversation panel, live reload, and standalone export.
The genealogy explorer should use that shell directly during ordinary research while remaining a self-contained web artifact that does not depend on Lavish to render.

## Solution

Build a local-first interactive genealogy explorer as a portable HTML application.
Represent the family as a normalized relationship graph containing people, unions, parentage, biographies, sources, and research qualifications.
Render that graph with person cards, compact union junctions, and explicit parent-child connections instead of attempting to force every relationship into a conventional node tree.

The application will begin with a designated person in focus while keeping the complete known network available.
Selecting another person will recompute relationship distance, branch priority, layout constraints, and visual emphasis around the new focus.
The graph will then animate into a deterministic layout that prioritizes the selected person's immediate families and nearby generations.
Remote branches will remain visible by default but will be compressed, moved outward, and visually de-emphasized.

Each person card will contain a clear focus action and a separate biography action.
Focusing a person will relayout the graph.
Opening the biography will reveal a details panel without changing the graph's focal person.
The details panel will contain lifespan, names, roles, places, narrative biography, family relationships, research status, notes, and citations when available.

Unions will be modeled as first-class relationship junctions rather than decorative marriage boxes.
A union can represent a marriage, partnership, or otherwise recorded parental relationship.
Multiple unions for one person will be supported.
Children will connect to the applicable union when both parental relationships are known and directly to the known parent when the other parent is unknown.

The browser application will use a dedicated layout engine for deterministic layered graph placement and D3 for SVG rendering, interaction, and animated transitions.
The layout engine will operate through an adapter so the genealogy model and focus algorithm remain independent of any specific graph library.
Layout work will run asynchronously and support cancellation so repeated focus changes do not freeze the interface or apply stale results.

The first version will use a human-readable normalized JSON dataset as its source.
This representation most directly supports the visual product's requirements, including unions, uncertain links, citations, biographies, and display metadata.
The data boundary will remain independent of the renderer so GEDCOM import or export can be added later without changing the layout or interaction architecture.

The application will normally be launched inside Lavish.
Lavish Explore mode will leave graph navigation and biography controls interactive.
Lavish Annotate mode will let the researcher select a person, relationship, label, or passage and send a correction or research request to the agent.
Lavish drawing tools will let the researcher mark confusing areas or sketch possible connections.
The application will mark its custom controls as actions so Lavish does not mistake those controls for annotation targets.

The same built artifact will also open directly in Brave.
It will not require the Lavish SDK, parent-frame access, browser storage, a development server, or a hosted API to function.
A standalone export will preserve the interactive genealogy explorer while intentionally omitting Lavish's surrounding annotation and conversation interface.

## User Stories

1. As a family researcher, I want the explorer to open around a designated person, so that the initial view has an intelligible point of reference.
2. As a family researcher, I want the complete known family network to remain available, so that focusing on one person does not hide the existence of distant branches.
3. As a family researcher, I want to click any person and make that person the new focus, so that I can investigate the family from different perspectives.
4. As a family researcher, I want focusing a person to recompute the layout, so that the view reflects that person's relationships rather than merely enlarging part of a fixed diagram.
5. As a family researcher, I want the focused person to appear in a stable central region, so that I can orient myself after every transition.
6. As a family researcher, I want parents and earlier generations to appear consistently relative to the focused person, so that ancestry is easy to scan.
7. As a family researcher, I want children and later generations to appear consistently relative to the focused person, so that descendants are easy to scan.
8. As a family researcher, I want spouses and unions to remain visually close to the focused person, so that household and parental relationships are immediately understandable.
9. As a family researcher, I want siblings to remain recognizable as members of the same parental family, so that collateral relationships are not mistaken for direct ancestry.
10. As a family researcher, I want distant branches moved toward the perimeter, so that they remain discoverable without overwhelming the current family context.
11. As a family researcher, I want distant branches visually de-emphasized, so that relationship distance is apparent before I inspect individual labels.
12. As a family researcher, I want the transition between focal people to animate coherently, so that I can retain my mental map of how the families relate.
13. As a family researcher, I want interrupted transitions to resolve cleanly, so that rapidly selecting several people never leaves the graph in an inconsistent state.
14. As a family researcher, I want deterministic layouts, so that returning to the same person produces a familiar view.
15. As a family researcher, I want the layout to minimize relationship-line crossings, so that parentage and unions can be followed without ambiguity.
16. As a family researcher, I want family groups to remain visually cohesive, so that a spouse or child is not placed closer to an unrelated branch.
17. As a family researcher, I want a person with multiple unions represented clearly, so that children are associated with the correct parental relationship.
18. As a family researcher, I want a union represented without implying a legal marriage when the evidence does not establish one, so that the visualization does not overstate the record.
19. As a family researcher, I want a child connected to a known single parent when the other parent is unknown, so that incomplete research can still be represented accurately.
20. As a family researcher, I want uncertain parentage displayed differently from established parentage, so that probable relationships are not mistaken for proven facts.
21. As a family researcher, I want relationship labels such as marriage dates or evidence qualifications available without dominating the graph, so that useful detail does not create excessive clutter.
22. As a family researcher, I want every person treated as a person rather than permanently classified as someone's spouse, so that the visualization remains valid when I change focus.
23. As a family researcher, I want compact person cards showing names and lifespans, so that I can identify people quickly.
24. As a family researcher, I want optional short descriptors such as occupations or historical roles, so that people with similar names remain distinguishable.
25. As a family researcher, I want long biographies excluded from graph cards, so that the relationship layout remains readable.
26. As a family researcher, I want a biography control on each person card, so that I can inspect context without losing the graph.
27. As a family researcher, I want biographies to open in a side panel, so that the selected person's relationships remain visible while I read.
28. As a family researcher, I want opening a biography to be separate from refocusing the graph, so that inspecting a person does not unexpectedly reorganize the network.
29. As a family researcher, I want the details panel to show alternate names and name qualifications, so that conflicting or changing records are understandable.
30. As a family researcher, I want the details panel to show birth and death information with their evidence status, so that approximations are clearly identified.
31. As a family researcher, I want the details panel to show occupations, residences, public roles, and narrative biography, so that relationships can be understood in historical context.
32. As a family researcher, I want the details panel to list parents, unions, spouses, and children, so that the textual record can confirm the visual structure.
33. As a family researcher, I want each listed relative to be navigable, so that the details panel can serve as another route through the family.
34. As a family researcher, I want citations attached to the facts or claims they support, so that I can evaluate the evidence rather than merely seeing a list of links.
35. As a family researcher, I want source titles and notes stored locally, so that the core research remains useful without an internet connection.
36. As a family researcher, I want external source links to open deliberately, so that browsing a citation does not disrupt the current graph state.
37. As a family researcher, I want incomplete and disputed claims labeled consistently, so that research uncertainty is visible across the product.
38. As a family researcher, I want research notes separated from biographical prose, so that speculation is not presented as established history.
39. As a family researcher, I want to search by personal name, alternate name, or surname, so that I can locate a person without manually traversing the graph.
40. As a family researcher, I want search results to include enough context to distinguish similarly named people, so that I select the correct record.
41. As a family researcher, I want selecting a search result to focus that person, so that search integrates directly with visual exploration.
42. As a family researcher, I want browser history or equivalent focus history, so that I can retrace an exploratory path.
43. As a family researcher, I want the focused person encoded in the page URL, so that reloading or sharing a focused view preserves its subject.
44. As a family researcher, I want controls for zooming, panning, fitting, and returning to the focused person, so that I can recover from manual navigation.
45. As a family researcher, I want manual zooming and panning to remain distinct from refocusing, so that spatial inspection does not silently alter relationship priorities.
46. As a family researcher, I want a visible legend for relationship certainty and visual emphasis, so that the graph's semantics do not depend on guesswork.
47. As a family researcher, I want visual meaning to use labels and line styles in addition to color, so that uncertainty and relationship types remain accessible.
48. As a keyboard user, I want to navigate people and activate focus or biography actions without a mouse, so that the explorer is fully operable from the keyboard.
49. As a user who reduces motion, I want focus transitions to respect my browser preference, so that the explorer remains comfortable to use.
50. As a family researcher, I want focus calculations and layout to remain responsive as the dataset grows, so that adding family branches does not make exploration frustrating.
51. As a family researcher, I want a loading indication during a substantial relayout, so that I understand when the application is working.
52. As a family researcher, I want stale layout results discarded, so that an earlier selection cannot overwrite a newer focus.
53. As a family researcher, I want malformed or contradictory records reported clearly during development, so that data mistakes do not become misleading graphics.
54. As a family researcher, I want duplicate identifiers and broken references rejected, so that every displayed relationship has a reliable identity.
55. As a family researcher, I want the application to operate entirely from local files, so that private family research is not uploaded to a service.
56. As a family researcher, I want the application to make no required runtime network requests, so that it remains available offline.
57. As a family researcher, I want the same artifact to open directly in Brave, so that the family visualization is not locked to its research shell.
58. As a family researcher, I want the artifact to launch normally inside Lavish, so that exploration, annotation, drawing, and agent feedback are available together.
59. As a family researcher, I want Lavish Explore mode to leave the graph's controls working normally, so that the surrounding shell does not interfere with investigation.
60. As a family researcher, I want Lavish Annotate mode to let me comment on a person or relationship, so that a research request can point to the exact visual object in question.
61. As a family researcher, I want to draw circles and arrows over confusing relationships, so that I can communicate layout problems or possible connections visually.
62. As a family researcher, I want to send several queued observations together, so that I can review a branch before asking the agent to make changes.
63. As a family researcher, I want changes made to the underlying artifact to appear through live reload, so that the research loop remains immediate.
64. As a family researcher, I want Lavish annotations to remain feedback rather than silently changing genealogy records, so that evidence-bearing data changes remain deliberate and reviewable.
65. As a family researcher, I want to export a standalone interactive HTML artifact, so that I can share the visualization later without sharing my Lavish session.
66. As a recipient of an exported artifact, I want focus, search, biographies, and source displays to keep working, so that the export remains an explorer rather than a screenshot.
67. As a recipient of an exported artifact, I want all required application assets included locally, so that moved or archived copies do not break.
68. As a maintainer, I want the genealogy model independent of the rendering library, so that changing the visual implementation does not require rewriting the research data.
69. As a maintainer, I want focus selection independent of graph layout, so that relationship-priority behavior can be tested without rendering a browser interface.
70. As a maintainer, I want the layout engine hidden behind a stable adapter, so that layout algorithms can evolve without affecting application features.
71. As a maintainer, I want graph rendering driven by layout results rather than genealogy-specific assumptions, so that rendering remains predictable and testable.
72. As a maintainer, I want biographies and sources represented as structured content, so that they can be displayed, searched, validated, and exported consistently.
73. As a maintainer, I want a documented path for importing GEDCOM later, so that using an application-oriented initial dataset does not create permanent data lock-in.
74. As a maintainer, I want the direct-browser and Lavish-hosted modes tested from the same build, so that portability does not drift over time.

## Implementation Decisions

### Product boundary

- The product is a local visualization and research tool, not a genealogy data-entry application.
- The application will not require an account, hosted backend, cloud database, or deployment workflow.
- The complete interactive artifact must work directly in Brave.
- The normal research workflow will open that same artifact inside Lavish.
- Lavish will be treated as a host shell rather than copied, forked again, or embedded into the genealogy application.
- The standalone application will not require Lavish-specific JavaScript to render or navigate.
- Lavish annotations, drawings, and conversation are research feedback and will not silently mutate genealogical records.

### Data model

- The initial source of truth will be a human-readable normalized JSON dataset.
- The internal model will use stable opaque identifiers for people, unions, relationships, sources, and claims.
- A person record will support primary and alternate names, lifespan facts, places, short descriptors, biographical text, research notes, and citation references.
- A union record will connect participating people without requiring that the relationship be labeled as a legal marriage.
- A union record will support relationship type, date information, place information, notes, certainty, and citations.
- Parentage will connect children to a union when the applicable parental union is known.
- Parentage will also support a direct known-parent connection when the other parent or union is unknown.
- Relationships and material facts will support confidence states such as established, probable, disputed, and unknown.
- Confidence must be based on explicit data rather than inferred from whether a label happens to contain words such as probable.
- Sources will be reusable records with titles, repositories or publishers, dates, local notes, external links when applicable, and optional transcription metadata.
- Claims will be able to reference the sources that support or challenge them.
- Visual display metadata will be kept separate from genealogical facts whenever the distinction is meaningful.
- The renderer will consume a normalized in-memory model rather than raw source-file structures.
- GEDCOM will not be required for v1.
- A future GEDCOM adapter must be able to populate the same normalized model without changing the focus, layout, or rendering modules.

### Graph semantics

- Every human being will be represented by the same person entity type.
- A person will not be permanently styled as a spouse because the person's role changes with the selected perspective.
- Unions will be first-class junctions used to route partner and child relationships clearly.
- Union junctions will be visually compact and subordinate to people while remaining inspectable and accessible.
- The graph will support multiple unions per person.
- The graph will support unknown spouses, unknown parents, childless unions, and partially known families.
- Biological, adoptive, step, foster, guardianship, and other parentage types will be representable even if the initial dataset uses only some of them.
- Relationship direction will be genealogical rather than chronological when those concepts differ.
- Uncertain relationships will use a redundant visual language that includes line style or labeling rather than color alone.
- Summary boxes that combine several unnamed children will be treated as migration artifacts rather than the preferred long-term representation.
- Named individuals will receive individual person records whenever the research distinguishes them.

### Focus and neighborhood model

- The graph will retain the complete loaded network by default.
- Selecting a person will calculate kinship distance and family roles relative to that person.
- The focus calculation will explicitly identify parents, ancestors, spouses, unions, children, descendants, siblings, and spouse-connected families.
- The selected person and immediate family will receive the strongest layout priority.
- Nearby generations and siblings will receive secondary priority.
- Remote branches will receive progressively lower priority but will remain rendered.
- Lower-priority branches may be compacted, moved outward, and visually de-emphasized.
- The initial view will use a configured designated focus person.
- The focused person will be recorded in the URL hash or another file-compatible URL fragment mechanism.
- Focus changes will participate in browser navigation history.
- Optional culling, collapsing, or depth limits are not part of the default behavior.
- The internal focus projection will nevertheless expose enough metadata for those features to be added later without rewriting the kinship algorithm.

### Layout

- Genealogy focus calculation and geometric layout will be separate modules.
- A dedicated deterministic layered graph engine will compute node and edge geometry.
- D3 will render the resulting geometry and manage interaction and transitions rather than acting as the sole layout engine.
- An adapter will translate the focus projection into the layout engine's graph representation and translate results back into renderer-neutral coordinates.
- Union junctions and family grouping constraints will be included in the layout input.
- The layout will prioritize generational consistency, family cohesion, low edge crossings, readable partner placement, and a stable focal region.
- Layout configuration will be deterministic for the same data, focus, viewport class, and settings.
- Layout computation will run outside the main interaction path, preferably in a Web Worker.
- Every layout request will have an identity, and results from superseded requests will be discarded.
- Repeated focus changes will be cancellable or coalesced.
- The renderer will preserve known node positions during the start of a transition so users can visually follow the reorganization.
- Reduced-motion mode will replace animated movement with a short or immediate state change.

### Rendering and interaction

- The primary visualization will be SVG because it supports accessible labels, precise relationship geometry, D3 transitions, and Lavish element annotation.
- Person nodes will be rendered as compact cards with name, lifespan, and at most one concise distinguishing descriptor.
- Each person card will expose separate focus and biography actions.
- Clicking the card's primary region will focus the person.
- Activating the biography action will open the details panel without changing focus.
- Custom graph controls will be marked as Lavish actions so annotation mode does not intercept their intended behavior.
- Native controls will be preferred where they provide better accessibility and Lavish compatibility.
- The graph will support pan, zoom, fit-to-network, and return-to-focus controls.
- Manual pan and zoom will not alter the focused person.
- The focused person, immediate relationships, hovered relationship paths, uncertain relationships, and remote context will have distinct visual states.
- Hover and keyboard focus will highlight the relevant path or family group without triggering a full relayout.
- Edge labels will appear selectively or on interaction to limit clutter.
- A legend will explain relationship lines, confidence styles, and focus emphasis.
- The interface will prevent overlapping controls, clipped cards, unreadable type, and horizontal page overflow at supported viewport sizes.
- The visual design will prioritize a research-map character over a decorative ancestry-chart aesthetic.

### Biography and source panel

- The details panel will be a persistent application region rather than content embedded inside the graph.
- The panel will show structured facts before narrative biography.
- The panel will distinguish established biography, unresolved research notes, and source commentary.
- Relationships listed in the panel will be navigable.
- Citations will appear near the facts or claims they support.
- The panel will remain usable at narrow widths by becoming an overlay or stacked region without obscuring its close control.
- Opening and closing the panel will not force a graph relayout unless the available viewport actually changes enough to require one.
- External links will use deliberate user activation and will not be required for the local artifact to load.

### Search and navigation

- Search will match primary names, alternate names, surnames, and useful distinguishing text.
- Search results will show lifespan or relationship context when needed to disambiguate names.
- Selecting a search result will focus the selected person.
- The application will provide backward and forward focus navigation through normal browser history.
- Reloading a focused URL will restore the same focal person.
- Invalid or missing focus identifiers will fall back to the configured initial focus and present a non-disruptive diagnostic.

### Lavish integration

- The genealogy artifact will be served through Lavish's existing arbitrary-artifact route during normal research.
- The artifact must operate within Lavish's sandboxed iframe without same-origin privileges.
- The application will not depend on localStorage, IndexedDB, service workers, parent DOM access, or a permissive iframe origin.
- Required scripts, styles, data, fonts, and other assets will be bundled or referenced with portable relative paths.
- The application will not depend on runtime module loading behavior that fails under an opaque iframe origin.
- The build will favor a self-contained bundle or another artifact form verified in both direct and Lavish-hosted modes.
- Explore mode will be the expected mode for operating graph interactions.
- Annotate mode will remain useful for selecting people, relationships, labels, biography passages, and source entries.
- Lavish drawing, queued prompts, screenshots, live reload, and standalone export will be accepted as host capabilities rather than reimplemented.
- Standalone export will intentionally preserve the explorer but omit Lavish session state, annotations, drawings, and conversation history.

### Deep modules

- A genealogy model module will parse, validate, normalize, and index people, unions, parentage, claims, and sources behind a small read-only query interface.
- A kinship projection module will accept a focused person and return relationship roles, distances, branch priorities, and emphasis metadata without performing layout.
- A layout module will accept a renderer-neutral projected graph and return deterministic nodes, junctions, edge routes, bounds, and transition keys.
- A graph renderer module will accept layout results and visual state, render accessible SVG, and expose focus, biography, hover, pan, and zoom events.
- A person-details module will render structured facts, narrative biography, research notes, relationships, and citations without knowing how the graph is laid out.
- A navigation module will coordinate focus state, search, URL state, history, and restoration.
- A Lavish compatibility boundary will contain the small amount of action-marking and host-environment behavior required for the artifact to work cleanly in both modes.
- A build and packaging module will produce the same portable artifact used for direct opening, Lavish research, and standalone sharing.

### Performance and resilience

- Initial rendering and refocusing must remain responsive for the present family dataset and credible growth into much larger family networks.
- Expensive layout work must not block clicking controls, opening biographies, or typing in search.
- The interface will show a restrained working state when layout exceeds the threshold at which delay becomes perceptible.
- Invalid data will fail with specific validation messages during development rather than producing a silently incorrect graph.
- Runtime errors in a biography or source record must not corrupt the entire graph.
- The application will preserve the previous valid layout until a new layout has completed.
- The application will not apply a partial or stale layout after a newer focus request.

## Testing Decisions

- Tests will assert externally observable behavior and stable domain contracts rather than private function structure or library-specific implementation details.
- The project currently has no application test suite, so the implementation will establish test conventions rather than inherit in-repository prior art.
- The existing Lavish artifact and browser tests are useful conceptual prior art for verifying direct and hosted artifact behavior, but the genealogy project will own its own tests.
- The genealogy model will be tested with valid and invalid fixtures covering duplicate identifiers, missing references, multiple unions, unknown partners, single-parent relationships, source references, and confidence states.
- Model tests will verify the normalized query interface rather than the internal storage layout.
- The kinship projection module will receive exhaustive tests because it defines the meaning of every focused view.
- Projection tests will cover parents, ancestors, children, descendants, full and half siblings, multiple unions, remarriage, spouse families, disconnected components, uncertain parentage, and pedigree collapse.
- Projection tests will verify that the complete network remains represented while priority and relationship roles change around the focus.
- The layout adapter will be tested for deterministic output, generational ordering, union cohesion, unique coordinates, valid edge routes, and stable identifiers.
- Layout tests will use relational and geometric invariants rather than brittle full-coordinate snapshots wherever possible.
- A small number of approved layout snapshots will cover representative difficult families where the complete composition is itself the expected behavior.
- The renderer will be tested for accessible person cards, distinct focus and biography actions, keyboard operation, semantic labels, confidence styling, and event emission.
- Details-panel tests will verify structured facts, relationship navigation, claim-linked citations, research-note separation, and safe handling of missing fields.
- Navigation tests will verify initial focus, search selection, URL restoration, browser back and forward behavior, and invalid focus fallback.
- Asynchronous behavior tests will verify that rapid focus changes discard stale layout results and that the previous valid layout remains visible until replacement.
- Browser end-to-end tests will begin from how the researcher actually opens and uses the product.
- End-to-end coverage will verify direct use in Brave or an equivalent Chromium automation target and use inside the Lavish artifact iframe.
- End-to-end tests will focus a sequence of relatives, open and close biographies, navigate cited relatives, search for a person, use browser history, pan and zoom, and restore a focused URL.
- Lavish-hosted tests will verify that Explore mode permits application controls and that action elements are not incorrectly consumed as annotations.
- Lavish-hosted tests will verify that meaningful graph elements remain selectable in Annotate mode.
- Export tests will verify that a standalone artifact loads without Lavish, without a development server, and without required network access.
- Visual regression tests will cover the initial view, a direct ancestor focus, a descendant focus, a person with multiple unions, uncertain parentage, a dense sibling group, an open biography panel, and a narrow viewport.
- Visual review will be strict about card overlap, edge crossings, text clipping, inconsistent spacing, distracting motion, faint contrast, ambiguous unions, and controls obscuring the graph.
- Accessibility tests will cover keyboard navigation, visible focus, meaningful accessible names, color-independent semantics, panel focus management, and reduced-motion behavior.
- Performance tests will use generated but genealogically plausible networks to measure initial layout, refocus latency, animation smoothness, and cancellation under repeated selection.
- Tests will not assert internal D3 selections, ELK-specific graph objects, private CSS class names, or exact animation frames unless those details become part of a documented public contract.

## Out of Scope

- The application will not provide forms for creating, editing, merging, or deleting people, unions, facts, biographies, or sources.
- The application will not silently convert Lavish feedback into genealogical records.
- The application will not provide user accounts, authentication, permissions, collaboration servers, or cloud synchronization.
- The application will not deploy a public website as part of this work.
- The application will not require or implement a hosted database.
- The application will not reproduce Lavish's annotation, drawing, conversation, screenshot, live-reload, or export systems.
- The application will not replace Lavish's browser chrome with a project-specific copy.
- GEDCOM import and export are deferred until the core visual model and interaction prove stable.
- Interoperability with commercial genealogy services is out of scope.
- Automated record discovery, web searching, source transcription, and AI-generated biographical writing are out of scope for the visualization.
- A graphical data editor is out of scope.
- Default depth culling or hiding of distant relatives is out of scope.
- Advanced manual layout editing and saved per-person coordinate overrides are out of scope.
- Geographic maps, event timelines, DNA visualizations, photo galleries, and statistical dashboards are out of scope.
- Mobile phone optimization beyond a functional narrow layout is out of scope for the initial research-oriented version.
- Persisting Lavish session annotations inside a standalone export is out of scope.

## Further Notes

- The current Mermaid file is valuable as research input and as a record of the visual problems the new product must solve.
- It should not become the runtime graph format or the long-term source of truth.
- Migration must preserve existing people, unions, dates, occupations, biographies, source comments, uncertain links, and explicitly unknown facts.
- Current combined boxes such as lists of other children should be reviewed during migration because some represent several people rather than one graph entity.
- The current use of a spouse-specific style should be retired because every person can become the focus and deserves the same entity semantics.
- The existing compact union-circle convention is directionally correct, but the new application should make unions interactive and semantically explicit rather than relying on invisible Mermaid junctions.
- The debated Example, Fixture, Sample, Demo, and Test relationships are useful acceptance fixtures because they exercise uncertain parentage, collateral family lines, remarriage, repeated names, incomplete spouses, and biographical evidence.
- Capt. Joseph Fixture Jr.'s probable relationship to the elder Joseph Fixture is a useful uncertainty scenario because the graph must communicate the connection without presenting it as settled.
- The local-first decision should be implemented as an architectural property rather than a collection of absolute machine paths.
- Portable relative assets, explicit data boundaries, and standalone builds will preserve a future sharing path without adding a hosted product now.
- The major product risk is not raw graph rendering.
- The major product risk is whether a full-network relayout can preserve family logic, orientation, and legibility while changing focus.
- The first implementation slice should therefore prove the complete focus-to-projection-to-layout-to-transition path on a representative subset before polishing every biography or migrating every record.
