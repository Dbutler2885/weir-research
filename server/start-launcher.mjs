// Starts the launcher, the small service that serves the setup and welcome pages
// while no project is open, and returns its address once it answers.
// It uses only Node's own modules, so `npm start` can run it before anything is installed.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// Where the running launcher records its address; the same folder as the projects.
const home = resolve(process.env.RESEARCH_HOME || join(root, ".research"));
export const launcherFile = join(home, "launcher-url");

export async function startLauncher() {
  // A launcher already running answers its front page with a redirect to setup.
  if (existsSync(launcherFile)) {
    const url = readFileSync(launcherFile, "utf8");
    const answered = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(500) }).then((r) => r.status === 302, () => false);
    if (answered) return url;
  }
  const file = join(mkdtempSync(join(tmpdir(), "research-launcher-")), "url");
  spawn(process.execPath, ["--no-warnings", join(root, "server/launcher.mjs"), file], { cwd: root, detached: true, stdio: "ignore" }).unref();
  for (let n = 0; n < 100; n++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (existsSync(file)) return readFileSync(file, "utf8");
  }
  throw new Error("The launcher did not start.");
}
