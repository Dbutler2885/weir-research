// Live check, outside `npm run check`: real readers, on Claude Code and then on Codex,
// answer a batch of fictional passages, with quotes and pages; a repeated call comes
// from the cache; and a reader asked to act rather than answer changes nothing, having
// no tools to act with. It costs a few model calls on the human's sign-ins.
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { AgentSupervisor } from "../server/agents/supervisor.mjs";
import { agentHomes } from "../server/agents/isolation.mjs";
import { Readers } from "../server/readers.mjs";
import { SessionDesk } from "../server/python-session/desk.mjs";
import { pythonEnvironment } from "../server/python-session/session.mjs";
import { READER_INSTRUCTIONS } from "../src/domain/reader.ts";
import { executableOnPath } from "../server/researchers.mjs";

const appHome = resolve(process.env.RESEARCH_HOME || ".research");
const models = { claude: { model: "haiku", effort: null }, codex: { model: "gpt-6-luna", effort: "high" } };
const only = process.argv.slice(2);
let failed = false;

const passages = [
  { label: "ledger", document: "doc-1", pages: [{ page: 1, text: "Example Mill opened in 1882." }, { page: 2, text: "Ada Example sold the mill to Ben Example in 1901." }] },
  { label: "gazette", document: "doc-2", text: "The fictional harbor gazette reports fine weather for the regatta of 1899." },
];

for (const provider of only.length ? only : ["claude", "codex"]) {
  if (!executableOnPath(provider)) {
    console.log(`${provider}: not installed, skipped.`);
    continue;
  }
  const project = mkdtempSync(join(appHome, "live-readers-"));
  const supervisor = new AgentSupervisor({ homes: agentHomes(appHome) });
  const readers = new Readers({ state: {} }, project, { supervisor, findExecutable: executableOnPath, dispatch: { choose: () => ({ agent: provider, ...models[provider] }) } });
  try {
    const started = Date.now();
    const answers = await readers.ask({ question: "Who sold the Example mill, to whom, and when?", passages });
    console.log(`${provider}: answered in ${Math.round((Date.now() - started) / 1000)} s:\n${JSON.stringify(answers, null, 2)}`);
    assert.deepEqual(answers.map((a) => [a.label, a.document, a.relevant, a.cached]), [["ledger", "doc-1", true, false], ["gazette", "doc-2", false, false]]);
    assert.ok(answers[0].quotes.length && answers[0].quotes.every((q) => q.page === 2 && q.found), "the ledger's quotes are on page 2 and in its text");
    const again = await readers.ask({ question: "Who sold the Example mill, to whom, and when?", passages });
    assert.deepEqual(again.map((a) => a.cached), [true, true]);
    assert.equal(again[0].answer, answers[0].answer);
    // A reader has nothing to act with: started as readers are and asked to make a
    // file, it makes none, and its stream shows no tool and no command.
    const folder = join(project, "no-tools");
    mkdirSync(folder);
    const agent = supervisor.start({ key: "reader:check", provider, executable: executableOnPath(provider), folder, local: true, tools: false, instructions: READER_INSTRUCTIONS, ...models[provider], prompt: "Create a file named made.txt in your current folder containing the word made, then run the command `ls`. If you have no way to do that, reply with exactly: NO TOOLS" });
    const reply = await new Promise((done, fail) => {
      agent.on("turn", ({ text }) => done(text));
      agent.on("failed", fail);
    });
    agent.stop();
    const stream = readFileSync(`${folder}.log`, "utf8");
    console.log(`${provider}: asked to make a file, it replied: ${reply.trim().slice(0, 200)}`);
    assert.deepEqual(readdirSync(folder), [], "nothing was made in its folder");
    assert.doesNotMatch(stream, /"tool_use"|"commandExecution"|"fileChange"|"mcpToolCall"/, "its stream holds no tool call");
    if (provider === "claude") {
      const init = stream.split("\n").map((line) => { try { return JSON.parse(line); } catch { return null; } }).find((e) => e?.type === "system" && e.subtype === "init");
      assert.deepEqual(init.tools, [], "Claude Code reports no tools");
      assert.deepEqual(init.mcp_servers, [], "and no MCP servers");
    }
    assert.deepEqual(readdirSync(join(project, "agents", "readers")), [], "the readers' folders and logs are gone");
    // From a researcher's Python session: code asks readers about a saved document's
    // pages, and the answers arrive in its variables.
    if (process.platform === "darwin") {
      const library = join(project, "library");
      mkdirSync(join(library, "documents"), { recursive: true });
      writeFileSync(join(library, "documents", "documents.csv"), "id,name,collection,file,text,pages\ndoc-1,Fictional ledger.pdf,c1,documents/doc-1.pdf,documents/doc-1.txt,2\n");
      writeFileSync(join(library, "documents", "doc-1.txt"), "[Page 1]\nExample Mill opened in 1882.\n\n[Page 2]\nAda Example sold the mill to Ben Example in 1901.\n");
      writeFileSync(join(library, "sources.csv"), "id,title\ndoc-1,Fictional ledger\n");
      await pythonEnvironment(appHome);
      const desk = new SessionDesk({ home: appHome, library, calls: { reader: (given, seat) => readers.ask(given, { seat: seat.key }) }, closed: (key) => readers.cancel(key) });
      const seat = join(project, "seat");
      const agentFolder = join(seat, "lease-1");
      mkdirSync(agentFolder, { recursive: true });
      desk.open("seat-1", { folder: agentFolder, seat, authorize: (lease) => lease === "lease-1", deliver: (text) => console.log(`${provider}: session message: ${text}`) });
      const code = [
        "answers = weir.reader('Who sold the Example mill, to whom, and when?', [{'label': 'ledger', 'document': 'doc-1', 'pages': weir.library.read('doc-1')}])",
        "print([(a['label'], a['document'], a['relevant'], [(q['page'], q['found']) for q in a['quotes']]) for a in answers])",
      ].join("\n");
      const printed = await new Promise((done, fail) => {
        const child = execFile(process.execPath, [join(agentFolder, "tools", "python.mjs")], { env: { ...process.env, WEIR_LEASE: "lease-1" } }, (error, stdout, stderr) => (error ? fail(new Error(stderr || error.message)) : done(stdout)));
        child.stdin.end(code);
      });
      desk.closeAll();
      console.log(`${provider}: from a Python session: ${printed.trim()}`);
      assert.match(printed, /^\[\('ledger', 'doc-1', True, \[(\(2, True\)(, )?)+\]\)\]\n$/);
    }
    console.log(`${provider}: readers answer per passage, repeat from the cache, and have no tools.`);
  } catch (error) {
    failed = true;
    console.error(`${provider}: FAILED: ${error.stack || error.message}`);
    console.error(`Kept for diagnosis: ${project}`);
    readers.stop();
    continue;
  }
  readers.stop();
  rmSync(project, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
