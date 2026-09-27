# Weir

A local research workspace where AI agents gather evidence and you decide what to keep.

In Passamaquoddy Bay, the tide fills the herring weirs and the fishermen sort the catch.
Weir works the same way.

## How it works

- You ask a research question in the browser.
- A coordinator agent splits it into batches and assigns researchers, each a Claude Code or Codex agent sandboxed in its own folder.
- Every finding must cite a source, quote it, and say where in the source the quote is; the app checks quotations against the preserved documents.
- You review each batch as a guided walkthrough and keep, question, or set aside each finding.
- Only your decisions change the research graph.

## Run it

You need Node.js 24 or later, and Claude Code or Codex installed and signed in.

```sh
npm start -- "Lubec, Maine industrial history"
```

The app installs what it needs, opens in your browser, and keeps your research in `.research/`, outside version control.

## How it's built

- `src/`: the browser app in TypeScript, with the graph drawn by D3 and laid out by ELK.
- `server/`: a local Node service that stores each project and supervises the agents.
- `server/agents/`: one supervisor with Claude and Codex adapters, and the sandbox settings in `isolation.mjs`.
- `skills/`: the instructions each agent role works from.

## Development

```sh
npm run check             # tests and build
npm run test:integration  # end-to-end checks with fake agents
```

The [guide](docs/guide.md) covers everything else: settings, sources, PDF processing, and the research workflow in detail.
