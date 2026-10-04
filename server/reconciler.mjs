// Reconciles a document's text with the quotes published from it. When a document is
// read again, the app first puts back the earlier corrections whose place still
// matches. For each page that still has a quote the text no longer holds, it then
// starts a job: a model given the page's earlier and current text, the page's picture,
// the quotes and their findings, which decides for each quote whether the earlier
// wording was right, the new reading is, or neither, and it transcribes the passage.
// The app checks the decisions and applies them as one corrected revision of the text,
// and tells the researchers at work that the document's text has changed.
// A researcher who notices a problem in a document's text can ask for the same.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
export { INSTRUCTIONS as RECONCILE_INSTRUCTIONS };
import { applyReconciliation, openQuotes, pageOf, reuseCorrections } from "../src/domain/reconciliation.ts";
import { reviseText } from "../src/domain/text-revisions.ts";
import { pagesOf } from "../src/domain/quotes.ts";
import { findingsChanged } from "./review-flow.mjs";

const RENDER = join(dirname(fileURLToPath(import.meta.url)), "pdf", "page-image.mjs");
const MAX_PROBLEM = 5_000;

// A PDF's page as a picture in the folder given; an image document as it is. Returns
// the picture's name, or nothing when the document has no picture to give.
export function pagePicture(document, file, page, folder) {
  if (document.mime === "application/pdf") {
    const drawn = spawnSync(process.execPath, ["--no-warnings", RENDER, file, String(page), join(folder, "page.png")], { timeout: 120_000 });
    return drawn.status === 0 ? "page.png" : null;
  }
  if (/^image\//.test(document.mime)) {
    const name = `page${document.name.match(/\.[^.]+$/)?.[0] || ""}`;
    copyFileSync(file, join(folder, name));
    return name;
  }
  return null;
}

// The seats whose researchers are at work, or will be again: they are told when a
// document's text changes. A finished seat is not woken for it.
export function seatsAtWork(state) {
  return state.investigations.filter((batch) => !batch.closedAt).flatMap((batch) => (batch.assignments || []).filter((seat) => ["running", "paused"].includes(seat.status)).map((seat) => seat.id));
}

const INSTRUCTIONS = `You are reconciling the text of one page of a saved document against the page itself, for a research workspace. You are not a coding agent here.

The document was read into text by a program, and that text can be wrong: a scan misread, a table scrambled, a letter mistaken for a digit. Researchers have quoted this page in published findings, so its text and their quotes must agree with what the page says.

In this folder:
- task.json: what to decide. It holds the document, the page number, the quotes to reconcile with the findings that hold them, any problem a researcher reported, and corrections made to this page before.
- current.txt: the page's text as the document has it now.
- earlier.txt: the page's text as it was when the quotes were checked, where that is known.
- the page's picture, named in task.json as "picture", where the document has one. Look at it: it is the page itself, and it settles what the text should say.

For each quote in task.json, decide one of:
- "old": the wording the quote has is what the page says, and the current text is wrong there. Give "replaces", the exact words of current.txt that are wrong, and "wording", what the page says in their place, so that the text then holds the quote.
- "new": the current text is what the page says, and the quote's wording was a misreading. Give "quote": the quote as it should now read, in the exact words of current.txt.
- "transcribed": neither is what the page says. Give "replaces", the exact words of current.txt that are wrong, "wording", what the page says in their place, and "quote", the quote as it should now read, in words the corrected text holds.
- "unsettled": the picture does not settle it, or there is no picture and the two texts cannot be told apart. The quote then keeps the wording it has.

"replaces" names the fewest whole words that are wrong, as they appear once on the page; include a word before or after when they appear more than once.

Give the reason for each decision in a sentence: what the page shows.
Where a change alters what a finding says, such as a year or a name it states, give "finding": the finding as it should now read, with its statement, explanation and qualification ("supported", "reported", "disputed" or "unresolved"). Where the finding still says what the page shows, give "finding": null.
Where task.json reports a problem, or you see other words on this page that the current text has wrong, list them under "corrections", each with "replaces", the exact words of current.txt, "wording", what the page says, and "reason".

Reply with JSON and nothing else:

{"quotes": [{"evidence": "<the quote's evidence, from task.json>", "decision": "old" | "new" | "transcribed" | "unsettled", "replaces": "...", "wording": "...", "quote": "...", "reason": "...", "finding": null}], "corrections": [{"replaces": "...", "wording": "...", "reason": "..."}]}

You have a Python session, run with node tools/python.mjs, for comparing the texts, and the research library to read. Work in this folder.
`;

// The JSON in a reply, with or without a code fence or a sentence around it.
function parse(reply) {
  const text = reply.trim().replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/, "");
  for (const candidate of [text, text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)])
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === "object") return value;
    } catch {
      /* Not the JSON asked for. */
    }
  throw new Error("its reply was not the JSON it was asked for");
}

export class Reconciler {
  // jobs runs the model; written() brings the library up to date; notify(notice) tells
  // the researchers at work, with {document, from, to, reconciled, text}.
  /** @param {any} store @param {string} directory @param {{jobs: any, written?: () => void, notify?: (notice: {document: any, from: number, to: number, reconciled: number, text: string}) => void, picture?: typeof pagePicture}} options */
  constructor(store, directory, { jobs, written = () => {}, notify = () => {}, picture = pagePicture }) {
    this.store = store;
    this.directory = directory;
    this.jobs = jobs;
    this.written = written;
    this.notify = notify;
    this.picture = picture;
    // One round at a time for each document.
    this.rounds = new Map();
    this.next = 0;
  }
  document(id) {
    return this.store.state.documents.find((d) => d.id === id);
  }
  // Keeps the text a document had before a new revision replaces it, as its own file.
  keep(id, previous) {
    if (!previous) return;
    mkdirSync(join(this.directory, "documents"), { recursive: true });
    writeFileSync(join(this.directory, "documents", `${id}.r${previous.revision}.txt`), previous.text, { mode: 0o600 });
  }
  // A document's text has a new revision, or may have quotes left to reconcile, as when
  // the app opens. from is the revision researchers last knew. Resolves when the
  // document is reconciled as far as it can be.
  /** @param {string} id @param {number | null} [from] */
  revised(id, from = null) {
    return this.enqueue(id, () => this.round(id, from));
  }
  // Every document with a quote still waiting, as slice 03 left them and as a restart
  // finds a round cut short.
  recover() {
    for (const d of this.store.state.documents) if (d.corrections?.some((c) => c.status === "unreconciled")) this.revised(d.id);
  }
  // A researcher reports a problem in a document's text on a page.
  request({ document: id, page, problem }) {
    const d = this.document(id);
    if (!d) throw new Error(`No saved document has the ID ${JSON.stringify(id)}. weir.library.documents() lists them.`);
    if (typeof d.text !== "string") throw new Error(`Document ${id} has no text to reconcile yet.`);
    if (!Number.isSafeInteger(page) || !pagesOf(d.text).some((p) => p.page === page)) throw new Error(`Document ${id} has no page ${page}.`);
    if (typeof problem !== "string" || !problem.trim() || problem.length > MAX_PROBLEM) throw new Error("Say what is wrong with the text, in up to 5,000 characters: the words as the text has them, and what you think the page says.");
    this.enqueue(id, () => this.round(id, null, { page, problem: problem.trim() })).catch(() => {});
    return { started: true, document: id, page };
  }
  enqueue(id, work) {
    const after = (this.rounds.get(id) || Promise.resolve()).then(work, work);
    const settled = after.catch(() => {}).then(() => {
      if (this.rounds.get(id) === settled) this.rounds.delete(id);
    });
    this.rounds.set(id, settled);
    return after;
  }
  async round(id, from, asked = null) {
    let d = this.document(id);
    if (!d || typeof d.text !== "string") return;
    const before = from ?? d.revision ?? 1;
    // Earlier corrections go back wherever their place still matches.
    const reused = reuseCorrections(d, d.text);
    if (reused) {
      const { previous } = this.store.update((next) => reviseText(next, id, reused.text, { engine: "corrections", at: new Date().toISOString() }));
      this.keep(id, previous);
    }
    const open = openQuotes(this.store.state, id);
    const pages = new Set([...open.keys(), ...(asked ? [asked.page] : [])]);
    let reconciled = 0;
    if (pages.size) {
      // One job for each page, side by side.
      const answers = await Promise.all(
        [...pages].map((page) =>
          this.page(id, page, open.get(page) || [], asked?.page === page ? asked.problem : null).then(
            (answer) => ({ page, ...answer }),
            (error) => ({ page, failed: error.message }),
          ),
        ),
      );
      d = this.document(id);
      if (!d) return;
      const decisions = [];
      const fixes = [];
      for (const answer of answers) {
        const quotes = openQuotes(this.store.state, id).get(answer.page) || [];
        // A job that could not answer leaves its quotes with the wording they have.
        if (answer.failed) decisions.push(...quotes.map((q) => ({ evidence: q.ref, decision: "unsettled", reason: `The reconciliation could not be completed: ${answer.failed}.` })));
        else {
          decisions.push(...answer.quotes);
          // A quote the job passed over is not left waiting.
          for (const q of quotes) if (!answer.quotes.some((given) => given.evidence === q.ref)) decisions.push({ evidence: q.ref, decision: "unsettled", reason: "The reconciliation gave no decision for this quote." });
          fixes.push(...answer.corrections.map((c) => ({ ...c, page: answer.page })));
        }
      }
      const result = this.store.update((next) => {
        const applied = applyReconciliation(next, id, decisions, fixes);
        // Graph work under way for a batch was built from findings that have now changed.
        for (const change of applied.changed) findingsChanged(next, change.batchId, `Finding ${change.replaced} was replaced by ${change.by} after its source was reconciled against the page: "${change.statement}". packet.json holds the batch's findings as they stand now; revise the draft to match them.`);
        return applied;
      });
      this.keep(id, result.previous);
      reconciled = result.outcomes.length;
    }
    d = this.document(id);
    const to = d.revision ?? 1;
    if (reused || pages.size) this.written();
    if (to === before && !reconciled) return;
    const how = [reconciled ? `${reconciled} passage${reconciled === 1 ? " was" : "s were"} reconciled against the page` : "", reused ? `${reused.reused.length} earlier correction${reused.reused.length === 1 ? " was" : "s were"} put back` : ""].filter(Boolean).join(", and ");
    this.notify({
      document: d,
      from: before,
      to,
      reconciled,
      text: `"${d.name}" (${d.id}) ${to === before ? `has had its quotes reconciled at revision ${to}` : `has a new text: revision ${to}, where it was revision ${before}`}${how ? `; ${how}` : ""}. weir.library.corrections("${d.id}") lists what changed, and weir.library.read gives the text as it is now.`,
    });
  }
  // One page's job: resolves with its decisions and corrections.
  async page(id, page, quotes, problem) {
    const d = this.document(id);
    const original = join(this.directory, "documents", id);
    const own = join(this.directory, "agents", "reconciliation", id, `page-${page}-${Date.now()}-${++this.next}`);
    const earlierRevision = Math.max(0, ...quotes.map((q) => q.correction.fromRevision));
    let earlier = "";
    try {
      if (earlierRevision) earlier = pageOf(readFileSync(join(this.directory, "documents", `${id}.r${earlierRevision}.txt`), "utf8"), page);
    } catch {
      /* The earlier revision's text was not kept. */
    }
    const prepare = (folder) => {
      mkdirSync(folder, { recursive: true });
      const picture = existsSync(original) ? this.picture(d, original, page, folder) : null;
      writeFileSync(join(folder, "current.txt"), pageOf(d.text, page));
      writeFileSync(join(folder, "earlier.txt"), earlier);
      writeFileSync(
        join(folder, "task.json"),
        JSON.stringify(
          {
            document: { id: d.id, name: d.name, revision: d.revision ?? 1 },
            page,
            picture,
            ...(problem ? { problem } : {}),
            quotes: quotes.map((q) => ({
              evidence: q.ref,
              quote: q.evidence.quote,
              checkedInRevision: q.correction.fromRevision,
              pages: q.correction.pages,
              interpretation: q.evidence.interpretation,
              finding: q.finding ? { statement: q.finding.statement, explanation: q.finding.explanation, qualification: q.finding.qualification } : null,
            })),
            earlierCorrections: (d.corrections || []).filter((c) => c.fix?.page === page).map((c) => ({ decision: c.decision, before: c.fix.before, after: c.fix.after, reason: c.reason })),
          },
          null,
          2,
        ),
      );
    };
    const reply = await this.jobs.task({
      id: `reconcile-${id}-${page}-${this.next}`,
      folder: own,
      title: `Reconciling page ${page} of ${d.name}`,
      instructions: INSTRUCTIONS,
      prompt: `Reconcile page ${page} of "${d.name}": ${quotes.length ? `${quotes.length} quote${quotes.length === 1 ? "" : "s"} to decide` : "a problem a researcher reported"}. Begin with task.json.`,
      prepare,
      alive: () => Boolean(this.document(id)),
    });
    const answer = parse(reply);
    const text = (value) => (typeof value === "string" ? value : "");
    return {
      quotes: (Array.isArray(answer.quotes) ? answer.quotes : [])
        .filter((q) => q && typeof q === "object" && typeof q.evidence === "string" && ["old", "new", "transcribed", "unsettled"].includes(q.decision))
        .map((q) => ({ evidence: q.evidence, decision: q.decision, replaces: text(q.replaces), wording: text(q.wording), quote: text(q.quote), reason: text(q.reason).trim() || "No reason was given.", finding: q.finding && typeof q.finding === "object" ? q.finding : null })),
      corrections: (Array.isArray(answer.corrections) ? answer.corrections : [])
        .filter((c) => c && typeof c === "object" && text(c.replaces).trim() && text(c.wording).trim())
        .map((c) => ({ replaces: c.replaces, wording: c.wording, reason: text(c.reason).trim() || "No reason was given." })),
    };
  }
}
