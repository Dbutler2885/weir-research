import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  statSync,
  openSync,
  closeSync,
  renameSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { initialState } from "../src/domain/research.ts";
export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const home = resolve(
  process.env.RESEARCH_HOME || join(root, ".research"),
);
export function read(file, fallback) {
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : fallback;
}
export function save(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
}
export function projects() {
  const registry = read(join(home, "projects.json"), []);
  const defaults = [];
  if (existsSync(join(home, "workspace.json")))
    defaults.push({
      id: "pike",
      name:
        read(join(home, "workspace.json"), {}).dataset?.title ||
        "Research workspace",
      directory: home,
    });
  if (existsSync(join(home, "example/workspace.json")))
    defaults.push({
      id: "example",
      name: "Workflow example",
      directory: join(home, "example"),
    });
  return [...defaults, ...registry];
}
export function project(id) {
  id ||=
    process.env.RESEARCH_PROJECT ||
    read(join(home, "active-project.json"), {})?.id;
  if (!id && projects().length === 1) id = projects()[0].id;
  const found = projects().find((p) => p.id === id);
  if (!found)
    throw new Error(
      "Select a project from `npm run workspace -- projects`, then use `npm run workspace -- open <id>`.",
    );
  return found;
}
export function createProject(id, name, datasetFile) {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(id) || projects().some((p) => p.id === id))
    throw new Error(
      "Choose a unique project ID using lowercase letters, digits, and hyphens.",
    );
  const dataset = JSON.parse(readFileSync(resolve(datasetFile), "utf8"));
  const state = initialState(dataset);
  const directory = join(home, "projects", id);
  if (existsSync(directory))
    throw new Error(
      "Project directory already exists; existing work was preserved.",
    );
  save(join(directory, "workspace.json"), state);
  const registry = read(join(home, "projects.json"), []);
  registry.push({ id, name, directory });
  save(join(home, "projects.json"), registry);
  return registry.at(-1);
}
export function createTopicProject(topic) {
  if (typeof topic !== "string" || !topic.trim() || topic.length > 300)
    throw new Error("Tell me the research topic (up to 300 characters).");
  const name = topic.trim();
  const base =
    name
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50) || "research";
  let id = base;
  for (
    let number = 2;
    projects().some((p) => p.id === id) ||
    existsSync(join(home, "projects", id));
    number++
  )
    id = `${base}-${number}`;
  const directory = join(home, "projects", id);
  const state = initialState({
    version: 2,
    title: name,
    initialFocusId: null,
    people: [],
    contextEntities: [],
    claims: [],
    evidence: [],
    sources: [],
  });
  save(join(directory, "workspace.json"), state);
  const registry = read(join(home, "projects.json"), []);
  const created = { id, name, directory };
  registry.push(created);
  save(join(home, "projects.json"), registry);
  save(join(home, "active-project.json"), { id });
  return created;
}

function newest(path) {
  if (!existsSync(path)) return 0;
  return statSync(path).isDirectory()
    ? Math.max(0, ...readdirSync(path).map((n) => newest(join(path, n))))
    : statSync(path).mtimeMs;
}
// Stops a project's service, and with it the agents it runs.
export async function stopProject(p) {
  const lock = join(p.directory, "server.lock");
  if (!existsSync(lock)) return { stopped: false };
  const pid = Number(readFileSync(lock, "utf8"));
  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    if (error.code === "ESRCH") return { stopped: false };
    throw error;
  }
  for (let n = 0; n < 100; n++) {
    try {
      process.kill(pid, 0);
    } catch {
      return { stopped: true };
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The project's service did not stop.");
}
export async function openProject(p, { browser = true, build = true } = {}) {
  const artifact = join(root, "dist/index.html");
  if (
    build &&
    (!existsSync(artifact) ||
      newest(join(root, "src")) > statSync(artifact).mtimeMs ||
      newest(join(root, "index.html")) > statSync(artifact).mtimeMs)
  ) {
    const built = spawnSync(
      process.platform === "win32" ? "npm.cmd" : "npm",
      ["run", "build"],
      { cwd: root, stdio: ["ignore", 2, 2] },
    );
    if (built.status !== 0) throw new Error("Workspace build failed.");
  }
  let connection = read(join(p.directory, "connection.json"), null);
  let live = false;
  if (connection) {
    try {
      const r = await fetch(`${connection.url}/api/project`, {
        signal: AbortSignal.timeout(1500),
      });
      const v = await r.json();
      live = r.ok && v.directory === p.directory && v.protocol === 2;
    } catch {
      /* Recover below. */
    }
  }
  if (!live) {
    const lockFile = join(p.directory, "server.lock");
    if (existsSync(lockFile)) {
      const pid = Number(readFileSync(lockFile, "utf8"));
      try {
        process.kill(pid, 0);
        throw new Error(
          `A workspace service is already running (PID ${pid}) but its startup protocol is unavailable. Restart that service before opening this project.`,
        );
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
    mkdirSync(p.directory, { recursive: true });
    const log = openSync(join(p.directory, "server.log"), "a", 0o600);
    const child = spawn(process.execPath, [join(root, "server/main.mjs")], {
      cwd: root,
      detached: true,
      stdio: ["ignore", log, log],
      env: {
        ...process.env,
        RESEARCH_STATE_DIR: p.directory,
        RESEARCH_HOME: home,
        // Reopen on the port this project used last, so an open browser tab survives a restart.
        RESEARCH_PORT: String(Number(connection?.url?.split(":").at(-1)) || 0),
      },
    });
    closeSync(log);
    let launchError;
    child.on("error", (e) => {
      launchError = e;
    });
    child.unref();
    for (let attempt = 0; attempt < 100; attempt++) {
      if (launchError) throw launchError;
      await new Promise((resolve) => setTimeout(resolve, 100));
      connection = read(join(p.directory, "connection.json"), null);
      if (!connection) continue;
      try {
        const r = await fetch(`${connection.url}/api/project`, {
          signal: AbortSignal.timeout(500),
        });
        const v = await r.json();
        if (r.ok && v.directory === p.directory && v.protocol === 2) {
          live = true;
          break;
        }
      } catch {
        /* Wait for the new service. */
      }
    }
    if (!live)
      throw new Error(
        `Workspace did not start. Inspect ${join(p.directory, "server.log")}.`,
      );
  }
  save(join(home, "active-project.json"), { id: p.id });
  if (browser) {
    const program =
      process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
          ? "explorer.exe"
          : "xdg-open";
    const opened = spawnSync(program, [connection.url], { stdio: "ignore" });
    if (opened.error || opened.status !== 0)
      console.error(`Open ${connection.url} in your browser.`);
  }
  return {
    project: p,
    url: connection.url,
    coordinator:
      'Attach the current agent with npm run coordinator -- attach "research coordinator".',
  };
}
