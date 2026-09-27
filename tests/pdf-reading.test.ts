// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import dataset from "./fixtures/workshop.json";
import { WorkspaceStore } from "../server/store.mjs";
import { PdfReading, pageText, pdfReading } from "../server/pdf/reading.mjs";
import { doclingFolder, doclingStatus } from "../server/pdf/docling.mjs";
import { fictionalPdf } from "../server/pdf/fictional-pdf.mjs";
import { quoteFound, type ResearchDocument } from "../src/domain/research";
import { readingLabel, readingNote } from "../src/ui/pdf-reading";
import { setupPage } from "../server/setup-page.mjs";
import { until } from "./fixtures/until";

const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((c) => c()));

// A project holding one fictional PDF: a typed page, then a scanned one.
function project({ reader }: { reader?: "standard" | "docling" } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "pdf-reading-"));
  const home = join(directory, "app");
  mkdirSync(join(directory, "documents"), { recursive: true });
  mkdirSync(home, { recursive: true });
  if (reader) writeFileSync(join(home, "app-settings.json"), JSON.stringify({ pdfReader: reader }));
  const store = new WorkspaceStore(directory, dataset);
  const id = "fictional-harbor";
  writeFileSync(
    join(directory, "documents", id),
    fictionalPdf([
      { text: ["Fictional Harbor Archive", "Example Trading Company was founded in 1842."] },
      { scan: ["FICTIONAL SCANNED RECORD", "Example Mill opened in 1882."] },
    ]),
  );
  store.update((next: any) => {
    next.documents.push({ id, collectionId: "imports", name: "harbor.pdf", mime: "application/pdf", size: 1, sha256: "x", importedAt: "2026-01-01T00:00:00Z", reading: { state: "waiting" } });
  });
  const reading = new PdfReading(store, { home, directory });
  cleanup.push(() => {
    reading.stop();
    rmSync(directory, { recursive: true, force: true });
  });
  const doc = () => store.state.documents.find((d: ResearchDocument) => d.id === id) as ResearchDocument;
  return { store, reading, home, doc, directory };
}

describe("reading PDFs with Standard", () => {
  it("takes the text layer where a page has one and reads a scanned page with OCR, page by page", async () => {
    const { reading, doc } = project();
    reading.pump();
    await until(() => doc().reading?.state === "done", 60_000);
    expect(doc().text).toContain("[Page 1]\nFictional Harbor Archive\nExample Trading Company was founded in 1842.");
    expect(doc().text).toMatch(/\[Page 2\]\nFICTIONAL SCANNED RECORD\nExample Mill opened in 1882\./);
    expect(doc().pages).toBe(2);
    expect(doc().reading).toMatchObject({ engine: "standard", ocrPages: 1 });
    expect(readingLabel(doc())).toBe("Searchable · 2 pages");
  }, 60_000);

  it("says why a PDF that isn't a PDF couldn't be read, and can try again", async () => {
    const { reading, doc, directory } = project();
    writeFileSync(join(directory, "documents", doc().id), "<html>Access denied</html>");
    reading.pump();
    await until(() => doc().reading?.state === "failed", 30_000);
    expect(readingLabel(doc())).toBe("Couldn't be read");
    expect(doc().reading?.error).toBe("This file isn't a PDF that can be read. It may be damaged, or a web page saved with a .pdf name.");
    expect(readingNote(doc())).toContain(`data-read-again="${doc().id}"`);
  }, 30_000);
});

describe("waiting for High accuracy", () => {
  it("holds PDFs until Docling is installed, and says so", () => {
    const { reading, doc, home } = project({ reader: "docling" });
    reading.pump();
    expect(doc().reading?.state).toBe("waiting");
    expect(readingLabel(doc(), pdfReading(home))).toBe("Waiting for High accuracy, which isn't installed");
  });

  it("reports an install whose process has gone as failed, so it can be tried again", () => {
    const { home } = project();
    mkdirSync(doclingFolder(home), { recursive: true });
    writeFileSync(join(doclingFolder(home), "status.json"), JSON.stringify({ state: "installing", step: "Downloading Python and Docling", pid: 2 ** 22 + 1 }));
    expect(doclingStatus(home)).toEqual({ state: "failed", error: "The install stopped before it finished." });
  });

  it("reads a PDF again with a named reader only when asked for documents it knows", () => {
    const { reading } = project();
    expect(() => reading.readAgain("everything" as any)).toThrow("Say which documents to read again.");
    expect(() => reading.readAgain("all", "fast" as any)).toThrow("Choose Standard or High accuracy.");
  });
});

describe("finding quotations in a PDF's text", () => {
  it("finds a quotation however the lines break, and not one that isn't there", () => {
    const text = pageText([{ number: 1, text: "Example Trading Company was\nfounded in 1842." }]);
    expect(quoteFound(text, "Company was founded in 1842.")).toBe(true);
    expect(quoteFound(text, "founded in 1843.")).toBe(false);
  });
});

describe("choosing a PDF reader during setup", () => {
  const setup = { agents: [], dependencies: [], ready: false };
  it("offers both readers with what each costs, with the current choice selected", () => {
    const page = setupPage({ setup, pdfReading: { reader: "standard", docling: { state: "absent" } } } as any);
    expect(page).toContain("Reading PDFs");
    expect(page).toMatch(/value="standard" checked/);
    expect(page).toContain("A one-time download of about 2 GB");
  });

  it("shows how far the High accuracy install has come", () => {
    const page = setupPage({ setup, pdfReading: { reader: "docling", docling: { state: "installing", step: "Downloading Python and Docling", downloaded: 1_200_000_000 } } } as any);
    expect(page).toContain("Installing High accuracy: Downloading Python and Docling, 1.2 GB of about 2 GB.");
  });
});
