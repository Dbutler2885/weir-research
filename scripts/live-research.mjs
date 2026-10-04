// Live check, outside `npm run check`: the whole app on a fictional project, with a
// real coordinator and a real team of two researchers, on Claude Code and then on
// Codex. The human asks one thing about a made-up town whose archive is a small site
// this script serves. The coordinator opens one batch with the request as its goal;
// the researchers save the site's pages into the library, organize on the board,
// publish findings with quotes the app checks, and finish with the done phrase.
// It costs some model calls on the human's sign-ins.
//
// node scripts/live-research.mjs [claude] [codex] [--keep]
// --keep leaves each project's folder in place, to read what the agents did.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { executableOnPath } from "../server/researchers.mjs";
import { WorkspaceStore } from "../server/store.mjs";
import { emptyGraph } from "../src/domain/graph-schema.ts";

const appHome = resolve(process.env.RESEARCH_HOME || ".research");
const models = {
  claude: { coordinator: { model: "sonnet", effort: "medium" }, cheap: { model: "haiku", effort: null } },
  codex: { coordinator: { model: "gpt-6-sol", effort: "medium" }, cheap: { model: "gpt-6-luna", effort: "high" } },
};
const args = process.argv.slice(2);
const keep = args.includes("--keep");
const only = args.filter((a) => !a.startsWith("--"));
let failed = false;

// The fictional archive. Every name, place and date in it is made up.
const filler = (kind, from, count) =>
  Array.from({ length: count }, (_, n) => `<p>Entry ${from + n}. ${kind} of the fictional property at ${n + 3} Sample Row, Harbour Town, held by the Placeholder family, renewed without change.</p>`).join("\n");
const page = (title, body) => `<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1>\n${body}\n</body></html>`;
const site = (base) => ({
  "/": page(
    "Harbour Town Fictional Archive",
    `<p>This archive is invented for testing. It holds four collections about Harbour Town, each on one page.</p>
<p>The deed register is at ${base}/deeds.html</p>
<p>The rate ledger is at ${base}/ledger.html</p>
<p>The Harbour Gazette notices are at ${base}/gazette.html</p>
<p>The Example family letters are at ${base}/letters.html</p>`,
  ),
  "/deeds.html": page(
    "Harbour Town deed register (fictional)",
    `${filler("Conveyance", 1, 40)}
<p>Entry 41. On 3 March 1882 the Harbour Town corporation granted the mill site on Weir Lane to Ada Example, who built the Example Mill there.</p>
${filler("Conveyance", 42, 40)}
<p>Entry 82. On 14 June 1901 Ada Example conveyed the Example Mill on Weir Lane to Ben Example, her nephew, for four hundred pounds.</p>
${filler("Conveyance", 83, 40)}
<p>Entry 123. On 2 September 1912 Ben Example conveyed the Example Mill to the Harbour Milling Company Limited.</p>
${filler("Conveyance", 124, 20)}`,
  ),
  "/ledger.html": page(
    "Harbour Town rate ledger (fictional)",
    `${filler("Rates", 1, 60)}
<p>Entry 61. Rates for 1890: Example Mill, Weir Lane, occupier and owner Ada Example.</p>
<p>Entry 62. Rates for 1905: Example Mill, Weir Lane, owner Ben Example, occupier the same.</p>
<p>Entry 63. Rates for 1915: Example Mill, Weir Lane, owner Harbour Milling Company Limited, occupier Carl Sample, manager.</p>
${filler("Rates", 64, 60)}
<p>Entry 124. Rates for 1924: site of the former Example Mill, Weir Lane, vacant, owner Harbour Milling Company Limited.</p>`,
  ),
  "/gazette.html": page(
    "Harbour Gazette notices (fictional)",
    `<p>21 June 1901. We hear that Miss Ada Example has given up the Example Mill to her nephew Mr Ben Example, who has worked there since boyhood.</p>
${filler("Notice", 2, 30)}
<p>9 November 1923. The Example Mill on Weir Lane was destroyed by fire on Tuesday night. The Harbour Milling Company says it will not rebuild.</p>
${filler("Notice", 33, 30)}`,
  ),
  "/letters.html": page(
    "Example family letters (fictional)",
    `<p>Letter of Dora Example, written in 1950: My aunt Ada sold the mill to cousin Ben in 1899, the year I was born, or so I was always told.</p>
<p>Letter of Dora Example, written in 1951: After the fire the company sold the ground on Weir Lane for houses, though I never learned to whom.</p>`,
  ),
});

function serveSite() {
  return new Promise((ready) => {
    let pages = {};
    const server = createServer((req, res) => {
      const body = pages[new URL(req.url, "http://x").pathname];
      res.writeHead(body ? 200 : 404, { "Content-Type": "text/html; charset=utf-8" });
      res.end(body || page("Not found", "<p>No such page in this fictional archive.</p>"));
    });
    server.listen(0, "127.0.0.1", () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      pages = site(base);
      ready({ base, close: () => server.close() });
    });
  });
}

const pause = (ms) => new Promise((done) => setTimeout(done, ms));
// A seat named, as "Researcher 2", "researcher two" or "the second researcher".
const SEAT = /\bresearchers? ?#?(\d|one|two|three|four|a\b|b\b)|\b(first|second|third|fourth|other) researcher\b/i;
for (const dividing of ["Researcher 1: investigate the deeds; Researcher 2: investigate the gazette.", "researcher two, take the letters", "The second researcher should read the ledger."]) assert.match(dividing, SEAT);
for (const whole of ["The human also wants the year the mill opened.", "Two findings give the 1901 sale; please settle on the board which stands.", "Researchers, the archive has a fifth page."]) assert.doesNotMatch(whole, SEAT);

for (const provider of only.length ? only : ["claude", "codex"]) {
  if (!executableOnPath(provider)) {
    console.log(`${provider}: not installed, skipped.`);
    continue;
  }
  const archive = await serveSite();
  mkdirSync(appHome, { recursive: true });
  const project = mkdtempSync(join(appHome, "live-research-"));
  // The project's settings as the human would have set them: a team of two, and who does which job.
  const seeded = new WorkspaceStore(project, emptyGraph());
  seeded.update((next) => {
    next.researchSettings = { timeLimitMinutes: null, researchersPerBatch: 2 };
    const cheap = { agent: provider, ...models[provider].cheap };
    next.dispatch = { default: { agent: provider, ...models[provider].coordinator }, roles: { researcher: cheap, helper: cheap, reader: cheap }, rules: [] };
  });
  // The app itself, as `npm start` runs it, with a browser that cannot start, so no window opens.
  const service = spawn(process.execPath, ["--no-warnings", resolve("server/main.mjs")], {
    env: { ...process.env, RESEARCH_HOME: appHome, RESEARCH_STATE_DIR: project, RESEARCH_BROWSER_CHROME: join(project, "no-browser") },
    stdio: ["ignore", "ignore", "inherit"],
  });
  let state = null;
  const batch = () => state?.investigations[0];
  const seats = () => (batch()?.assignments || []).map((a) => `${a.title} ${a.status}`).join(", ");
  try {
    const connection = join(project, "connection.json");
    for (let n = 0; !existsSync(connection); n++) {
      if (n > 200) throw new Error("The app did not start.");
      await pause(100);
    }
    const { url } = JSON.parse(readFileSync(connection, "utf8"));
    const read = async () => (state = await (await fetch(`${url}/api/state`)).json());
    const request = `I'd like to know the history of the Example Mill in Harbour Town: who owned it over the years, how it changed hands, and what became of it. Harbour Town is made up, for a test of this app, so the real web has nothing on it; everything there is to know is on the town's archive site at ${archive.base}/ and the pages it lists. Please get the research going.`;
    const sent = await fetch(`${url}/api/commands`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "send", text: request }) });
    assert.equal(sent.status, 200, "the human's message was accepted");
    const started = Date.now();
    const until = async (what, minutes, met) => {
      const deadline = Date.now() + minutes * 60_000;
      while (!met(await read())) {
        if (Date.now() > deadline) throw new Error(`${what} had not happened after ${minutes} minutes (${seats() || "no batch"}).`);
        await pause(2000);
      }
    };
    await until("The coordinator opening a batch", 10, (s) => s.investigations.length > 0);
    console.log(`${provider}: the coordinator opened "${batch().title}" after ${Math.round((Date.now() - started) / 1000)} s.\n  Goal: ${batch().goal}`);
    await until("The batch reaching Review", 30, (s) => s.investigations[0].status === "review");
    await pause(3000);
    await read();
    const board = batch().board || [];
    const name = (id) => batch().assignments.find((a) => a.id === id)?.title || "Coordinator";
    const findings = batch().proposals.flatMap((p) => p.findings.filter((f) => f.status !== "superseded").map((f) => ({ ...f, by: name(p.assignmentId), evidence: p.evidence })));
    const saved = state.documents.filter((d) => d.url?.startsWith(archive.base));
    console.log(`${provider}: Review after ${Math.round((Date.now() - started) / 60_000)} min.`);
    console.log(`  Saved: ${saved.map((d) => new URL(d.url).pathname).join(", ")}`);
    console.log(`  Board:\n${board.map((p) => `    ${name(p.assignmentId)}: ${p.text.replace(/\s+/g, " ")}`).join("\n")}`);
    console.log(`  Findings:\n${findings.map((f) => `    ${f.by} [${f.qualification}]: ${f.statement}`).join("\n")}`);
    console.log(`  The coordinator said:\n${state.conversation.filter((m) => m.author !== "human" && m.text).map((m) => `    ${m.text.replace(/\s+/g, " ")}`).join("\n")}`);

    // The coordinator: one batch, with the request as its goal, left whole for the team.
    assert.equal(state.investigations.length, 1, "one goal is one batch");
    assert.match(batch().goal, /Example Mill/, "the goal says what the human wants to know");
    assert.ok(batch().goal.includes(archive.base), "the goal says where the human said to look");
    // A goal that restates the request is about its length; one that adds a method, a
    // division or a list of what to produce runs well past it.
    assert.doesNotMatch(batch().goal, SEAT, "the goal gives no researcher a part");
    assert.ok(batch().goal.length <= request.length * 1.5, `the goal keeps to what the human said (${batch().goal.length} characters for a request of ${request.length})`);
    assert.equal(batch().assignments.length, 2, "the team is the size the human set");
    // The coordinator speaks to the whole team: a post of its own that names a seat is steering one researcher.
    const dividing = board.filter((p) => !p.assignmentId && SEAT.test(p.text));
    assert.equal(dividing.length, 0, `the coordinator's posts leave who does what to the team (${dividing.map((p) => p.text).join(" / ")})`);
    assert.ok(state.conversation.some((m) => m.author !== "human" && m.text), "the coordinator answered the human");
    // The researchers: sources saved, the board used, findings published and checked.
    assert.ok(saved.length >= 3, "the researchers saved the archive's pages into the library");
    assert.ok(board.filter((p) => p.assignmentId).length >= 2, "the researchers posted to the board");
    assert.ok(findings.some((f) => /1901/.test(f.statement)), "a finding gives the year the mill passed to Ben Example");
    assert.ok(findings.some((f) => /1912/.test(f.statement)), "a finding gives the sale to the company");
    assert.ok(findings.some((f) => /1923|fire/i.test(f.statement)), "a finding says what became of the mill");
    const evidence = batch().proposals.flatMap((p) => p.evidence);
    assert.ok(evidence.length && evidence.every((e) => e.check === "checked"), "every quote was checked against a saved page");
    assert.ok(evidence.every((e) => saved.some((d) => d.id === e.documentId)), "every quote cites a page the team saved");
    assert.ok(batch().assignments.every((a) => a.status === "finished"), "both researchers said the done phrase");
    console.log(`${provider}: passed.`);
  } catch (error) {
    failed = true;
    console.log(`${provider}: FAILED: ${error.message}`);
    console.log(`Seats: ${seats()}. Events:\n${(batch()?.events || []).map((e) => `  ${e.message}`).join("\n")}`);
  } finally {
    service.kill("SIGTERM");
    await pause(2500);
    archive.close();
    if (keep) console.log(`${provider}: project kept at ${project}`);
    else rmSync(project, { recursive: true, force: true, maxRetries: 5 });
  }
}
process.exit(failed ? 1 : 0);
