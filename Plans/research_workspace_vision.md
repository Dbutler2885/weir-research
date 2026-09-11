# Research Workspace Vision

## Summary

This project is a research workspace for building, inspecting, challenging, and revising a structured model of what a researcher is trying to understand or argue.

The central idea is that the researcher works on a visual **research model** made of meaningful nodes and relationships. Those nodes may be concrete domain entities such as people, organizations, places, species, documents, or events, but they may also be abstract entities such as concepts, hypotheses, themes, mechanisms, interpretations, or parts of an argument. Relationships are equally important: in many research projects, the main intellectual contribution is the claim that two things are connected in a particular way.

Examples:

```text
William Example ──worked_at──▶ Example Harbor Canning Co.
Shipping access ──enabled──▶ Example business expansion
Finding X ──contradicts──▶ Hypothesis Y
Theory A ──explains──▶ Phenomenon B
```

The visible graph represents the researcher's current model of the subject: what they are presently saying, thinking, or trying to establish.

Underneath every important node or relationship is a deeper provenance structure explaining why that object is in the model, how it is grounded in sources, what interpretive steps were required, where uncertainty remains, and what other claims support or challenge it.

The research surface is also the feedback surface. A researcher can select any graph object, claim, interpretation, source passage, or other visible element and ask an agent to investigate, challenge, repair, expand, or reconstruct that part of the research.

The overall interaction loop is:

```text
inspect → select → question/criticize → agent investigates → proposed patch → review → accept/reject → model updates
```

This turns the research artifact itself into the primary interface for directing AI-assisted research.

---

## 1. Core Product Idea

Most AI research tools produce prose first. The user asks a question, the system performs searches, and the result arrives as a linear answer with citations. If the user wants a structured visualization afterward, that visualization is usually a secondary representation of the generated prose.

This workspace reverses that relationship.

The structured research artifact is the main object being built. Research agents gather evidence and propose changes to that artifact. The researcher reviews those changes in place.

The artifact is therefore both:

- a representation of the current state of the research; and
- the interface through which the researcher directs further research.

This design is particularly useful for research where the goal is to construct an understanding of a domain, develop or test hypotheses, trace relationships, form an argument, or reconcile conflicting evidence.

---

## 2. The Top-Level Research Model

The top-level graph should represent the objects the researcher actually cares about.

These do not have to be conventional real-world entities. A node can represent:

- a person;
- an organization;
- a place;
- an event;
- a species;
- a work or document;
- a concept;
- a hypothesis;
- a theme;
- a mechanism;
- an interpretation;
- a proposed explanation;
- a question under investigation;
- a component of an argument.

This makes the graph useful beyond entity-heavy domains such as genealogy, investigative journalism, corporate research, or history. A researcher can also construct a conceptual or argumentative graph.

For example:

```text
Shipping infrastructure
        │
        ├──enabled──▶ Regional market access
        │                  │
        │                  └──contributed_to──▶ Example business expansion
        │
        └──controlled_by──▶ Local merchant network
```

The graph is a **working model of the researcher's understanding**.

It is not intended to imply that everything shown is unquestionably true. Each visible object can have an epistemic status and a provenance trail underneath it.

---

## 3. Relationships Are First-Class Research Objects

Edges should not be treated as lightweight labels between nodes.

In many research projects, the relationship itself is the primary claim:

```text
A ──caused──▶ B
A ──influenced──▶ B
A ──contradicts──▶ B
A ──depends_on──▶ B
A ──worked_with──▶ B
A ──part_owner_of──▶ B
A ──explains──▶ B
```

A researcher may agree that two objects exist while disputing the relationship between them.

For this reason, edges should be addressable objects internally. A relationship may have:

- a type or predicate;
- temporal scope;
- geographic scope;
- role or subtype;
- epistemic status;
- evidence strength;
- supporting claims;
- contradicting or complicating claims;
- interpretive assumptions;
- citations and source anchors;
- revision history;
- downstream dependencies.

The user should be able to select an edge directly and ask questions such as:

> Is “enabled” too strong here?

> Find independent evidence for this relationship.

> Look for sources that contradict this connection.

> Re-evaluate whether this was an employment relationship or only a commercial association.

The system can then investigate the relationship and propose a structured revision rather than merely rewriting prose.

---

## 4. The Claim / Provenance Structure Underneath the Model

A visible node or edge may depend on a complex chain of evidence and interpretation.

A useful conceptual chain is:

```text
Source
  ↓
Evidence Anchor
  ↓
Claim Occurrence
  ↓
Interpretations / Resolutions
  ↓
Research Assertion
  ↓
Projected Node or Relationship in the Research Model
```

The interface may present this as a **claim tree** for a selected research object, even if the underlying storage is graph-shaped.

### Source

A source is the complete artifact from which evidence is drawn.

Examples:

- a PDF paper;
- a scanned newspaper;
- a directory;
- a webpage;
- a court record;
- an archival document;
- a database record;
- a video;
- an interview transcript;
- a spreadsheet;
- an image.

### Evidence Anchor

The evidence anchor identifies the exact location inside the source that grounds a claim.

The preferred experience is to show the original source with a **highlight overlay** on the relevant region.

Depending on the source type, an anchor might be:

- highlighted text in a PDF;
- a bounding box over a scanned newspaper image;
- a DOM/text-range highlight in HTML;
- a table row or cell range;
- a record and field in structured data;
- a timestamped segment of audio or video;
- a region of an image.

The anchor should preserve enough surrounding context to let the researcher judge whether the agent has interpreted the passage correctly.

A floating quotation alone is insufficient because headings, nearby text, layout, attribution, or surrounding records may materially change the meaning.

### Claim Occurrence

A claim occurrence records what a particular source says at a particular location.

For example, if a directory contains:

> “Example, Wm., clerk, N.L.C. Co.”

then the source-situated statement may be represented as:

> A person referred to as “Wm. Example” was recorded as a clerk at an organization referred to as “N.L.C. Co.”

This is intentionally closer to the source than the final research assertion.

The same statement appearing in another source should be another occurrence, because the provenance and independence of the evidence matter.

### Interpretations and Resolutions

Moving from a source-level statement to the research model often requires interpretive steps.

Examples:

```text
“Wm. Example” → William Henry Example
“N.L.C. Co.” → Example Harbor Canning Company
“clerk” → employment relationship
“his interest” → ownership interest
“the firm of Example & Other” → evidence of a commercial partnership
```

These interpretations should be independently inspectable and challengeable.

Some may require their own supporting evidence.

### Research Assertion

A research assertion is the proposition admitted into the researcher's current working model.

For example:

> William Henry Example worked for Example Harbor Canning Company around 1887.

The UI may project that assertion as:

```text
William Henry Example ──worked_at──▶ Example Harbor Canning Company
```

The visible edge is therefore a compact rendering of a deeper epistemic structure.

---

## 5. Distinguishing What a Source Says From What the Researcher Concludes

The workspace should preserve the distinction between:

1. what is literally present in the source;
2. what the system extracts from it;
3. how mentions are resolved;
4. what interpretation is made;
5. what conclusion the researcher ultimately accepts.

For example, a newspaper may say:

> “Residents claim the mill is owned by Example.”

The source clearly establishes that residents made that statement. It does not automatically establish that Example owned the mill.

Similarly:

> “The former Example & Other establishment...”

may strongly suggest a business association, but additional interpretation is required before asserting a formal legal partnership.

This separation prevents the system from silently transforming ambiguous source material into overconfident facts.

---

## 6. The Claim Tree as an Inspectable Justification View

When a researcher selects a node or relationship, the workspace can open a claim tree explaining how that object is justified.

Example:

```text
Hypothesis:
Example expansion depended on shipping relationships
│
├── Claim A:
│   Example & Co. had a recurring relationship with Firm A
│   │
│   ├── Evidence anchor: 1891 newspaper passage
│   ├── Evidence anchor: ledger entry
│   └── Interpretations
│       ├── “Example & Co.” → Example company entity
│       └── repeated transactions → recurring relationship
│
├── Claim B:
│   Firm A provided access to Boston markets
│   └── evidence / interpretations / sources
│
└── Counterclaim C:
    Example had another independent distribution route
    └── evidence / interpretations / sources
```

“Tree” describes the user-facing view of the justification for the selected object.

The underlying data should probably remain a graph because evidence, interpretations, and claims can be shared across multiple assertions.

For example, one identity resolution may affect several employment relationships, an address, and a family connection. One source may ground multiple claims. One claim may bear on multiple hypotheses.

---

## 7. The Review Surface Is the Feedback Surface

This is one of the central interaction principles.

Any visible research object should be selectable and directly addressable by the user.

The user should be able to select:

- a graph node;
- a graph edge;
- multiple graph objects;
- a sentence inside a claim tree;
- an interpretation or entity resolution;
- an evidence item;
- text inside the source viewer;
- a highlighted source region;
- potentially a spatial region drawn over the graph.

The user can then give natural-language feedback directly against that selection.

Examples:

> I don't think this is the right Example. Re-research the identity.

> This source seems derivative. Find an independent source.

> The quoted passage does not justify this interpretation.

> Look for evidence that contradicts this claim.

> “Caused” seems too strong. Re-evaluate the relationship.

> We may have merged two companies here. Investigate.

> Something about this section of the timeline is inconsistent. Reconcile it.

The selection establishes the scope of criticism.

Internally, a DOM selection in the graph may identify a research assertion. A selected sentence may identify an interpretation. A highlighted passage may identify an evidence anchor. The researcher does not have to manually explain all of that context to the agent.

---

## 8. Agent Work as Structured Patches

The agent should generally propose changes to the research model rather than silently rewriting it.

A research action can return a structured patch such as:

```text
Proposed change:
William Example ──part_owner_of──▶ Example & Co.
Effective no later than March 1890

Evidence:
1890 newspaper, page 2, column 4
Highlighted passage:
“Wm. Example has sold one-half of his interest in Example & Co. ...”

Interpretation:
Selling one-half of “his interest” implies that Example held an ownership interest immediately beforehand.

Entity resolution:
“Wm. Example” → William H. Example
Basis: matching address and occupation

Caveat:
This establishes an ownership interest, not sole ownership.
```

The researcher can then:

- accept the patch;
- reject it;
- edit the predicate;
- change the date range;
- challenge the entity resolution;
- request stronger evidence;
- ask the agent to investigate an alternative interpretation.

This resembles staged code or UI changes: the agent proposes a modification, the user reviews it, and the model is updated only when the change is accepted.

---

## 9. Dependency-Aware Reconstruction

Because the provenance structure is graph-shaped, the system can understand what depends on what.

Suppose the researcher rejects:

```text
“Wm. Example” → William Henry Example
```

The system may discover that this resolution currently supports:

- three employment relationships;
- one address;
- one business relationship;
- one family relationship.

The workspace can warn:

> Changing this interpretation affects six assertions.

The agent can then investigate and propose a coordinated patch to the affected branch of the model.

This makes correction more like dependency-aware refactoring than isolated editing.

The system should preserve superseded interpretations and prior accepted states so that the evolution of the research remains inspectable.

---

## 10. Original Source Review

Evidence review should return the researcher to the original source whenever possible.

A user inspecting a claim should be able to move downward through:

```text
Research model object
→ research assertion
→ interpretation
→ source-level claim occurrence
→ evidence anchor
→ original source in context
```

The researcher should also be able to travel in the opposite direction:

```text
source passage
→ claims extracted from it
→ interpretations based on it
→ assertions that depend on it
→ graph objects affected by those assertions
```

This bidirectional provenance is especially important when one dubious source or interpretation is “load-bearing” for a large section of the model.

---

## 11. Evidence Independence and Source Lineage

Multiple citations do not necessarily mean multiple independent pieces of evidence.

Five newspapers may reproduce the same wire story. Several secondary sources may all trace back to one archival document.

The provenance model should therefore be able to represent relationships such as:

```text
Evidence occurrence B ──derived_from──▶ Evidence occurrence A
Source C ──cites──▶ Source B
Claim occurrence D ──possibly_copied_from──▶ Claim occurrence E
```

This enables the system to distinguish between:

> five attestations from one underlying source lineage

and

> five independently produced attestations.

That distinction can materially affect how strongly a researcher should treat an assertion.

---

## 12. Epistemic and Workflow State

The system should avoid pretending that research confidence is a precise numerical quantity when it is not.

Operational states may be more useful:

- **candidate** — proposed by an agent or researcher but not admitted to the model;
- **accepted** — currently part of the working research model;
- **contested** — credible evidence or interpretations point in incompatible directions;
- **unresolved** — evidence exists but a required interpretation remains open;
- **superseded** — previously accepted but replaced by a later interpretation;
- **rejected** — explicitly excluded from the current model.

Separately, evidence or inference strength can be described with labels such as:

- direct;
- indirect;
- inferred;
- weakly implied;
- corroborated;
- dependent on a disputed interpretation.

Workflow state and epistemic strength should remain distinct. A researcher may choose to accept a weakly supported assertion provisionally.

---

## 13. Progressive Disclosure

The full research ontology is too complex to show all at once.

The interface should expose complexity progressively.

The normal view may show only:

```text
Example ──worked_at──▶ Cannery
```

The relationship can have a lightweight visual indication of status, such as provisional, well supported, or contested.

Clicking it reveals the relevant claim tree.

Selecting a claim reveals its evidence and interpretations.

Selecting the evidence opens the original source with the exact passage highlighted.

The user can therefore move through:

```text
world / argument
→ assertion
→ evidentiary reasoning
→ original source
```

without being forced to view the entire underlying graph.

---

## 14. One Underlying Research Graph, Multiple Projections

The cleanest architecture may be one underlying typed research graph with several user-facing projections.

Possible object types include:

### Domain and Idea Objects

- people;
- organizations;
- places;
- events;
- concepts;
- hypotheses;
- mechanisms;
- themes;
- questions;
- argument components.

### Provenance Objects

- sources;
- evidence anchors;
- claim occurrences;
- interpretations;
- entity resolutions;
- research assertions;
- contradictions or corroborations;
- source-lineage relationships.

### Workflow Objects

- research questions;
- agent investigations;
- proposed patches;
- accepted/rejected changes;
- open problems;
- revision history.

Different interface views can project different slices of this graph:

- **research model view** — the researcher's current understanding or argument;
- **claim tree view** — the justification for a selected node or relationship;
- **source view** — original evidence in context;
- **review queue** — candidate claims and proposed changes awaiting judgment;
- **history/dependency view** — how assertions evolved and what depends on them.

The user should not need to think about the storage model explicitly.

---

## 15. Research Questions and Open Gaps

The workspace should support research that is driven by hypotheses and unresolved questions rather than only by broad literature review.

A user may notice a gap in the model and ask:

> Where was Example working between 1882 and 1887?

or select a hypothesis and ask:

> What evidence would actually establish this causal relationship?

Questions and hypotheses can therefore be first-class objects in the research model.

An agent can investigate them, search multiple strategies, return candidate evidence, and propose additions or revisions to the model.

The graph can therefore contain both what the researcher currently believes and what they are actively trying to determine.

---

## 16. Review Queue

Agent research should often result in a reviewable set of candidate changes rather than an immediate mutation of the model.

A review item may include:

- proposed claim or relationship;
- source citation;
- highlighted evidence anchor;
- extracted source-level statement;
- entity resolutions;
- interpretive steps;
- conflicts with existing assertions;
- proposed graph changes;
- downstream consequences.

The user can flip through these items and:

- accept;
- reject;
- revise;
- request corroboration;
- request contradiction search;
- send the item back for further research.

This keeps the researcher in control while allowing the agent to perform substantial autonomous research work.

---

## 17. Example End-to-End Flow

A researcher is studying the Example family, its businesses, partners, and workplaces in Example Town.

The graph currently contains:

```text
William Example ──business_partner_of──▶ Charles Other
```

The researcher selects the edge and writes:

> I don't think we have enough evidence to call this a partnership. Re-evaluate it.

The agent inspects the claim tree underneath the edge and finds that the relationship currently depends on two sources:

1. an 1892 newspaper reference to “Example & Other”;
2. an 1893 directory listing them at the same address.

The agent determines that neither source alone clearly establishes a legal partnership and launches a targeted investigation.

It returns two new candidate evidence items:

- an 1892 article referring to “the firm of Example & Other”;
- an 1895 article stating that “Other purchased Example's interest.”

Each item opens in its original source with the relevant passage highlighted.

The agent proposes:

```text
William Example ──business_partner_of──▶ Charles Other
approx. 1892–1895
```

with a note that the evidence establishes a commercial partnership but does not yet establish the exact legal formation date.

The researcher accepts the two evidence anchors and the relationship, but edits the date status to “no later than 1892.”

The graph and claim tree update together.

Later, a newly found record suggests that the “Wm. Example” in one supporting source was a different person. The researcher selects that entity resolution and asks the agent to investigate.

The system identifies all dependent assertions, researches the identity conflict, and proposes a patch affecting several relationships. The researcher reviews and accepts only the supported changes.

The workspace preserves both the current model and the provenance of how it evolved.

---

## 18. Interaction Principle: Direct Manipulation of Research

The strongest interaction pattern is that the researcher does not have to translate their criticism into a long prompt describing context.

They point directly at the thing they mean.

```text
select object → say what is wrong / missing / interesting → agent acts on that object
```

This can work at every level:

- select a node to research the entity or concept;
- select an edge to challenge a relationship;
- select several objects to investigate a pattern;
- select an interpretation to question an inference;
- select a claim to find corroboration or contradiction;
- select evidence to inspect its reliability;
- select text in the original source to create or revise an evidence anchor;
- draw around a suspicious region of the graph and ask the agent to reconcile it.

The same interaction grammar can drive many research operations without requiring a bespoke button for every possible task.

---

## 19. Conceptual Positioning

This design differs from a system whose primary persistent structure is a graph of extracted literature claims.

Here, the primary user-facing structure is the researcher's own model of the subject or argument. The model may contain concrete entities, conceptual entities, hypotheses, and first-class relationships.

Claims and evidence remain essential, but they form the provenance and justification structure beneath the research model.

A useful distinction is:

```text
Top layer:     What am I currently saying, thinking, or trying to establish?
Underlying:    Why am I entitled to say it?
Source level:  What exactly does the evidence say, and where?
```

The product should make movement between those levels fluid.

---

## 20. Product Principles

1. **Research objects should be directly manipulable.** The user should be able to point at the exact thing they want the agent to investigate or revise.

2. **Relationships deserve the same status as nodes.** Many important research conclusions are relational.

3. **Every accepted assertion should be traceable to original evidence.** The user should be able to inspect the exact source context, not only a citation.

4. **Interpretation should remain visible.** Entity resolution, temporal inference, terminology resolution, and predicate choice should not disappear inside an opaque model response.

5. **Agent changes should be reviewable.** Research agents should usually propose structured patches that the researcher can accept, reject, or revise.

6. **Research history should be preserved.** Superseded interpretations and prior states are part of scholarly provenance.

7. **The interface should hide unnecessary complexity.** The underlying model can be richly graph-shaped while the user sees the right projection for the task.

8. **The original source remains authoritative.** Extracted text and structured claims are conveniences; the user should always be able to return to the source in context.

9. **Uncertainty should be represented without fake precision.** The system should distinguish candidate, accepted, contested, unresolved, superseded, and rejected states, while separately describing evidence strength.

10. **The research artifact should remain alive.** The graph is not a final visualization generated after the research. It is the evolving environment in which research happens.

---

## 21. Prototype Scope

A convincing prototype does not require implementing the complete ontology or a production-grade autonomous research backend.

A focused version could demonstrate the core interaction loop with:

- an entity/idea graph;
- first-class selectable nodes and edges;
- a claim-tree panel for a selected object;
- original-source viewing with highlight overlays;
- a small number of interpretation types, such as entity resolution and predicate interpretation;
- natural-language feedback attached to any selected object;
- an agent that proposes structured patches;
- a review queue for accepting or rejecting those patches;
- visible propagation when one interpretation affects several assertions.

That would be enough to demonstrate the central product thesis: **a research model whose structure, provenance, review, and AI collaboration all occur on the same interactive surface.**
