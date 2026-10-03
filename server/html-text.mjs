// Takes the text out of a web page as it was downloaded, for saving as a source. All of
// the text in the page's HTML is kept, in order, rather than a guess at its main
// article, so a quote from any part of the page can be found in the saved text. This
// is the page's static text: what its scripts would draw, or a browser would hide or
// show by its styles, is for a capture from the research browser.
import { parse } from "parse5";

// Elements whose content is not the page's text: code, styles, and what stands in
// for media or frames that could not be shown.
const UNSEEN = new Set(["script", "style", "noscript", "template", "head", "iframe", "object", "canvas", "audio", "video"]);
// Elements that begin and end a line, so the words of one never run into the next.
const BLOCKS = new Set(
  "address article aside blockquote body caption dd details dialog div dl dt fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hgroup hr html li main menu nav ol p section summary table tbody tfoot thead tr ul button textarea select option svg text".split(" "),
);
const SPACED = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p", "blockquote", "table", "ul", "ol", "dl", "pre", "section", "article"]);

const attribute = (node, name) => node.attrs?.find((a) => a.name === name)?.value;
const hidden = (node) => attribute(node, "hidden") !== undefined || attribute(node, "aria-hidden") === "true" || /display\s*:\s*none|visibility\s*:\s*hidden/i.test(attribute(node, "style") || "");

function find(node, tag) {
  if (node.tagName === tag) return node;
  for (const child of node.childNodes || []) {
    const found = find(child, tag);
    if (found) return found;
  }
  return null;
}
const plain = (node) => (node.nodeName === "#text" ? node.value : (node.childNodes || []).map(plain).join(""));
const tidy = (text) => text.replace(/\s+/g, " ").trim();

/**
 * A page's title and its text: one line per block, a blank line around
 * headings, paragraphs, lists and tables, and a tab between a table row's cells.
 * @param {string} html
 * @returns {{title: string, text: string}}
 */
export function readableText(html) {
  const document = parse(html);
  let out = "";
  const line = () => {
    if (out && !out.endsWith("\n")) out += "\n";
  };
  const gap = () => {
    line();
    if (out && !out.endsWith("\n\n")) out += "\n";
  };
  const visit = (node, pre) => {
    if (node.nodeName === "#text") {
      if (pre) out += node.value;
      else {
        const text = node.value.replace(/\s+/g, " ");
        // A space is kept between words, never at the start of a line.
        out += out === "" || /[\n\t ]$/.test(out) ? text.trimStart() : text;
      }
      return;
    }
    const tag = node.tagName;
    if (tag && (UNSEEN.has(tag) || hidden(node))) return;
    if (tag === "br") return void (out += "\n");
    if (tag === "td" || tag === "th") {
      if (out && !out.endsWith("\n")) out = `${out.trimEnd()}\t`;
    } else if (SPACED.has(tag)) gap();
    else if (BLOCKS.has(tag)) line();
    for (const child of (tag === "template" ? [] : node.childNodes) || []) visit(child, pre || tag === "pre");
    if (SPACED.has(tag)) gap();
    else if (BLOCKS.has(tag)) line();
  };
  visit(find(document, "body") || document, false);
  const text = out
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const title = find(document, "title");
  const heading = find(document, "h1");
  return { title: tidy(title ? plain(title) : "") || tidy(heading ? plain(heading) : ""), text };
}

// The character set a page names for itself, in its first bytes.
export function declaredCharset(bytes) {
  const start = Buffer.from(bytes.subarray(0, 4096)).toString("latin1");
  return start.match(/<meta[^>]+charset\s*=\s*["']?\s*([\w-]+)/i)?.[1] || null;
}
