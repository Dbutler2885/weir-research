// Saves a source from the web as a library document: the app downloads the address
// itself, keeps the original, takes the text in it, and registers it as a source, so the
// whole team shares one copy and every quote can be checked against it. A capture has
// its own ID and never changes; a later capture of the same address is another document.
import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
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

// The kinds of image that can be saved, told by how their bytes begin.
const IMAGES = [
  { mime: "image/png", extension: ".png", is: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: "image/jpeg", extension: ".jpg", is: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/gif", extension: ".gif", is: (b) => ["GIF87a", "GIF89a"].includes(b.subarray(0, 6).toString("latin1")) },
  { mime: "image/webp", extension: ".webp", is: (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP" },
  { mime: "image/tiff", extension: ".tif", is: (b) => ["II*\u0000", "MM\u0000*"].includes(b.subarray(0, 4).toString("latin1")) },
];
const MAX_TRANSCRIPTION = 500_000;

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
  // browser.capture(url) gives the page open in the research browser at an address.
  /** @param {any} store @param {{directory: string, readPdf: (file: string) => Promise<{pages: {number: number, text: string, method?: string}[], engine: string}>, written?: () => void, maxBytes?: number, timeout?: number, download?: typeof fetch, browser?: {capture: (url: string) => Promise<{url: string, title: string, text: string, html: string} | null>} | null}} options */
  constructor(store, { directory, readPdf, written = () => {}, maxBytes = 50_000_000, timeout = 60_000, download = fetch, browser = null }) {
    this.browser = browser;
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

  // The capture that shows the address as it was last seen: not always the newest
  // one, since a page can go back to what an earlier capture holds.
  latest(url) {
    const captures = this.captures(url);
    return captures.find((d) => d.id === this.store.state.latestCaptures?.[url]) || captures.at(-1);
  }

  // A fresh download matched an earlier capture, which is how the address looks now.
  seen(url, doc) {
    if (this.latest(url)?.id !== doc.id) this.store.update((next) => ((next.latestCaptures ||= {})[url] = doc.id));
    return this.receipt(doc, true);
  }

  receipt(doc, existing) {
    const title = this.store.state.dataset.sources?.find((source) => source.id === doc.id)?.title || doc.name;
    return { id: doc.id, title, ...(doc.url ? { url: doc.url } : {}), pages: doc.pages ?? 1, characters: (doc.text || "").length, existing, ...(doc.transcribed ? { transcribed: true } : {}) };
  }

  // Keeps an original and registers it as a document and a source.
  register({ id = randomUUID(), bytes, title, fields, url, source, latest = Boolean(url) }) {
    const hash = sha256(bytes);
    mkdirSync(join(this.directory, "documents"), { recursive: true });
    writeFileSync(join(this.directory, "documents", id), bytes, { mode: 0o600 });
    const at = new Date().toISOString();
    const saved = { id, collectionId: COLLECTION, ...fields, size: bytes.length, sha256: hash, importedAt: at, ...(url ? { url } : {}), capturedAt: at, revision: 1 };
    this.store.update((next) => {
      next.documents.push(saved);
      if (latest) (next.latestCaptures ||= {})[url] = id;
      (next.dataset.sources ||= []).push({ id, title, ...(url ? { repository: new URL(url).hostname, url } : {}), date: at.slice(0, 10), access: "full-text", accessedAt: at, ...source, note: `${source.note} SHA-256: ${hash}` });
    });
    this.written();
    return this.receipt(saved, false);
  }

  // Saves the page open in the research browser at an address, as it shows there,
  // sign-ins included. It is always a fresh capture; one that shows the same text as
  // an earlier capture of the address gives that earlier one.
  async savePage({ url: given }) {
    const url = address(given).href;
    if (!this.browser) throw new Error("This project has no research browser to save a page from. Save the address with weir.save instead.");
    const before = this.saving.get(url) || Promise.resolve();
    const result = before.then(async () => {
      const shown = await this.browser.capture(url);
      if (!shown) throw new Error(`No tab in the research browser is open at ${url}. Open the page there with your browser tools, then save it while it is open.`);
      const text = String(shown.text || "").replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
      if (text.replace(/\s/g, "").length < READABLE_MINIMUM) throw new Error("The page open in the research browser shows no readable text, so it was not saved. If it is a scan, save its image with your transcription.");
      const unchanged = this.captures(url).findLast((d) => d.text === text);
      if (unchanged) return this.seen(url, unchanged);
      const title = String(shown.title || "").trim() || decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).at(-1) || "") || new URL(url).hostname;
      return this.register({ bytes: Buffer.from(String(shown.html || ""), "utf8"), title, url, fields: { name: fileName(title, ".html"), mime: "text/html", text, pages: 1, via: "browser" }, source: { note: "Saved by the app from the research browser, as the page showed there." } });
    });
    const settled = result.catch(() => {}).then(() => {
      if (this.saving.get(url) === settled) this.saving.delete(url);
    });
    this.saving.set(url, settled);
    return result;
  }

  // Saves an image with the transcription of the agent that read it, for a record that
  // has no text of its own. The image is an address, which the app downloads, or a file
  // in the agent's own folder. Quotes from it are marked as transcribed, since the app
  // cannot check them against the image.
  /** @param {{source: string, transcription: string, title?: string}} given @param {{folder?: string | null}} [where] */
  async saveImage({ source, transcription, title: named }, { folder = null } = {}) {
    if (typeof transcription !== "string" || transcription.replace(/\s/g, "").length < READABLE_MINIMUM) throw new Error("Give your transcription of the image: the words it shows, as you read them.");
    if (transcription.length > MAX_TRANSCRIPTION) throw new Error(`A transcription holds up to ${MAX_TRANSCRIPTION.toLocaleString("en-US")} characters; save a longer record as several images.`);
    if (typeof source !== "string" || !source.trim()) throw new Error("Give the image: its web address, or a file in your folder.");
    let bytes;
    let url;
    if (/^https?:\/\//i.test(source.trim())) {
      url = address(source).href;
      ({ bytes } = await this.fetch(url));
    } else {
      if (!folder) throw new Error("Give the image's web address, starting with https://.");
      const root = realpathSync(folder);
      const refuse = () => new Error("An image file must be in your own folder. Save it there, or give its web address.");
      const inside = (file) => file === root || file.startsWith(root + sep);
      let named;
      try {
        named = realpathSync(resolve(root, source.trim()));
      } catch {
        throw new Error(`There is no file ${JSON.stringify(source)} in your folder.`);
      }
      if (!inside(named)) throw refuse();
      // The file is opened once and read from that opening, and what was opened is then
      // checked to be the file in the folder: a link put in its place meanwhile, or in
      // the place of a folder above it, is refused rather than followed.
      let descriptor;
      try {
        descriptor = openSync(named, constants.O_RDONLY | constants.O_NOFOLLOW);
      } catch {
        throw refuse();
      }
      try {
        const opened = fstatSync(descriptor);
        let now;
        try {
          now = realpathSync(named);
        } catch {
          throw refuse();
        }
        const there = lstatSync(now);
        if (!opened.isFile() || !inside(now) || there.ino !== opened.ino || there.dev !== opened.dev) throw refuse();
        if (opened.size > this.maxBytes) throw new Error(`${basename(named)} is larger than ${Math.floor(this.maxBytes / 1_000_000)} MB, so it was not saved.`);
        bytes = readFileSync(descriptor);
      } finally {
        closeSync(descriptor);
      }
    }
    const kind = IMAGES.find((image) => image.is(bytes));
    if (!kind) throw new Error("This is not an image the app can save: PNG, JPEG, GIF, WebP and TIFF images can be saved. A page or a PDF is saved with weir.save.");
    const text = transcription.replace(/\r\n?/g, "\n").trim();
    const hash = sha256(bytes);
    // The same image with the same transcription is the capture already there.
    const same = this.store.state.documents.find((d) => d.transcribed && d.sha256 === hash && d.text === text);
    if (same) return this.receipt(same, true);
    const last = url ? decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).at(-1) || "") : basename(source.trim());
    const title = (typeof named === "string" && named.trim()) || last.replace(/\.[^.]+$/, "") || "Saved image";
    return this.register({ bytes, title, url, latest: false, fields: { name: fileName(title, kind.extension), mime: kind.mime, text, pages: 1, transcribed: true }, source: { note: "An image saved by the app, with the transcription of the agent that read it." } });
  }

  async capture(url, fresh) {
    const earlier = this.captures(url);
    if (earlier.length && !fresh) return this.receipt(this.latest(url), true);
    const { bytes, type } = await this.fetch(url);
    const hash = sha256(bytes);
    const same = earlier.findLast((d) => d.sha256 === hash);
    if (same) return this.seen(url, same);
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
        doc.conversion = { engine, at: doc.reading.at };
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
          return this.seen(url, unchanged);
        }
      }
    } catch (error) {
      rmSync(file, { force: true });
      throw error;
    }
    const at = new Date().toISOString();
    const { title, ...fields } = doc;
    const saved = { id, collectionId: COLLECTION, ...fields, size: bytes.length, sha256: hash, importedAt: at, url, capturedAt: at, revision: 1 };
    this.store.update((next) => {
      next.documents.push(saved);
      (next.latestCaptures ||= {})[url] = id;
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
