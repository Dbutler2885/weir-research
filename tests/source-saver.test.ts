// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import dataset from "./fixtures/workshop.json";
import { WorkspaceStore } from "../server/store.mjs";
import { PdfReading } from "../server/pdf/reading.mjs";
import { fictionalPdf } from "../server/pdf/fictional-pdf.mjs";
import { SourceSaver } from "../server/source-saver.mjs";
import { ResearchLibrary } from "../server/research-library.mjs";
import { readableText } from "../server/html-text.mjs";
import { sourceLibrary } from "../src/domain/findings";

const cleanup: (() => void)[] = [];
afterEach(() =>
  cleanup
    .splice(0)
    .reverse()
    .forEach((c) => c()),
);

const page = (body: string, title = "Fictional Harbor Gazette") => `<!doctype html><html><head><title>${title}</title><style>p { color: red }</style></head><body>${body}<script>track()</script></body></html>`;

// A fictional site on this computer, and a project that saves from it.
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "source-saver-"));
  const home = join(directory, "app");
  mkdirSync(join(directory, "documents"), { recursive: true });
  mkdirSync(home, { recursive: true });
  const store = new WorkspaceStore(directory, dataset);
  const reading = new PdfReading(store, { home, directory });
  const library = new ResearchLibrary(store, directory);
  const site = { requests: [] as string[], edition: 1, visit: 0 };
  const server = createServer((req, res) => {
    site.requests.push(req.url!);
    const send = (type: string, body: string | Buffer, status = 200) => {
      res.writeHead(status, { "Content-Type": type });
      res.end(body);
    };
    if (req.url === "/gazette") return send("text/html; charset=utf-8", page("<h1>Harbor notes</h1><p>Example Mill opened   in 1882,\n and Ada Example kept its <b>ledger</b>.</p><table><tr><th>Year</th><th>Owner</th></tr><tr><td>1901</td><td>Ben Example</td></tr></table>"));
    if (req.url === "/ledger.pdf") return send("application/pdf", fictionalPdf([{ text: ["Fictional Harbor Archive", "Example Trading Company was founded in 1842."] }, { text: ["Ada Example sold the mill in 1901."] }]));
    if (req.url === "/notes.txt") return send("text/plain", "Fictional notes.\r\nExample Mill burned in 1911.\r\n");
    if (req.url === "/edition") return send("text/html", page(`<p>The Example Mill register, edition ${site.edition}, lists forty workers.</p>`));
    // The same words every time, in a page whose bytes differ on every visit.
    if (req.url === "/stamped") return send("text/html", page(`<p>The Example Mill register lists forty workers.</p><script>visit = ${++site.visit}</script>`));
    if (req.url === "/app") return send("text/html", page('<div id="root"></div>'));
    if (req.url === "/latin") return send("text/html; charset=iso-8859-1", Buffer.from(page("<p>Fictional café ledger of the Example family, 1882.</p>"), "latin1"));
    if (req.url === "/picture") return send("image/png", Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    if (req.url === "/moved") {
      res.writeHead(302, { Location: "/gazette" });
      return res.end();
    }
    return send("text/html", "<p>Nothing here.</p>", 404);
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const saver = new SourceSaver(store, { directory, readPdf: (file: string) => reading.readFile(file), written: () => library.write() });
  cleanup.push(() => {
    server.close();
    server.closeAllConnections();
    reading.stop();
    library.stop();
    rmSync(directory, { recursive: true, force: true });
  });
  const save = (path: string, fresh = false) => saver.save({ url: `${base}${path}`, fresh });
  const doc = (id: string) => store.state.documents.find((d: any) => d.id === id) as any;
  const inLibrary = (path: string) => readFileSync(join(directory, "library", path), "utf8");
  return { directory, store, site, base, saver, save, doc, inLibrary };
}

describe("a page's readable text", () => {
  it("keeps the page's own text in order, a line per block, without scripts, styles or hidden parts", () => {
    const { title, text } = readableText(
      page('<nav><a href="/">Home</a> <a href="/about">About</a></nav><h1>Harbor   notes</h1><p>Example Mill<br>opened in <i>1882</i>.</p><p hidden>Draft only.</p><ul><li>First</li><li>Second</li></ul><pre>a  b\n  c</pre><button>Show the Example ledger</button><textarea>Typed note on Ada Example</textarea><svg><style>text { fill: red }</style><text>Owner: Ben Example</text></svg><table><tr><td>1901</td><td> Ben Example </td></tr></table>'),
    );
    expect(title).toBe("Fictional Harbor Gazette");
    expect(text).toBe("Home About\n\nHarbor notes\n\nExample Mill\nopened in 1882.\n\nFirst\nSecond\n\na  b\n  c\n\nShow the Example ledger\nTyped note on Ada Example\nOwner: Ben Example\n\n1901\tBen Example");
  });
  it("takes its title from the first heading when the page has no title", () => {
    expect(readableText("<h1>The Example  deed</h1><p>Text.</p>").title).toBe("The Example deed");
  });
});

describe("saving sources", () => {
  it("saves a web page as a document with its text, registered as a source, in the library at once", async () => {
    const { save, doc, store, base, inLibrary } = await fixture();
    const receipt = await save("/gazette#notes");
    expect(receipt).toMatchObject({ title: "Fictional Harbor Gazette", url: `${base}/gazette`, pages: 1, existing: false });
    const saved = doc(receipt.id);
    expect(saved).toMatchObject({ collectionId: "web", name: "Fictional Harbor Gazette.html", mime: "text/html", url: `${base}/gazette` });
    expect(saved.text).toBe("Harbor notes\n\nExample Mill opened in 1882, and Ada Example kept its ledger.\n\nYear\tOwner\n1901\tBen Example");
    expect(receipt.characters).toBe(saved.text.length);
    expect(sourceLibrary(store.state).find((s) => s.id === receipt.id)).toMatchObject({ title: "Fictional Harbor Gazette", url: `${base}/gazette`, access: "full-text" });
    // No wait for the library's next write: it is there when the save returns.
    expect(inLibrary(`documents/${receipt.id}.r1.txt`)).toBe(saved.text);
    expect(inLibrary(`documents/${receipt.id}.html`)).toContain("<h1>Harbor notes</h1>");
    expect(inLibrary("documents/documents.csv")).toContain(`${receipt.id},Fictional Harbor Gazette.html,web,documents/${receipt.id}.html,documents/${receipt.id}.r1.txt,1,${base}/gazette,`);
    expect(inLibrary("sources.csv")).toContain(receipt.id);
  });

  it("saves a PDF with its pages", async () => {
    const { save, doc, inLibrary } = await fixture();
    const receipt = await save("/ledger.pdf");
    expect(receipt).toMatchObject({ title: "ledger", pages: 2, existing: false });
    expect(doc(receipt.id)).toMatchObject({ name: "ledger.pdf", mime: "application/pdf", pages: 2, reading: { state: "done", engine: "standard" } });
    expect(inLibrary(`documents/${receipt.id}.r1.txt`)).toBe("[Page 1]\nFictional Harbor Archive\nExample Trading Company was founded in 1842.\n\n[Page 2]\nAda Example sold the mill in 1901.");
  }, 60_000);

  it("saves plain text as it is, and reads a page in the character set it names", async () => {
    const { save, doc } = await fixture();
    expect(doc((await save("/notes.txt")).id)).toMatchObject({ name: "notes.txt", mime: "text/plain", text: "Fictional notes.\nExample Mill burned in 1911." });
    expect(doc((await save("/latin")).id).text).toBe("Fictional café ledger of the Example family, 1882.");
  });

  it("gives the capture already saved for a repeated address, without downloading again", async () => {
    const { save, site, store } = await fixture();
    const first = await save("/gazette");
    const again = await save("/gazette");
    expect(again).toEqual({ ...first, existing: true });
    expect(site.requests).toEqual(["/gazette"]);
    expect(store.state.documents).toHaveLength(1);
  });

  it("shares one capture between two researchers saving an address together", async () => {
    const { save, site, store } = await fixture();
    const [one, two] = await Promise.all([save("/gazette"), save("/gazette")]);
    expect(two.id).toBe(one.id);
    expect([one.existing, two.existing]).toEqual([false, true]);
    expect(site.requests).toEqual(["/gazette"]);
    expect(store.state.documents).toHaveLength(1);
  });

  it("gives the earlier capture for a fresh one whose content has not changed", async () => {
    const { save, site, store, directory } = await fixture();
    const first = await save("/edition");
    expect(await save("/edition", true)).toEqual({ ...first, existing: true });
    // The page's bytes differ each visit; its words do not.
    const stamped = await save("/stamped");
    expect(await save("/stamped", true)).toEqual({ ...stamped, existing: true });
    expect(site.requests).toEqual(["/edition", "/edition", "/stamped", "/stamped"]);
    expect(store.state.documents).toHaveLength(2);
    expect(readdirSync(join(directory, "documents"))).toHaveLength(2);
  });

  it("keeps a fresh capture with changed content as a new document, leaving the earlier one as it was", async () => {
    const { save, site, doc } = await fixture();
    const first = await save("/edition");
    const before = structuredClone(doc(first.id));
    site.edition = 2;
    const second = await save("/edition", true);
    expect(second.existing).toBe(false);
    expect(second.id).not.toBe(first.id);
    expect(doc(second.id).text).toContain("edition 2");
    expect(doc(first.id)).toEqual(before);
    // The latest capture is the one a repeated address gives.
    expect((await save("/edition")).id).toBe(second.id);
  });

  it("gives the capture last seen at an address, when the page has gone back to an earlier one", async () => {
    const { save, site, store } = await fixture();
    const first = await save("/edition");
    site.edition = 2;
    const second = await save("/edition", true);
    site.edition = 1;
    // The page is as it first was: the fresh capture is the first one again.
    expect((await save("/edition", true)).id).toBe(first.id);
    expect((await save("/edition")).id).toBe(first.id);
    expect(store.state.documents.map((d: any) => d.id)).toEqual([first.id, second.id]);
  });

  it("follows a redirect to the page", async () => {
    const { save, doc } = await fixture();
    expect(doc((await save("/moved")).id).text).toContain("Example Mill opened in 1882");
  });

  it("says plainly why an address could not be saved, and saves nothing", async () => {
    const { save, saver, store, base, directory } = await fixture();
    await expect(save("/missing")).rejects.toThrow(`${base}/missing could not be downloaded: the site answered 404 Not Found.`);
    await expect(save("/app")).rejects.toThrow("This page has no readable text when downloaded, so it was not saved. It may need a sign-in, or draw its text with scripts.");
    await expect(save("/picture")).rejects.toThrow("This address gives a file of the kind image/png, which cannot be saved as text.");
    // An address where nothing listens.
    const closed = createServer();
    await new Promise<void>((done) => closed.listen(0, "127.0.0.1", done));
    const gone = `http://127.0.0.1:${(closed.address() as any).port}/closed`;
    await new Promise((done) => closed.close(done));
    await expect(saver.save({ url: gone })).rejects.toThrow(`${gone} could not be downloaded: nothing answered at that address.`);
    await expect(saver.save({ url: "harbor ledger" })).rejects.toThrow('"harbor ledger" is not a web address.');
    await expect(saver.save({ url: "file:///etc/hosts" })).rejects.toThrow("Only http and https addresses can be saved");
    expect(store.state.documents).toHaveLength(0);
    expect(readdirSync(join(directory, "documents"))).toHaveLength(0);
    expect(existsSync(join(directory, "library", "documents", "documents.csv"))).toBe(true);
  });
});
