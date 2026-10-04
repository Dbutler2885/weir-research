// A seat's inbox: what the app has for a seat's researcher and has not yet delivered,
// kept on disk in the seat's folder so it survives a restart of the app. Board posts
// the researcher missed and notices of its own work finishing wait here while it is
// paused, finished or still starting, and each is delivered once.
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

let sequence = 0;

export class SeatInbox {
  /** @param {string} seat The seat's folder. */
  constructor(seat) {
    this.folder = join(seat, "inbox");
  }
  // Keeps a message for the seat: a post, with who it is from, or a notice. A message
  // given an ID and a time is kept once however often it is added, so adding it again
  // after a restart changes nothing.
  /** @param {{kind: "post" | "notice", from?: string, text: string}} item @param {{id?: string, at?: string}} [known] */
  add(item, { id, at } = {}) {
    mkdirSync(this.folder, { recursive: true });
    // Named so that they sort in the order they arrived.
    const name = id
      ? `${String(Date.parse(at) || Date.now()).padStart(15, "0")}-000000-${id}`
      : `${String(Date.now()).padStart(15, "0")}-${String(++sequence).padStart(6, "0")}-${randomUUID().slice(0, 8)}`;
    writeFileSync(join(this.folder, `${name}.tmp`), JSON.stringify({ ...item, at: new Date().toISOString() }));
    renameSync(join(this.folder, `${name}.tmp`), join(this.folder, `${name}.json`));
  }
  // What is waiting, oldest first, each with the file that holds it.
  list() {
    let names;
    try {
      names = readdirSync(this.folder).filter((name) => name.endsWith(".json")).sort();
    } catch {
      return [];
    }
    return names.flatMap((name) => {
      try {
        return [{ ...JSON.parse(readFileSync(join(this.folder, name), "utf8")), file: name }];
      } catch {
        return [];
      }
    });
  }
  get size() {
    return this.list().length;
  }
  // Forgets messages that have been delivered.
  remove(items) {
    for (const item of items) rmSync(join(this.folder, item.file), { force: true });
  }
  clear() {
    rmSync(this.folder, { recursive: true, force: true });
  }
}

// Waiting messages as the researcher reads them, in one message.
export function inboxText(items) {
  return items.map((item) => (item.kind === "post" ? `A post on your batch's board, from ${item.from}:\n\n${item.text}` : item.text)).join("\n\n---\n\n");
}
