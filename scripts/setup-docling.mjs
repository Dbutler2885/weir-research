import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const tooling = join(root, ".python-tools");
const windows = process.platform === "win32";
const executableDir = windows ? "Scripts" : "bin";
const python = join(tooling, executableDir, windows ? "python.exe" : "python");
const env = {
  ...process.env,
  UV_CACHE_DIR: join(tooling, "cache"),
  UV_PYTHON_INSTALL_DIR: join(tooling, "pythons"),
};
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} exited with ${result.status ?? result.signal}`);
}
try {
  if (!existsSync(python)) {
    const candidates = windows
      ? [
          ["py", ["-3"]],
          ["python", []],
          ["python3", []],
        ]
      : [
          ["python3", []],
          ["python", []],
        ];
    const installed = candidates.find(
      ([command, args]) =>
        spawnSync(
          command,
          [...args, "-c", "import sys; assert sys.version_info.major == 3"],
          {
            stdio: "ignore",
          },
        ).status === 0,
    );
    if (!installed)
      throw new Error("Install Python 3, then rerun npm run setup:pdf.");
    run(installed[0], [...installed[1], "-m", "venv", tooling]);
  }
  run(python, ["-m", "pip", "install", "uv==0.10.0"]);
  run(join(tooling, executableDir, windows ? "uv.exe" : "uv"), [
    "sync",
    "--locked",
    "--python",
    "3.12",
  ]);
  console.log(
    "Docling is installed in .venv. Run npm run pdf -- /path/to/document.pdf",
  );
} catch (error) {
  console.error(`Docling setup failed: ${error.message}`);
  process.exitCode = 1;
}
