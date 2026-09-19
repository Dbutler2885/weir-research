// One-time conversion of existing projects to numbered batches.
// Usage: node scripts/convert-to-batches.mjs [project-id ...]  (all projects when omitted)
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { projects, read, save } from "./workspace-lib.mjs";
import { convertToBatches } from "../src/domain/batch-conversion.ts";

const wanted = process.argv.slice(2);
for (const p of projects().filter((p) => !wanted.length || wanted.includes(p.id))) {
  const file = join(p.directory, "workspace.json");
  if (!existsSync(file)) continue;
  const lock = join(p.directory, "server.lock");
  if (existsSync(lock)) {
    try {
      process.kill(Number(readFileSync(lock, "utf8")), 0);
      console.log(`${p.id}: skipped, its workspace server is running. Stop it and retry.`);
      continue;
    } catch {
      /* A stale lock from a stopped server. */
    }
  }
  const state = read(file, null);
  if (state.investigations.some((i) => i.number)) {
    console.log(`${p.id}: already converted.`);
    continue;
  }
  const backup = join(p.directory, "workspace.before-batches.json");
  if (!existsSync(backup)) copyFileSync(file, backup);
  const next = convertToBatches(state);
  save(file, next);
  console.log(
    `${p.id}: ${next.investigations.length} batches, ${next.conversation.length} conversation messages, ${next.queue.length} queued. Backup: ${backup}`,
  );
}
