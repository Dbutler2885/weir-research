// Reads every PDF a project holds into searchable text, one at a time, in the
// background. Which reader does it is the human's choice for the whole app:
// Standard, which needs nothing but Node, or High accuracy, which is Docling.
// A document keeps its original; its text is stored page by page, marked with
// page numbers so quotations can be found and cited.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { doclingStatus, readWithDocling, startDoclingInstall } from "./docling.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const settingsFile = (home) => join(home, "app-settings.json");
const settings = (home) => {
  try {
    return JSON.parse(readFileSync(settingsFile(home), "utf8"));
  } catch {
    return {};
  }
};

/**
 * The chosen reader, Standard unless High accuracy was chosen.
 * @returns {"standard" | "docling"}
 */
export const pdfReader = (home) => (settings(home).pdfReader === "docling" ? "docling" : "standard");

// Choosing High accuracy installs Docling, if it isn't already.
export function choosePdfReader(home, reader) {
  if (!["standard", "docling"].includes(reader)) throw new Error("Choose Standard or High accuracy.");
  mkdirSync(home, { recursive: true });
  writeFileSync(settingsFile(home), JSON.stringify({ ...settings(home), pdfReader: reader }, null, 2), { mode: 0o600 });
  if (reader === "docling" && ["absent", "failed"].includes(doclingStatus(home).state)) startDoclingInstall(home);
}

/** Where PDF reading stands for the whole app, for the pages to show. */
export const pdfReading = (home) => ({ reader: pdfReader(home), docling: doclingStatus(home) });

// A document's text: each page under its number.
export const pageText = (pages) => pages.map((p) => `[Page ${p.number}]\n${p.text}`).join("\n\n");

const isPdf = (d) => d.mime === "application/pdf";

export class PdfReading {
  constructor(store, { home, directory }) {
    this.store = store;
    this.home = home;
    this.directory = directory;
    this.current = null;
    // Reading that stopped with the app starts again from the beginning.
    const stopped = store.state.documents.filter((d) => isPdf(d) && d.reading?.state === "reading");
    if (stopped.length)
      store.update((next) => {
        for (const d of next.documents) if (isPdf(d) && d.reading?.state === "reading") d.reading = { state: "waiting", engine: d.reading.engine };
      });
    // Docling may finish installing while PDFs wait for it.
    this.timer = setInterval(() => this.pump(), 5000);
    this.timer.unref();
  }

  // PDFs with no text yet, and none waiting, are waiting from now.
  queueUnread() {
    if (!this.store.state.documents.some((d) => isPdf(d) && d.text === undefined && !d.reading)) return;
    this.store.update((next) => {
      for (const d of next.documents) if (isPdf(d) && d.text === undefined && !d.reading) d.reading = { state: "waiting" };
    });
  }

  // Reads documents again, with a named reader or the chosen one. Their current
  // text stays until the new reading is done.
  readAgain(ids, engine) {
    if (ids !== "all" && !(Array.isArray(ids) && ids.every((id) => typeof id === "string"))) throw new Error("Say which documents to read again.");
    if (engine && !["standard", "docling"].includes(engine)) throw new Error("Choose Standard or High accuracy.");
    const result = this.store.update((next) => {
      const chosen = next.documents.filter((d) => isPdf(d) && (ids === "all" || ids.includes(d.id)) && d.reading?.state !== "reading");
      for (const d of chosen) d.reading = { state: "waiting", ...(engine ? { engine } : {}) };
      return chosen.length;
    });
    this.pump();
    return result;
  }

  pump() {
    this.queueUnread();
    if (this.current) return;
    const reader = pdfReader(this.home);
    const docling = doclingStatus(this.home).state;
    const next = this.store.state.documents.find((d) => {
      if (!isPdf(d) || d.reading?.state !== "waiting") return false;
      return (d.reading.engine || reader) === "standard" || docling === "ready";
    });
    if (!next) return;
    const engine = next.reading.engine || reader;
    this.current = { id: next.id, controller: new AbortController() };
    this.set(next.id, { state: "reading", engine });
    this.read(next, engine, this.current.controller.signal).then(
      (pages) => {
        this.store.update((state) => {
          const d = state.documents.find((x) => x.id === next.id);
          if (!d) return;
          d.text = pageText(pages);
          d.pages = pages.length;
          d.reading = { state: "done", engine, at: new Date().toISOString(), ...(pages.some((p) => p.method === "ocr") ? { ocrPages: pages.filter((p) => p.method === "ocr").length } : {}) };
        });
      },
      (error) => {
        if (this.stopped) return;
        this.set(next.id, { state: "failed", engine, error: error.message.slice(0, 300) });
      },
    ).finally(() => {
      this.current = null;
      if (!this.stopped) this.pump();
    });
  }

  set(id, reading) {
    this.store.update((state) => {
      const d = state.documents.find((x) => x.id === id);
      if (d) d.reading = reading;
    });
  }

  read(doc, engine, signal) {
    const file = join(this.directory, "documents", doc.id);
    if (engine === "docling") return readWithDocling(this.home, file, join(this.directory, "processed-pdfs"), { signal });
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [join(here, "standard.mjs"), file], { stdio: ["ignore", "pipe", "pipe"], signal });
      let buffer = "";
      let stderr = "";
      let pages = null;
      let problem = null;
      let shown = 0;
      child.stdout.on("data", (chunk) => {
        buffer += chunk;
        let end;
        while ((end = buffer.indexOf("\n")) >= 0) {
          const line = JSON.parse(buffer.slice(0, end));
          buffer = buffer.slice(end + 1);
          if (line.pages) pages = line.pages;
          else if (line.error) problem = line.error;
          // Progress, at most every two seconds, so a long document doesn't flood the project with saves.
          else if (line.page && Date.now() - shown > 2000) {
            shown = Date.now();
            this.set(doc.id, { state: "reading", engine, page: line.page, total: line.total });
          }
        }
      });
      child.stderr.on("data", (chunk) => (stderr = (stderr + chunk).slice(-4000)));
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code === 0 && pages) resolve(pages);
        else reject(new Error(problem || `This PDF could not be read. ${stderr.trim().split("\n").find((l) => /^\w*(Error|Exception)\b/.test(l)) || ""}`.trim()));
      });
    });
  }

  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    this.current?.controller.abort();
  }
}
