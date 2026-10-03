// Docling, the High accuracy PDF reader: a local Python program that follows columns,
// tables and reading order, and reads scans with OCR. The app installs it on request
// into one folder of its own, with nothing needed beforehand but Node: it downloads
// uv, a pinned and checksummed release, which fetches Python and the locked packages,
// then reads a small fictional PDF to fetch Docling's models and prove it works.
// Removing that folder removes Docling.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fictionalPdf } from "./fictional-pdf.mjs";
import { downloadUv, uvExecutable } from "../uv.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const windows = process.platform === "win32";
export const doclingFolder = (home) => join(home, "tools", "docling");
const paths = (home) => {
  const folder = doclingFolder(home);
  return {
    folder,
    status: join(folder, "status.json"),
    uv: uvExecutable(folder),
    python: join(folder, "environment", windows ? "Scripts/python.exe" : "bin/python"),
    env: {
      ...process.env,
      UV_CACHE_DIR: join(folder, "uv-cache"),
      UV_PYTHON_INSTALL_DIR: join(folder, "pythons"),
      UV_PROJECT_ENVIRONMENT: join(folder, "environment"),
      HF_HOME: join(folder, "models"),
      HF_HUB_DISABLE_TELEMETRY: "1",
    },
  };
};

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

// How much has come down so far: everything but the environment, which is made
// from the downloads rather than downloaded itself. Counting walks many files, so a
// count serves every look for a few seconds.
const counted = new Map();
function downloadedSize(folder) {
  const last = counted.get(folder);
  if (last && Date.now() - last.at < 3000) return last.total;
  let total = 0;
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory() && path === join(folder, "environment")) continue;
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) total += statSync(path).size;
    }
  };
  try {
    visit(folder);
  } catch {
    /* A file vanished mid-count; the next look counts again. */
  }
  counted.set(folder, { at: Date.now(), total });
  return total;
}

/**
 * Where Docling stands: absent, installing (with its step and how much has come
 * down), ready, or failed with the reason.
 * @returns {{state: "absent" | "installing" | "ready" | "failed", step?: string, downloaded?: number, error?: string}}
 */
export function doclingStatus(home) {
  const p = paths(home);
  let status;
  try {
    status = JSON.parse(readFileSync(p.status, "utf8"));
  } catch {
    return { state: "absent" };
  }
  if (status.state === "installing") {
    // An install whose process has gone, with the computer restarted or the process killed.
    if (!alive(status.pid)) return { state: "failed", error: "The install stopped before it finished." };
    return { state: "installing", step: status.step, downloaded: downloadedSize(p.folder) };
  }
  if (status.state === "ready" && !existsSync(p.python)) return { state: "absent" };
  return status;
}

// Starts the install as its own process, so it carries on if the app closes.
export function startDoclingInstall(home) {
  if (doclingStatus(home).state === "installing") return;
  const p = paths(home);
  mkdirSync(p.folder, { recursive: true });
  const child = spawn(process.execPath, [join(root, "scripts/setup-docling.mjs")], {
    env: { ...process.env, RESEARCH_HOME: home },
    detached: true,
    stdio: "ignore",
  });
  writeFileSync(p.status, JSON.stringify({ state: "installing", step: "Starting", pid: child.pid }));
  child.unref();
}

export async function removeDocling(home) {
  if (doclingStatus(home).state === "installing") throw new Error("Wait for the install to finish, or for it to fail, before removing it.");
  await rm(doclingFolder(home), { recursive: true, force: true });
}

// The install itself, run by scripts/setup-docling.mjs. It records each step as it goes.
export async function installDocling(home, { log = () => {} } = {}) {
  const p = paths(home);
  mkdirSync(p.folder, { recursive: true });
  const step = (name) => {
    log(name);
    writeFileSync(p.status, JSON.stringify({ state: "installing", step: name, pid: process.pid }));
  };
  const run = (command, args) => {
    const result = spawnSync(command, args, { cwd: root, env: p.env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error((result.stderr || result.stdout || "").trim().split("\n").slice(-3).join(" ") || `${command} failed.`);
    return result.stdout;
  };
  try {
    if (!existsSync(p.uv)) {
      step("Downloading uv");
      await downloadUv(p.folder, { unavailable: `High accuracy reading isn't available for ${process.platform} on ${process.arch}.` });
    }
    step("Downloading Python and Docling");
    // Always uv's own Python, so every computer gets the same one.
    run(p.uv, ["sync", "--locked", "--managed-python", "--python", "3.12"]);
    step("Downloading Docling's reading models");
    const sample = join(p.folder, "check.pdf");
    writeFileSync(sample, fictionalPdf([{ text: ["Fictional Harbor Archive", "Example Trading Company was founded in 1842."] }, { scan: ["FICTIONAL SCANNED RECORD", "Example Mill opened in 1882."] }]));
    const pages = await readWithDocling(home, sample, join(p.folder, "check"));
    rmSync(sample);
    rmSync(join(p.folder, "check"), { recursive: true, force: true });
    if (!/Example Mill opened in 1882/i.test(pages.map((page) => page.text).join("\n"))) throw new Error("Docling installed, but it could not read a test page.");
    // The download cache is only for installing; the environment keeps its own copies.
    rmSync(p.env.UV_CACHE_DIR, { recursive: true, force: true });
    writeFileSync(p.status, JSON.stringify({ state: "ready" }));
    log("Docling is ready.");
  } catch (error) {
    writeFileSync(p.status, JSON.stringify({ state: "failed", error: error.message }));
    throw error;
  }
}

/**
 * Reads a PDF with Docling, keeping its full conversion in the output folder, and
 * returns each page's text.
 * @returns {Promise<{number: number, text: string}[]>}
 */
export function readWithDocling(home, file, output, { signal } = {}) {
  const p = paths(home);
  return new Promise((resolve, reject) => {
    const child = spawn(p.python, [join(root, "scripts/convert_pdf.py"), file, "--output-root", output, "--low-memory"], {
      cwd: root,
      env: p.env,
      stdio: ["ignore", "pipe", "pipe"],
      signal,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr = (stderr + chunk).slice(-4000)));
    child.on("error", reject);
    child.on("exit", (code) => {
      // A partial conversion exits 2 and still has the pages it could read.
      if (code !== 0 && code !== 2) return reject(new Error(stderr.trim().split("\n").at(-1) || `Docling exited with ${code}.`));
      try {
        const manifest = JSON.parse(stdout.slice(stdout.lastIndexOf("\n{") + 1));
        resolve(JSON.parse(readFileSync(join(manifest.directory, manifest.pages), "utf8")));
      } catch (error) {
        reject(error);
      }
    });
  });
}
