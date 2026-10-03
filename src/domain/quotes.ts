// Checking a quote against a document's saved text, at the pages it cites.

const PAGE = /^\[Page (\d+)\]\n/gm;
const flat = (value: string) => value.replace(/\s+/g, " ").trim();

// A document's text as pages: a PDF's text has "[Page n]" before each page, and any
// other document is one page.
export function pagesOf(text: string): { page: number; text: string }[] {
  const marks = [...text.matchAll(PAGE)];
  if (!marks.length) return [{ page: 1, text }];
  return marks.map((mark, n) => ({
    page: Number(mark[1]),
    text: text.slice(mark.index! + mark[0].length, n + 1 < marks.length ? marks[n + 1]!.index : text.length).replace(/\n+$/, ""),
  }));
}

// The passage in a text nearest to a quote: the stretch around their longest run of
// shared words, as long as the quote.
export function closestPassage(text: string, quote: string): string {
  const words = flat(text).split(" ").filter(Boolean);
  const wanted = flat(quote).split(" ").filter(Boolean);
  if (!words.length || !wanted.length) return "";
  let best = 0;
  let at = 0;
  let from = 0;
  let previous = new Array<number>(wanted.length + 1).fill(0);
  for (let i = 1; i <= words.length; i++) {
    const row = new Array<number>(wanted.length + 1).fill(0);
    for (let j = 1; j <= wanted.length; j++) {
      if (words[i - 1]!.toLowerCase() !== wanted[j - 1]!.toLowerCase()) continue;
      row[j] = previous[j - 1]! + 1;
      if (row[j]! > best) {
        best = row[j]!;
        at = i - best;
        from = j - best;
      }
    }
    previous = row;
  }
  if (!best) return "";
  const start = Math.max(0, at - from);
  return words.slice(start, start + wanted.length).join(" ");
}

export type QuoteCheck = { found: true } | { found: false; reason: string };

/**
 * Whether a quote appears within the cited pages of a document's text, after
 * whitespace is normalized. A quote that runs over the end of the last cited page
 * onto the next is found too. Otherwise the reason says where the quote is, if it is
 * on another page, or gives the nearest passage on the cited pages.
 */
export function checkQuote(text: string, from: number, to: number, quote: string): QuoteCheck {
  const pages = pagesOf(text);
  const wanted = flat(quote);
  const joined = (first: number, last: number) => flat(pages.filter((p) => p.page >= first && p.page <= last).map((p) => p.text).join("\n"));
  const cited = from === to ? `page ${from}` : `pages ${from} to ${to}`;
  if (!pages.some((p) => p.page >= from && p.page <= to)) {
    const last = Math.max(...pages.map((p) => p.page));
    return { found: false, reason: `The document has no ${cited}; its pages run from ${Math.min(...pages.map((p) => p.page))} to ${last}.` };
  }
  if (joined(from, to).includes(wanted)) return { found: true };
  // Across the break after the last cited page, but not wholly on the page after it.
  if (joined(from, to + 1).includes(wanted) && !joined(to + 1, to + 1).includes(wanted)) return { found: true };
  const elsewhere = pages.filter((p) => flat(p.text).includes(wanted)).map((p) => p.page);
  if (elsewhere.length) return { found: false, reason: `The quote is not on ${cited}; it is on page ${elsewhere.join(" and page ")}. Cite the page it is on.` };
  const nearest = closestPassage(joined(from, to), quote);
  return {
    found: false,
    reason: `The quote does not appear on ${cited} of the saved text. ${nearest ? `The nearest passage there is: "${nearest}". Quote the saved text exactly.` : "Nothing like it is there. Quote the saved text exactly, and cite the page it is on."}`,
  };
}
