// What a reader is sent and what comes back. A reader is one prompt and one answer
// from a cheap model with no tools: it sees only the text passed to it. A batch of
// labelled passages is packed whole into as few prompts as hold them, and each
// reader answers passage by passage.

// About how many characters of passages one reader is given.
export const READER_INPUT = 100_000;
const MAX_QUESTION = 10_000;
const MAX_LABEL = 200;

// What every reader is told about its job, as its CLI's instructions.
export const READER_INSTRUCTIONS = `You are a reader for a research team: you are sent one message, and your reply to it is your whole job.
Work from the text in the message alone, and reply at once.
Copy quotations exactly as they are written, including their spelling and punctuation.
Say plainly when the text does not answer what is asked.`;

export interface Passage {
  label: string;
  // The passage as a reader sees it: its pages under "[Page n]" lines, or its text as given.
  text: string;
  // What the caller sent with the passage besides its text, returned with its answer.
  carried: Record<string, unknown>;
}
export interface ReaderQuote {
  page: number | null;
  quote: string;
  // Whether the words are in the passage, spacing aside. Where the passage has pages,
  // the page is the one the words are on, whatever the reader cited.
  found: boolean;
}
export interface ReaderAnswer {
  relevant: boolean;
  answer: string;
  quotes: ReaderQuote[];
}

function fail(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
const flat = (value: string) => value.replace(/\s+/g, " ").trim();
const count = (n: number) => n.toLocaleString("en-US");

export function readerQuestion(question: unknown): string {
  fail(typeof question === "string" && question.trim(), "Give the reader a question, as text.");
  fail(question.length <= MAX_QUESTION, `The question is ${count(question.length)} characters; ask it in up to ${count(MAX_QUESTION)}, and put the material in passages.`);
  return question.trim();
}

// One prompt sent as it stands.
export function readerPrompt(prompt: unknown, limit = READER_INPUT): string {
  fail(typeof prompt === "string" && prompt.trim(), "Give the reader a prompt, as text.");
  fail(prompt.length <= limit, `The prompt is ${count(prompt.length)} characters; a reader takes up to ${count(limit)}. Send a question with the material as passages, each up to that size.`);
  return prompt;
}

// The passages a caller sent, checked: each {label, text} or {label, pages: [{page, text}]},
// with a label of its own. Anything else in a passage is carried to its answer.
export function readerPassages(given: unknown, limit = READER_INPUT): Passage[] {
  fail(Array.isArray(given) && given.length, "Give the reader a list of passages, each with a label and its text or pages.");
  const seen = new Set<string>();
  return given.map((raw, n) => {
    const where = `Passage ${n + 1}`;
    fail(raw && typeof raw === "object" && !Array.isArray(raw), `${where} must be an object with a label and its text or pages.`);
    const { text, pages, ...carried } = raw as Record<string, unknown>;
    const label = typeof carried.label === "number" ? String(carried.label) : carried.label;
    fail(typeof label === "string" && label.trim() && label.length <= MAX_LABEL && !label.includes("\n"), `${where} needs a label: one line of up to ${MAX_LABEL} characters.`);
    fail(!seen.has(label), `Two passages are labelled ${JSON.stringify(label)}; give each passage a label of its own.`);
    seen.add(label);
    let body: string;
    if (pages !== undefined) {
      fail(Array.isArray(pages) && pages.length, `Passage ${JSON.stringify(label)}: pages must be a list of {"page": n, "text": ...}.`);
      body = pages
        .map((page) => {
          const p = page as Record<string, unknown>;
          fail(p && Number.isSafeInteger(p.page) && typeof p.text === "string", `Passage ${JSON.stringify(label)}: each page needs its number as "page" and its "text".`);
          return `[Page ${p.page}]\n${p.text}`;
        })
        .join("\n\n");
    } else {
      fail(typeof text === "string", `Passage ${JSON.stringify(label)} needs its text, or its pages.`);
      body = text;
    }
    fail(body.trim(), `Passage ${JSON.stringify(label)} is empty.`);
    fail(body.length <= limit, `Passage ${JSON.stringify(label)} is ${count(body.length)} characters; a reader takes up to ${count(limit)}. Send it as smaller passages.`);
    return { label, text: body, carried: { ...carried, label } };
  });
}

// Packs passages into prompts in the order given: as many whole passages as fit the
// input size, and never part of one.
export function packPassages<P extends { text: string }>(passages: P[], limit = READER_INPUT): P[][] {
  const prompts: P[][] = [];
  let size = 0;
  for (const passage of passages) {
    const current = prompts[prompts.length - 1];
    if (current && size + passage.text.length <= limit) {
      current.push(passage);
      size += passage.text.length;
    } else {
      prompts.push([passage]);
      size = passage.text.length;
    }
  }
  return prompts;
}

// The prompt for one reader: the question, how to answer, and its passages as
// numbered, labelled sections.
export function batchPrompt(question: string, passages: Pick<Passage, "label" | "text">[]): string {
  const many = passages.length > 1;
  return `Question:
${question}

Below ${many ? `are ${passages.length} passages, each` : "is one passage,"} under a line "=== Passage <number>: <label> ===". Answer the question for ${many ? "each passage separately, from that passage's text alone" : "it, from its text alone"}.

Reply with a JSON array and nothing else, holding one object for ${many ? "each passage, in order" : "the passage"}:
{"passage": <its number>, "relevant": true or false, "answer": "<a short answer: a few sentences at most>", "quotes": [{"page": <page number, or null>, "quote": "<words copied from the passage>"}]}

- "relevant" is false when the passage does not answer the question; "answer" then says so in a few words, and "quotes" is empty.
- Each quote is copied exactly from one page of the passage, and is the shortest stretch that carries the point. Give a quote for every point of the answer.
- "page" is the number in the "[Page n]" line above the quoted words, or null where the passage has no such lines.

${passages.map((p, n) => `=== Passage ${n + 1}: ${p.label} ===\n${p.text}`).join("\n\n")}`;
}

const PAGE = /^\[Page (\d+)\]\n/gm;
function pagesIn(text: string): Map<number, string> | null {
  const marks = [...text.matchAll(PAGE)];
  if (!marks.length) return null;
  return new Map(marks.map((mark, n) => [Number(mark[1]), flat(text.slice(mark.index! + mark[0].length, n + 1 < marks.length ? marks[n + 1]!.index : text.length))]));
}

// The JSON in a reply, with or without a code fence or a sentence around it.
function jsonIn(reply: string): unknown {
  const text = reply.trim().replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/, "");
  try {
    return JSON.parse(text);
  } catch {
    const from = text.search(/[[{]/);
    const to = Math.max(text.lastIndexOf("]"), text.lastIndexOf("}"));
    if (from < 0 || to <= from) throw new Error("no JSON in it");
    return JSON.parse(text.slice(from, to + 1));
  }
}

// One reader's reply as an answer for each of its passages, in their order, or the
// problem with that passage's answer.
export function readAnswers(reply: string, passages: Pick<Passage, "text">[]): (ReaderAnswer | { problem: string })[] {
  let parsed: unknown;
  try {
    parsed = jsonIn(reply);
  } catch {
    return passages.map(() => ({ problem: "The reader's reply was not the JSON it was asked for." }));
  }
  const list = (Array.isArray(parsed) ? parsed : [parsed]).filter((item) => item && typeof item === "object") as Record<string, unknown>[];
  const numbered = new Map(list.filter((item) => Number.isSafeInteger(Number(item.passage))).map((item) => [Number(item.passage), item]));
  // A reply that numbers none of its answers, with one for each passage, answers them in order.
  const inOrder = !numbered.size && list.length === passages.length;
  return passages.map((passage, n) => {
    const item = inOrder ? list[n] : numbered.get(n + 1);
    if (!item) return { problem: "The reader gave no answer for this passage." };
    if (typeof item.relevant !== "boolean" || typeof item.answer !== "string") return { problem: "The reader's answer for this passage was not in the form it was asked for." };
    const pages = pagesIn(passage.text);
    const whole = flat(passage.text);
    const quotes = (Array.isArray(item.quotes) ? item.quotes : [])
      .filter((q): q is Record<string, unknown> => q && typeof q === "object" && typeof q.quote === "string" && Boolean(q.quote.trim()))
      .map((q) => {
        const cited = Number.isSafeInteger(q.page) ? (q.page as number) : null;
        const quote = q.quote as string;
        const words = flat(quote);
        if (!pages) return { page: cited, quote, found: whole.includes(words) };
        // The page is where the words are: the one the reader cited when they are there,
        // else the page they are found on.
        const on = cited !== null && pages.get(cited)?.includes(words) ? cited : [...pages].find(([, text]) => text.includes(words))?.[0];
        return { page: on ?? cited, quote, found: on !== undefined };
      });
    return { relevant: item.relevant, answer: item.answer, quotes };
  });
}
