import { spawnSync } from "node:child_process";

// Claude Code takes model aliases; each names its latest model of that kind.
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
function claudeEfforts(run) {
  const help = run("claude", ["--help"]);
  const listed = help.match(/--effort <level>[\s\S]*?\(([^)]*)\)/)?.[1];
  return listed ? listed.split(",").map((e) => e.trim()).filter(Boolean) : CLAUDE_EFFORTS;
}

// Codex lists its models, and each model's efforts, itself.
function codexModels(run) {
  try {
    return JSON.parse(run("codex", ["debug", "models"]))
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

const output = (command, args) => {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 20_000 });
  return result.status === 0 ? result.stdout : "";
};

// What the installed agent CLIs offer: models and efforts, for the menus and for
// validating dispatch rules. Read once, since it changes only when a CLI does.
export function agentCatalog({ findExecutable = (/** @type {string} */ _name) => /** @type {string | null} */ (null), run = output } = {}) {
  const claude = Boolean(findExecutable("claude"));
  const codex = Boolean(findExecutable("codex"));
  const efforts = claude ? claudeEfforts(run) : CLAUDE_EFFORTS;
  const codexList = codex ? codexModels(run) : [];
  return {
    agents: [
      { id: "claude", label: "Claude Code", installed: claude, models: CLAUDE_MODELS.map((m) => ({ ...m, efforts })), efforts },
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
