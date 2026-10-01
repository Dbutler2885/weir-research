import { createServer } from "node:http";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  realpathSync,
  readdirSync,
  statSync,
  openSync,
  closeSync,
  unlinkSync,
  renameSync,
} from "node:fs";
import { tmpdir } from "node:os";
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
import { agentCatalog } from "./agents/catalog.mjs";
import { DispatchRules } from "./dispatch.mjs";
import { Helpers } from "./helpers.mjs";
import { ResearchBrowser } from "./research-browser.mjs";
import { setupRoutes } from "./setup-routes.mjs";
import { codeStamp, startLauncher } from "./start-launcher.mjs";
import { validateChoice } from "../src/domain/dispatch.ts";
import { emptyGraph } from "../src/domain/graph-schema.ts";
import { LiveActivity } from "./live-activity.mjs";
import { projectSkills } from "./skills.mjs";
import { flowCommand } from "./review-flow.mjs";
import { humanConversationCommands } from "../src/domain/conversation.ts";
import { PdfReading, choosePdfReader, pdfReading } from "./pdf/reading.mjs";
import { removeDocling } from "./pdf/docling.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directory = resolve(
  process.env.RESEARCH_STATE_DIR || join(root, ".research"),
);
let port = Number(process.env.RESEARCH_PORT || 4318);
// When the code this service runs last changed, so opening a project after an update
// replaces a service still running the old code.
const stamp = codeStamp();
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
// Closing stops the app's agents, except workers the human chose to keep running;
// their stop reaches the hosts before the app exits.
let closing = false;
function close() {
  if (closing) return;
  closing = true;
  for (const stop of [() => coordinatorHost.stop(), () => helpers.stop(), () => researchers.stop(), () => graphBuilders.stop(), () => writers.stop(), () => pdfs.stop()])
    try {
      stop();
    } catch {
      /* Closing carries on. */
    }
  setTimeout(() => process.exit(0), 300);
}
process.on("SIGTERM", close);
process.on("SIGINT", close);
const store = new WorkspaceStore(directory, emptyGraph());
const live = new LiveActivity();
const coordinator = new Coordinator(store, { workers: () => live.list(), skills: projectSkills(root) });
// One supervisor launches and reads every agent the app runs.
// Codex agents share the app's own homes, beside the projects.
const appDirectory = resolve(process.env.RESEARCH_HOME || join(root, ".research"));
// Each agent runs under its own host process, recorded beside the projects, so a
// worker the human keeps running outlives the app and is taken back when it opens.
const supervisor = new AgentSupervisor({
  live,
  homes: agentHomes(appDirectory),
  hosts: { registry: join(appDirectory, "agent-hosts"), sockets: join(tmpdir(), `research-agents-${process.getuid?.() ?? "user"}`) },
});
// One research browser for the app, with its own profile, shared by every project.
const researchBrowser = new ResearchBrowser(appDirectory, { root });
// Settings for the whole app rather than one project: developer mode, which shows
// the tools for recording feedback about Weir itself, and whether the human has
// seen the introduction to annotating.
const appSettingsFile = join(appDirectory, "app-settings.json");
const draftFile = join(directory, "draft.json");
const appSettings = () => {
  try {
    return JSON.parse(readFileSync(appSettingsFile, "utf8"));
  } catch {
    return {};
  }
};
const setupScreen = setupRoutes({ home: appDirectory, homes: agentHomes(appDirectory), next: { label: "Back to your project", href: "/" } });
const researchers = new ResearcherPool(store, directory, root, { coordinator, live, supervisor, browser: researchBrowser });
coordinator.researchers = researchers;
const graphBuilders = new GraphBuilders(store, directory, root, { live, supervisor });
const writers = new WalkthroughWriters(store, directory, root, { live, supervisor });
coordinator.writers = writers;
// What the installed agent CLIs offer, and the project's rules for which does each job.
const catalog = await agentCatalog({ findExecutable: researchers.findExecutable });
const dispatch = new DispatchRules(store, catalog);
dispatch.ensure();
coordinator.dispatch = dispatch;
process.on("exit", () => writers.stop());
process.on("exit", () => graphBuilders.stop());
process.on("exit", () => researchers.stop());
// A coordinator command, from the app's coordinator or one attached from outside.
function coordinatorCommand(data) {
  // An agent, model or effort named for one assignment must be one the installed CLIs offer.
  if (["assign", "assign-graph", "assign-walkthrough", "ask-helper"].includes(data.action) && data.engine && data.engine !== "manual")
    validateChoice({ agent: data.engine, model: data.model ?? null, effort: data.effort ?? null }, catalog, "The named agent");
  const result = coordinator.command(data);
  researchers.pump();
  graphBuilders.pump();
  writers.pump();
  return result;
}
// The app starts a fresh coordinator every time it opens the project.
const coordinatorHost = new CoordinatorHost({ store, coordinator, supervisor, directory, root, dispatch, handle: coordinatorCommand });
const helpers = new Helpers(store, directory, { live, supervisor, dispatch, answer: (text) => coordinatorHost.tell(text) });
coordinator.helpers = helpers;
process.on("exit", () => helpers.stop());
// For the context evaluation, the coordinator's folder is prepared for an agent it runs itself.
if (process.env.RESEARCH_COORDINATOR_AGENT === "prepare") {
  const prompt = coordinatorHost.prepare();
  writeFileSync(join(directory, "coordinator", "prepared.json"), JSON.stringify({ folder: coordinatorHost.folder, prompt }));
} else if (process.env.RESEARCH_COORDINATOR_AGENT !== "0") {
  // Reopening a project spends nothing: the coordinator starts when the human first
  // writes to it, annotates, or decides something. A new project's topic is the
  // human's first word, so it starts at once; the sample waits for its visitor.
  if (existsSync(join(directory, "coordinator")) || store.state.sample) coordinator.waiting = true;
  else coordinatorHost.start();
}
// Starts the coordinator on the human's first message, annotation or decision.
function startWaitingCoordinator() {
  if (!coordinator.waiting) return;
  coordinator.waiting = false;
  coordinatorHost.start();
}
process.on("exit", () => coordinatorHost.stop());
const token = randomBytes(32).toString("hex");
const coordinatorToken = randomBytes(32).toString("hex");
const documentsDir = join(directory, "documents");
mkdirSync(documentsDir, { recursive: true });
// Every PDF is read into searchable text in the background.
const pdfs = new PdfReading(store, { home: appDirectory, directory });
process.on("exit", () => pdfs.stop());
pdfs.pump();
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
  "queue-move",
  "queue-hold",
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
function importDocument(next, name, bytes, collectionId, { maxBytes = 10_000_000 } = {}) {
  const mime = types[extname(name).toLowerCase()];
  if (!mime) throw new Error("Supported formats: PDF, TXT, Markdown, CSV.");
  if (bytes.length > maxBytes)
    throw new Error(`${name} exceeds the ${Math.floor(maxBytes / 1_000_000)} MB limit.`);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const existing = next.documents.find(
    (d) => d.sha256 === sha256 && d.collectionId === collectionId,
  );
  if (existing) return existing;
  const id = crypto.randomUUID();
  writeFileSync(join(documentsDir, id), bytes, { mode: 0o600 });
  const doc = {
    id,
    collectionId,
    name: basename(name),
    mime,
    size: bytes.length,
    sha256,
    importedAt: new Date().toISOString(),
    // Text documents are searchable as they are; PDFs wait to be read.
    ...(mime === "text/plain" ? { text: bytes.toString("utf8") } : { reading: { state: "waiting" } }),
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
    // The setup screen, to come back to from Research settings.
    const handled = await setupScreen(req, url, {
      json: (value) => json(res, 200, value),
      html: (text) => {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        res.end(text);
      },
      body: () => body(req),
      redirect: (location) => {
        res.writeHead(302, { Location: location });
        res.end();
      },
    });
    if (handled !== false) return;
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
    // The installed CLIs' models, read again so one released since the app started shows.
    if (req.method === "POST" && url.pathname === "/api/catalog") {
      Object.assign(catalog, await agentCatalog({ findExecutable: researchers.findExecutable }));
      return json(res, 200, catalog);
    }
    if (req.method === "GET" && url.pathname === "/api/project")
      return json(res, 200, { directory, protocol: 2, stamp });
    // What the human is writing to the coordinator and has not sent, kept with the
    // project so it comes back whatever address the app opens at.
    if (req.method === "GET" && url.pathname === "/api/draft") {
      try {
        return json(res, 200, JSON.parse(readFileSync(draftFile, "utf8")));
      } catch {
        return json(res, 200, null);
      }
    }
    if (req.method === "POST" && url.pathname === "/api/draft") {
      const draft = await body(req);
      if (!draft || typeof draft !== "object" || JSON.stringify(draft).length > 200_000)
        return json(res, 400, { error: "A draft is an object of up to 200,000 characters." });
      writeFileSync(`${draftFile}.tmp`, JSON.stringify(draft), { mode: 0o600 });
      renameSync(`${draftFile}.tmp`, draftFile);
      return json(res, 200, { saved: true });
    }
    if (req.method === "GET" && url.pathname === "/api/state")
      return json(res, 200, {
        ...store.publicState(),
        coordinator: coordinator.status(),
        live: live.list(),
        catalog,
        usage: supervisor.usage,
        researchBrowser: { available: researchBrowser.available, name: researchBrowser.browser.name },
        developerMode: Boolean(appSettings().developerMode),
        annotationIntroSeen: Boolean(appSettings().annotationIntroSeen),
        pdfReading: pdfReading(appDirectory),
      });
    if (req.method === "GET" && url.pathname === "/api/revision")
      return json(res, 200, {
        revision: store.state.revision,
        datasetRevision: store.state.datasetRevision,
        coordinator: coordinator.status(),
        live: live.list(),
        usage: supervisor.usage,
        // Installing Docling changes nothing in the project, so its progress comes with every poll.
        pdfReading: pdfReading(appDirectory),
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
      startWaitingCoordinator();
      graphBuilders.pump();
      return json(res, 200, result);
    }
    if (req.method === "POST" && url.pathname === "/api/organization") {
      const result = organize(store, await body(req));
      startWaitingCoordinator();
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
      if (!isWorker) startWaitingCoordinator();
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
    if (req.method === "POST" && url.pathname === "/api/app-settings") {
      const changes = Object.fromEntries(Object.entries(await body(req)).filter(([key]) => ["developerMode", "annotationIntroSeen"].includes(key)));
      if (!Object.keys(changes).length || Object.values(changes).some((v) => typeof v !== "boolean"))
        return json(res, 400, { error: "Say which app setting is on or off." });
      mkdirSync(appDirectory, { recursive: true });
      const next = { ...appSettings(), ...changes };
      writeFileSync(appSettingsFile, JSON.stringify(next, null, 2), { mode: 0o600 });
      return json(res, 200, next);
    }
    if (req.method === "POST" && url.pathname === "/api/research-settings") {
      return json(res, 200, researchers.configure(await body(req)));
    }
    // Closing the project: workers are kept running or stopped, as the human chose.
    // Closed from the browser, the launcher takes over with the welcome page.
    if (req.method === "POST" && url.pathname === "/api/quit") {
      const { keep, welcome } = await body(req);
      const kept = keep ? supervisor.hosted((r) => r.meta?.project === directory && ["researcher", "builder", "writer"].includes(r.meta?.role) && !r.ended).length : 0;
      if (keep) supervisor.keep((r) => r.meta?.project === directory && ["researcher", "builder", "writer"].includes(r.meta?.role));
      const next = welcome ? await startLauncher().then((address) => `${address}/welcome`, () => null) : null;
      json(res, 200, { closing: true, kept, next });
      setTimeout(close, 100);
      return;
    }
    // The human compacts the coordinator's context now, or starts a fresh one when it is idle.
    if (req.method === "POST" && url.pathname === "/api/coordinator/compact") {
      coordinatorHost.compact();
      return json(res, 200, { compacting: true });
    }
    if (req.method === "POST" && url.pathname === "/api/coordinator/fresh")
      return json(res, 200, { started: coordinatorHost.startFresh() });
    // The human opens the research browser to sign in to archives once.
    if (req.method === "POST" && url.pathname === "/api/research-browser") {
      await researchBrowser.show((await body(req)).url ?? null);
      return json(res, 200, { open: true });
    }
    if (req.method === "POST" && url.pathname === "/api/dispatch")
      return json(res, 200, { dispatch: dispatch.change(await body(req), "human") });
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
      pdfs.pump();
      return json(res, 200, { documentId: result.id });
    }
    // Which reader reads PDFs, for every project; choosing High accuracy installs it.
    if (req.method === "POST" && url.pathname === "/api/pdf-reading") {
      const data = await body(req);
      if (data.reader) choosePdfReader(appDirectory, data.reader);
      if (data.remove) await removeDocling(appDirectory);
      if (data.readAgain) pdfs.readAgain(data.readAgain, data.engine);
      pdfs.pump();
      return json(res, 200, pdfReading(appDirectory));
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
      pdfs.pump();
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
