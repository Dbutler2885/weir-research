// The project's cache of calls to cheap models. Every reader call is kept on disk by
// its model, its question and its input, so a repeated call returns its earlier answer
// at once and costs nothing. It belongs to the project, so the whole team shares it.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export class CallCache {
  constructor(folder) {
    this.folder = folder;
  }
  // A call's key: its kind, its model, its question and its input, each of which
  // changes the key.
  key({ kind, model, question = "", input }) {
    return createHash("sha256").update(JSON.stringify([kind, model, question, input])).digest("hex");
  }
  file(call) {
    const key = this.key(call);
    return join(this.folder, call.kind, key.slice(0, 2), `${key}.json`);
  }
  // The earlier answer to a call, or undefined when it was never made.
  get(call) {
    try {
      return JSON.parse(readFileSync(this.file(call), "utf8")).answer;
    } catch {
      return undefined;
    }
  }
  set(call, answer) {
    const file = this.file(call);
    mkdirSync(dirname(file), { recursive: true });
    const partial = `${file}.${randomUUID().slice(0, 8)}.tmp`;
    writeFileSync(partial, JSON.stringify({ kind: call.kind, model: call.model, question: call.question || "", at: new Date().toISOString(), answer }));
    renameSync(partial, file);
  }
}
