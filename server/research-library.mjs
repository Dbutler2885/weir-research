import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { graphToTables } from "../src/domain/graph-csv.ts";
import { sourceLibrary } from "../src/domain/findings.ts";

// The research library: everything the project has produced, as files a researcher
// searches and reads with its shell. The app writes it from the project's saved state
// and keeps it current; researchers can read it but not change it. It leaves out the
// human's conversation and annotations, results the coordinator has not reviewed, and
// the app's own records, such as worker credentials.

const README = `# Research library

Everything this project has produced so far, kept current by the app while you work.
You can read and search it; you cannot change it.

- \`batches/batch-N/brief.md\`: what each batch is for, from the coordinator.
- \`batches/batch-N/board.md\`: what the batch's researchers, and the coordinator, posted for its researchers.
- \`batches/batch-N/pass-K/\`: one folder per research pass, in the order the coordinator made them.
  \`assignment.md\` is the coordinator's direction and any steering that followed, \`findings.md\` the findings it returned once the coordinator published them, with their evidence, and \`checkpoints.md\` the researcher's saved progress, including dead ends.
- \`walkthroughs/batch-N.md\`: how each batch's research was explained to the human.
- \`graph/\`: the project's graph as tables: \`nodes.csv\`, \`edges.csv\`, the project's types, fields and relationships, and \`evidence.csv\`, the evidence the graph cites.
- \`sources.csv\`: every source the project knows, by ID.
- \`documents/\`: the project's saved documents by ID, with \`documents.csv\` listing them; a PDF's text is beside it as \`<id>.txt\`, with "[Page n]" before each page.

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

function boardFile(b) {
  const posts = b.board || [];
  const title = (id) => b.assignments?.find((a) => a.id === id)?.title || "an assignment";
  return lines(
    `# Board for ${b.number ? `batch ${b.number}` : b.title}`,
    posts.length
      ? posts.map((p) => `## ${p.at.slice(0, 16).replace("T", " ")}, from ${p.author === "coordinator" ? "the coordinator" : `the researcher on "${title(p.assignmentId)}"`}\n\n${p.text}`).join("\n\n")
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
  return lines(
    quote(e.quote),
    `Evidence ${e.id} (${e.stance}). Source: ${source?.title || "unknown"} (${e.sourceId}), ${e.locator}.${e.documentId ? ` Saved as documents/${e.documentId}.` : ""}`,
    `Context: ${e.context}`,
    `Interpretation: ${e.interpretation}`,
  ).trimEnd();
}

function findingsFile(state, title, proposals) {
  if (!proposals.length) return lines(`# Findings: ${title}`, "Nothing published from this pass yet.");
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
              `Finding ${f.id} in report ${p.id}: ${f.qualification}${f.status === "deferred" ? "; set aside by the human" : f.status === "kept" ? "; kept by the human" : ""}.`,
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
    files.set(`${base}/brief.md`, batchBrief(b));
    files.set(`${base}/board.md`, boardFile(b));
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
    const textFile = d.text !== undefined && d.mime === "application/pdf" ? `documents/${d.id}.txt` : "";
    if (textFile) files.set(textFile, d.text);
    documents.push([d.id, d.name, d.collectionId, original, textFile || (d.mime === "application/pdf" ? "not read yet" : original), d.pages ?? ""]);
  }
  files.set("documents/documents.csv", csv(["id", "name", "collection", "file", "text", "pages"], documents));
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
