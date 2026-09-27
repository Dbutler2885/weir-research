// Runs the Docling conversion checks with the installed High accuracy reader.
// Install it first, from Research settings or with `npm run setup:pdf`.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { doclingFolder } from "../server/pdf/docling.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const folder = doclingFolder(resolve(process.env.RESEARCH_HOME || join(root, ".research")));
const python = join(folder, "environment", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
if (!existsSync(python)) {
  console.error("Install High accuracy PDF reading first: npm run setup:pdf");
  process.exit(1);
}
const result = spawnSync(python, ["-m", "unittest", "discover", "-s", "tests/python", "-v"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, HF_HOME: join(folder, "models"), HF_HUB_DISABLE_TELEMETRY: "1" },
});
process.exit(result.status ?? 1);
