# Modular graph

Status: design agreed with the human on 2026-09-27; built on the `modular-graph` branch on 2026-09-27, not yet merged.
A mockup of the node panel, made from the real North Lubec cannery data, is kept privately at `.research/ui-review/node-panel/panel.html`.

## Problem Statement

The app is meant for anyone researching connected things: people, organizations, buildings, ships, events, objects, and how they relate.
It cannot represent most of them.
A node's type must be one of eight words, chosen during the project's first historical and economic research, and any other type is rejected.
Apart from families, every non-person node looks the same; the only difference is the type printed in capitals on its card.

People are handled by separate rules.
Only people can have born and died dates, alternate names, and research notes.
Generations are laid out in rows only while the graph holds nothing but family relationships; one employment or ownership link switches the whole graph to a free network, and the family stops reading as a family tree.
Clicking a person moves the graph's focus, and only a small "i" button opens their panel, while clicking any other node opens its panel directly.

The panels are hard to make sense of.
In the sardine cannery project, the 1880 North Lubec cannery panel opens on a long italic descriptor that crams thirteen years of history into one paragraph.
Then comes "What the research says": sixteen evidence-backed statements in no particular order, with names invented one at a time (`built_at`, `built_to`, `established_during`, `built_on_site_of`), the plant's five trading names as five unrelated rows, and whole sentences of interpretation posing as values.
Each statement opens into "Evidence and explanation", which mixes six text sizes, internal notes such as "This edge absorbs the former fac-lubec-cannery-fall-1880", source titles, quotations, locators, and a further "Passage context" drop-down.
"Historical connections" repeats the relationships as cards whose meaning is unclear, and "Sources" repeats sources already shown under each statement.
The people in that project have almost nothing on their own panels; what is known about Moses P. Lawrence lives entirely on the cannery's connections.

No node has a summary.
The researchers' contract lists a biography column but never asks for one, and the panel hides the Biography section whenever a node has claims, so a well-researched node never shows one.
The graph stores raw research, one assertion per quotation, and the panel shows it raw; nothing turns it into a picture of what is now known about the thing.

## Solution

Every node gets a small fixed core that the app enforces: an id, a name, a type, sources, and a summary of what is known.
Everything else is defined by the graph builder, once per project.
The builder decides the project's types from the material it has and what the project is meant to record, and gives each type its fields and its look.
A cannery might have built, site, purpose, names, workers, and closed; a ship might have tonnage, home port, and builder.
Each fact is filed under its field, with its date, confidence, and evidence, and a field can hold several dated values, such as a plant's trading names over thirteen years.
A field with no value shows as "Not yet found", a gap the human can select and ask to have researched.

Relationships get rules too.
A relationship can be ranked (parent above child, parent company above subsidiary), paired (spouses, partners), or free.
The whole graph uses one layout: nodes linked by ranked relationships are held at the height of their rank and everything else arranges itself around them, so a family reads as a family tree, drawn with classic family-tree lines, while a relative's employer sits beside them.
People become one type among the rest.

Every node is clicked the same way: one click focuses it and opens its panel.
The panel reads, from the top: type, name, place and dates; the summary; the fields, with gaps; the connections, grouped by relationship; anything else recorded; and a closed list of sources.
Every row, and every line on the graph, opens its own panel: the statement written as a sentence, a plain explanation of its confidence when it is not fully supported, and its evidence, each piece as source, quotation, and one line of locator, context, and a link to the source.

Quotations are never rewritten.
They stay in the evidence registry where researchers put them, cited by identifier; the builder writes only the types, the summaries, the rows, and each row's reasoning, and the app assembles the panels.

## User Stories

1. As a researcher of any subject, I want the graph to hold whatever kinds of things my research is about, so that I am not limited to the types chosen for the first project.
2. As a human, I want each kind of thing to look distinct on the graph, so that I can tell canneries from people from places at a glance.
3. As a human, I want every node's panel to open on a short summary of what is known, so that I understand the thing before reading its evidence.
4. As a human, I want a thinly documented node's summary to say only what puts it on the graph, so that I know nothing else is known yet rather than wondering whether it was left out.
5. As a human, I want a node's facts grouped under meaningful fields, so that related facts are read together rather than scattered.
6. As a human, I want a field with several values over time shown as a timeline, so that I can follow a plant's trading names from 1880 to 1893.
7. As a human, I want a field that has no value yet shown as "Not yet found", so that I can see the gaps in what is known.
8. As a human, I want to select a gap and ask for research on it, so that filling it is one step from seeing it.
9. As a human, I want confidence words to appear only when a statement is not fully supported, so that the uncertain ones stand out.
10. As a human, I want facts that fit no field still shown, under "Also recorded", so that nothing the research found is hidden.
11. As a human, I want a node's connections grouped by relationship and read from that node's point of view, such as "Founded by" on the cannery, so that I can see who and what it was linked to.
12. As a human, I want sources collapsed at the bottom of a panel, so that they do not repeat the evidence shown under each statement.
13. As a human, I want to click any row of a panel and see the evidence behind that one statement, so that I can judge it.
14. As a human, I want to click any line on the graph and see the evidence behind that relationship, so that relationships are as inspectable as nodes.
15. As a human, I want a statement's panel to state it as a sentence, so that I know exactly what is being claimed.
16. As a human, I want a plain explanation of why a statement is only reported or inferred, so that I know what would settle it.
17. As a human, I want each piece of evidence shown as its source, the quotation, and one line of locator, context, and a link to the source, so that evidence is easy to read.
18. As a human, I want a way back from a statement's panel to the node I came from, so that I can move through the research without losing my place.
19. As a human, I want the names of nodes in a statement to be links, so that I can move to either end of a relationship.
20. As a human, I want to click a person the same way I click any other node, so that the graph behaves consistently.
21. As a human, I want one click to focus a node and open its panel, so that I do not need a separate button to read about it.
22. As a human, I want families drawn as family trees, with a bar joining each couple and a line dropping to their children, so that genealogy reads the way readers expect.
23. As a human, I want a family tree to stay a tree when the graph also holds organizations and places, so that adding business research does not scramble the family.
24. As a human, I want a relative and the organization they are linked to to sit near each other, so that the graph shows how the two worlds connect.
25. As a human, I want org charts and ownership chains laid out in rows the same way as families, so that any hierarchy reads as one.
26. As a human, I want spouses and business partners placed side by side, so that pairs read as pairs.
27. As a human, I want the panel to use a few consistent text sizes, so that it is calm and legible.
28. As a human, I want statements written for a reader, without internal identifiers or notes about earlier drafts, so that I can understand them.
29. As a human with an existing project, I want it to open without losing anything, so that the change is safe.
30. As a human with an existing project, I want a one-time rebuild that writes summaries and files facts under fields, so that my old projects gain the new panels.
31. As a human reviewing a builder's draft, I want the walkthrough to say when a summary, a type, or a field changed, so that I can review those changes like any other.
32. As a human, I want a new type the builder introduces to be named in the walkthrough, so that the project's categories never change without my seeing it.
33. As a graph builder, I want to define the project's types and fields once, so that every node of a type is recorded consistently.
34. As a graph builder, I want suggested fields for common types such as person, organization, and place, so that I have a sensible starting point.
35. As a graph builder, I want to define how a relationship reads from the other end, so that "established" on a person reads "Founded by" on the cannery.
36. As a graph builder, I want to mark a relationship ranked or paired, so that hierarchies and pairs lay out correctly.
37. As a graph builder, I want to cite evidence by identifier, so that I never retype a quotation.
38. As a graph builder, I want every problem in a draft reported at once, such as a missing summary, an undefined field, or an unknown evidence id, so that I can fix them in one pass.
39. As a graph builder, I want a fact whose name is not a field of its type accepted and shown under "Also recorded", so that genuine one-off findings are not forced into a field.
40. As a graph builder, I want clear rules for short values and reader-facing reasoning, so that panels stay readable.
41. As a researcher agent, I want my evidence stored once and cited, so that a passage can back several statements.
42. As a developer, I want the panel built from one computed description of a node, so that the panel code only draws and the logic can be tested without a browser.

## Implementation Decisions

### Modules

- **Type definitions** (new, deep): reads the project's types, fields, looks, and relationship rules, and answers questions about them: whether a field belongs to a type, what kind of value it takes, whether it repeats, how a relationship reads from its target, and whether it is ranked, paired, or free.
- **Node view** (new, deep): takes the graph, its type definitions, and one node, and returns everything its panel shows: type, name, place and dates, summary, fields with their values or gaps, connections grouped by relationship and read from this node, other recorded facts, and sources.
  A second function returns the same for a single statement: the sentence, its date and confidence, its reasoning, and its evidence.
  The panels only draw what these return.
- **Graph layout** (changed, deep): one network layout for every graph.
  Nodes connected by ranked relationships are held at the row of their rank; paired nodes are held side by side; free nodes arrange themselves around them.
  It returns family-tree connectors (a couple's bar and the drop to their children) alongside ordinary lines.
- **Draft tables** (changed): the builder's editable files gain the type definitions, and nodes become id, type, name, summary, and sources.
  Every fact is an edge, as value edges already are, and a fact's name is its field.
  Validation reports every problem at once, as it does today.
- **Stored graph** (changed): people and other things become one list of nodes, each with a free-text type and a summary.
  Type definitions are stored with the graph.
- **Upgrade of existing projects** (changed): on load, existing projects convert mechanically, keeping the original file, as earlier upgrades have.
- **Graph changes and walkthroughs** (changed): the computed difference between two graphs includes summaries, types, type definitions, and relationship rules.
- **Graph drawing** (changed): each node's look comes from its type; every node has the same click behavior; lines can be clicked.
- **Panels** (changed): the node panel and the statement panel, drawn from the node view.
- **Builder and researcher instructions** (changed).

### Decisions

- The enforced core of every node is id, name, type, sources, and summary; a draft with a node lacking a summary is refused.
- A type has a name, a look, and fields.
  A field has a name, a kind of value (text, date, or number), and whether it may hold several values over time.
- Facts remain edges carrying evidence, as today; there are no plain node columns for facts, so every shown value has evidence behind it.
- A fact whose name is a field of its node's type is shown under that field; any other fact is shown under "Also recorded".
- A connection is an edge to another node.
  Each relationship name can be given a reading from its target, such as "established" reading "Founded by", and an arrangement: ranked, paired, or free.
  Unlisted relationship names are free and read from the target as their own name.
- The look is chosen from a small fixed set of colors and shapes that the app guarantees are legible in light and dark themes; the builder cannot write arbitrary styling.
  A type with no look gets the neutral default.
- People are an ordinary type.
  Born, died, and alternate names become fields of it.
- Family relationships are ordinary relationship names with rules: "parent of" and its variants ranked, "married to" and its variants paired.
  The current fixed recognition of family relationship names becomes the default rules for a new project.
- The summary explains what the node is and why it is on the graph, choosing the connections that matter to the question.
  When little is known it says only what puts the node on the graph.
  It never describes where things were searched; that belongs to the investigation.
- Quotations, locators, and passage context live only in the evidence registry and are never rewritten by the builder.
- Clicking a node focuses it and opens its panel; the "i" button is removed.
  Clicking a line opens its statement panel.
- The statement panel serves both connections and field values.
- Selecting a gap starts the app's existing way of asking for research, with the gap as the reference.
- Panel typography uses three sizes: the title, body text, and small text.
- Existing projects convert on load: each current node kind becomes a type with a default look; person born and died dates and alternate names become facts without evidence, marked as carried over; research notes on people move into the builder's notes; nodes without a summary show "Summary not yet written" as a gap.
- After conversion, the human can run a one-time rebuild in which a graph builder writes summaries, defines fields, and files existing facts under them; it is reviewed like any other draft.

## Testing Decisions

- Tests exercise external behavior: given a graph, what the module returns; given draft files, what is accepted or which problems are reported.
  They do not inspect internal structures.
- Type definitions: parsing, validation of fields and relationship rules, and readings from the target.
- Node view: fields with values and gaps, repeating fields in date order, grouped connections read from the node, "Also recorded", confidence words shown only when not supported, and a statement's sentence and evidence.
- Graph layout: ranked nodes in rows, paired nodes side by side, a family that stays a tree with organizations present, and family-tree connectors.
- Draft tables: round-trip of the new files, and every refusal reported together (missing summary, undefined field, unknown evidence).
- Upgrade: an old project converts without loss, following the existing graph-upgrade tests.
- Graph changes: summary, type, and field changes appear in the computed difference, following the existing graph-diff tests.
- Panels: a few checks that the node and statement panels show the right sections, following the existing workspace UI tests, then a pass in a real browser against the sardine project at desktop and narrow widths.
- Builder instructions: checked by rebuilding the sardine project and reading the result, not by automated tests.
- Prior art: the graph-csv, graph-diff, graph-upgrade, graph, and workspace-ui tests.

## Out of Scope

- Layout rules per type, such as events placed left to right by date as a timeline.
- Icons for types.
- Research artifacts other than the graph.
- Editing types, fields, or looks by hand in the interface; the builder defines them and the human reviews them.
- The README and making the repository public, which follow this work.

## Further Notes

- How ranked layout treats cycles and contradictory ranks, such as a disputed parent, is settled during implementation; a node never sits in two rows.
- The exact set of colors and shapes is settled during implementation, reviewed with the human in the browser.
- The mockup's summary for the cannery was written by hand from the project's data, as an example of the length and tone the builder should aim for.

## Decisions made while building

- A node's core also keeps optional `dates`, shown on its card, and `notes`, what to look into next, because existing projects hold both and neither is a fact that needs evidence.
- Existing summaries come from the old descriptor and biography, joined when both exist, so most converted nodes open on something readable before any reorganization.
- A field has a name and a kind of value; any field can hold several dated values, shown in date order, so there is no separate setting for fields that repeat.
- A relationship read from its target with no reverse reading reads as its name followed by "this", such as "Established this", so its direction is never lost.
- The project's types are stored in three small tables: `types.csv` for looks, `fields.csv` for fields, and `relationships.csv` for readings and arrangements.
- The one-time rebuild is a reorganization job: the human asks for it, the coordinator opens a batch and sends `reorganize-graph`, and the draft is signed off and decided like any other. The coordinator's context counts nodes without a summary so it can offer one.
- In a row, a couple is placed as one unit, so no one lands between partners and the bar joining them never crosses another card.
- The fixed layout engine for pure family trees is gone; every graph uses the one network layout with rows.
- Converting a project keeps the original as `workspace.before-types.json`, beside any backup from the earlier conversion.
- A builder's tables written in the old format are set aside in `untyped-tables/`, and the draft starts again from the converted graph.
- The app has no dark theme, so looks are chosen for the light one.

