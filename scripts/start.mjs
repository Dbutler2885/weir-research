// The one command that opens the app: `npm start` or `npm start -- "topic"`.
// It installs what a fresh clone is missing, then opens the named topic as a new
// project, or the last project, in the browser; the first time, it opens the setup
// screen. The app keeps running on its
// own after this command, or the agent that ran it, exits.
// It uses only Node's own modules, so it runs before anything is installed.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startLauncher } from "../server/start-launcher.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const [major] = process.versions.node.split(".").map(Number);
if (major < 24) {
  console.error(`This app needs Node.js 24 or later; this is ${process.versions.node}. Install a current Node.js from https://nodejs.org and run npm start again.`);
  process.exit(1);
}

// A fresh clone, or one whose lockfile changed since the last install.
const installed = join(root, "node_modules", ".package-lock.json");
if (!existsSync(installed) || statSync(join(root, "package-lock.json")).mtimeMs > statSync(installed).mtimeMs) {
  console.log("Installing the app's dependencies (first run only)...");
  if (spawnSync(npm, ["ci"], { cwd: root, stdio: "inherit" }).status !== 0) {
    console.error("Installing dependencies failed; the messages above say why.");
    process.exit(1);
  }
}

const openBrowser = (url) =>
  spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
const workspace = (...args) =>
  spawnSync(process.execPath, ["--no-warnings", join(root, "scripts/workspace.mjs"), ...args], { cwd: root, encoding: "utf8" });
let topic = process.argv.slice(2).join(" ").trim();
// With no project yet, the setup screen checks the agents and starts the first one.
if (!topic && !JSON.parse(workspace("projects").stdout || "[]").length) {
  let url;
  try {
    url = `${await startLauncher()}/setup`;
  } catch {
    console.error("The setup screen did not start.");
    process.exit(1);
  }
  if (!process.env.RESEARCH_NO_BROWSER) openBrowser(url);
  console.log(`Set up the app at ${url}`);
  process.exit(0);
}
const opened = topic ? workspace("start", topic) : workspace("resume");
if (opened.status !== 0) {
  console.error(opened.stderr.trim());
  process.exit(1);
}
const { url, project } = JSON.parse(opened.stdout);
console.log(`${project.name} is open at ${url}`);
