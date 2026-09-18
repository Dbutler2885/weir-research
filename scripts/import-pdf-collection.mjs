import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const arguments_ = process.argv.slice(2);
const nativeOnly = arguments_.includes("--native-only");
const [projectId, collectionArgument] = arguments_.filter(
  (argument) => argument !== "--native-only",
);
if (!projectId || !collectionArgument) {
  console.error(
    "Usage: node scripts/import-pdf-collection.mjs <project-id> <collection-folder>",
  );
  process.exit(1);
}

const projectDirectory = join(root, ".research", "projects", projectId);
const connectionFile = join(projectDirectory, "connection.json");
const python = join(root, ".venv", "bin", "python");
const converter = join(root, "scripts", "convert_pdf.py");
const outputRoot = join(projectDirectory, "processed-pdfs");
const collection = resolve(collectionArgument);
if (!existsSync(connectionFile))
  throw new Error(`Open the project first: ${projectId}`);
if (!existsSync(python))
  throw new Error("Install local PDF processing first: npm run setup:pdf");
if (!statSync(collection).isDirectory())
  throw new Error(`Collection folder not found: ${collection}`);

const { url } = JSON.parse(readFileSync(connectionFile, "utf8"));
const stateResponse = await fetch(`${url}/api/state`);
if (!stateResponse.ok) throw new Error(`Workspace unavailable at ${url}`);
const state = await stateResponse.json();
const imported = new Set(
  state.documents
    .filter((document) => document.text !== undefined)
    .map((document) => document.sha256),
);
const converted = new Map();
if (existsSync(outputRoot))
  for (const entry of readdirSync(outputRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = join(outputRoot, entry.name);
    const manifestPath = join(directory, "manifest.json");
    if (!existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (
        manifest.status === "done" &&
        manifest.sha256 &&
        manifest.markdown &&
        existsSync(join(directory, manifest.markdown))
      )
        converted.set(manifest.sha256, { ...manifest, directory });
    } catch {
      // An interrupted conversion remains available for diagnosis and is retried.
    }
  }

function walk(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(path));
    else if (entry.isFile() && extname(entry.name).toLowerCase() === ".pdf")
      files.push(path);
  }
  return files;
}

function digest(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function convert(path) {
  return new Promise((resolveConversion, rejectConversion) => {
    const child = spawn(
      python,
      [converter, path, "--output-root", outputRoot, "--low-memory"],
      {
        cwd: root,
        env: {
          ...process.env,
          HF_HOME: join(root, ".research", "cache", "huggingface"),
          HF_HUB_DISABLE_TELEMETRY: "1",
        },
        stdio: ["ignore", "pipe", "inherit"],
      },
    );
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.on("error", rejectConversion);
    child.on("exit", (code) => {
      if (code !== 0)
        return rejectConversion(
          new Error(`${basename(path)} conversion exited with ${code}`),
        );
      try {
        const trimmed = stdout.trim();
        const jsonStart = trimmed.lastIndexOf("\n{");
        resolveConversion(JSON.parse(jsonStart >= 0 ? trimmed.slice(jsonStart + 1) : trimmed));
      } catch (error) {
        rejectConversion(error);
      }
    });
  });
}

function extractNativeText(path) {
  return new Promise((resolveExtraction, rejectExtraction) => {
    const child = spawn("pdftotext", [path, "-"], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", rejectExtraction);
    child.on("exit", (code) => {
      if (code !== 0)
        return rejectExtraction(
          new Error(stderr.trim() || `${basename(path)} extraction exited with ${code}`),
        );
      if (stdout.trim().length < 200)
        return rejectExtraction(new Error("No substantial embedded text; OCR required"));
      resolveExtraction({
        text: stdout,
        manifest: {
          processor: { name: "pdftotext", version: "26.02.0" },
          status: "native-text",
        },
      });
    });
  });
}

const files = walk(collection).sort();
let completed = 0;
let skipped = 0;
const failures = [];
console.log(`Found ${files.length} PDFs under ${collection}`);
for (const [index, path] of files.entries()) {
  const sha256 = digest(path);
  if (imported.has(sha256)) {
    skipped++;
    console.log(`[${index + 1}/${files.length}] already imported: ${relative(collection, path)}`);
    continue;
  }
  console.log(`[${index + 1}/${files.length}] converting: ${relative(collection, path)}`);
  try {
    const extraction = nativeOnly
      ? await extractNativeText(path)
      : await Promise.resolve(converted.get(sha256) || convert(path)).then((manifest) => ({
          manifest,
          text: readFileSync(join(manifest.directory, manifest.markdown), "utf8"),
        }));
    const { manifest, text } = extraction;
    const response = await fetch(`${url}/api/import-processed-pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path,
        collectionPath: collection,
        text,
        extraction: {
          processor: `${manifest.processor.name} ${manifest.processor.version}`,
          status: manifest.status,
          totalPages: manifest.totalPages,
          processedPages: manifest.processedPages,
          ...(manifest.directory
            ? { bundle: relative(projectDirectory, manifest.directory) }
            : {}),
        },
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Import failed (${response.status})`);
    imported.add(sha256);
    completed++;
    console.log(`  imported ${result.documentId}`);
  } catch (error) {
    failures.push({ path, error: error.message });
    console.error(`  failed: ${error.message}`);
  }
}

console.log(
  JSON.stringify(
    { found: files.length, completed, skipped, failures },
    null,
    2,
  ),
);
process.exitCode = failures.length ? 2 : 0;
