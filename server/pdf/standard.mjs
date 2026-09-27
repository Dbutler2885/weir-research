// The Standard PDF reader, run as its own process: `node standard.mjs <pdf>`.
// It takes each page's text layer where the page has one, and reads the pages that
// are only pictures, such as scans, with OCR. It uses nothing outside Node.
// It prints one JSON line per page read, then one with every page's text.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createWorker, OEM } from "tesseract.js";

const require = createRequire(import.meta.url);
// A page with less text than this is taken to be a picture of its text.
const TEXT_LAYER_MINIMUM = 40;
// Scans render at twice PDF resolution, about 144 dpi, which OCR reads well.
const SCALE = 2;

const say = (line) => process.stdout.write(`${JSON.stringify(line)}\n`);

// A page's text layer, with its own line breaks.
async function textLayer(page) {
  const content = await page.getTextContent();
  let text = "";
  for (const item of content.items) {
    if (!("str" in item)) continue;
    text += item.str;
    if (item.hasEOL) text += "\n";
  }
  return text.replace(/[ \t]+\n/g, "\n").trim();
}

let worker;
async function ocr(page, canvasFactory) {
  const viewport = page.getViewport({ scale: SCALE });
  const { canvas, context } = canvasFactory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  const image = canvas.toBuffer("image/png");
  canvasFactory.destroy({ canvas, context });
  // English, from the language data installed with the app, so nothing is downloaded.
  worker ||= await createWorker("eng", OEM.LSTM_ONLY, {
    langPath: join(dirname(require.resolve("@tesseract.js-data/eng/package.json")), "4.0.0_best_int"),
    cacheMethod: "none",
    gzip: true,
  });
  const { data } = await worker.recognize(image);
  return data.text.trim();
}

const file = process.argv[2];
const loading = getDocument({ data: new Uint8Array(readFileSync(file)), verbosity: 0, isEvalSupported: false });
let pdf;
try {
  pdf = await loading.promise;
} catch (error) {
  // Said in words the human can act on, rather than as pdf.js names it.
  const reason = {
    InvalidPDFException: "This file isn't a PDF that can be read. It may be damaged, or a web page saved with a .pdf name.",
    PasswordException: "This PDF is protected by a password. Save an unprotected copy and add that.",
  }[error.name];
  say({ error: reason || `This PDF could not be read: ${error.message}` });
  process.exit(1);
}
say({ total: pdf.numPages });
const pages = [];
try {
  for (let number = 1; number <= pdf.numPages; number++) {
    const page = await pdf.getPage(number);
    let text = await textLayer(page);
    let method = "text";
    if (text.replace(/\s/g, "").length < TEXT_LAYER_MINIMUM) {
      text = await ocr(page, pdf.canvasFactory);
      method = "ocr";
    }
    page.cleanup();
    pages.push({ number, text, method });
    say({ page: number, total: pdf.numPages });
  }
} finally {
  await worker?.terminate();
  await loading.destroy();
}
say({ pages });
