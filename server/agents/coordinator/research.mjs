#!/usr/bin/env node
// The coordinator's command tool. It runs inside the coordinator's sandboxed
// folder, so it talks to the app through files there: each command is written
// to requests/ and the app's answer appears in responses/.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const folder = join(dirname(fileURLToPath(import.meta.url)), "..");
const [first, ...rest] = process.argv.slice(2);
if (!first) {
  console.error("Usage: node tools/research.mjs '<json command>' | <command file> | snapshot | search <words>");
  process.exit(1);
}
let command;
try {
  if (first === "snapshot") command = { action: "snapshot" };
  else if (first === "search") command = { action: "search", query: rest.join(" ") };
  else command = JSON.parse(first.trim().startsWith("{") ? first : readFileSync(first, "utf8"));
} catch (error) {
  console.error(`The command must be JSON or a file of JSON: ${error.message}`);
  process.exit(1);
}
const id = randomUUID();
mkdirSync(join(folder, "requests"), { recursive: true });
const pending = join(folder, "requests", `${id}.tmp`);
writeFileSync(pending, JSON.stringify(command));
renameSync(pending, join(folder, "requests", `${id}.json`));
const response = join(folder, "responses", `${id}.json`);
const deadline = Date.now() + 600_000;
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
const result = answer.result;
console.log(typeof result?.context === "string" ? result.context : JSON.stringify(result, null, 2));
