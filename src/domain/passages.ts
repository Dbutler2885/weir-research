// The passage builder: a document's chunks and which of them are flagged in; passages
// out, each small enough for one reader. It knows nothing of what flagged them.
import { READER_INPUT } from "./reader.ts";

// About a page or two of text.
export const CHUNK_SIZE = 4_000;

// A stretch of one page: its lines from..to, counted from 1 within the page. open is
// true when it stops part-way through a line too long for one chunk.
export interface Segment {
  page: number;
  from: number;
  to: number;
  text: string;
  open?: boolean;
}
export interface Chunk {
  segments: Segment[];
}
export interface BuiltPassage {
  label: string;
  // The passage's text page by page, as a reader is sent it.
  pages: { page: number; text: string }[];
  // Where it starts and ends in the document.
  from: { page: number; line: number };
  to: { page: number; line: number };
  // Its first and last chunk, counted from 0.
  chunks: [number, number];
  characters: number;
}

// A chunk as text: each page's part under its "[Page n]" line.
export const chunkText = (chunk: Chunk) => pagesOf([chunk]).map((p) => `[Page ${p.page}]\n${p.text}`).join("\n\n");
// What a chunk adds to a passage's size: its text, and room for a page line and a break.
const sizeOf = (chunk: Chunk) => chunk.segments.reduce((sum, s) => sum + s.text.length + 20, 0);

// Consecutive chunks as pages, joining the parts of a page that chunks divided.
function pagesOf(chunks: Chunk[]): { page: number; text: string }[] {
  const pages: { page: number; text: string }[] = [];
  let open = false;
  for (const segment of chunks.flatMap((c) => c.segments)) {
    const last = pages[pages.length - 1];
    if (last && last.page === segment.page) last.text += `${open ? "" : "\n"}${segment.text}`;
    else pages.push({ page: segment.page, text: segment.text });
    open = Boolean(segment.open);
  }
  return pages;
}

// Cuts a document's pages into chunks of about a page or two, at line ends: small
// pages share a chunk, a long page is several, and only a line longer than a chunk
// is itself cut, at a space where it has one.
export function chunkPages(pages: { page: number; text: string }[], size = CHUNK_SIZE): Chunk[] {
  const chunks: Chunk[] = [];
  let current: Segment[] = [];
  let length = 0;
  const close = () => {
    if (current.length) chunks.push({ segments: current });
    current = [];
    length = 0;
  };
  const add = (page: number, line: number, text: string, open: boolean) => {
    if (length && length + text.length + 1 > size) close();
    const last = current[current.length - 1];
    if (last && last.page === page && !last.open) {
      last.text += `\n${text}`;
      last.to = line;
      last.open = open || undefined;
    } else current.push({ page, from: line, to: line, text, ...(open ? { open } : {}) });
    length += text.length + 1;
    if (open) close();
  };
  for (const { page, text } of pages) {
    text.split("\n").forEach((line, n) => {
      let rest = line;
      while (rest.length > size) {
        const space = rest.lastIndexOf(" ", size);
        const cut = space > size / 2 ? space + 1 : size;
        add(page, n + 1, rest.slice(0, cut), true);
        rest = rest.slice(cut);
      }
      add(page, n + 1, rest, false);
    });
  }
  close();
  // A document of blank lines alone has nothing to read. Blank stretches within one
  // stay, so that a passage is the document's own text, with nothing dropped.
  return chunks.some((c) => !blank(c)) ? chunks : [];
}

// A chunk with nothing but spacing in it.
export const blank = (chunk: Chunk) => chunk.segments.every((s) => !s.text.trim());

// How many characters of the document's text the chunks numbered here hold, counting
// the line ends between chunks that follow one another.
export function charactersIn(chunks: Chunk[], numbers: number[]): number {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  let total = 0;
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    total += pagesOf(chunks.slice(sorted[i]!, sorted[j]! + 1)).reduce((sum, p) => sum + p.text.length, 0);
    i = j + 1;
  }
  return total;
}

// Runs of chunks, each [first, last], cut so that none is larger than the cap. Cuts
// fall between chunks, and a run cut in two shares `overlap` chunks across the cut.
function capped(chunks: Chunk[], [first, last]: [number, number], cap: number, overlap: number): [number, number][] {
  const pieces: [number, number][] = [];
  let start = first;
  while (start <= last) {
    let end = start;
    let size = sizeOf(chunks[start]!);
    while (end < last && size + sizeOf(chunks[end + 1]!) <= cap) size += sizeOf(chunks[++end]!);
    pieces.push([start, end]);
    if (end === last) break;
    // The next piece begins with this one's last chunks, unless that would make no headway.
    start = Math.max(start + 1, end + 1 - overlap);
  }
  return pieces;
}

// Passages from a document's chunks and their flags.
// Each flagged chunk is widened by one chunk on each side; widened chunks that overlap
// or touch become one passage; a passage longer than the cap is cut between chunks,
// with one chunk shared across each cut. When most of the document is flagged, the
// whole of it is returned as consecutive passages at the cap.
export function buildPassages(chunks: Chunk[], flags: boolean[], { cap = READER_INPUT, name = "" }: { cap?: number; name?: string } = {}): BuiltPassage[] {
  const flagged = chunks.map((_, n) => n).filter((n) => flags[n]);
  if (!flagged.length) return [];
  const whole = flagged.length * 2 > chunks.length;
  const runs: [number, number][] = [];
  if (whole) runs.push([0, chunks.length - 1]);
  else
    for (const n of flagged) {
      const run: [number, number] = [Math.max(0, n - 1), Math.min(chunks.length - 1, n + 1)];
      const last = runs[runs.length - 1];
      if (last && run[0] <= last[1] + 1) last[1] = run[1];
      else runs.push(run);
    }
  const built = runs
    .flatMap((run) => capped(chunks, run, cap, whole ? 0 : 1))
    .map(([first, last]) => {
      const pages = pagesOf(chunks.slice(first, last + 1));
      const start = chunks[first]!.segments[0]!;
      const end = chunks[last]!.segments[chunks[last]!.segments.length - 1]!;
      const from = { page: start.page, line: start.from };
      const to = { page: end.page, line: end.to };
      return {
        label: `${name ? `${name}, ` : ""}page ${from.page} line ${from.line} to page ${to.page} line ${to.line}`,
        pages,
        from,
        to,
        chunks: [first, last] as [number, number],
        characters: pages.reduce((sum, p) => sum + p.text.length, 0),
      };
    });
  // Passages cut from one long line have the same line range; each still needs a label of its own.
  const times = new Map<string, number>();
  for (const passage of built) times.set(passage.label, (times.get(passage.label) ?? 0) + 1);
  const part = new Map<string, number>();
  for (const passage of built)
    if (times.get(passage.label)! > 1) {
      const n = (part.get(passage.label) ?? 0) + 1;
      part.set(passage.label, n);
      passage.label = `${passage.label}, part ${n}`;
    }
  return built;
}
