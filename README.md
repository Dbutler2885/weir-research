# Research Workspace

A local research workspace built around an interactive research graph, with genealogy support, annotated investigations, and evidence review.
Research, Ongoing work, Review, and Sources & access are views of the same application.
The interface has no chat transcript.

## Start with a coding agent

Open this repository in a coding agent and ask to begin or resume research.
`AGENTS.md` (also exposed as `CLAUDE.md`) gives it its role and the complete ordinary startup procedure before it needs to inspect implementation files.
For a new project it asks only for your topic, creates an empty workspace, opens the research surface, and attaches as coordinator.
It does not need a dataset, person, internal ID, or invented seed facts.
The current agent remains the coordinator and waits for browser activity through a local event loop.
You choose and review research in the browser while the agent delegates work and reconciles findings.

```sh
npm run workspace -- start "Example Town industrial history"
# In a later agent session:
npm run workspace -- resume
```

The start and resume commands build when necessary, start or reuse the project's service, open its URL, and return the coordinator session and compact project context.
New projects live under `.research/projects/`, alongside the registry and outside version control.
See [the coordinator guide](docs/coordinator.md) for project creation, assignment, event waiting, and recovery.
Closing the agent conversation ends active coordination; the next agent recovers saved work when it attaches.

## Start the workspace directly

Use Node.js 24 or later.

```sh
npm ci
npm start
```

Open http://127.0.0.1:4318.
The local service stores accepted research, investigation history, and imported sources in `.research/`, including archived original datasets and trial notes.
Keep a backup of that directory to preserve your work.

Explore the graph normally, then enable Annotate with the toolbar button or Command/Control + I.
Select an element or passage and describe the investigation it needs.
Queue annotations or investigate immediately.
Follow-up annotations on a proposal stay in its investigation and retain the exact revision they address.
Review the evidence, interpretations, preserved ambiguity, and proposed record changes before accepting them.
Only acceptance applies researched claims to the graph.
An empty project provides Ask a research question and Add sources without requiring any nodes.
You may also add a named starting point, such as a place or organization, without creating a person.
Use Organize to preview which nodes to keep, apply the change in place, or undo the latest organization.
Organization preserves sources and research history, pauses active work, and prevents old results from being applied to the reorganized graph.

## Research engines

The default engine is Manual CLI handoff.
Ongoing work also lets you select an installed Codex or Claude CLI using its existing account configuration.
Selecting an engine enables queued research and sends each assigned investigation's context and scoped sources to that provider.
Initial CLI installation and sign-in remain prerequisites outside this application.
The process supervisor runs at most two researchers concurrently, with a ten-minute limit per pass.
Failures pause for inspection; saved checkpoints support an explicit resume or replacement researcher.
Switching engines affects new assignments, while Replace researcher restarts an active investigation with its saved handoff.

The manual protocol remains available:

```sh
npm run research -- status
npm run research -- claim "investigator name"
npm run research -- checkpoint /path/to/checkpoint.json
npm run research -- propose /path/to/proposal.json
```

See [the research-agent contract](docs/research-agent.md) for the proposal format, source expectations, and recovery behavior.
The supervisor implements a narrow research workflow inspired by Firstmate; it does not run Firstmate's fleet or Git worktrees.
The agent-led mode adds coordinator briefs, project-wide handoffs, and a synthesis step before researcher findings become human-review proposals.
In that mode, the engine selector is a preference for the coordinator; it does not dispatch work on its own.

## Try the isolated example

```sh
npm run example
```

Open http://127.0.0.1:4319.
This separate workspace uses a fictional workshop fixture to demonstrate evidence review.
It audits the supplied dataset, adds no new historical assertions, and explicitly distinguishes the dataset's summary from an original obituary quotation.
Its state lives in `.research/demo/`; accepting its proposal does not affect the main workspace.

## Sources and access

Import PDF, TXT, Markdown, or CSV files, or register a local folder from Sources & access.
Imports preserve snapshots and SHA-256 fingerprints; rescanning adds changed files without replacing previously cited copies.
Text evidence can link to an exact highlighted quotation, and the server verifies that quoted text occurs in its preserved document.
PDF originals can be viewed, but automatic PDF extraction and page-region highlights are not implemented.
Subscription services such as JSTOR do not have connected access adapters.
Per-investigation source scope is set in the annotation form.

## Development

```sh
npm run check
npm run serve
```

`check` runs the automated tests, TypeScript checks, and production build.
`npm run test:integration` additionally exercises real local startup, browser-event waiting, recovery, synthesis, acceptance, topic-only creation, place focus, live organization and undo, and project isolation through the CLI and HTTP service without launching a model provider.
`serve` starts the local service using an existing build.
Set `RESEARCH_PORT` and `RESEARCH_STATE_DIR` to run an isolated workspace elsewhere.
See [the implementation plan](Plans/research_workspace_implementation.md) for the agreed behavior and first-slice boundaries.

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
