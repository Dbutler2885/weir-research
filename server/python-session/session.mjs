// A researcher's Python session: a long-running Python process the app starts, owns
// and keeps, separate from the agent's own process, confined by a macOS sandbox
// profile to reading the library and its own Python, and writing its seat's folder.
// Its variables are saved after every completed run and loaded by the next process,
// so they outlive the process, the agent and the app.
import { spawn, spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { downloadUv } from "../uv.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const KERNEL = join(here, "kernel.py");
const PYTHON_VERSION = "3.12";
const SANDBOX = "/usr/bin/sandbox-exec";

export const sessionToolsFolder = (home) => join(home, "tools", "python-session");

// The session's own small Python environment: uv's Python with the pinned packages in
// requirements.txt. One install serves every session; concurrent callers share it.
const installs = new Map();
export function pythonEnvironment(home) {
  const folder = sessionToolsFolder(home);
  const python = join(folder, "environment", "bin", "python");
  if (existsSync(join(folder, "ready")) && existsSync(python)) return Promise.resolve({ folder: realpathSync(folder), python });
  if (!installs.has(folder))
    installs.set(
      folder,
      (async () => {
        mkdirSync(folder, { recursive: true });
        const uv = await downloadUv(folder, { unavailable: `Python sessions aren't available for ${process.platform} on ${process.arch}.` });
        const env = { ...process.env, UV_CACHE_DIR: join(folder, "uv-cache"), UV_PYTHON_INSTALL_DIR: join(folder, "pythons") };
        const run = (args) => {
          const result = spawnSync(uv, args, { env, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
          if (result.error) throw result.error;
          if (result.status !== 0) throw new Error(`Setting up Python sessions failed: ${(result.stderr || result.stdout || "").trim().split("\n").at(-1)}`);
        };
        // Always uv's own Python, so every computer gets the same one.
        run(["venv", "--managed-python", "--python", PYTHON_VERSION, "--allow-existing", join(folder, "environment")]);
        run(["pip", "install", "--python", python, "--require-hashes", "-r", join(here, "requirements.txt")]);
        spawnSync("rm", ["-rf", env.UV_CACHE_DIR]);
        spawnSync("touch", [join(folder, "ready")]);
        return { folder: realpathSync(folder), python };
      })().finally(() => installs.delete(folder)),
    );
  return installs.get(folder);
}

const literal = (path) => JSON.stringify(path);

// The sandbox profile: nothing is allowed but what is named. The session reads its
// Python, the session package, the library and its seat's folder, writes its seat's
// folder, and reaches nothing else: no other files, no network, no other programs.
export function sandboxProfile({ python, library, folder }) {
  const reads = [python, here, folder, ...(library ? [library] : [])].map((path) => `(subpath ${literal(realpathSync(path))})`);
  return `(version 1)
(deny default)
(allow process-fork)
(allow process-exec (subpath ${literal(realpathSync(python))}))
(allow sysctl-read)
(allow file-read-metadata)
(allow file-read* (literal "/") (subpath "/usr/lib") (subpath "/System") (subpath "/private/var/db/dyld") (literal "/dev/urandom") (literal "/dev/random") (literal "/dev/null") ${reads.join(" ")})
(allow file-write* (subpath ${literal(realpathSync(folder))}) (literal "/dev/null"))
`;
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
};
// Ends the kernel that last owned this state, if it is still running.
async function retire(state) {
  let pid;
  try {
    pid = JSON.parse(readFileSync(join(state, "owner.json"), "utf8")).pid;
  } catch {
    return;
  }
  if (!Number.isSafeInteger(pid) || !alive(pid)) return;
  // Only a session kernel: the number may have passed to another program since.
  const command = spawnSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" }).stdout || "";
  if (!command.includes(KERNEL)) return;
  process.kill(pid, "SIGKILL");
  for (let tries = 0; tries < 100 && alive(pid); tries++) await new Promise((resolve) => setTimeout(resolve, 20));
}

export const sandboxAvailable = () => process.platform === "darwin" && existsSync(SANDBOX);

export class PythonSession extends EventEmitter {
  // folder: the seat's folder, which outlasts its researchers' leases and agents; the
  // session keeps its variables in session/ there, and can read and write the folder.
  // library: the research library, read-only. home: the app's folder, for the environment.
  /** @param {{folder: string, library?: string | null, home: string, outputLimit?: number, launch?: typeof spawn}} options */
  constructor({ folder, library = null, home, outputLimit = 20_000, launch = spawn }) {
    super();
    this.folder = folder;
    this.state = join(folder, "session");
    this.library = library;
    this.home = home;
    this.outputLimit = outputLimit;
    this.launch = launch;
    /** @type {import("node:child_process").ChildProcess | null} */
    this.process = null;
    /** @type {Promise<{interrupted: string | null, problem: string | null, variables: string[]}> | null} */
    this.ready = null;
    this.waiting = new Map();
    this.queue = Promise.resolve();
    this.next = 0;
    this.ended = false;
    // Runs whose caller already heard they were cut short, so a new process does not
    // report them again.
    this.told = new Set();
  }
  // Starts the process if it is not running, and resolves once it has loaded the
  // variables, with what it found: a run interrupted before, or a problem loading.
  start() {
    if (this.ended) return Promise.reject(new Error("This Python session has ended."));
    // A process that was killed is gone even before its exit is reported.
    if (this.ready && !this.process?.killed) return this.ready;
    this.ready = (async () => {
      if (!sandboxAvailable()) throw new Error("Python sessions need the macOS sandbox, which this computer does not have, so the session will not start unconfined.");
      const environment = await pythonEnvironment(this.home);
      mkdirSync(join(this.state, "tmp"), { recursive: true });
      // One process owns the session's state: one left from before, say by an app that
      // crashed mid-run, is ended first, so it cannot save over its replacement's work.
      await retire(this.state);
      const owner = randomUUID();
      const profile = sandboxProfile({ python: environment.folder, library: this.library, folder: this.folder });
      const child = this.launch(SANDBOX, ["-p", profile, environment.python, "-u", KERNEL, realpathSync(this.state)], {
        cwd: this.folder,
        // Only what the session needs: none of the app's environment, which can hold keys.
        env: {
          PYTHONPATH: here,
          PYTHONDONTWRITEBYTECODE: "1",
          PYTHONIOENCODING: "utf-8",
          HOME: realpathSync(this.state),
          TMPDIR: realpathSync(join(this.state, "tmp")),
          WEIR_LIBRARY: this.library ? realpathSync(this.library) : "",
          WEIR_OUTPUT_LIMIT: String(this.outputLimit),
          WEIR_OWNER: owner,
        },
        stdio: ["pipe", "ignore", "pipe", "pipe"],
      });
      this.process = child;
      // A process that died between runs refuses what is written to it; its exit says why.
      child.stdin.on("error", () => {});
      let errors = "";
      child.stderr.on("data", (chunk) => (errors = (errors + chunk).slice(-4000)));
      let buffer = "";
      let opened;
      const opening = new Promise((resolve, reject) => (opened = { resolve, reject }));
      child.stdio[3].on("data", (chunk) => {
        buffer += chunk;
        for (let at = buffer.indexOf("\n"); at >= 0; at = buffer.indexOf("\n")) {
          const line = buffer.slice(0, at);
          buffer = buffer.slice(at + 1);
          if (!line.trim()) continue;
          const message = JSON.parse(line);
          if (message.ready) opened.resolve(message);
          else {
            this.waiting.get(message.id)?.resolve({ output: message.output, failed: message.failed, seconds: message.seconds });
            this.waiting.delete(message.id);
          }
        }
      });
      child.on("error", (error) => opened.reject(error));
      child.on("exit", (code, signal) => {
        if (this.process === child) {
          this.process = null;
          this.ready = null;
        }
        const reason = this.ended ? "The Python session was stopped" : `The Python session ended unexpectedly${signal ? ` (${signal})` : code ? ` (exit ${code})` : ""}${errors.trim() ? `: ${errors.trim().split("\n").at(-1)}` : ""}`;
        opened.reject(new Error(reason));
        for (const [id, waiter] of this.waiting) {
          this.told.add(id);
          waiter.reject(new Error(`${reason} during this run. Your variables are as they were after the run before it.`));
        }
        this.waiting.clear();
      });
      const found = await opening;
      return { interrupted: this.told.has(found.interrupted) ? null : found.interrupted, problem: found.problem, variables: found.variables };
    })();
    this.ready.catch(() => (this.ready = null));
    return this.ready;
  }
  // Runs code after any run before it, and resolves with what it printed. The run's
  // ID, the caller's or one made here, is what the session's calls to the app carry.
  run(code, { id = `run-${Date.now()}-${++this.next}` } = {}) {
    const result = this.queue.then(async () => {
      await this.start();
      const done = new Promise((resolve, reject) => this.waiting.set(id, { resolve, reject }));
      this.process.stdin.write(`${JSON.stringify({ id, code })}\n`);
      return done;
    });
    this.queue = result.catch(() => {});
    return result;
  }
  get busy() {
    return this.waiting.size > 0;
  }
  // Ends the process; the saved variables stay for a later session.
  stop() {
    this.ended = true;
    this.process?.kill("SIGKILL");
  }
}
