import { createServer } from "node:http";
import {
  readFileSync,
  writeFileSync,
  linkSync,
  existsSync,
  mkdirSync,
  realpathSync,
  readdirSync,
  statSync,
  openSync,
  closeSync,
  unlinkSync,
} from "node:fs";
import { join, resolve, extname, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, createHash } from "node:crypto";
import { WorkspaceStore } from "./store.mjs";
import { organize } from "./organization.mjs";
import { Coordinator } from "./coordinator.mjs";
import { ResearcherPool } from "./researchers.mjs";
import { GraphBuilders } from "./graph-builders.mjs";
import { WalkthroughWriters } from "./walkthrough-writers.mjs";
import { CoordinatorHost } from "./coordinator-host.mjs";
import { AgentSupervisor } from "./agents/supervisor.mjs";
import { agentHomes } from "./agents/isolation.mjs";
import { LiveActivity } from "./live-activity.mjs";
import { projectSkills } from "./skills.mjs";
import { flowCommand } from "./review-flow.mjs";
import { humanConversationCommands } from "../src/domain/conversation.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directory = resolve(
  process.env.RESEARCH_STATE_DIR || join(root, ".research"),
);
let port = Number(process.env.RESEARCH_PORT || 4318);
mkdirSync(directory, { recursive: true });
const lock = join(directory, "server.lock");
if (existsSync(lock)) {
  const pid = Number(readFileSync(lock, "utf8"));
  try {
    process.kill(pid, 0);
    throw new Error(`Workspace already has a live writer (PID ${pid}).`);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
    unlinkSync(lock);
  }
}
const lockFd = openSync(lock, "wx", 0o600);
writeFileSync(lockFd, String(process.pid));
closeSync(lockFd);
process.on("exit", () => {
  if (existsSync(lock) && readFileSync(lock, "utf8") === String(process.pid))
    unlinkSync(lock);
});
process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
const store = new WorkspaceStore(
  directory,
  JSON.parse(readFileSync(join(root, "src/data/empty.json"), "utf8")),
);
const live = new LiveActivity();
const coordinator = new Coordinator(store, { workers: () => live.list(), skills: projectSkills(root) });
// One supervisor launches and reads every agent the app runs.
// Codex agents share the app's own homes, beside the projects.
const appDirectory = resolve(process.env.RESEARCH_HOME || join(root, ".research"));
const supervisor = new AgentSupervisor({ live, homes: agentHomes(appDirectory) });
const researchers = new ResearcherPool(store, directory, root, { coordinator, live, supervisor });
coordinator.researchers = researchers;
const graphBuilders = new GraphBuilders(store, directory, root, { live, supervisor });
const writers = new WalkthroughWriters(store, directory, root, { live, supervisor });
coordinator.writers = writers;
process.on("exit", () => writers.stop());
process.on("exit", () => graphBuilders.stop());
process.on("exit", () => researchers.stop());
// A coordinator command, from the app's coordinator or one attached from outside.
function coordinatorCommand(data) {
  if (
    data.action === "assign" &&
    !researchers.findExecutable(data.engine || store.state.engine)
  )
    throw new Error("Requested researcher CLI is not available.");
  if (["claim-graph", "submit-graph-files"].includes(data.action)) {
    coordinator.require(data.session);
    coordinator.noteAction(data);
    return graphBuilders.native(data);
  }
  const result = coordinator.command(data);
  researchers.pump();
  graphBuilders.pump();
  writers.pump();
  return result;
}
// The app starts a fresh coordinator every time it opens the project.
const coordinatorHost = new CoordinatorHost({ store, coordinator, supervisor, directory, root, handle: coordinatorCommand });
// For the context evaluation, the coordinator's folder is prepared for an agent it runs itself.
if (process.env.RESEARCH_COORDINATOR_AGENT === "prepare") {
  const prompt = coordinatorHost.prepare();
  writeFileSync(join(directory, "coordinator", "prepared.json"), JSON.stringify({ folder: coordinatorHost.folder, prompt }));
} else if (process.env.RESEARCH_COORDINATOR_AGENT !== "0") coordinatorHost.start();
process.on("exit", () => coordinatorHost.stop());
const token = randomBytes(32).toString("hex");
const coordinatorToken = randomBytes(32).toString("hex");
const documentsDir = join(directory, "documents");
mkdirSync(documentsDir, { recursive: true });
const workerCommands = new Set(["claim", "checkpoint", "propose"]);
const userCommands = new Set([
  "finding-decision",
  "build-graph",
  "apply-groups",
  "edit-annotation",
  "delete-annotation",
  "interface-feedback",
  "reclassify-annotation",
  "resume-decision",
  "resolve-access",
  "annotate",
  "dispatch",
  "pause",
  "resume",
  "accept",
  "reject",
  ...humanConversationCommands,
]);
const types = {
  ".txt": "text/plain",
  ".md": "text/plain",
  ".csv": "text/plain",
  ".pdf": "application/pdf",
};

function json(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}
async function body(req) {
  if (!req.headers["content-type"]?.startsWith("application/json"))
    throw new Error("Expected application/json.");
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 15_000_000)
      throw new Error("Upload exceeds the 10 MB file limit.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function importDocument(
  next,
  name,
  bytes,
  collectionId,
  { text, extraction, maxBytes = 10_000_000, sourcePath } = {},
) {
  const mime = types[extname(name).toLowerCase()];
  if (!mime) throw new Error("Supported formats: PDF, TXT, Markdown, CSV.");
  if (bytes.length > maxBytes)
    throw new Error(`${name} exceeds the ${Math.floor(maxBytes / 1_000_000)} MB limit.`);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const existing = next.documents.find(
    (d) => d.sha256 === sha256 && d.collectionId === collectionId,
  );
  if (existing) {
    if (typeof text === "string") existing.text = text;
    if (extraction) existing.extraction = extraction;
    return existing;
  }
  const id = crypto.randomUUID();
  if (sourcePath) linkSync(sourcePath, join(documentsDir, id));
  else writeFileSync(join(documentsDir, id), bytes, { mode: 0o600 });
  const doc = {
    id,
    collectionId,
    name: basename(name),
    mime,
    size: bytes.length,
    sha256,
    importedAt: new Date().toISOString(),
    ...(typeof text === "string"
      ? { text }
      : mime === "text/plain"
        ? { text: bytes.toString("utf8") }
        : {}),
    ...(extraction ? { extraction } : {}),
  };
  next.documents.push(doc);
  (next.dataset.sources ||= []).push({
    id,
    title: doc.name,
    repository: "Preserved local document",
    date: doc.importedAt.slice(0, 10),
    note: `SHA-256: ${sha256}`,
  });
  return doc;
}
function scanFolder(path) {
  const found = [];
  const skipped = [];
  let count = 0;
  let total = 0;
  function visit(dir, depth) {
    if (depth > 4) {
      skipped.push(`${dir}: depth limit`);
      return;
    }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (++count > 2000)
        throw new Error(
          "Folder contains too many entries. Choose a smaller research collection.",
        );
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        skipped.push(`${entry.name}: symbolic link`);
        continue;
      }
      if (entry.isDirectory()) visit(full, depth + 1);
      else if (types[extname(entry.name).toLowerCase()]) {
        const size = statSync(full).size;
        if (size > 10_000_000) {
          skipped.push(`${entry.name}: exceeds 10 MB`);
          continue;
        }
        total += size;
        if (found.length >= 100 || total > 50_000_000)
          throw new Error(
            "Choose a smaller folder (up to 100 documents / 50 MB).",
          );
        found.push(full);
      } else skipped.push(`${entry.name}: unsupported format`);
    }
  }
  visit(path, 0);
  return { found, skipped };
}
const server = createServer(async (req, res) => {
  try {
    const host = req.headers.host;
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(host))
      return json(res, 403, { error: "Local workspace host required." });
    if (req.headers.origin && req.headers.origin !== `http://${host}`)
      return json(res, 403, {
        error: "Cross-origin requests are not allowed.",
      });
    if (req.headers["sec-fetch-site"] === "cross-site")
      return json(res, 403, { error: "Open the local workspace directly." });
    res.setHeader("X-Content-Type-Options", "nosniff");
    const url = new URL(req.url, `http://${host}`);
    if (url.pathname === "/api/coordinator" && req.method === "POST") {
      if (req.headers.authorization !== `Bearer ${coordinatorToken}`)
        return json(res, 403, { error: "Coordinator credentials required." });
      const data = await body(req);
      if (data.action === "attach")
        return json(res, 200, coordinator.attach(data.name, data.session));
      return json(res, 200, coordinatorCommand(data) ?? null);
    }
    if (
      req.method === "POST" &&
      req.headers.authorization &&
      (req.headers.authorization !== `Bearer ${token}` ||
        url.pathname !== "/api/commands")
    )
      return json(res, 403, {
        error: "This credential is limited to worker commands.",
      });
    if (req.method === "GET" && url.pathname === "/api/project")
      return json(res, 200, { directory, protocol: 2 });
    if (req.method === "GET" && url.pathname === "/api/state")
      return json(res, 200, {
        ...store.publicState(),
        researcher: researchers.capabilities(),
        coordinator: coordinator.status(),
        live: live.list(),
      });
    if (req.method === "GET" && url.pathname === "/api/revision")
      return json(res, 200, {
        revision: store.state.revision,
        datasetRevision: store.state.datasetRevision,
        coordinator: coordinator.status(),
        live: live.list(),
      });
    if (req.method === "GET" && url.pathname.startsWith("/api/documents/")) {
      const doc = store.state.documents.find(
        (d) => d.id === url.pathname.split("/").pop(),
      );
      if (!doc) return json(res, 404, { error: "Document not found." });
      res.writeHead(200, {
        "Content-Type": doc.mime,
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(doc.name)}`,
        "Content-Security-Policy": "sandbox; default-src 'none'",
        "Cache-Control": "private, max-age=31536000, immutable",
      });
      return res.end(readFileSync(join(documentsDir, doc.id)));
    }
    if (req.method === "POST" && url.pathname === "/api/review-flow") {
      const result = flowCommand(store, await body(req), "human");
      graphBuilders.pump();
      return json(res, 200, result);
    }
    if (req.method === "POST" && url.pathname === "/api/organization") {
      const result = organize(store, await body(req));
      researchers.pump();
      return json(res, 200, result);
    }
    if (req.method === "POST" && url.pathname === "/api/commands") {
      const command = await body(req);
      if (coordinator.enabled && workerCommands.has(command.type))
        return json(res, 409, {
          error:
            "This project uses coordinator supervision. Submit through the coordinator session.",
        });
      const isWorker = req.headers.authorization === `Bearer ${token}`;
      if (workerCommands.has(command.type) && !isWorker)
        return json(res, 403, { error: "Worker credentials required." });
      if (isWorker && !workerCommands.has(command.type))
        return json(res, 403, {
          error: "Workers cannot accept research changes.",
        });
      if (!workerCommands.has(command.type) && !userCommands.has(command.type))
        throw new Error("Unknown command.");
      const result = store.command(command);
      researchers.pump();
      return json(res, 200, { result, revision: store.state.revision });
    }
    if (req.method === "POST" && url.pathname === "/api/review-settings") {
      const data = await body(req);
      if (typeof data.autoWalkthrough !== "boolean" || typeof data.autoGraph !== "boolean")
        throw new Error("Choose on or off for each automatic review.");
      store.update((next) => {
        next.reviewSettings = { autoWalkthrough: data.autoWalkthrough, autoGraph: data.autoGraph };
      });
      return json(res, 200, store.state.reviewSettings);
    }
    if (req.method === "POST" && url.pathname === "/api/research-settings") {
      return json(res, 200, researchers.configure(await body(req)));
    }
    if (req.method === "POST" && url.pathname === "/api/engine") {
      const data = await body(req);
      researchers.choose(data.engine);
      return json(res, 200, researchers.capabilities());
    }
    if (req.method === "POST" && url.pathname === "/api/import") {
      const data = await body(req);
      if (typeof data.name !== "string" || typeof data.content !== "string")
        throw new Error("File name and base64 content required.");
      const result = store.update((next) =>
        importDocument(
          next,
          data.name,
          Buffer.from(data.content, "base64"),
          "imports",
        ),
      );
      return json(res, 200, { documentId: result.id });
    }
    if (req.method === "POST" && url.pathname === "/api/import-processed-pdf") {
      const data = await body(req);
      if (
        typeof data.path !== "string" ||
        typeof data.text !== "string" ||
        !data.path.trim()
      )
        throw new Error("PDF path and extracted text required.");
      const path = realpathSync(data.path);
      if (!statSync(path).isFile() || extname(path).toLowerCase() !== ".pdf")
        throw new Error("Choose a local PDF file.");
      const result = store.update((next) => {
        const collectionPath = realpathSync(data.collectionPath || dirname(path));
        if (!statSync(collectionPath).isDirectory())
          throw new Error("Collection path must be a folder.");
        let collection = next.collections.find((c) => c.path === collectionPath);
        if (!collection) {
          collection = {
            id: crypto.randomUUID(),
            name: basename(collectionPath),
            kind: "folder",
            path: collectionPath,
            description:
              "Preserved PDFs with local Docling text extraction and OCR.",
          };
          next.collections.push(collection);
        }
        return importDocument(
          next,
          path,
          readFileSync(path),
          collection.id,
          {
            text: data.text,
            extraction: data.extraction,
            maxBytes: 100_000_000,
            sourcePath: path,
          },
        );
      });
      return json(res, 200, { documentId: result.id });
    }
    if (req.method === "POST" && url.pathname === "/api/folders") {
      const data = await body(req);
      if (typeof data.path !== "string" || !data.path.trim())
        throw new Error("Choose a local folder path.");
      const path = realpathSync(data.path);
      if (!statSync(path).isDirectory())
        throw new Error("This path is not a folder.");
      const { found, skipped } = scanFolder(path);
      const result = store.update((next) => {
        let collection = next.collections.find((c) => c.path === path);
        if (!collection) {
          collection = {
            id: crypto.randomUUID(),
            name: basename(path),
            kind: "folder",
            path,
            description:
              "Preserved copies taken when this folder is scanned. Re-scan to import new versions.",
          };
          next.collections.push(collection);
        }
        for (const file of found)
          importDocument(next, file, readFileSync(file), collection.id);
        return {
          collectionId: collection.id,
          inspected: found.length,
          skipped,
        };
      });
      return json(res, 200, result);
    }
    if (
      req.method === "GET" &&
      (url.pathname === "/" || url.pathname === "/index.html")
    ) {
      const file = join(root, "dist/index.html");
      if (!existsSync(file))
        return json(res, 503, {
          error: "Build the application with npm run build first.",
        });
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy": "frame-ancestors 'self'",
      });
      return res.end(readFileSync(file));
    }
    json(res, 404, { error: "Not found." });
  } catch (error) {
    json(res, 400, {
      error: error instanceof Error ? error.message : "Request failed.",
    });
  }
});
// The remembered port may have been taken by something else since last time.
server.on("error", (error) => {
  if (error.code !== "EADDRINUSE" || !port) throw error;
  port = 0;
  server.listen(0, "127.0.0.1");
});
server.listen(port, "127.0.0.1", () => {
  port = server.address().port;
  writeFileSync(
    join(directory, "connection.json"),
    JSON.stringify({ url: `http://127.0.0.1:${port}`, token }),
    { mode: 0o600 },
  );
  writeFileSync(
    join(directory, "coordinator-connection.json"),
    JSON.stringify({
      url: `http://127.0.0.1:${port}`,
      token: coordinatorToken,
    }),
    { mode: 0o600 },
  );
  console.log(
    `Research workspace: http://127.0.0.1:${port}\nState: ${directory}\nWaiting investigations are claimed by a connected research agent.`,
  );
});
