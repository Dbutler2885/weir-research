import { execFile, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The aliases Claude Code takes when it cannot list its models; each names its latest model of that kind.
const CLAUDE_MODELS = [
  { id: "fable", label: "Fable" },
  { id: "opus", label: "Opus" },
  { id: "sonnet", label: "Sonnet" },
  { id: "haiku", label: "Haiku" },
];
const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"];
// An effort that delegates to agents of its own; only the app starts agents.
const DELEGATING = new Set(["ultra"]);

// The efforts Claude Code lists in its help, or the known ones if it lists none.
function claudeEfforts(help) {
  const listed = help.match(/--effort <level>[\s\S]*?\(([^)]*)\)/)?.[1];
  return listed ? listed.split(",").map((e) => e.trim()).filter(Boolean) : CLAUDE_EFFORTS;
}

// Claude Code lists its models when asked to initialize, without starting a turn. The
// first of each kind is the current one; the rest are older versions, kept so a choice
// already made stays valid. A current model given by its full name is offered by its
// kind's alias where Claude Code takes one, so the choice follows each new version.
function claudeModels(reply, help) {
  let models;
  for (const line of reply.split("\n")) {
    try {
      const event = JSON.parse(line);
      if (event.type === "control_response") models = event.response?.response?.models;
    } catch {
      /* Not an event. */
    }
  }
  if (!Array.isArray(models) || !models.length) return null;
  const seen = new Set();
  const listed = [];
  for (const m of models) {
    if (m.value === "default" || typeof m.value !== "string") continue;
    const label = m.displayName || m.value;
    const kind = label.split(" ")[0].toLowerCase();
    const efforts = (m.supportedEffortLevels || []).filter((e) => !DELEGATING.has(e));
    const current = !seen.has(kind);
    seen.add(kind);
    const alias = current && m.value !== kind && help.includes(`'${kind}'`) ? kind : null;
    if (alias) listed.push({ id: alias, label, efforts });
    listed.push({ id: m.value, label, efforts, ...(current && !alias ? {} : { older: true }) });
  }
  return listed;
}

// Codex lists its models, and each model's efforts, itself.
function codexModels(list) {
  try {
    return JSON.parse(list)
      .models.filter((m) => m.visibility === "list")
      .map((m) => ({
        id: m.slug,
        label: m.display_name || m.slug,
        efforts: m.supported_reasoning_levels.map((l) => l.effort).filter((e) => !DELEGATING.has(e)),
      }));
  } catch {
    return [];
  }
}

// A CLI's output, or nothing when it fails. Claude Code is asked in an empty folder with
// none of the human's settings, hooks or MCP servers, as the app's agents run.
function output(command, args, input) {
  return new Promise((done) => {
    const folder = input === undefined ? undefined : mkdtempSync(join(tmpdir(), "weir-catalog-"));
    const finish = (text) => {
      if (folder) rmSync(folder, { recursive: true, force: true });
      done(text);
    };
    if (input === undefined) return execFile(command, args, { encoding: "utf8", timeout: 20_000 }, (error, stdout) => finish(error ? "" : stdout));
    const child = spawn(command, args, { cwd: folder, stdio: ["pipe", "pipe", "ignore"] });
    let stdout = "";
    const timer = setTimeout(() => child.kill(), 20_000);
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.on("error", () => {
      clearTimeout(timer);
      finish("");
    });
    child.on("close", () => {
      clearTimeout(timer);
      finish(stdout);
    });
    child.stdin.end(input);
  });
}

const CLAUDE_LIST = [
  ["--print", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--setting-sources", "project", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}'],
  `${JSON.stringify({ type: "control_request", request_id: "models", request: { subtype: "initialize" } })}\n`,
];

// What the installed agent CLIs offer, read from the CLIs themselves: models and
// efforts, for the menus and for validating dispatch rules. Read when the app starts
// and again when the human opens the settings, so a new model shows without an update.
export async function agentCatalog({ findExecutable = (/** @type {string} */ _name) => /** @type {string | null} */ (null), run = output } = {}) {
  const claude = Boolean(findExecutable("claude"));
  const codex = Boolean(findExecutable("codex"));
  const [help, reply, list] = await Promise.all([
    claude ? run("claude", ["--help"]) : "",
    claude ? run("claude", ...CLAUDE_LIST) : "",
    codex ? run("codex", ["debug", "models"]) : "",
  ]);
  const efforts = claudeEfforts(help);
  const claudeList = claudeModels(reply, help) ?? CLAUDE_MODELS.map((m) => ({ ...m, efforts }));
  const codexList = codex ? codexModels(list) : [];
  return {
    agents: [
      {
        id: "claude",
        label: "Claude Code",
        installed: claude,
        models: claudeList,
        efforts: [...new Set(claudeList.flatMap((m) => m.efforts))],
      },
      {
        id: "codex",
        label: "Codex",
        installed: codex,
        models: codexList,
        efforts: [...new Set(codexList.flatMap((m) => m.efforts))],
      },
    ],
  };
}
