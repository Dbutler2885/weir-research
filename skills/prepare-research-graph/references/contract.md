# Graph builder contract, version 3

The graph is nodes and edges, described in the project's own vocabulary: its types of node, the facts each type records, and how its relationships read and arrange the graph.
You receive it as tables, edit them in place, and hand them back.
The application reads your tables back, checks that they hold together, and works out what you changed by comparing them with the graph you started from.
You never describe your changes; the comparison does.

## Your working directory

- `nodes.csv` and `edges.csv`: the graph. Edit these.
- `types.csv`, `fields.csv` and `relationships.csv`: the project's vocabulary. Edit these too.
- `questions.csv` and `notes.csv`: your commentary beside the graph. Write these.
- `start/`: an untouched copy of every table as it was when the job began. Read only.
- `packet.json`: the research to represent: the question, the walkthrough when there is one, the findings, the evidence registry, the source library, and coordinator updates.
- `graph-research.json`: the evidence and sources the graph already cites. Read only.
- `updates.json`: sequenced coordinator updates, which can arrive while you work.
- `checkpoint.md` and `notes.md`: your working state, for recovery.

## The tables

Use UTF-8 CSV with the exact headers below, comma delimiters, and standard CSV quoting.
Quote any cell containing a comma, a quotation mark, or a line break, and escape a quotation mark by doubling it.
Leave a cell empty for an absent value.
Separate several identifiers in one cell with semicolons.
Put one item per line in a cell that holds several lines of text.

| File | Header |
| --- | --- |
| nodes.csv | id,type,name,dates,summary,notes,sources |
| edges.csv | id,from,name,targetType,target,qualification,time,reasoning,supports,challenges,context,sources |
| types.csv | type,color,shape |
| fields.csv | type,field,value |
| relationships.csv | name,reverse,arrangement |
| questions.csv | id,question,nodeIds,edgeIds,provisionalTreatment,requestedResearch |
| notes.csv | id,nodeIds,edgeIds,decision,alternatives,reason |

### Types and fields

Define the project's types from the material you have and from what the project is meant to record, before you write nodes.
A type is a kind of thing the research is about: a person, a cannery, a ship, a court case, a painting.
Use the same type for things of the same kind, and a new type only when the research is about a kind of thing the project does not have yet.

`types.csv` lists each type once.
`color` is one of `slate`, `rust`, `sea`, `gold`, `moss`, `plum`, `sky` or `clay`, and `shape` is `rounded`, `square` or `round`; leave either empty for the default.
Give different types different colours where you can, so they can be told apart on the graph.

`fields.csv` lists the facts a node of each type is expected to have, one row per field.
`value` is `text`, `date` or `number`.
Choose fields that are meaningful for the type and that the research could find: a person's birth and death, a ship's tonnage and home port, a cannery's opening, trading names and closing.
Some starting points, to adapt rather than copy:

- person: born, died, also_known_as, occupation
- organization: founded, dissolved, trading_name
- place: also_known_as
- building or site: built, closed, address

A field that nothing has been found for yet shows as a gap the human can ask to have researched, so a field is a statement of what is worth knowing, not only of what is known.

### Nodes

Every node has an `id`, a `type` from `types.csv`, a `name`, and a `summary`.
The summary says what is known about the node and why it is on the graph, in plain sentences a reader can take in at once.
Choose the connections that matter to the research question; the graph and the node's panel show every connection, so the summary need not list them.
When little is known, the summary says only what puts the node on the graph, such as "Known only as the clerk who witnessed the 1874 mill deed", and that nothing else is known yet.
It does not describe where things were searched; that belongs to the investigation.
Keep facts out of the summary's place in the table: they belong in edges, filed under fields, where each one carries its evidence.

`dates` is a lifespan or active dates, shown on the node's card.
`notes` holds what to look into next, one item per line.
`sources` lists source ids the node cites.

### Edges

An edge runs from the node in `from` to a target: another node, or a value.

An edge to a value is a fact about its node.
When its `name` is a field of the node's type, the fact is filed under that field; name it exactly as the field is named, and file every fact of that kind under the same field rather than inventing a new name each time.
A field can hold several facts, each with its own `time`, such as a firm's trading names over the years.
A fact that no field defines is still kept, and shown with the node's other findings.
Keep a fact's value short: a name, a date, a number, a phrase.
An interpretation belongs in the edge's `reasoning`, not in its value.

An edge to a node is a relationship.
`name` is free text naming it, such as `located_in`, `operated`, `married_to`, or `parent_of`.
There is no list of allowed names; choose the one that matches the evidence.
Operating a factory, owning it, founding a business, and occupying a site are different assertions.

`targetType` is `node`, `text`, or `number`.
For `node`, `target` is a node id; for `text` and `number`, it is the value.
A number written as text stays text, so declare quantities as `number`.
An edge cannot point at its own starting node.

`qualification` is `supported`, `reported`, `inferred`, `disputed`, or `unresolved`.
`time` is empty or a readable temporal scope such as an exact date, an interval, or an approximate period.
`reasoning` explains the assertion in a sentence or two, for the human reading it.
Say why it stands as it does, and when it is not fully supported, what would settle it.
Do not mention ids, tables, or earlier versions of the graph.

`supports`, `challenges`, and `context` list the evidence the edge cites, by the role each passage plays for this edge.
`sources` lists source ids cited without a specific passage.
An unresolved edge can cite nothing only when its reasoning names the open question.

### Relationships

`relationships.csv` says how a relationship reads from its other end and how it arranges the graph.
`reverse` is how it reads from its target: `established` reads `founded by` from the thing established.
Give a reverse to every relationship the human will see from both ends.
`arrangement` is `ranked`, `paired` or `free`, and empty means free.
A ranked relationship puts its target in the row below its source, such as a parent above a child or a parent company above a subsidiary; a ranked rule also covers qualified forms of its name, so `parent_of` covers `adoptive_parent_of`.
A paired relationship places both ends side by side, such as a married couple.
Ranked and paired relationships are drawn as a family tree: a bar joining a couple, and a line dropping from it to their children.
A project starts with the family rules; keep them.

## Citing research

Cite evidence and sources by id; never copy, rewrite, or invent a research record.
You can cite evidence the graph already holds (`graph-research.json`) and evidence in the registry (`packet.json`, keyed by finding report and evidence id, such as `report/evidence`).
You can cite sources the graph already holds and sources in the library.
When the draft is accepted, the application copies cited registry evidence into the graph.
If nothing supports an edge, leave it out and say what is missing in `questions.csv`.

## Editing

Every change is an ordinary edit.

- Add a node or an edge by adding a row.
- Remove one by deleting its row.
- Rename, requalify, or reword by editing a cell.
- Merge nodes by deleting the rows of the nodes that go and changing `from` or `target` on every edge that named them to the node that stays.
  Keep each edge's id when you move it, so the change reads as a move rather than a removal and an addition.
  Delete any edge that would then point at its own starting node.

Removing or merging existing records is allowed when the research warrants it.
Explain consequential choices in `notes.csv`.

## Commentary

`questions.csv` holds your open questions: what is uncertain, the affected nodes and edges, the provisional treatment you chose, and what research would settle it.
Make a decision provisionally and keep working rather than stopping on a question.

`notes.csv` holds representation notes for the coordinator: the affected nodes and edges, the decision, the alternatives you considered (one per line), and why it matters.
Commentary can name records the draft removes.

## Finishing

When the draft is ready, write `done` followed by the last update sequence you incorporated to `submission.txt`, such as `done 0` or `done 2`, and end your turn.
If an update arrives after you finish, you will be asked to continue from your own draft.

The application then reads the tables.
A draft that does not hold together comes back to you with every problem listed in `validation.txt`: unknown ids, wrong column counts from unquoted text, types that are not defined, nodes without a summary, unknown colours, shapes, value kinds or qualifications, edges that point nowhere, and citations of records that do not exist.
A node the graph already held without a summary is allowed to stay without one, but write one whenever you can.
Correct those problems in place and write `submission.txt` again.

A draft that holds together goes to the coordinator, who checks it against the human's instructions and either sends it back with what is missing or passes it to the human.
The human accepts or sets aside the whole draft.
