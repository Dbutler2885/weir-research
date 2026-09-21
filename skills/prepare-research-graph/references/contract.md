# Graph builder contract, version 2

The graph is nodes and edges.
You receive it as two tables, edit them in place, and hand them back.
The application reads your tables back, checks that they hold together, and works out what you changed by comparing them with the graph you started from.
You never describe your changes; the comparison does.

## Your working directory

- `nodes.csv` and `edges.csv`: the graph. Edit these.
- `questions.csv` and `notes.csv`: your commentary beside the graph. Write these.
- `start/nodes.csv` and `start/edges.csv`: an untouched copy of the graph as it was when the job began. Read only.
- `packet.json`: the research to represent: the question, the walkthrough when there is one, the findings, the evidence registry, the source library, and coordinator updates.
- `graph-research.json`: the evidence and sources the graph already cites. Read only.
- `updates.json`: sequenced coordinator updates, which can arrive while you work.
- `checkpoint.md`, `notes.md` and `status.txt`: your working state.

## The tables

Use UTF-8 CSV with the exact headers below, comma delimiters, and standard CSV quoting.
Quote any cell containing a comma, a quotation mark, or a line break, and escape a quotation mark by doubling it.
Leave a cell empty for an absent value.
Separate several identifiers in one cell with semicolons.
Put one item per line in a cell that holds several lines of text.

| File | Header |
| --- | --- |
| nodes.csv | id,kind,name,descriptor,biography,dates,born,died,alternateNames,notes,sources |
| edges.csv | id,from,name,targetType,target,qualification,time,reasoning,supports,challenges,context,sources |
| questions.csv | id,question,nodeIds,edgeIds,provisionalTreatment,requestedResearch |
| notes.csv | id,nodeIds,edgeIds,decision,alternatives,reason |

### Nodes

`kind` is `person`, `organization`, `facility`, `place`, `event`, `family`, `vessel`, or `observation`.
`dates` is a person's lifespan or an entity's active dates.
`born`, `died`, `alternateNames`, and `notes` (research notes) apply only to people.
`sources` lists source ids the node cites.
Keep historical assertions in edges rather than in a node's descriptor.

### Edges

An edge runs from the node in `from` to a target.
`name` is free text naming the relationship or property, such as `located_in`, `operated`, `married_to`, or `parent_of`.
There is no list of allowed names; choose the one that matches the evidence.
Operating a factory, owning it, founding a business, and occupying a site are different assertions.

`targetType` is `node`, `text`, or `number`.
For `node`, `target` is a node id; for `text` and `number`, it is the value.
A number written as text stays text, so declare quantities as `number`.
An edge cannot point at its own starting node.

`qualification` is `supported`, `reported`, `inferred`, `disputed`, or `unresolved`.
`time` is empty or a readable temporal scope such as an exact date, an interval, or an approximate period.
`reasoning` explains the assertion in a sentence or two.

`supports`, `challenges`, and `context` list the evidence the edge cites, by the role each passage plays for this edge.
`sources` lists source ids cited without a specific passage.
An unresolved edge can cite nothing only when its reasoning names the open question.

Family edges are ordinary edges.
The layout draws couples from `married_to` and `spouse_of`, and parents above children from `parent_of`, including qualified forms such as `adoptive_parent_of`.

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
A draft that does not hold together comes back to you with every problem listed in `validation.txt`: unknown ids, wrong column counts from unquoted text, unknown kinds or qualifications, edges that point nowhere, and citations of records that do not exist.
Correct those problems in place and write `submission.txt` again.

A draft that holds together goes to the coordinator, who checks it against the human's instructions and either sends it back with what is missing or passes it to the human.
The human accepts or sets aside the whole draft.
