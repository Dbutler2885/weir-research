import { describe, expect, it } from "vitest";
import { buildPassages, charactersIn, chunkPages, chunkText, type Chunk } from "../src/domain/passages";
import { readerPassages } from "../src/domain/reader";

// A fictional document of one-line pages, each its own chunk, so chunks are easy to name.
const pages = (n: number, length = 80) => Array.from({ length: n }, (_, i) => ({ page: i + 1, text: `Page ${i + 1} of the fictional ledger. `.padEnd(length, "x") }));
const chunksOf = (n: number, length = 80) => chunkPages(pages(n, length), length);
const flagsFor = (n: number, flagged: number[]) => Array.from({ length: n }, (_, i) => flagged.includes(i));
const ranges = (chunks: Chunk[], flagged: number[], cap?: number) => buildPassages(chunks, flagsFor(chunks.length, flagged), { cap, name: "doc-1" }).map((p) => p.chunks);

describe("cutting a document into chunks", () => {
  it("keeps lines whole, lets small pages share a chunk and gives a long page several", () => {
    const chunks = chunkPages(
      [
        { page: 1, text: "First line.\nSecond line." },
        { page: 2, text: "Third line." },
        { page: 3, text: ["a".repeat(30), "b".repeat(30), "c".repeat(30)].join("\n") },
      ],
      70,
    );
    expect(chunks.map((c) => c.segments.map((s) => [s.page, s.from, s.to]))).toEqual([
      [[1, 1, 2], [2, 1, 1], [3, 1, 1]],
      [[3, 2, 3]],
    ]);
    expect(chunkText(chunks[0]!)).toBe(`[Page 1]\nFirst line.\nSecond line.\n\n[Page 2]\nThird line.\n\n[Page 3]\n${"a".repeat(30)}`);
  });
  it("cuts a line longer than a chunk at a space, and puts it back together exactly", () => {
    const line = Array.from({ length: 40 }, (_, n) => `word${n}`).join(" ");
    const chunks = chunkPages([{ page: 1, text: `Before.\n${line}\nAfter.` }], 60);
    expect(chunks.length).toBeGreaterThan(4);
    for (const chunk of chunks) expect(chunk.segments.reduce((sum, s) => sum + s.text.length, 0)).toBeLessThanOrEqual(60);
    const [whole] = buildPassages(chunks, chunks.map(() => true), { cap: 10_000 });
    expect(whole!.pages).toEqual([{ page: 1, text: `Before.\n${line}\nAfter.` }]);
    expect([whole!.from, whole!.to]).toEqual([{ page: 1, line: 1 }, { page: 1, line: 3 }]);
  });
  it("gives passages cut from one very long line labels of their own", () => {
    const chunks = chunkPages([{ page: 1, text: "word ".repeat(400) }], 100);
    const passages = buildPassages(chunks, chunks.map(() => true), { cap: 600, name: "doc-1" });
    expect(passages.length).toBeGreaterThan(3);
    expect(passages.slice(0, 2).map((p) => p.label)).toEqual(["doc-1, page 1 line 1 to page 1 line 1, part 1", "doc-1, page 1 line 1 to page 1 line 1, part 2"]);
    expect(readerPassages(passages)).toHaveLength(passages.length);
    expect(passages.map((p) => p.pages[0]!.text).join("")).toBe("word ".repeat(400));
  });
  it("keeps the blank stretches inside a document, so a passage is its own text with nothing dropped", () => {
    const text = `${"A".repeat(90)}\n${" ".repeat(300)}\n\n\n\nB`;
    const chunks = chunkPages([{ page: 1, text }], 100);
    const [whole] = buildPassages(chunks, chunks.map(() => true), { cap: 10_000 });
    expect(whole!.pages).toEqual([{ page: 1, text }]);
    expect(charactersIn(chunks, chunks.map((_, n) => n))).toBe(text.length);
    // Chunks that do not follow one another are counted apart.
    expect(charactersIn(chunks, [0, chunks.length - 1])).toBeLessThan(text.length);
  });
  it("has no chunks for a document with nothing in it", () => {
    expect(chunkPages([{ page: 1, text: "\n\n  \n" }])).toEqual([]);
  });
});

describe("the passage builder", () => {
  it("returns nothing when nothing is flagged", () => {
    expect(ranges(chunksOf(10), [])).toEqual([]);
  });
  it("widens each flagged chunk by one chunk on each side, within the document", () => {
    const chunks = chunksOf(20);
    expect(ranges(chunks, [5])).toEqual([[4, 6]]);
    expect(ranges(chunks, [0])).toEqual([[0, 1]]);
    expect(ranges(chunks, [19])).toEqual([[18, 19]]);
  });
  it("merges widened chunks that overlap or touch, and keeps apart those that do not", () => {
    const chunks = chunksOf(30);
    // 5 and 7 overlap once widened; 10 widens to 9, which touches 8.
    expect(ranges(chunks, [5, 7, 10])).toEqual([[4, 11]]);
    // 5 widens to 6 and 9 to 8, with 7 between them.
    expect(ranges(chunks, [5, 9])).toEqual([[4, 6], [8, 10]]);
    expect(ranges(chunks, [2, 3, 20])).toEqual([[1, 4], [19, 21]]);
  });
  it("cuts a run longer than the cap between chunks, with one chunk shared across each cut", () => {
    const chunks = chunksOf(40);
    // Each chunk counts 100 against the cap: three to a passage.
    const cut = ranges(chunks, [10, 11, 12, 13, 14, 15, 16], 300);
    expect(cut).toEqual([[9, 11], [11, 13], [13, 15], [15, 17]]);
    const passages = buildPassages(chunks, flagsFor(40, [10, 11, 12, 13, 14, 15, 16]), { cap: 300 });
    expect(passages[0]!.pages.map((p) => p.page)).toEqual([10, 11, 12]);
    expect(passages[1]!.pages.map((p) => p.page)).toEqual([12, 13, 14]);
    for (const passage of passages) expect(passage.characters).toBeLessThanOrEqual(300);
    // A cap that holds one chunk still gets through the run.
    expect(ranges(chunks, [10, 11], 100)).toEqual([[9, 9], [10, 10], [11, 11], [12, 12]]);
  });
  it("returns the whole document as consecutive passages at the cap when most of it is flagged", () => {
    const chunks = chunksOf(10);
    expect(ranges(chunks, [0, 2, 4, 6, 8, 9], 400)).toEqual([[0, 3], [4, 7], [8, 9]]);
    // Half is not most.
    expect(ranges(chunks, [0, 2, 4, 6, 8], 400)).toEqual([[0, 3], [3, 6], [6, 9]]);
    expect(ranges(chunksOf(1), [0])).toEqual([[0, 0]]);
  });
  it("gives each passage its pages, its line range and a label of its own, in the form a reader takes", () => {
    const document = [
      { page: 1, text: Array.from({ length: 6 }, (_, n) => `Page one, line ${n + 1}.`).join("\n") },
      { page: 2, text: Array.from({ length: 6 }, (_, n) => `Page two, line ${n + 1}.`).join("\n") },
    ];
    const chunks = chunkPages(document, 40);
    expect(chunks.map((c) => c.segments.map((s) => [s.page, s.from, s.to]))).toEqual([[[1, 1, 2]], [[1, 3, 4]], [[1, 5, 6]], [[2, 1, 2]], [[2, 3, 4]], [[2, 5, 6]]]);
    const passages = buildPassages(chunks, flagsFor(6, [2]), { name: "doc-7" });
    expect(passages).toEqual([
      {
        label: "doc-7, page 1 line 3 to page 2 line 2",
        pages: [
          { page: 1, text: "Page one, line 3.\nPage one, line 4.\nPage one, line 5.\nPage one, line 6." },
          { page: 2, text: "Page two, line 1.\nPage two, line 2." },
        ],
        from: { page: 1, line: 3 },
        to: { page: 2, line: 2 },
        chunks: [1, 3],
        characters: 106,
      },
    ]);
    const apart = buildPassages(chunks, flagsFor(6, [0, 5]), { name: "doc-7" });
    expect(apart.map((p) => p.label)).toEqual(["doc-7, page 1 line 1 to page 1 line 4", "doc-7, page 2 line 3 to page 2 line 6"]);
    expect(readerPassages(apart)[0]!.text).toBe("[Page 1]\nPage one, line 1.\nPage one, line 2.\nPage one, line 3.\nPage one, line 4.");
  });
  it("keeps every passage within what a reader takes, for a long document flagged throughout", () => {
    const chunks = chunkPages(Array.from({ length: 120 }, (_, n) => ({ page: n + 1, text: `Fictional entry ${n}. `.repeat(180) })));
    const passages = buildPassages(chunks, chunks.map(() => true), { name: "doc-1" });
    expect(passages.length).toBeGreaterThan(4);
    expect(readerPassages(passages)).toHaveLength(passages.length);
    expect(passages.map((p) => p.chunks[0]).slice(1)).toEqual(passages.map((p) => p.chunks[1] + 1).slice(0, -1));
  });
});
