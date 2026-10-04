// Draws one page of a PDF as a picture, run as its own process:
// `node page-image.mjs <pdf> <page number> <out.png>`. The reconciliation job looks at
// it to see what the page itself says.
import { readFileSync, writeFileSync } from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

// About 180 dpi: enough to read small print, without a picture too large to look at.
const SCALE = 2.5;
const [file, number, out] = process.argv.slice(2);
const loading = getDocument({ data: new Uint8Array(readFileSync(file)), verbosity: 0, isEvalSupported: false });
try {
  const pdf = await loading.promise;
  const page = await pdf.getPage(Number(number));
  const viewport = page.getViewport({ scale: SCALE });
  const { canvas, context } = pdf.canvasFactory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  writeFileSync(out, canvas.toBuffer("image/png"));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await loading.destroy();
}
