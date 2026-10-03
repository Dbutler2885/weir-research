// Saves a source from the web as a library document: the app downloads the address
// itself, keeps the original, turns it into text, and registers it as a source, so the
// whole team shares one copy and every quote can be checked against it. A capture has
// its own ID and never changes; a later capture of the same address is another document.
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { declaredCharset, readableText } from "./html-text.mjs";
import { pageText } from "./pdf/reading.mjs";

const COLLECTION = "web";
// Less text than this is a page that shows nothing without its scripts or a sign-in.
const READABLE_MINIMUM = 20;
const AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Weir/1.0 Safari/537.36";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const REASONS = { ECONNREFUSED: "nothing answered at that address", ENOTFOUND: "no site has that name", ECONNRESET: "the site closed the connection", CERT_HAS_EXPIRED: "the site's certificate has expired" };
const fileName = (title, extension) => `${(title.toLowerCase().endsWith(extension) ? title.slice(0, -extension.length) : title).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "Saved source"}${extension}`;

function address(given) {
  let url;
  try {
    url = new URL(String(given).trim());
  } catch {
    throw new Error(`"${given}" is not a web address. Give the whole address, starting with https://.`);
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error(`Only http and https addresses can be saved, and this one starts with ${url.protocol}`);
  // The part after # names a place in the page, not another page.
  url.hash = "";
  return url;
}

function decode(bytes, type) {
  for (const charset of [type.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1], declaredCharset(bytes), "utf-8"]) {
    if (!charset) continue;
    try {
      return new TextDecoder(charset).decode(bytes);
    } catch {
      /* A character set this computer does not know; try the next. */
    }
  }
  return new TextDecoder().decode(bytes);
}

export class SourceSaver {
  // readPdf(file) resolves with a PDF's pages and the reader that read them.
  // written() runs after a save, to bring the library's files up to date at once.
  /** @param {any} store @param {{directory: string, readPdf: (file: string) => Promise<{pages: {number: number, text: string, method?: string}[], engine: string}>, written?: () => void, maxBytes?: number, timeout?: number, download?: typeof fetch}} options */
  constructor(store, { directory, readPdf, written = () => {}, maxBytes = 50_000_000, timeout = 60_000, download = fetch }) {
    this.store = store;
    this.directory = directory;
    this.readPdf = readPdf;
    this.written = written;
    this.maxBytes = maxBytes;
    this.timeout = timeout;
    this.download = download;
    // One save at a time per address, so two researchers saving it together share a capture.
    this.saving = new Map();
  }

  // Saves the address, and resolves with a receipt: the document's ID, its title,
  // pages and length, and whether it was already saved. An address already saved
  // gives its latest capture without downloading, unless fresh is asked for; a fresh
  // capture with the same content as an earlier one gives that earlier one.
  save({ url: given, fresh = false }) {
    let url;
    try {
      url = address(given).href;
    } catch (error) {
      return Promise.reject(error);
    }
    const before = this.saving.get(url) || Promise.resolve();
    const result = before.then(() => this.capture(url, fresh === true));
    const settled = result.catch(() => {}).then(() => {
      if (this.saving.get(url) === settled) this.saving.delete(url);
    });
    this.saving.set(url, settled);
    return result;
  }

  captures(url) {
    return this.store.state.documents.filter((d) => d.url === url);
  }

  receipt(doc, existing) {
    const title = this.store.state.dataset.sources?.find((source) => source.id === doc.id)?.title || doc.name;
    return { id: doc.id, title, url: doc.url, pages: doc.pages ?? 1, characters: (doc.text || "").length, existing };
  }

  async capture(url, fresh) {
    const earlier = this.captures(url);
    if (earlier.length && !fresh) return this.receipt(earlier.at(-1), true);
    const { bytes, type } = await this.fetch(url);
    const hash = sha256(bytes);
    const same = earlier.findLast((d) => d.sha256 === hash);
    if (same) return this.receipt(same, true);
    const id = randomUUID();
    const pdf = !/html/i.test(type) && bytes.subarray(0, 1024).includes("%PDF-");
    const html = !pdf && (/html|xml/i.test(type) || (!type && /^\s*<(!doctype|html)/i.test(bytes.subarray(0, 200).toString("latin1"))));
    if (!pdf && !html && !/^text\//i.test(type)) throw new Error(`This address gives ${type ? `a file of the kind ${type}` : "a file of an unknown kind"}, which cannot be saved as text. Pages, PDFs and plain text can be saved.`);
    const file = join(this.directory, "documents", id);
    mkdirSync(join(this.directory, "documents"), { recursive: true });
    writeFileSync(file, bytes, { mode: 0o600 });
    let doc;
    try {
      const last = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).at(-1) || "");
      if (pdf) {
        const { pages, engine } = await this.readPdf(file);
        const title = last.replace(/\.pdf$/i, "") || new URL(url).hostname;
        const ocr = pages.filter((p) => p.method === "ocr").length;
        doc = { title, name: fileName(title, ".pdf"), mime: "application/pdf", text: pageText(pages), pages: pages.length, reading: { state: "done", engine, at: new Date().toISOString(), ...(ocr ? { ocrPages: ocr } : {}) } };
        if (pages.reduce((n, p) => n + p.text.replace(/\s/g, "").length, 0) < READABLE_MINIMUM) throw new Error("This PDF has no readable text, so it was not saved.");
      } else {
        const decoded = decode(bytes, type);
        const page = html ? readableText(decoded) : { title: "", text: decoded.replace(/\r\n?/g, "\n").trim() };
        const title = page.title || last || new URL(url).hostname;
        doc = { title, name: fileName(title, html ? ".html" : ".txt"), mime: html ? "text/html" : "text/plain", text: page.text, pages: 1 };
        if (page.text.replace(/\s/g, "").length < READABLE_MINIMUM)
          throw new Error("This page has no readable text when downloaded, so it was not saved. It may need a sign-in, or draw its text with scripts.");
        const unchanged = earlier.findLast((d) => d.text === page.text);
        if (unchanged) {
          rmSync(file, { force: true });
          return this.receipt(unchanged, true);
        }
      }
    } catch (error) {
      rmSync(file, { force: true });
      throw error;
    }
    const at = new Date().toISOString();
    const { title, ...fields } = doc;
    const saved = { id, collectionId: COLLECTION, ...fields, size: bytes.length, sha256: hash, importedAt: at, url, capturedAt: at };
    this.store.update((next) => {
      next.documents.push(saved);
      (next.dataset.sources ||= []).push({ id, title, repository: new URL(url).hostname, date: at.slice(0, 10), url, access: "full-text", accessedAt: at, note: `Saved by the app. SHA-256: ${hash}` });
    });
    this.written();
    return this.receipt(saved, false);
  }

  async fetch(url) {
    let response;
    const signal = AbortSignal.timeout(this.timeout);
    const failed = (error) => {
      const reason = error.name === "TimeoutError" ? `the site did not answer within ${Math.round(this.timeout / 1000)} seconds` : REASONS[error.cause?.code] || error.cause?.message || error.message;
      return new Error(`${url} could not be downloaded: ${reason}.`);
    };
    try {
      response = await this.download(url, { redirect: "follow", signal, headers: { "User-Agent": AGENT, Accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,text/plain;q=0.8,*/*;q=0.5" } });
    } catch (error) {
      throw failed(error);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new Error(`${url} could not be downloaded: the site answered ${response.status}${response.statusText ? ` ${response.statusText}` : ""}.`);
    }
    const chunks = [];
    let length = 0;
    try {
      for await (const chunk of response.body || []) {
        length += chunk.length;
        if (length > this.maxBytes) {
          await response.body.cancel().catch(() => {});
          throw new Error(`${url} is larger than ${Math.floor(this.maxBytes / 1_000_000)} MB, so it was not saved.`);
        }
        chunks.push(chunk);
      }
    } catch (error) {
      throw /was not saved/.test(error.message) ? error : failed(error);
    }
    return { bytes: Buffer.concat(chunks), type: (response.headers.get("content-type") || "").trim() };
  }
}
