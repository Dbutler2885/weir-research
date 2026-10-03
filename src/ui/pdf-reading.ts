// How PDFs are read into searchable text: the choice between the two readers in
// Research settings, and where each document's reading stands.
import type { ResearchDocument, ResearchState } from "../domain/research";
import { html } from "./finding-review";

export type PdfReading = NonNullable<ResearchState["pdfReading"]>;
type Reader = PdfReading["reader"];

const gigabytes = (bytes: number) => `${(bytes / 1e9).toFixed(1)} GB`;

export const readerName = (reader: Reader) => (reader === "docling" ? "High accuracy" : "Standard");

// Where High accuracy stands, in a sentence, with what the human can do about it.
export function doclingStatus(reading: PdfReading): string {
  const d = reading.docling;
  if (d.state === "installing")
    return `<p>Installing: ${html(d.step)}. ${d.downloaded ? `${gigabytes(d.downloaded)} of about 2 GB so far.` : ""}</p><p class="page-context">It carries on if you close the project. PDFs wait for it and are read once it is ready.</p>`;
  if (d.state === "failed")
    return `<p>The install didn't finish: ${html(d.error)}</p><div class="setting-control"><button type="button" data-pdf-reader="docling">Try again</button></div>`;
  if (d.state === "ready")
    return reading.reader === "docling" ? "<p>Installed.</p>" : `<p class="page-context">High accuracy is installed but not in use.</p><div class="setting-control"><button type="button" data-remove-docling>Remove it and free about 2 GB</button></div>`;
  return reading.reader === "docling" ? "<p>Not installed.</p>" : "";
}

// The Research settings section.
export function pdfReadingSettings(state: ResearchState): string {
  const reading = state.pdfReading;
  if (!reading) return "";
  const choice = (reader: Reader, title: string, detail: string) =>
    `<label class="setting-choice"><input type="radio" name="pdf-reader" value="${reader}" ${reading.reader === reader ? "checked" : ""}><span><strong>${title}</strong><span class="page-context">${detail}</span></span></label>`;
  const pdfs = state.documents.filter((d) => d.mime === "application/pdf").length;
  return `<section><h2>Reading PDFs</h2><p class="page-context">Every PDF you add is read into text, so researchers can search it and quotations can be checked against it. This applies to every project.</p><fieldset class="setting-choices"><legend class="sr-only">PDF reader</legend>${choice("standard", "Standard", "Small and fast. Reads typed and printed PDFs well, including scans, but can run the columns of a newspaper or a complex layout together.")}${choice("docling", "High accuracy", "A one-time download of about 2 GB, and slower. Follows columns, tables and reading order, so newspapers and complex scans come out right.")}</fieldset><div data-pdf-status>${doclingStatus(reading)}</div>${pdfs ? `<div class="setting-control"><button type="button" data-read-all-again>Read this project's ${pdfs === 1 ? "PDF" : `${pdfs} PDFs`} again with ${readerName(reading.reader)}</button></div>` : ""}</section>`;
}

// A document's line in the source library: searchable, or how far its reading has come.
export function readingLabel(d: ResearchDocument, reading?: PdfReading): string {
  const r = d.reading;
  if (r?.state === "reading") return r.page && r.total ? `Reading page ${r.page} of ${r.total}` : "Reading";
  if (r?.state === "waiting") {
    const engine = r.engine || reading?.reader;
    if (engine === "docling" && reading?.docling.state === "installing") return "Waiting for High accuracy to install";
    if (engine === "docling" && reading?.docling.state !== "ready") return "Waiting for High accuracy, which isn't installed";
    return d.text === undefined ? "Waiting to be read" : "Searchable · waiting to be read again";
  }
  if (r?.state === "failed") return d.text === undefined ? "Couldn't be read" : "Searchable · reading again failed";
  if (d.text !== undefined) return d.pages ? `Searchable · ${d.pages} ${d.pages === 1 ? "page" : "pages"}` : "Searchable";
  return "Not read";
}

// Under a PDF on its source page: how it was read, and reading it again.
export function readingNote(d: ResearchDocument, reading?: PdfReading): string {
  if (d.mime !== "application/pdf") return "";
  const r = d.reading;
  const label = readingLabel(d, reading);
  if (r?.state === "failed")
    return `<p class="muted">${html(label)}: ${html(r.error)}</p><button type="button" data-read-again="${d.id}">Try again</button>`;
  if (r?.state !== "done") return `<p class="muted">${html(label)}.</p>`;
  const how = `Read with ${readerName(r.engine || "standard")}${r.ocrPages ? `, ${r.ocrPages} ${r.ocrPages === 1 ? "page" : "pages"} by OCR` : ""}.`;
  const better = r.engine !== "docling" && reading?.docling.state === "ready";
  return `<p class="muted">${html(how)}</p>${better ? `<button type="button" data-read-again="${d.id}" data-engine="docling">Read again with High accuracy</button>` : ""}`;
}
