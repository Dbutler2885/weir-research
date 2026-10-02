import { basename } from "node:path";

// What each worker is doing at this moment. It lives in memory only: the saved
// history records the stages, and this fills in the latest action between them.
// How many earlier steps are kept beside the current one.
const TRAIL = 3;
// The current step and the few before it, most recent first, after one more step.
// The same step said again only moves its time.
export function step({ latest, trail }, text, now) {
  if (!text) return { latest, trail };
  const at = new Date(now).toISOString();
  if (latest?.text === text) return { latest: { at: latest.at, text }, trail };
  return { latest: { at, text }, trail: latest ? [latest, ...trail].slice(0, TRAIL) : trail };
}

export class LiveActivity {
  constructor(now = Date.now) {
    this.now = now;
    this.workers = new Map();
  }
  begin(key, worker) {
    this.workers.set(key, { ...worker, startedAt: new Date(this.now()).toISOString(), latest: null, trail: [] });
  }
  note(key, text) {
    const worker = this.workers.get(key);
    if (worker) Object.assign(worker, step(worker, text, this.now()));
  }
  end(key) {
    this.workers.delete(key);
  }
  list() {
    return [...this.workers.values()].map((w) => structuredClone(w));
  }
}

// Reads a worker's streamed output line by line and reports each action it takes.
export function streamReader(describe, report) {
  let pending = "";
  return (chunk) => {
    pending += chunk.toString();
    const lines = pending.split("\n");
    pending = lines.pop();
    for (const line of lines) {
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      for (const text of streamActions(event, describe)) report(text);
    }
  };
}

const quoted = (value) => {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return `“${text.length > 60 ? `${text.slice(0, 57)}...` : text}”`;
};
const host = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "a web page";
  }
};

// The actions in one line of Claude's stream-json or Codex's --json output.
export function streamActions(event, describe) {
  if (event.type === "assistant")
    return (event.message?.content || [])
      .filter((b) => b.type === "tool_use")
      .map((b) => toolAction(b.name, b.input || {}, describe))
      .filter(Boolean);
  // Codex's app server reports each item as it starts and completes.
  if (event.method === "item/started" || event.method === "item/completed") {
    const item = event.params?.item || {};
    const started = event.method === "item/started";
    if (item.type === "commandExecution" && started) return [commandAction(item.command, describe)].filter(Boolean);
    if (item.type === "fileChange" && !started)
      return (item.changes || []).map((c) => describe.file(c.path, "write")).filter(Boolean);
    if (item.type === "webSearch" && !started && item.query) return [`Searching the web for ${quoted(item.query)}`];
    if (item.type === "mcpToolCall" && item.server === "browser" && started) return [browserAction(item.tool, item.arguments || {})].filter(Boolean);
    return [];
  }
  if (event.type === "item.started" || event.type === "item.completed") {
    const item = event.item || {};
    // Codex reports a command when it starts and a file change when it is made.
    if (item.type === "command_execution" && event.type === "item.started") return [commandAction(item.command, describe)].filter(Boolean);
    if (item.type === "file_change" && event.type === "item.completed")
      return (item.changes || []).map((c) => describe.file(c.path, "write")).filter(Boolean);
    if (item.type === "web_search" && event.type === "item.started") return [`Searching the web for ${quoted(item.query)}`];
  }
  return [];
}

function toolAction(name, input, describe) {
  if (name === "Read") return describe.file(input.file_path, "read");
  if (name === "Write" || name === "Edit" || name === "MultiEdit") return describe.file(input.file_path, "write");
  if (name === "Grep") return `Searching for ${quoted(input.pattern)}`;
  if (name === "WebSearch") return `Searching the web for ${quoted(input.query)}`;
  if (name === "WebFetch") return `Reading a page on ${host(input.url)}`;
  if (name === "Task" || name === "Agent") return "Handing a part of the work to a helper";
  if (name === "Bash") return commandAction(input.command, describe);
  if (name.startsWith("mcp__browser__")) return browserAction(name.slice("mcp__browser__".length), input);
  return null;
}

// A research browser step, named by the site it is on.
function browserAction(tool, input) {
  if (tool === "new_page" || tool === "navigate_page") return input.url ? `Opening ${host(input.url)} in the research browser` : "Opening a page in the research browser";
  if (tool === "take_snapshot" || tool === "evaluate_script" || tool === "take_screenshot") return "Reading a page in the research browser";
  if (tool === "click" || tool === "fill" || tool === "fill_form" || tool === "press_key") return "Working with a page in the research browser";
  return null;
}

function commandAction(command, describe) {
  const text = Array.isArray(command) ? command.join(" ") : String(command || "");
  const url = text.match(/https?:\/\/[^\s'"]+/);
  if (/chrome-devtools-axi/.test(text)) return url ? `Opening ${host(url[0])} in a browser` : "Looking at a page in a browser";
  const file = text.match(/(?:cat|sed|head|tail|less|rg|grep)\b.*?([\w./-]+\.(?:json|csv|md|txt|pdf|html))/);
  if (file) return describe.file(file[1], "read");
  return null;
}

// Plain names for the files a worker touches, so a line reads as what it is doing.
export function fileDescriber(names = {}, titles = {}) {
  return {
    // Kept so a host process can rebuild the same describer.
    names,
    titles,
    file(path, mode) {
      if (!path) return null;
      const name = basename(String(path));
      const title = titles[name];
      if (title) return mode === "read" ? `Reading ${title}` : null;
      const known = names[name];
      if (known) return known[mode] ?? null;
      return mode === "read" ? `Reading ${name}` : `Writing ${name}`;
    },
  };
}

export const researcherFiles = {
  "brief.json": { read: "Reading its assignment" },
  "AGENTS.md": { read: "Reading its instructions" },
  "research-contract.ts": { read: "Reading the findings format" },
  "findings.ts": { read: "Reading the findings format" },
  "types.ts": { read: "Reading the findings format" },
  "checkpoint.json": { read: "Reading its saved progress", write: "Saving its progress" },
  "result.json": { read: "Checking its findings", write: "Writing up its findings" },
};

export const writerFiles = {
  "AGENTS.md": { read: "Reading its instructions" },
  "SKILL.md": { read: "Reading how to write a walkthrough" },
  "runtime.md": { read: "Reading the walkthrough format" },
  "materials.json": { read: "Reading the findings for this batch" },
  "walkthrough.json": { read: "Rereading its draft", write: "Writing the walkthrough" },
};

export const builderFiles = {
  "packet.json": { read: "Reading the research for this batch" },
  "updates.json": { read: "Checking for new instructions" },
  "contract.md": { read: "Reading the table format" },
  "graph-builder-system.md": { read: "Reading its instructions" },
  "AGENTS.md": { read: "Reading its instructions" },
  "graph-research.json": { read: "Reading the evidence the graph already cites" },
  "nodes.csv": { read: "Reading the nodes table", write: "Editing the nodes table" },
  "edges.csv": { read: "Reading the edges table", write: "Editing the edges table" },
  "types.csv": { read: "Reading the project's types", write: "Editing the project's types" },
  "fields.csv": { read: "Reading the fields each type records", write: "Editing the fields each type records" },
  "relationships.csv": { read: "Reading the relationship rules", write: "Editing the relationship rules" },
  "questions.csv": { read: "Reading its open questions", write: "Writing down open questions" },
  "notes.csv": { read: "Reading its notes", write: "Writing notes on its choices" },
  "validation.txt": { read: "Reading the problems found in its last draft" },
  "checkpoint.md": { read: "Reading its saved progress", write: "Saving its progress" },
  "submission.txt": { read: null, write: "Handing in the draft" },
};

// A line for what the coordinator is doing, read from the command it just sent.
export function coordinatorAction(data, state) {
  const batch = (id) => {
    const i = state.investigations.find((i) => i.id === id);
    return i?.number ? `batch ${i.number}` : "a batch";
  };
  const source = (id) => (state.dataset?.sources || []).find((s) => s.id === id)?.title
    || (state.documents || []).find((d) => d.id === id)?.name;
  switch (data.action) {
    case "snapshot": return "Catching up on the project";
    case "search": return `Searching the project for ${quoted(data.query)}`;
    case "inspect":
      if (data.kind === "investigation") return `Reading ${batch(data.id)}`;
      if (data.kind === "source") return source(data.id) ? `Reading ${source(data.id)}` : "Reading a source";
      if (data.kind === "candidate") return "Checking the findings a researcher returned";
      if (data.kind === "entity") return "Looking at a record in the graph";
      if (data.kind === "map") return "Reading the research map";
      return "Looking over the investigations";
    case "reply": return "Replying to you";
    case "open-batch": return "Starting a batch of research";
    case "add-to-batch": return `Adding your notes to ${batch(data.investigationId)}`;
    case "retitle": return `Renaming ${batch(data.investigationId)}`;
    case "request-approval": return "Asking you for a decision";
    case "batch-ready": return `Marking ${batch(data.investigationId)} ready for review`;
    case "assign": return `Assigning a researcher to ${batch(data.investigationId)}`;
    case "steer": return `Redirecting the researcher on ${batch(data.investigationId)}`;
    case "stop-researcher": return `Stopping the researcher on ${batch(data.investigationId)}`;
    case "publish": return `Publishing findings for ${batch(data.investigationId)}`;
    case "revise": return `Revising the findings for ${batch(data.investigationId)}`;
    case "request-resume": return `Asking to resume ${batch(data.investigationId)}`;
    case "ask-helper": return "Handing a small task to a helper";
    case "set-role":
    case "add-rule":
    case "remove-rule":
      return "Updating who does which job";
    case "assign-walkthrough": return `Assigning a walkthrough writer to ${batch(data.investigationId)}`;
    case "walkthrough-update": return `Sending instructions to the walkthrough writer for ${batch(data.investigationId)}`;
    case "publish-walkthrough": return `Publishing the walkthrough for ${batch(data.investigationId)}`;
    case "inspect-flow": return `Checking the graph draft for ${batch(data.investigationId)}`;
    case "request-graph": return `Starting the graph update you asked for on ${batch(data.investigationId)}`;
    case "assign-graph": return `Briefing a graph builder for ${batch(data.investigationId)}`;
    case "graph-update": return `Sending instructions to the graph builder for ${batch(data.investigationId)}`;
    case "request-graph-resume": return `Asking to resume the graph for ${batch(data.investigationId)}`;
    case "publish-graph-review": return `Signing off the graph draft for ${batch(data.investigationId)}`;
    case "answer-draft-feedback": return "Answering your note on the graph draft";
    case "map": return "Updating the research map";
    default:
      if (data.action?.startsWith("organization-")) return "Reorganizing the graph";
      return null;
  }
}
