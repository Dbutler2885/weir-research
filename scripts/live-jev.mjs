// Live check, outside `npm run check`, and only when TYPESAFE_API_KEY is set: a real
// Jev sweep of a fictional ledger finds the one page that records a sale, lets through
// a small part of the document, and costs nothing when repeated. It costs a few
// thousand tokens on the human's TypeSafe key.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { JevClient, JevSweeps } from "../server/jev.mjs";
import { typesafeKey } from "../server/typesafe-key.mjs";

const key = typesafeKey();
if (!key) {
  console.log("Jev: TYPESAFE_API_KEY is not set, skipped.");
  process.exit(0);
}
assert.equal(process.env.TYPESAFE_API_KEY, undefined, "the key is out of the environment once taken");
const entry = (n) => `Entry ${n}: the fictional harbor clerk recorded ${(n * 7) % 90} barrels of example flour, weighed at the quay and carted to the store.`;
const page = (n) => Array.from({ length: 30 }, (_, i) => (n === 12 && i === 14 ? "Ada Example sold the mill to Ben Example in 1901 for four hundred example pounds." : entry(n * 100 + i))).join("\n");
const text = Array.from({ length: 30 }, (_, n) => `[Page ${n + 1}]\n${page(n + 1)}`).join("\n\n");
const directory = mkdtempSync(join(tmpdir(), "weir-live-jev-"));
const state = { documents: [{ id: "doc-1", text }] };
const store = { state, update: (change) => change(state) };
const sweeps = new JevSweeps(store, directory, { client: new JevClient({ key }) });
try {
  const started = Date.now();
  const sweep = await sweeps.sweep({ document: "doc-1", questions: ["Does this text record the sale of a mill?", "Does this text record a marriage?"] });
  console.log(`Jev: swept ${sweep.characters.toLocaleString("en-US")} characters in ${sweep.chunks} chunks in ${((Date.now() - started) / 1000).toFixed(1)} s; flagged ${sweep.flagged}, let through ${sweep.passed.toLocaleString("en-US")} characters, for ${state.jevFigures.inputTokens.toLocaleString("en-US")} input tokens.`);
  for (const p of sweep.passages) console.log(`  ${p.label}: ${p.matched.join(", ")} at ${p.probability}`);
  assert.equal(sweep.passages.length, 1, "one passage");
  assert.deepEqual(sweep.passages[0].matched, ["q1"]);
  assert.ok(sweep.passages[0].pages.some((p) => p.page === 12 && p.text.includes("Ada Example sold the mill")), "the passage holds the sale on page 12");
  assert.ok(sweep.passed < sweep.characters / 4, "it let through a small part of the document");
  const tokens = state.jevFigures.inputTokens;
  const again = await sweeps.sweep({ document: "doc-1", questions: ["Does this text record the sale of a mill?", "Does this text record a marriage?"] });
  assert.equal(state.jevFigures.inputTokens, tokens, "a repeated sweep costs nothing");
  assert.deepEqual(again.passages.map((p) => p.label), sweep.passages.map((p) => p.label));
  console.log("Jev: the sweep finds the passage, and a repeat comes from the cache.");
} catch (error) {
  console.error(`Jev: FAILED: ${error.stack || error.message}`);
  process.exitCode = 1;
} finally {
  rmSync(directory, { recursive: true, force: true });
}
