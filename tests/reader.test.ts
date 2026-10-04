import { describe, expect, it } from "vitest";
import { batchPrompt, packPassages, readAnswers, readerPassages, readerPrompt, readerQuestion } from "../src/domain/reader";

const text = (n: number, letter = "x") => letter.repeat(n);

describe("the passages a reader is sent", () => {
  it("are checked, with pages shown under their page lines and anything else carried along", () => {
    const [ledger, gazette] = readerPassages([
      { label: "ledger", document: "doc-1", pages: [{ page: 1, text: "Example Mill opened in 1882." }, { page: 2, text: "Ada Example sold it." }] },
      { label: 7, text: "Fine weather for the fictional regatta." },
    ]);
    expect(ledger).toEqual({ label: "ledger", text: "[Page 1]\nExample Mill opened in 1882.\n\n[Page 2]\nAda Example sold it.", carried: { label: "ledger", document: "doc-1" } });
    expect(gazette).toEqual({ label: "7", text: "Fine weather for the fictional regatta.", carried: { label: "7" } });
  });
  it("are refused with the reason: no label, a repeated label, no text, or more than a reader takes", () => {
    expect(() => readerPassages([])).toThrow("Give the reader a list of passages");
    expect(() => readerPassages([{ text: "words" }])).toThrow("Passage 1 needs a label");
    expect(() => readerPassages([{ label: "a", text: "one" }, { label: "a", text: "two" }])).toThrow('Two passages are labelled "a"');
    expect(() => readerPassages([{ label: "a" }])).toThrow('Passage "a" needs its text, or its pages.');
    expect(() => readerPassages([{ label: "a", text: "  " }])).toThrow('Passage "a" is empty.');
    expect(() => readerPassages([{ label: "long", text: text(101) }], 100)).toThrow('Passage "long" is 101 characters; a reader takes up to 100. Send it as smaller passages.');
    expect(() => readerPrompt(text(101), 100)).toThrow("The prompt is 101 characters; a reader takes up to 100.");
    expect(() => readerQuestion("")).toThrow("Give the reader a question");
    expect(readerPassages([{ label: "fits", text: text(100) }], 100)).toHaveLength(1);
  });
});

describe("packing passages into prompts", () => {
  const sizes = (prompts: { text: string }[][]) => prompts.map((p) => p.map((q) => q.text.length));
  const frame = batchPrompt("Q", [{ label: "", text: "" }, { label: "", text: "" }]).length;
  const labelled = (lengths: number[]) => lengths.map((n, i) => ({ label: `p${i}`, text: text(n, String.fromCharCode(97 + (i % 26))) }));
  it("puts as many whole passages in each prompt as fit, in order", () => {
    expect(sizes(packPassages(labelled([400, 400, 300, 1000, 100, 800, 100]), frame + 1000, "Q"))).toEqual([[400, 400], [300], [1000], [100, 800], [100]]);
  });
  it("never splits a passage between prompts, and counts the whole prompt against the input size", () => {
    const passages = labelled(Array.from({ length: 40 }, (_, n) => 1 + ((n * 37) % 600)));
    const limit = frame + 700;
    const prompts = packPassages(passages, limit, "Q");
    expect(prompts.flat()).toEqual(passages);
    for (const prompt of prompts) expect(batchPrompt("Q", prompt).length).toBeLessThanOrEqual(limit);
    for (const passage of passages) expect(prompts.filter((prompt) => `${batchPrompt("Q", prompt)}\n\n`.includes(`: ${passage.label} ===\n${passage.text}\n\n`))).toHaveLength(1);
  });
  it("counts headings and labels too, so many small passages with long labels do not make one vast prompt", () => {
    const passages = Array.from({ length: 500 }, (_, n) => ({ label: `${n}-${text(190, "l")}`, text: "x" }));
    const prompts = packPassages(passages, frame + 5000, "Q");
    expect(prompts.length).toBeGreaterThan(20);
    for (const prompt of prompts) expect(batchPrompt("Q", prompt).length).toBeLessThanOrEqual(frame + 5000);
  });
});

describe("a reader's prompt and its reply", () => {
  const passages = readerPassages([
    { label: "ledger", pages: [{ page: 1, text: "Example Mill opened in 1882." }, { page: 2, text: "Ada Example sold the mill\nto Ben Example in 1901." }] },
    { label: "gazette", text: "Fine weather for the fictional regatta." },
  ]);
  it("gives each passage a numbered, labelled section and asks for an answer for each", () => {
    const prompt = batchPrompt("Who sold the mill?", passages);
    expect(prompt).toContain("Question:\nWho sold the mill?");
    expect(prompt).toContain("=== Passage 1: ledger ===\n[Page 1]\nExample Mill opened in 1882.");
    expect(prompt).toContain("=== Passage 2: gazette ===\nFine weather");
    expect(prompt).toContain("one object for each passage, in order");
    expect(prompt).toContain('"relevant" is false when the passage does not answer the question');
  });
  it("is read as one answer for each passage, each quote with its page and whether it is there", () => {
    const reply = `\`\`\`json
[{"passage": 2, "relevant": false, "answer": "It does not say.", "quotes": []},
 {"passage": 1, "relevant": true, "answer": "Ada Example, in 1901.", "quotes": [
   {"page": 2, "quote": "Ada Example sold the mill to Ben Example in 1901."},
   {"page": 1, "quote": "Ada Example sold the mill"},
   {"page": null, "quote": "Example Mill opened"},
   {"page": 2, "quote": "Ada Example gave the mill"}]}]
\`\`\``;
    expect(readAnswers(reply, passages)).toEqual([
      {
        relevant: true,
        answer: "Ada Example, in 1901.",
        quotes: [
          // Spacing and line breaks aside, the words are on page 2.
          { page: 2, quote: "Ada Example sold the mill to Ben Example in 1901.", found: true },
          // The right words cited at the wrong page, or at none, come back with the page they are on.
          { page: 2, quote: "Ada Example sold the mill", found: true },
          { page: 1, quote: "Example Mill opened", found: true },
          // Words that are not in the passage keep the page the reader gave.
          { page: 2, quote: "Ada Example gave the mill", found: false },
        ],
      },
      { relevant: false, answer: "It does not say.", quotes: [] },
    ]);
  });
  it("finds a quote anywhere in a passage that has no pages", () => {
    const [answer] = readAnswers('Here it is: [{"passage": 1, "relevant": true, "answer": "Fine.", "quotes": [{"page": null, "quote": "fictional regatta"}]}] as asked.', [passages[1]!]);
    expect(answer).toEqual({ relevant: true, answer: "Fine.", quotes: [{ page: null, quote: "fictional regatta", found: true }] });
  });
  it("takes unnumbered answers in order when there is one for each passage", () => {
    const answers = readAnswers('[{"relevant": true, "answer": "A", "quotes": []}, {"relevant": false, "answer": "B", "quotes": []}]', passages);
    expect(answers.map((a) => "answer" in a && a.answer)).toEqual(["A", "B"]);
  });
  it("takes quotes in any other form as a problem, not as an answer without quotes", () => {
    const problem = { problem: "The reader's quotes for this passage were not in the form it was asked for." };
    for (const quotes of ['"Ada sold it."', '[{"page": 2}]', '[{"page": "two", "quote": "Ada Example"}]', '["Ada Example"]'])
      expect(readAnswers(`[{"passage": 1, "relevant": true, "answer": "A", "quotes": ${quotes}}]`, [passages[0]!])).toEqual([problem]);
    expect(readAnswers('[{"passage": 1, "relevant": true, "answer": "A"}]', [passages[0]!])).toEqual([problem]);
  });
  it("names the problem for a passage left out, an answer in the wrong form, and a reply that is not JSON", () => {
    expect(readAnswers('[{"passage": 2, "relevant": "yes", "answer": "B"}]', passages)).toEqual([
      { problem: "The reader gave no answer for this passage." },
      { problem: "The reader's answer for this passage was not in the form it was asked for." },
    ]);
    expect(readAnswers("I could not decide.", passages)).toEqual([
      { problem: "The reader's reply was not the JSON it was asked for." },
      { problem: "The reader's reply was not the JSON it was asked for." },
    ]);
  });
});
