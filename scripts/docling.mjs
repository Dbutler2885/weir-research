import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const python =
  process.platform === "win32"
    ? join(root, ".venv", "Scripts", "python.exe")
    : join(root, ".venv", "bin", "python");
if (!existsSync(python)) {
  console.error("Install local PDF processing first: npm run setup:pdf");
  process.exitCode = 1;
} else {
  const args = process.argv.slice(2);
  const test = args[0] === "--test";
  const child = spawn(
    python,
    test
      ? ["-m", "unittest", "discover", "-s", "tests/python", "-v"]
      : [join(root, "scripts", "convert_pdf.py"), ...args],
    {
      cwd: root,
      stdio: "inherit",
      env: {
        ...process.env,
        HF_HOME: join(root, ".research", "cache", "huggingface"),
        HF_HUB_DISABLE_TELEMETRY: "1",
      },
    },
  );
  child.on("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => child.kill(signal));
  }
}
