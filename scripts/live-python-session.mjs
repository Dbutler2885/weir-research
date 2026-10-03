// Live check, outside `npm run check`: a real Claude Code and a real Codex researcher,
// each in the app's sandbox for its CLI, use their Python sessions through the command
// tool on a fictional library. It costs a few model calls on the human's sign-ins.
// Each also saves a page from a fictional site on this computer with weir.save, and the
// Claude Code researcher is checked to have web search but no page retrieval.
// The result is read from the seat's saved session, not from what the agent says.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { AgentSupervisor } from "../server/agents/supervisor.mjs";
import { agentHomes } from "../server/agents/isolation.mjs";
import { SessionDesk } from "../server/python-session/desk.mjs";
import { PythonSession } from "../server/python-session/session.mjs";
import { executableOnPath, SESSION_INSTRUCTIONS } from "../server/researchers.mjs";
import { WorkspaceStore } from "../server/store.mjs";
import { emptyGraph } from "../src/domain/graph-schema.ts";
import { ResearchLibrary } from "../server/research-library.mjs";
import { SourceSaver } from "../server/source-saver.mjs";
import { FindingPublisher } from "../server/finding-publisher.mjs";

// The app's own Codex home, where the human signed Codex in, and its tools folder.
const appHome = resolve(process.env.RESEARCH_HOME || ".research");
const supervisor = new AgentSupervisor({ homes: agentHomes(appHome) });
const models = { claude: { model: "haiku", effort: "low" }, codex: { model: "gpt-6-luna", effort: "low" } };
const only = process.argv.slice(2);
let failed = false;
// A fictional site with one page for the researchers to save.
const site = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end("<title>Fictional Harbor Gazette</title><h1>Harbor notes</h1><p>Example Mill was sold to Ben Example in 1901 for 412 pounds.</p>");
});
await new Promise((done) => site.listen(0, "127.0.0.1", done));
const gazette = `http://127.0.0.1:${site.address().port}/gazette`;

for (const provider of only.length ? only : ["claude", "codex"]) {
  const executable = executableOnPath(provider);
  if (!executable) {
    console.log(`${provider}: not installed, skipped.`);
    continue;
  }
  const project = mkdtempSync(join(appHome, "live-session-"));
  const seat = join(project, "agents", "batch-1", "seat-1");
  const folder = join(seat, "lease-1");
  const library = join(project, "library");
  mkdirSync(folder, { recursive: true });
  mkdirSync(join(project, "documents"), { recursive: true });
  // A project whose library holds one fictional three-page document.
  const store = new WorkspaceStore(project, emptyGraph());
  writeFileSync(join(project, "documents", "doc-1"), "%PDF-");
  store.update((next) => {
    next.documents.push({ id: "doc-1", collectionId: "imports", name: "Fictional harbor ledger.pdf", mime: "application/pdf", size: 5, sha256: "x", importedAt: "2026-01-01T00:00:00Z", pages: 3, reading: { state: "done" }, text: "[Page 1]\nExample Mill opened in 1882.\n\n[Page 2]\nThe ledger names Ada Example.\n\n[Page 3]\nAda Example sold the mill in 1901." });
  });
  const files = new ResearchLibrary(store, project);
  const saver = new SourceSaver(store, { directory: project, readPdf: () => Promise.reject(new Error("No PDFs in this check.")), written: () => files.write() });
  // A batch with a team of two, whose researchers can post and publish findings.
  store.update((next) => (next.researchSettings = { timeLimitMinutes: null, researchersPerBatch: 2 }));
  store.command({ type: "open-batch", title: "Who bought the Example mill", goal: "Find who bought the fictional Example mill, and when." });
  const seatId = store.state.investigations[0].assignments[0].id;
  const publisher = new FindingPublisher(store, { directory: project, published: () => files.write() });
  const desk = new SessionDesk({ home: appHome, library, calls: { save: (given) => saver.save(given), publish: (given, context) => publisher.publish(context.key, given.finding), post: (given, context) => store.command({ type: "post", assignmentId: context.key, text: given.text, key: `${context.key}:${given.text}` }) } });
  const lease = "lease-1";
  desk.open(seatId, { folder, seat, authorize: (given) => given === lease, deliver: (text) => console.log(`${provider} message: ${text}`) });
  const instructions = `You are checking a research workspace's Python session. Work only in this folder.\n${SESSION_INSTRUCTIONS}`;
  writeFileSync(join(folder, "AGENTS.md"), instructions);
  try {
    const agent = supervisor.start({
      key: `live:${provider}`,
      provider,
      executable,
      folder,
      env: { ...process.env, WEIR_LEASE: lease },
      instructions,
      readOnly: [library],
      web: true,
      webFetch: false,
      ...models[provider],
      prompt: `Using your Python session, in one run: read document doc-1 and store its number of pages in a variable named pages_count, and print it. Then, in a second, separate run, print pages_count * 10 without reading the document again. Then, in a third run, save the page at ${gazette} into the library, keep its receipt in a variable named receipt, read the saved document from the library, and print its text. Then publish one finding, qualified as reported, that Ben Example bought Example Mill in 1901, with one piece of evidence quoting the saved page, and keep what weir.publish returns in a variable named published. Then post to the board, with weir.post, exactly this sentence: The gazette names the buyer. Reply with only the two numbers that were printed and then the price in pounds the page mentions, as a number.`,
    });
    const actions = [];
    agent.on("action", (text) => actions.push(text));

    const turn = await new Promise((done, fail) => {
      agent.on("turn", done);
      agent.on("failed", fail);
      setTimeout(() => fail(new Error("no answer within five minutes")), 5 * 60_000);
    });
    agent.stop();
    desk.close(seatId);
    // What the session kept, read by a fresh session on the same seat.
    const check = new PythonSession({ folder: seat, library, home: appHome });
    const kept = (await check.run("print(pages_count)")).output.trim();
    const receipt = JSON.parse((await check.run("import json\nprint(json.dumps(receipt))")).output);
    const savedText = (await check.run("print(weir.library.text(receipt['id']))")).output;
    const published = JSON.parse((await check.run("print(json.dumps(published))")).output);
    check.stop();
    console.log(`${provider}: replied ${JSON.stringify(turn.text.trim())}; the session kept pages_count = ${kept}.`);
    console.log(`${provider} actions:\n  ${actions.join("\n  ")}`);
    assert.equal(kept, "3", "the session kept the variable the agent made");
    assert.match(turn.text, /\b3\b[\s\S]*\b30\b[\s\S]*\b412\b/, "the agent saw all three runs' output");
    const saved = store.state.documents.find((d) => d.id === receipt.id);
    assert.equal(saved?.url, gazette, "the page the agent saved is a document of the project");
    assert.match(savedText, /sold to Ben Example in 1901 for 412 pounds/, "the session reads the saved page from the library");
    assert.equal(store.state.documents.length, 2, "the page was saved once");
    const report = store.state.investigations[0].proposals.find((p) => published.id === `${p.id}/f1`);
    assert.ok(report, "the finding the agent published is in the batch");
    assert.equal(report.assignmentId, seatId, "the finding records its seat");
    assert.deepEqual([report.evidence[0].documentId, report.evidence[0].check], [receipt.id, "checked"], "its quote was checked against the saved page");
    assert.match(readFileSync(join(library, "batches", "batch-1", "findings.md"), "utf8"), /published by Researcher 1/, "the finding is in the library");
    assert.deepEqual(store.state.investigations[0].board.map((p) => [p.assignmentId, p.text]), [[seatId, "The gazette names the buyer."]], "the agent's post is on the board");
    assert.match(readFileSync(join(library, "batches", "batch-1", "board.md"), "utf8"), /from Researcher 1\n\nThe gazette names the buyer\./, "the post is in the library");
    if (provider === "claude") {
      // The tools Claude Code said the agent has, from its raw stream in the log.
      const tools = readFileSync(`${folder}.log`, "utf8")
        .split("\n")
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .find((event) => event?.type === "system" && event.subtype === "init")?.tools;
      assert.ok(tools, "Claude Code listed the agent's tools");
      assert.ok(tools.includes("WebSearch"), "the researcher can search the web");
      assert.ok(!tools.includes("WebFetch"), "the researcher has no page retrieval");
    }
    console.log(`${provider}: passed.`);
  } catch (error) {
    failed = true;
    console.log(`${provider}: FAILED: ${error.message}`);
    // The end of the agent's raw stream, to see what it did.
    try {
      console.log(readFileSync(`${folder}.log`, "utf8").slice(-6000));
    } catch {
      /* No log was written. */
    }
  } finally {
    desk.closeAll();
    files.stop();
    rmSync(project, { recursive: true, force: true, maxRetries: 5 });
  }
}
site.close();
process.exit(failed ? 1 : 0);
