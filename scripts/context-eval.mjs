// Starts a real coordinator on a copy of a project and asks it questions right
// after its startup context. The coordinator works as the app's own does: Claude
// Code in the coordinator folder the app prepares, sandboxed there, starting from
// the same first message and inspecting whatever it needs with its command tool.
// Answers are scored against the human's answer key, and every read is counted.
// The project itself is never touched.
//
// node scripts/context-eval.mjs <project-id> [--model <model>] [--grader <model>]
// Probes and the answer key live in .research/context-eval/<project-id>/probes.json:
// [{"id":"...","question":"...","key":"what a correct answer must say"}]
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { home, root, project } from "./workspace-lib.mjs";
import { claudeIsolationArgs } from "../server/agents/isolation.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  if (at < 0) return fallback;
  const [, value] = args.splice(at, 2);
  return value;
};
const model = option("--model");
const grader = option("--grader", "sonnet");

// Everything but the live connection, lock and sessions, so the copy starts its
// own service and a fresh coordinator instead of reaching the running one.
const leaveOut = new Set(["connection.json", "coordinator-connection.json", "server.lock", "server.log", "coordinator-sessions"]);
function copyProject(p, evalHome) {
  const directory = join(evalHome, "projects", p.id);
  mkdirSync(directory, { recursive: true });
  for (const name of readdirSync(p.directory)) {
    if (leaveOut.has(name)) continue;
    // A copy-on-write clone where the filesystem supports it.
    const copied = spawnSync("cp", ["-Rc", join(p.directory, name), directory]);
    if (copied.status !== 0 && spawnSync("cp", ["-R", join(p.directory, name), directory]).status !== 0)
      throw new Error(`Could not copy ${name}.`);
  }
  writeFileSync(join(evalHome, "projects.json"), JSON.stringify([{ ...p, directory }], null, 2));
  writeFileSync(join(evalHome, "active-project.json"), JSON.stringify({ id: p.id }));
  return directory;
}

function stopService(directory) {
  const lock = join(directory, "server.lock");
  if (!existsSync(lock)) return;
  try {
    process.kill(Number(readFileSync(lock, "utf8")));
  } catch {
    /* Already stopped. */
  }
}

// Runs Claude Code with the given confinement, streaming its actions.
function run(prompt, { cwd, env, confine = [], chosen, transcript }) {
  const flags = ["-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "dontAsk", "--no-session-persistence", ...confine];
  if (chosen) flags.push("--model", chosen);
  return new Promise((resolvePromise, reject) => {
    const child = spawn("claude", flags, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    const events = [];
    let pending = "", err = "";
    child.stdout.on("data", (chunk) => {
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop();
      for (const line of lines) if (line.trim()) events.push(JSON.parse(line));
    });
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (transcript) writeFileSync(transcript, events.map((e) => JSON.stringify(e)).join("\n"));
      const result = events.find((e) => e.type === "result");
      if (!result || result.is_error) return reject(new Error(`claude exited ${code}: ${result?.result || err}`));
      const tools = events
        .filter((e) => e.type === "assistant")
        .flatMap((e) => e.message.content.filter((c) => c.type === "tool_use"))
        .map((c) => ({ name: c.name, input: c.input }));
      resolvePromise({ text: result.result, tools, cost: result.total_cost_usd, turns: result.num_turns, tokens: tokenUse(events) });
    });
    child.stdin.end(prompt);
  });
}

// Every model call re-reads its whole context, so tokens ingested are summed over
// calls; the largest single call is how big the context grew.
function tokenUse(events) {
  const seen = new Set();
  const calls = [];
  for (const e of events) {
    if (e.type !== "assistant" || !e.message?.usage || seen.has(e.message.id)) continue;
    seen.add(e.message.id);
    const u = e.message.usage;
    calls.push({ input: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0), output: u.output_tokens || 0 });
  }
  return {
    calls: calls.length,
    ingested: calls.reduce((sum, c) => sum + c.input, 0),
    peakContext: Math.max(0, ...calls.map((c) => c.input)),
    output: calls.reduce((sum, c) => sum + c.output, 0),
  };
}

const json = (text) => JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));

function firstMessage(startup, probes) {
  return [
    startup,
    "",
    "Before doing anything else, answer these questions for me.",
    "I am checking what you know when you start, so inspect whatever you need, but do not change the project or reply in the browser conversation. Answer, then stop.",
    "",
    ...probes.map((p) => `- ${p.id}: ${p.question}`),
    "",
    'End your reply with JSON only: {"answers":[{"id":"...","answer":"..."}]}',
  ].join("\n");
}

function gradePrompt(probes, answers) {
  return [
    "Score a research coordinator's answers against the human's answer key.",
    "2 = says everything the key requires and nothing contradicting it; 1 = partly right or missing a required point; 0 = wrong, contradicts the key, or guesses.",
    'Reply with JSON only: {"scores":[{"id":"...","score":0,"reason":"one sentence"}]}',
    "",
    ...probes.map((p) => `### ${p.id}\nQuestion: ${p.question}\nKey: ${p.key}\nAnswer: ${answers.find((a) => a.id === p.id)?.answer ?? "(no answer)"}`),
  ].join("\n\n");
}

const describe = (tool) => (tool.name === "Bash" ? tool.input.command : `${tool.name} ${tool.input?.file_path || tool.input?.skill || tool.input?.pattern || ""}`.trim());

try {
  const p = project(args.find((a) => !a.startsWith("--")));
  const folder = join(home, "context-eval", p.id);
  const probesFile = join(folder, "probes.json");
  if (!existsSync(probesFile)) throw new Error(`Write the probes and answer key first: ${probesFile}`);
  const probes = JSON.parse(readFileSync(probesFile, "utf8"));
  const out = join(folder, new Date().toISOString().replace(/[:.]/g, "-"));
  mkdirSync(out, { recursive: true });
  const results = {};
  const evalHome = join(out, "home");
  const directory = copyProject(p, evalHome);
  // The service prepares the coordinator's folder, as the app does, without starting an agent there.
  const env = { ...process.env, RESEARCH_HOME: evalHome, RESEARCH_NO_BROWSER: "1", RESEARCH_COORDINATOR_AGENT: "prepare" };
  try {
    // Opened in its own process: the registry location is read once, from the environment.
    const opened = spawnSync(process.execPath, [join(root, "scripts/workspace.mjs"), "open", p.id, "--no-browser"], { env, encoding: "utf8" });
    if (opened.status !== 0) throw new Error(`Could not open the project copy: ${opened.stderr}`);
    const prepared = JSON.parse(readFileSync(join(directory, "coordinator", "prepared.json"), "utf8"));
    const answered = await run(firstMessage(prepared.prompt, probes), {
      cwd: prepared.folder,
      env,
      chosen: model,
      transcript: join(out, "transcript.jsonl"),
      confine: claudeIsolationArgs(prepared.folder, { web: false }),
    });
    const answers = json(answered.text).answers;
    const graded = await run(gradePrompt(probes, answers), { cwd: out, env: process.env, chosen: grader });
    const scores = json(graded.text).scores;
    results.app = { answers, scores, reads: answered.tools.map(describe), turns: answered.turns, tokens: answered.tokens, cost: (answered.cost || 0) + (graded.cost || 0) };
    writeFileSync(join(out, "result.json"), JSON.stringify(results.app, null, 2));
  } finally {
    stopService(directory);
    rmSync(evalHome, { recursive: true, force: true });
  }
  const total = (name) => results[name].scores.reduce((sum, s) => sum + s.score, 0);
  const names = Object.keys(results);
  const lines = [
    `# Startup context evaluation: ${p.id}`,
    "",
    "The coordinator ran as Claude Code in the folder the app prepares, on a copy of the project, and was asked the questions below after its startup context.",
    `Coordinator model: ${model || "CLI default"}. Grader: ${grader}. ${probes.length} questions, 2 points each.`,
    "",
    "Tokens ingested is a running total: every model call re-sends the whole context, so it grows with each tool call. Peak context is the largest single call, the size that matters for compaction.",
    "",
    "| Context | Score | Reads | Tokens ingested | Peak context | Cost (USD) |",
    "|---|---:|---:|---:|---:|---:|",
    ...names.map((n) => {
      const r = results[n];
      const k = (v) => v.toLocaleString("en-US");
      return `| ${n} | ${total(n)} / ${probes.length * 2} | ${r.reads.length} | ${k(r.tokens.ingested)} | ${k(r.tokens.peakContext)} | ${r.cost.toFixed(2)} |`;
    }),
    "",
    "## By question",
    "",
    ...probes.flatMap((probe) => [
      `### ${probe.id}: ${probe.question}`,
      "",
      ...names.map((n) => {
        const s = results[n].scores.find((x) => x.id === probe.id);
        return `- ${n}: ${s?.score ?? "?"} - ${s?.reason ?? "not scored"}`;
      }),
      "",
    ]),
    "## Reads",
    "",
    ...names.flatMap((n) => [`### ${n}`, "", ...(results[n].reads.length ? results[n].reads.map((r) => `- \`${r.slice(0, 200)}\``) : ["None."]), ""]),
  ];
  writeFileSync(join(out, "REPORT.md"), lines.join("\n"));
  console.log(JSON.stringify({ directory: out, scores: Object.fromEntries(names.map((n) => [n, total(n)])), reads: Object.fromEntries(names.map((n) => [n, results[n].reads.length])), outOf: probes.length * 2 }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
