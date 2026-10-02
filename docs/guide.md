# Weir guide

A local research workspace built around an interactive research graph, with genealogy support, annotated investigations, and evidence review.
Graph, Investigations, Review, and Sources are views of the same application.
The interface has no chat transcript.

## Start the app

Use Node.js 24 or later, and install Claude Code or Codex, the agent CLIs the app runs.

```sh
npm start
npm start -- "Example Town industrial history"
```

The first run installs the app's dependencies.
With a topic, it starts a new project; without one, it reopens your last project, or asks what you would like to research.
It opens the project in your browser and keeps running after the command exits.
Close project, in the app's header, takes you to the welcome page, where you can open another project or start a new one; `npm run workspace -- stop` closes it from a terminal.
Either asks whether workers still running should keep going.
A kept worker carries on alone, including waiting out a usage limit, and the app takes it back when it opens the project again; workers not kept stop when the app closes or crashes.

When the app opens a project, it starts a fresh research coordinator for it, which picks up from the project's saved state.
You write to the coordinator from the browser; it assigns researchers, graph builders and walkthrough writers, which the app launches and shows in the live panel.
New projects live under `.research/projects/`, alongside the registry and outside version control.
See [the coordinator guide](../skills/coordinate-research/SKILL.md) for how the coordinator works.

You can also open Codex or Claude Code in this folder and ask it to open the app; it runs the same command, after you approve it running outside its sandbox.
That agent is for working on the app itself; it is not the coordinator.

The local service stores accepted research, investigation history, and imported sources in `.research/`, including archived original datasets and trial notes.
Keep a backup of that directory to preserve your work.

The Coordinator button opens the sidebar where you talk with the coordinator; it shows how many of its messages are unread.
The Annotate switch, or Command/Control + I, lets you select elements or passages on any surface, and opens the sidebar's Annotations tab with the note you are writing.
You can also write an annotation there with no selection.
The sidebar docks beside the surface, preserves drafts when closed, and supports editing queued annotations before you send them together.
Only research objects can be annotated: nodes and connections on the graph, and the gaps in a node's details, batches and their research passes, reports, findings, walkthroughs and sources.
Each reference reaches the coordinator as that object, with its ids and the screen it was picked from, never as page structure.
Developer mode, in Research settings, is for work on Weir itself and applies to every project.
With it on, any part of the app can be annotated, and Interface feedback records product observations separately from historical research.
The destination stays selected between saves; the Feedback button and save confirmation open all saved interface notes.
Investigations separates Findings, Queue, and Activity.
The gear at the top opens Research settings.
Queue annotations or investigate immediately.
Follow-up annotations on a proposal stay in its investigation and retain the exact revision they address.
Review individual findings in cards or a continuous view, with evidence and qualifications alongside each decision.
Keep findings independently, question them, or set them aside; these decisions do not change the graph.
Request a separate graph-construction pass from selected kept findings, then preview and apply coherent groups with explicit dependencies.
Older reviews remain available in their original format.
The graph and source inspectors link back to the findings that inform them.
An empty project provides Ask a research question and Add sources without requiring any nodes.
You may also ask the coordinator to add a named starting point, such as a place or organization, or to trim the graph to the nodes you want to keep.
The coordinator previews such a change before applying it, and you can undo the latest one.
Organization preserves sources and research history, pauses active work, and prevents old results from being applied to the reorganized graph.

## Reading PDFs

Every PDF you add is read into text in the background, so researchers can search it and the app can check their quotations against it.
The original is always kept; its text is stored page by page, with `[Page n]` before each page, so quotations can be cited by page.
Sources shows how far each document has come, and a PDF's own page shows how it was read, with a way to read it again.

There are two readers, chosen during setup and changeable in Research settings; the choice applies to every project.

- Standard reads each page's text layer, and reads pages that are only pictures, such as scans, with OCR.
  It needs nothing but Node and is fast, but it can run the columns of a newspaper or a complex layout together.
- High accuracy uses [Docling](https://github.com/docling-project/docling), which follows columns, tables and reading order.
  It is a one-time download of about 2 GB, and slower.

Choosing High accuracy installs it in the background, into `.research/tools/docling/`, and nothing is needed beforehand.
The install downloads uv, a pinned release checked against its published checksum, which brings its own Python 3.12 and the packages locked in `uv.lock`.
It then reads a small fictional PDF, which fetches Docling's models and proves the install works.
PDFs chosen for High accuracy wait until it is ready.
Removing it, from Research settings once Standard is chosen, deletes that folder.
`npm run setup:pdf` runs the same install from a terminal.

Both readers work on this computer; no document is sent to a parsing service.
Docling keeps its full conversion for each document under the project's `processed-pdfs/`, including its structured `document.json` with page positions.
Run `npm run test:pdf` to check Docling itself on fictional documents; the PDF workflow in GitHub Actions installs and checks it on macOS, Linux and Windows.

## Research agents

The app runs Claude Code and Codex as its agents; install at least one of them.
Research settings shows who does which job: a default agent, and an agent, model and effort for the coordinator, researchers, graph builders, walkthrough writers and helpers wherever you want one to differ.
Tell the coordinator a preference in the conversation, such as a different agent for one kind of work, and it adds the rule there.
Each agent receives only its assignment's context and scoped sources.
Claude agents use your existing Claude Code sign-in.
Codex agents use the app's own Codex home, so they never load your personal Codex instructions, skills or servers; sign it in once with Codex's own sign-in:

```sh
npm run workspace -- sign-in codex
```

Every agent runs in its own folder under its CLI's sandbox, with any command and the web available there, and nothing else on your computer within reach.
Researchers can also read the project's research library, which they cannot change: every batch's brief, every research pass with its direction, published findings and checkpoints, the walkthroughs, the graph as tables, the sources and the saved documents.
It leaves out your conversation, your annotations, and findings the coordinator has not yet published.
It loads the app's skills from its folder, never your personal instructions, hooks, skills or MCP servers, and an agent CLI started from inside one is stopped and reported.
Researchers working on the web share one research browser: Google Chrome with the app's own profile, separate from your browsers, reached through Chrome DevTools MCP.
Open it from Research settings and sign in to archives once; every researcher can then use those sign-ins, each in its own tab.
The coordinator divides each batch into assignments, one per researcher, each with a title and a brief; Findings shows every research pass under its title and the coordinator's brief.
At most four researchers work one batch at once, unless you set another number in Research settings; further assignments wait their turn, and other batches are not held back.
Researchers in a batch post what the others should know on the batch's board, and the coordinator can post there for all of them; each batch's board closes it in Findings, and the Board tab shows every batch's.
The Queue tab in Investigations shows the batches in the order they are worked; move one up or down, or hold it.
Research settings also offers an optional limit in whole minutes for each research pass; running passes keep the limit they started with.
The coordinator can ask to resume paused work, with a reason shown in the investigation; research waits for you to choose Resume research or Keep paused.
Failures pause for inspection; saved checkpoints carry over to the next researcher.

Outside a coordinated project, an independent worker can use the manual protocol:

```sh
npm run research -- status
npm run research -- claim "investigator name"
npm run research -- checkpoint /path/to/checkpoint.json
npm run research -- propose /path/to/proposal.json
```

See [the research-agent contract](../skills/research-contract/SKILL.md) for the proposal format, source expectations, and recovery behavior.
The supervisor implements a narrow research workflow inspired by Firstmate; it does not run Firstmate's fleet or Git worktrees.
With the coordinator, researcher findings pass through its synthesis before they become proposals for your review.

## Try the isolated example

```sh
npm run example
```

Open http://127.0.0.1:4319.
This separate workspace uses a fictional workshop fixture to demonstrate evidence review.
It audits the supplied dataset, adds no new historical assertions, and explicitly distinguishes the dataset's summary from an original register quotation.
Its state lives in `.research/demo/`; accepting its proposal does not affect the main workspace.
For a fictional fixture of the new findings and graph review flow, run `REVIEW_BROWSER_FIXTURE=1 node scripts/test-findings.mjs` after building and open the printed URL.
That command leaves an isolated fixture under `.research/development/` and serves it until stopped.

## Sources and access

Sources shows research source records before graph acceptance, including access metadata, passages, related findings, and accepted graph connections.
Import PDF, TXT, Markdown, or CSV files, or register a local folder from Sources.
Imports preserve snapshots and SHA-256 fingerprints; rescanning adds changed files without replacing previously cited copies.
Evidence can link to an exact highlighted quotation, and the server verifies that quoted text occurs in its preserved document, however lines break between its words.
PDFs are checked against the text read from them; see [Reading PDFs](#reading-pdfs).
Subscription services such as JSTOR do not have dedicated access adapters.
Researchers may use available browser or computer tools; actual capabilities and signed-in sessions depend on the runtime.
When access needs your help, Investigations displays the request and a resume action.
Per-investigation source scope is set in the annotation form.

## Development

```sh
npm run check
npm run serve
```

`check` runs the automated tests, TypeScript checks, and production build.
`npm run test:integration` additionally exercises real local startup, browser-event waiting, recovery, synthesis, acceptance, topic-only creation, place focus, live organization and undo, and project isolation through the CLI and HTTP service without launching a model provider.
It also checks separate findings and graph phases, partial application, human-only decisions, source-access recovery, and interface feedback.
`serve` starts the local service using an existing build.
Set `RESEARCH_PORT` and `RESEARCH_STATE_DIR` to run an isolated workspace elsewhere.
See [the post-trial design notes](../Plans/post_trial_design_notes.md) for the implemented direction and remaining design experiments.

The production build remains a single `dist/index.html` file.
Opened directly from disk, it opens an empty standalone surface; the live workspace requires the local service.
The annotation engine is vendored from MIT-licensed Lavish, with [attribution and provenance](../src/vendor/lavish/README.md).
The live workspace does not require a global Lavish installation.
The legacy `npm run lavish` command still opens the standalone viewer in an installed Lavish host.

## Private research and version control

All real research belongs under `.research/`, including datasets, source captures, notes, exports, annotations, and researcher scratch files.
The whole directory is ignored automatically; Git tracks the application, instructions, plans, and explicitly fictional test fixtures.
A fresh checkout contains no real research and needs no private dataset to build or test.
Keep separate backups of `.research/` because Git does not back it up.

## Guided research review

The coordinator publishes an opening briefing and connected evidence screens, then graph preparation starts while the reader explores the research.
The original reports remain available in the review history.
A separate builder writes durable CSV tables and checkpoints; the coordinator reviews its submission and writes a graph tour.
The browser focuses relevant nodes and connections alongside the tour and evidence.
Only Apply selected groups changes the accepted graph, preserving qualifications and citations.

The repository instructions route coordinators through `skills/present-research/SKILL.md` and `skills/prepare-research-graph/SKILL.md`.
Graph builders use the agent the dispatch rules choose for them.
Graph jobs preserve working files and streamed output under the ignored project directory, and interrupted work requires human confirmation to resume.
Use `?view=review&investigation=<id>` on a workspace URL to link directly to a review.
