# Research workspace

This repository is a local research workspace: a browser app that runs research agents for the human.
An agent opened here works on the app itself, or opens the app for the human.
It is not the research coordinator; the app starts its own coordinator, with its own instructions in `server/agents/coordinator/AGENTS.md`.

## Opening the app

When the human asks to open the app, start or resume research, or open a project, run:

```sh
npm start
```

With a topic for a new project, run `npm start -- "<the human's topic>"`; do not ask for anything else, such as an ID, a dataset, a focus or starting sources.
Without a topic, it reopens the last project; if there is none, ask only "What would you like to research?" and pass the answer.
The command installs what a fresh clone is missing, starts the app as its own process, and opens the browser.
Run it right away, outside your sandbox, because the app launches its own agents; your tool's approval prompt for that command is the human's one approval, so do not ask in words first.
The app keeps running after you finish or close; tell the human it is open at the printed address.
`npm run workspace -- projects` lists projects, `npm run workspace -- resume <project-id>` opens a particular one, and `npm run workspace -- stop` stops a project's service.
If a command fails, do not recreate or delete an existing project as a workaround; for missing dependencies run `npm ci` and retry.

Research happens in the browser, where the human writes to the coordinator.
Do not attach to a project as its coordinator, send coordinator commands, or edit a project's files under `.research/` to do research.

## Working on the app

Development requests take the ordinary coding-agent route: read the code, change it, and verify it.
`npm run check` runs the tests and the build; `npm run test:integration` runs the local integration checks.
Interface feedback the human records in the app is kept in the project's `workspace.json` under `interfaceFeedback`; read it when working on the app, and never treat it as research.
The human records it with developer mode on, in Research settings; each reference then carries a `page` field with the element, the headings above it and the window size.
The app's agents are supervised in `server/agents/`: one supervisor with a Claude and a Codex adapter, and the sandbox settings in `isolation.mjs`.

## Repository conventions

Never use an em dash in prose.
Do not add agent co-authorship to commits.
Never manually modify changelogs or generated files.
Put each full sentence on its own physical line in long Markdown documents.
Run `npm run check` after relevant code changes.
For bug fixes, reproduce the user-visible problem before editing, then verify the repaired flow.
Prefer durable, simple, maintainable designs.

## Research storage boundary

Write all project research, downloaded material, exports, working notes, and researcher scratch files under `.research/`.
Never put real research in `src/`, `tests/`, `docs/`, `Plans/`, or a top-level temporary file.
Application tests and examples use explicitly fictional fixtures.
Git intentionally does not back up the private research directory.
