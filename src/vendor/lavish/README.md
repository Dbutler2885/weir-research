# Lavish annotation engine

The JavaScript files in this directory were vendored from the local `lavish-axi-fork` checkout on 2026-09-09.
`artifact-sdk.js` has one addition since: `isHostExcluded`, which asks the host's `lavishUnifiedFeedback.canAnnotate(element)` before hovering, selecting or annotating an element, so the research workspace can limit annotation to research objects.
Upstream project: https://github.com/kunchenguid/lavish-axi.
The accompanying MIT license credits Kun Chen.
This is annotation-engine reuse, not a copy of the complete Lavish application.

The research host invokes `createArtifactSdk` and supplies `lavishUnifiedFeedback.selectReference` to route DOM and text-range selections to its research annotation composer.
It controls the existing `lavish:setAnnotationMode` message and keyboard-toggle protocol.
It defaults to Explore and retains annotations in the research service rather than a Lavish chat session.

Original SHA-256 checksums, before that addition:

```text
1bf7e6913469751ff3bdce26fbe2b5464287317a9fbaa6c59f900dde176f87ef  artifact-sdk.js
6ed96632e6f86dda6e1e5d3b87541e01afe83a95eb972cf3bf58defb42019dd3  mermaid-node.js
```
