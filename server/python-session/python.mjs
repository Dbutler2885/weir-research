#!/usr/bin/env node
// A researcher's command tool for its Python session. It runs inside the researcher's
// sandboxed folder, so it reaches the app through files there: the code is written to
// python/requests/ with this agent's lease, and the app's answer appears in
// python/responses/. What the code printed is printed here.
//
//   node tools/python.mjs <<'EOF'
//   pages = weir.library.read("doc-1")
//   print(len(pages))
//   EOF
//
// or node tools/python.mjs file.py
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const folder = join(dirname(fileURLToPath(import.meta.url)), "..");
const [file] = process.argv.slice(2);
let code;
try {
  code = file ? readFileSync(file, "utf8") : readFileSync(0, "utf8");
} catch (error) {
  console.error(`Give the code on standard input or as a file: ${error.message}`);
  process.exit(1);
}
if (!code.trim()) {
  console.error("Give the code on standard input or as a file.");
  process.exit(1);
}
const id = randomUUID();
const requests = join(folder, "python", "requests");
mkdirSync(requests, { recursive: true });
writeFileSync(join(requests, `${id}.tmp`), JSON.stringify({ lease: process.env.WEIR_LEASE || "", code }));
renameSync(join(requests, `${id}.tmp`), join(requests, `${id}.json`));
const response = join(folder, "python", "responses", `${id}.json`);
const deadline = Date.now() + 10 * 60_000;
while (!existsSync(response)) {
  if (Date.now() > deadline) {
    console.error("The app did not answer within ten minutes.");
    process.exit(1);
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
}
const answer = JSON.parse(readFileSync(response, "utf8"));
rmSync(response, { force: true });
if (answer.error) {
  console.error(answer.error);
  process.exit(1);
}
if (answer.pending) console.log(answer.note);
else process.stdout.write(answer.output.endsWith("\n") || !answer.output ? answer.output : `${answer.output}\n`);
if (answer.failed) process.exitCode = 1;
