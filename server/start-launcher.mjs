// Starts the launcher, the small service that serves the setup and welcome pages
// while no project is open, and returns its address once it answers.
// It uses only Node's own modules, so `npm start` can run it before anything is installed.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// Where the running launcher records itself; the same folder as the projects.
const home = resolve(process.env.RESEARCH_HOME || join(root, ".research"));
export const launcherFile = join(home, "launcher.json");

// When the app's code last changed on disk. A launcher started on older code, as
// one still running across a `git pull` is, would serve the old pages.
export function codeStamp() {
  let newest = 0;
  for (const folder of ["server", "scripts", "src"])
    for (const file of readdirSync(join(root, folder), { recursive: true }))
      newest = Math.max(newest, statSync(join(root, folder, file)).mtimeMs);
  return newest;
}

export async function startLauncher() {
  // A launcher already running on this code answers its front page with a redirect
  // to setup; one on older code is replaced.
  if (existsSync(launcherFile)) {
    const running = JSON.parse(readFileSync(launcherFile, "utf8"));
    const answered = await fetch(running.url, { redirect: "manual", signal: AbortSignal.timeout(500) }).then((r) => r.status === 302, () => false);
    if (answered && running.stamp === codeStamp()) return running.url;
    if (answered)
      try {
        process.kill(running.pid);
      } catch {
        /* It has gone already. */
      }
  }
  const file = join(mkdtempSync(join(tmpdir(), "research-launcher-")), "url");
  spawn(process.execPath, ["--no-warnings", join(root, "server/launcher.mjs"), file], { cwd: root, detached: true, stdio: "ignore" }).unref();
  for (let n = 0; n < 100; n++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (existsSync(file)) return readFileSync(file, "utf8");
  }
  throw new Error("The launcher did not start.");
}
