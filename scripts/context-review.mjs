// Writes what a fresh coordinator would read for a project, old and new side by
// side, with sizes, so the human can judge the startup context. Read-only.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { home, project } from "./workspace-lib.mjs";
import { startupContexts } from "./context-lib.mjs";

const tokens = (text, perToken) => Math.round(text.length / perToken);
const number = (n) => n.toLocaleString("en-US");

try {
  const p = project(process.argv[2]);
  const { state, old, layered: context } = startupContexts(p);
  const at = new Date().toLocaleDateString("sv");
  const out = join(home, "context-review", `${p.id}-${at}`);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "old-resume-output.json"), `${old}\n`);
  writeFileSync(join(out, "new-context.md"), `${context.text}\n`);
  const rows = context.layers.map(
    (l) => `| ${l.title} | ${number(l.characters)} | ${number(l.budget)} | ${number(tokens(l.text, 4))} | ${l.omitted || ""} |`,
  );
  const stats = [
    `# Startup context for ${state.dataset.title}`,
    "",
    `Written ${new Date().toISOString()} from saved revision ${state.revision}, without attaching.`,
    "Live workers are not included, because only the running app knows them.",
    "Token counts are estimates: about 4 characters per token for text and 3.6 for JSON.",
    "",
    "| Version | Characters | Est. tokens |",
    "|---|---:|---:|",
    `| Old resume output (old-resume-output.json) | ${number(old.length)} | ${number(tokens(old, 3.6))} |`,
    `| New layered context (new-context.md) | ${number(context.text.length)} | ${number(tokens(context.text, 4))} |`,
    "",
    "## New context by layer",
    "",
    "| Layer | Characters | Budget | Est. tokens | Items left out |",
    "|---|---:|---:|---:|---:|",
    ...rows,
    "",
  ].join("\n");
  writeFileSync(join(out, "STATS.md"), stats);
  console.log(JSON.stringify({ directory: out, oldCharacters: old.length, newCharacters: context.text.length }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
