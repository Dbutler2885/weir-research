// Builds small, fictional PDFs for tests: pages of real text, and scanned pages that
// are only a picture of text, so readers have something to OCR.
import { createCanvas } from "@napi-rs/canvas";

// A scanned page: black text drawn onto a white image, as a JPEG.
function scan(lines) {
  const canvas = createCanvas(1700, 2200);
  const context = canvas.getContext("2d");
  context.fillStyle = "white";
  context.fillRect(0, 0, 1700, 2200);
  context.fillStyle = "black";
  context.font = "56px serif";
  lines.forEach((line, i) => context.fillText(line, 140, 260 + i * 110));
  return { width: 1700, height: 2200, jpeg: canvas.toBuffer("image/jpeg", 92) };
}

const escapeText = (text) => text.replace(/[\\()]/g, (c) => `\\${c}`);

/**
 * Each page is {text: [lines]} for a page with a text layer, or {scan: [lines]} for
 * a page that is only an image.
 * @param {({text: string[]} | {scan: string[]})[]} pages
 */
export function fictionalPdf(pages) {
  const objects = [];
  const add = (body) => objects.push(body) && objects.length;
  const catalog = add(null);
  const tree = add(null);
  const font = add(Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"));
  const kids = [];
  for (const page of pages) {
    let content;
    let resources;
    if ("text" in page) {
      const commands = page.text.map((line, i) => `BT /F1 12 Tf 72 ${720 - i * 18} Td (${escapeText(line)}) Tj ET`).join("\n");
      content = Buffer.from(commands);
      resources = `<< /Font << /F1 ${font} 0 R >> >>`;
    } else {
      const image = scan(page.scan);
      const picture = add(Buffer.concat([
        Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.jpeg.length} >>\nstream\n`),
        image.jpeg,
        Buffer.from("\nendstream"),
      ]));
      content = Buffer.from("q 612 0 0 792 0 0 cm /Im1 Do Q");
      resources = `<< /XObject << /Im1 ${picture} 0 R >> >>`;
    }
    const stream = add(Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`), content, Buffer.from("\nendstream")]));
    kids.push(add(Buffer.from(`<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 612 792] /Resources ${resources} /Contents ${stream} 0 R >>`)));
  }
  objects[catalog - 1] = Buffer.from(`<< /Type /Catalog /Pages ${tree} 0 R >>`);
  objects[tree - 1] = Buffer.from(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`);
  const parts = [Buffer.from("%PDF-1.4\n")];
  let offset = parts[0].length;
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(offset);
    const object = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), body, Buffer.from("\nendobj\n")]);
    parts.push(object);
    offset += object.length;
  });
  const table = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  parts.push(Buffer.from(`${table}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${offset}\n%%EOF\n`));
  return Buffer.concat(parts);
}
