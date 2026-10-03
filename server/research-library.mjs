import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { graphToTables } from "../src/domain/graph-csv.ts";
import { sourceLibrary } from "../src/domain/findings.ts";
import { textFile } from "../src/domain/text-revisions.ts";
import { isTeam } from "../src/domain/assignments.ts";

// The research library: everything the project has produced, as files a researcher
// searches and reads with its shell. The app writes it from the project's saved state
// and keeps it current; researchers can read it but not change it. It leaves out the
// human's conversation and annotations, and the app's own records, such as worker
// credentials.

const README = `# Research library

Everything this project has produced so far, kept current by the app while you work.
You can read and search it; you cannot change it.

- \`batches/batch-N/goal.md\`: the goal a batch's team of researchers shares, as the coordinator restated what the human asked for.
- \`batches/batch-N/board.md\`: what the batch's researchers, and the coordinator, posted for the team.
- \`batches/batch-N/findings.md\`: every finding the team has published, newest first, each with its evidence and the researcher who published it.
- \`batches/batch-N/researcher-K/checkpoints.md\`: each researcher's saved progress, including dead ends.
- A batch from before teams has \`brief.md\` in place of \`goal.md\`, and one folder per research pass, \`pass-K/\`, holding \`assignment.md\`, the coordinator's direction for it, \`findings.md\`, the findings it returned, and \`checkpoints.md\`.
- \`walkthroughs/batch-N.md\`: how each batch's research was explained to the human.
- \`graph/\`: the project's graph as tables: \`nodes.csv\`, \`edges.csv\`, the project's types, fields and relationships, and \`evidence.csv\`, the evidence the graph cites.
- \`sources.csv\`: every source the project knows, by ID.
- \`documents/\`: the project's saved documents by ID, with \`documents.csv\` listing them, each with the address it was saved from, if any; a PDF's or a web page's text is beside it as \`<id>.r<n>.txt\`, where n is the text's revision, a PDF's with "[Page n]" before each page. \`documents.csv\` names each document's current revision and the file that holds it. A document read again has a new revision in a new file; the files of its earlier revisions stay as they were.

IDs here are the ones to cite and to name in your work.
`;

const batchFolder = (b) => (b.number ? `batch-${b.number}` : `investigation-${b.id}`);
const lines = (...parts) => parts.filter((p) => p !== null && p !== undefined && p !== "").join("\n\n") + "\n";
const quote = (text) => String(text).trim().split("\n").map((l) => `> ${l}`).join("\n");
const cell = (value) => {
  const text = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};
const csv = (header, rows) => [header, ...rows].map((r) => r.map(cell).join(",")).join("\n") + "\n";
const statusWords = {
  waiting: "Waiting for a researcher.",
  running: "A researcher is working on it now.",
  finished: "Finished.",
  returned: "Returned; the coordinator is reviewing the result.",
  done: "Finished; its findings are published.",
  paused: "Paused.",
  stopped: "Stopped by the coordinator, or never started.",
};

function batchBrief(b) {
  const brief = b.brief;
  return lines(
    `# ${b.number ? `Batch ${b.number}: ` : ""}${b.title}`,
    `ID ${b.id}. Source collections: ${b.scope.join(", ")}.`,
    brief ? `## Purpose\n\n${brief.purpose}` : "No brief was written for this batch.",
    brief && `## Scope\n\n${brief.scope}`,
    brief && `## Direction\n\n${brief.direction}`,
  );
}

function batchGoal(b) {
  return lines(`# ${b.number ? `Batch ${b.number}: ` : ""}${b.title}`, `ID ${b.id}. Source collections: ${b.scope.join(", ")}.`, `## The goal\n\n${b.goal}`, `## The team\n\n${(b.assignments || []).map((a) => `- ${a.title}: ${statusWords[a.status].replace(/\.$/, "").toLowerCase()}`).join("\n")}`);
}

// A seat's folder in a team's batch: its place in the team.
export const seatFolderName = (b, a) => `researcher-${b.assignments.findIndex((x) => x.id === a.id) + 1}`;

function boardFile(b) {
  const posts = b.board || [];
  const title = (id) => b.assignments?.find((a) => a.id === id)?.title || "an assignment";
  const from = (p) => (p.author === "coordinator" ? "the coordinator" : isTeam(b) ? title(p.assignmentId) : `the researcher on "${title(p.assignmentId)}"`);
  return lines(
    `# Board for ${b.number ? `batch ${b.number}` : b.title}`,
    posts.length
      ? posts.map((p) => `## ${p.at.slice(0, 16).replace("T", " ")}, from ${from(p)}\n\n${p.text}`).join("\n\n")
      : "Nothing posted yet.",
  );
}

function assignmentFile(state, b, a) {
  const annotations = (a.annotationIds || [])
    .map((id) => b.annotations.find((x) => x.id === id))
    .filter(Boolean);
  const direction = a.brief
    ? `## The coordinator's brief\n\n${a.brief}`
    : annotations.length
      ? `## Started from the human's annotations\n\nThis pass was started before the coordinator wrote briefs, from these annotations:\n\n${annotations.map((x) => quote(x.question)).join("\n\n")}`
      : "No brief was recorded for this pass.";
  return lines(
    `# ${a.title}`,
    `Assignment ${a.id} in ${b.number ? `batch ${b.number}` : b.title}. ${statusWords[a.status]}${a.worker ? ` Researcher: ${a.worker}.` : ""}${a.startedAt ? ` Started ${a.startedAt.slice(0, 16).replace("T", " ")}.` : ""}`,
    direction,
    a.steering.length
      ? `## Steering from the coordinator\n\n${a.steering.map((s) => `${s.at.slice(0, 16).replace("T", " ")}:\n\n${quote(s.message)}`).join("\n\n")}`
      : "",
  );
}

function evidenceText(state, p, id) {
  const e = p.evidence.find((x) => x.id === id);
  if (!e) return `Evidence ${id} is missing.`;
  const source = sourceLibrary(state).find((s) => s.id === e.sourceId);
  // Which revision of the document's text the quote was found in, and where that text is.
  const d = e.check === "checked" ? state.documents.find((x) => x.id === e.documentId) : null;
  const cited = e.pages && e.pages[0] !== e.pages[1] ? "pages" : "page";
  const [found, now] = [e.revision ?? 1, d?.revision ?? 1];
  const checked = !d
    ? " The app found this quote in the saved text at the pages cited."
    : ` The app found this quote at the ${cited} cited, in revision ${found} of the saved text (${textFile(d, found)}).${
        found < now ? ` The document has been read again since, and revision ${now} (${textFile(d, now)}) words this passage differently; the quote keeps the wording it was checked in until the two are reconciled against the page.` : ""
      }`;
  return lines(
    quote(e.quote),
    `Evidence ${e.id} (${e.stance}). Source: ${source?.title || "unknown"} (${e.sourceId}), ${e.locator}.${e.documentId ? ` Saved as documents/${e.documentId}.` : ""}${
      e.check === "checked" ? checked : e.check === "transcribed" ? " From a transcription, which the app cannot check against the image." : ""
    }`,
    e.context ? `Context: ${e.context}` : "",
    `Interpretation: ${e.interpretation}`,
  ).trimEnd();
}

function findingsFile(state, title, proposals) {
  // The seat whose researcher published a finding.
  const seat = (p) => state.investigations.flatMap((b) => b.assignments || []).find((a) => a.id === p.assignmentId)?.title || "a researcher";
  if (!proposals.length) return lines(`# Findings: ${title}`, "Nothing published yet.");
  return lines(
    `# Findings: ${title}`,
    ...proposals.map((p) =>
      lines(
        `## ${p.title}`,
        `Report ${p.id}, published ${p.createdAt.slice(0, 10)}.`,
        p.summary,
        p.ambiguity ? `Unresolved: ${p.ambiguity}` : "",
        ...(p.findings || [])
          .filter((f) => f.status !== "superseded")
          .map((f) =>
            lines(
              `### ${f.statement}`,
              `Finding ${p.id}/${f.id} (finding ${f.id} in report ${p.id})${p.key ? `, published by ${seat(p)}` : ""}: ${f.qualification}${f.status === "deferred" ? "; set aside by the human" : f.status === "kept" ? "; kept by the human" : ""}.`,
              f.explanation,
              ...f.evidenceIds.map((id) => evidenceText(state, p, id)),
            ).trimEnd(),
          ),
        // A report from before findings changed the graph directly; its evidence is what it cited.
        !p.findings?.length && p.evidence.length ? p.evidence.map((e) => evidenceText(state, p, e.id)).join("\n\n") : "",
      ).trimEnd(),
    ),
  );
}

function checkpointsFile(title, checkpoints) {
  return lines(
    `# Checkpoints: ${title}`,
    checkpoints.length
      ? checkpoints
          .map((c) => lines(`## ${c.at.slice(0, 16).replace("T", " ")}, ${c.worker}`, c.summary, `### What was found and tried\n\n${c.findings}`, `### Next steps\n\n${c.nextSteps}`).trimEnd())
          .join("\n\n")
      : "No checkpoints saved.",
  );
}

function walkthroughFile(b, w) {
  return lines(
    `# ${w.title}`,
    `The walkthrough of ${b.number ? `batch ${b.number}` : b.title}, revision ${w.revision}.`,
    `## The question\n\n${w.question}`,
    `## How the research went\n\n${w.journey}`,
    `## The answer\n\n${w.answer}`,
    w.caveats.length ? `## Caveats\n\n${w.caveats.map((c) => `- ${c}`).join("\n")}` : "",
    ...w.steps.map((s, n) => lines(`## ${n + 1}. ${s.title}`, s.body, s.evidenceRefs.length ? `Evidence: ${s.evidenceRefs.join(", ")}` : "").trimEnd()),
    w.closing ? `## Closing\n\n${w.closing}` : "",
  );
}

// The library's files for a project: text by path, or a document to copy by path.
export function libraryFiles(state) {
  const files = new Map([["README.md", README]]);
  for (const b of state.investigations) {
    const base = `batches/${batchFolder(b)}`;
    files.set(`${base}/board.md`, boardFile(b));
    // A team's batch: its goal, one list of its findings, and each seat's checkpoints.
    if (isTeam(b)) {
      files.set(`${base}/goal.md`, batchGoal(b));
      files.set(`${base}/findings.md`, findingsFile(state, b.title, [...b.proposals].filter((p) => p.kind === "findings" || !p.kind).reverse()));
      for (const a of b.assignments || []) files.set(`${base}/${seatFolderName(b, a)}/checkpoints.md`, checkpointsFile(a.title, a.checkpoints));
      const walkthrough = b.reviewFlow?.walkthroughs.at(-1);
      if (walkthrough) files.set(`walkthroughs/${batchFolder(b)}.md`, walkthroughFile(b, walkthrough));
      continue;
    }
    files.set(`${base}/brief.md`, batchBrief(b));
    (b.assignments || []).forEach((a, n) => {
      const pass = `${base}/pass-${n + 1}`;
      files.set(`${pass}/assignment.md`, assignmentFile(state, b, a));
      files.set(`${pass}/findings.md`, findingsFile(state, a.title, b.proposals.filter((p) => p.assignmentId === a.id)));
      files.set(`${pass}/checkpoints.md`, checkpointsFile(a.title, a.checkpoints));
    });
    const other = b.proposals.filter((p) => !p.assignmentId || !b.assignments?.some((a) => a.id === p.assignmentId));
    if (other.length) files.set(`${base}/other-findings.md`, findingsFile(state, b.title, other));
    const walkthrough = b.reviewFlow?.walkthroughs.at(-1);
    if (walkthrough) files.set(`walkthroughs/${batchFolder(b)}.md`, walkthroughFile(b, walkthrough));
  }
  for (const [name, text] of Object.entries(graphToTables(state.dataset))) files.set(`graph/${name}`, text);
  files.set(
    "graph/evidence.csv",
    csv(["id", "sourceId", "quote", "context", "locator", "interpretation"], (state.dataset.evidence || []).map((e) => [e.id, e.sourceId, e.quote, e.context, e.locator, e.interpretation])),
  );
  const sources = sourceLibrary(state);
  const keys = ["id", "title", ...new Set(sources.flatMap((s) => Object.keys(s)).filter((k) => k !== "id" && k !== "title"))];
  files.set("sources.csv", csv(keys, sources.map((s) => keys.map((k) => s[k]))));
  const documents = [];
  for (const d of state.documents) {
    const original = `documents/${d.id}${extname(d.name).toLowerCase()}`;
    files.set(original, { copy: d.id, size: d.size });
    // A text document is its own text; a PDF's or a web page's text is kept beside it.
    // Each revision of it has a file of its own that never changes, so a reader that
    // takes the revision from documents.csv and then opens the file gets that revision.
    const text = d.text !== undefined && d.mime !== "text/plain" ? textFile(d, d.revision ?? 1) : "";
    if (text) files.set(text, d.text);
    // Earlier revisions of its text, kept when it was read again.
    for (const r of d.textRevisions || []) files.set(textFile(d, r.revision), { copy: `${d.id}.r${r.revision}.txt`, size: r.size });
    documents.push([d.id, d.name, d.collectionId, original, text || (d.mime === "application/pdf" ? "not read yet" : original), d.pages ?? "", d.url ?? "", d.capturedAt ?? "", d.text !== undefined ? d.revision ?? 1 : ""]);
  }
  files.set("documents/documents.csv", csv(["id", "name", "collection", "file", "text", "pages", "url", "saved", "revision"], documents));
  return files;
}

// Writes the library into its folder, changing only what changed and removing what
// no longer belongs, so a researcher reading it never sees it emptied.
export function writeLibrary(state, directory) {
  const folder = join(directory, "library");
  const files = libraryFiles(state);
  for (const [path, content] of files) {
    const target = join(folder, path);
    mkdirSync(dirname(target), { recursive: true });
    if (typeof content === "string") {
      if (existsSync(target) && readFileSync(target, "utf8") === content) continue;
      writeFileSync(`${target}.tmp`, content);
      // A rename replaces the file whole; a reader sees the old or the new one.
      renameSync(`${target}.tmp`, target);
    } else {
      const source = join(directory, "documents", content.copy);
      if (!existsSync(source) || (existsSync(target) && statSync(target).size === statSync(source).size)) continue;
      copyFileSync(source, target);
    }
  }
  for (const file of walk(folder)) if (!files.has(relative(folder, file))) rmSync(file, { force: true });
  return folder;
}

function* walk(folder) {
  if (!existsSync(folder)) return;
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

// Keeps a project's library current as its research is saved.
export class ResearchLibrary {
  constructor(store, directory, { delay = 500 } = {}) {
    this.store = store;
    this.directory = directory;
    this.folder = join(directory, "library");
    this.delay = delay;
    this.timer = null;
    this.write();
    this.unsubscribe = store.subscribe(() => this.schedule());
  }
  schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.write();
    }, this.delay);
    this.timer.unref?.();
  }
  write() {
    try {
      writeLibrary(this.store.state, this.directory);
    } catch (error) {
      console.error(`The research library could not be written: ${error.message}`);
    }
  }
  stop() {
    clearTimeout(this.timer);
    this.timer = null;
    this.unsubscribe();
  }
}
