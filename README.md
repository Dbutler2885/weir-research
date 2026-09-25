# Research Workspace

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
Quit from the app's header, or with `npm run workspace -- stop`; either asks whether workers still running should keep going.
A kept worker carries on alone, including waiting out a usage limit, and the app takes it back when it opens the project again; workers not kept stop when the app closes or crashes.

When the app opens a project, it starts a fresh research coordinator for it, which picks up from the project's saved state.
You write to the coordinator from the browser; it assigns researchers, graph builders and walkthrough writers, which the app launches and shows in the live panel.
New projects live under `.research/projects/`, alongside the registry and outside version control.
See [the coordinator guide](skills/coordinate-research/SKILL.md) for how the coordinator works.

You can also open Codex or Claude Code in this folder and ask it to open the app; it runs the same command, after you approve it running outside its sandbox.
That agent is for working on the app itself; it is not the coordinator.

The local service stores accepted research, investigation history, and imported sources in `.research/`, including archived original datasets and trial notes.
Keep a backup of that directory to preserve your work.

Open Annotations to write an annotation, select references, or manage the queued list in one sidebar.
Enable Select references inside the sidebar or use Command/Control + I to annotate the current surface.
Select one or several elements or passages, or use Add question with no selection.
The composer docks beside the surface, preserves drafts when closed, and supports editing queued annotations and amending sent instructions.
Its New annotation and Queued tabs preserve the current draft and keep the research surface open; the Annotations button shows the number of unsent annotations.
Choose Interface feedback to record product observations separately from historical research.
The destination stays selected between saves; the Feedback button and save confirmation open all saved interface notes.
Investigations separates Findings, Your annotations, and Activity, with researcher preferences under Research settings.
Queue annotations or investigate immediately.
Follow-up annotations on a proposal stay in its investigation and retain the exact revision they address.
Review individual findings in cards or a continuous view, with evidence and qualifications alongside each decision.
Keep findings independently, question them, or set them aside; these decisions do not change the graph.
Request a separate graph-construction pass from selected kept findings, then preview and apply coherent groups with explicit dependencies.
Older reviews remain available in their original format.
The graph and source inspectors link back to the findings that inform them.
An empty project provides Ask a research question and Add sources without requiring any nodes.
You may also add a named starting point, such as a place or organization, without creating a person.
Use Organize to preview which nodes to keep, apply the change in place, or undo the latest organization.
Organization preserves sources and research history, pauses active work, and prevents old results from being applied to the reorganized graph.

## Local PDF processing

Docling is a repository dependency managed by `pyproject.toml` and the committed `uv.lock`.
Install it separately from the JavaScript dependencies:

```sh
npm run setup:pdf
npm run pdf -- "/path/to/document.pdf"
# Optionally process an inclusive range of PDF pages:
npm run pdf -- "/path/to/document.pdf" --pages 1 10
# Match Question Wheel's existing-text-only conversion:
npm run pdf -- "/path/to/document.pdf" --ocr off
```

Setup requires Python 3 (`python3` on macOS/Linux, or `py`/`python` on Windows) and downloads the locked packages into `.venv`, using a repository-local uv installation in `.python-tools`.
It selects Python 3.12, downloading that runtime locally if necessary.
The first conversion also downloads Docling's model weights into `.research/cache/huggingface`; subsequent conversions reuse them locally.
Documents are processed on this computer without sending their contents to a parsing API.
OCR defaults to RapidOCR with the CPU ONNX runtime on every platform because it reliably preserves mixed native-text and scanned pages.
Use `--ocr-engine apple` to select Apple Vision explicitly on macOS.
The initial OCR configuration is for English documents.
Apple dependencies are conditional on macOS, and Linux/Windows install CPU PyTorch wheels without requiring CUDA or a GPU.
The default `--ocr auto` lets Docling apply OCR to bitmap regions; `--ocr off` disables OCR entirely.
Conversion uses automatic device selection with two processing threads; `--device cpu` can select CPU processing explicitly.

Each conversion creates a new directory under `.research/sources/`, preserving `original.pdf`, Docling's structured `document.json` with page provenance, readable `document.md`, extracted picture assets, and a `manifest.json` with the original hash, processor version, requested page range, coverage, and errors.
Existing captures are never overwritten, and there is no fixed 50-page cap.
Page ranges refer to physical PDF pages, not printed page labels.
Failed conversions retain their original and failure record; partial conversions are labeled and return a nonzero exit code.
These bundles are currently a local conversion facility; automatic import into the browser source library and researcher tool access are separate integration work.

Run `npm run test:pdf` to exercise native-text extraction, OCR of a fictional scanned page, source preservation, location metadata, and explicit page coverage.
This integration check downloads model weights on first use and is separate from the faster `npm run check` suite.
It exercises the platform default and the portable RapidOCR backend.
The PDF workflow is configured to run on macOS, Linux, and Windows in GitHub Actions; only macOS has been verified locally.

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
It loads the app's skills from its folder, never your personal instructions, hooks, skills or MCP servers, and an agent CLI started from inside one is stopped and reported.
Researchers working on the web share one research browser: Google Chrome with the app's own profile, separate from your browsers, reached through Chrome DevTools MCP.
Open it from Research settings and sign in to archives once; every researcher can then use those sign-ins, each in its own tab.
The coordinator runs at most four workers at once unless you set another number in Research settings or ask it for more on one job.
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

See [the research-agent contract](skills/research-contract/SKILL.md) for the proposal format, source expectations, and recovery behavior.
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
Text evidence can link to an exact highlighted quotation, and the server verifies that quoted text occurs in its preserved document.
PDF originals can be viewed, but automatic PDF extraction and page-region highlights are not implemented.
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
See [the post-trial design notes](Plans/post_trial_design_notes.md) for the implemented direction and remaining design experiments.

The production build remains a single `dist/index.html` file.
Opened directly from disk, it opens an empty standalone surface; the live workspace requires the local service.
The annotation engine is vendored from MIT-licensed Lavish, with [attribution and provenance](src/vendor/lavish/README.md).
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
