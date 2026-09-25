// Local integration test: starts the research browser headless with a throwaway
// profile, connects two workers to it through Chrome DevTools MCP, as agents do,
// and checks that a sign-in made in one reaches the other, that each works in its
// own tab, and that the browser uses only the app's own profile.
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { ResearchBrowser, findChrome } from "../server/research-browser.mjs";

// Without Google Chrome, the headless shell that Puppeteer caches stands in; it
// runs where there is no display, as on a test machine.
const cached = join(homedir(), ".cache", "puppeteer", "chrome-headless-shell");
if (!findChrome() && existsSync(cached))
  for (const version of readdirSync(cached)) {
    const shell = ["chrome-headless-shell-mac-arm64", "chrome-headless-shell-mac-x64", "chrome-headless-shell-linux64"]
      .map((folder) => join(cached, version, folder, "chrome-headless-shell"))
      .find((file) => existsSync(file));
    process.env.RESEARCH_BROWSER_CHROME ||= shell;
  }
if (!findChrome()) {
  console.log("Google Chrome is not installed; research browser check skipped.");
  process.exit(0);
}
const app = mkdtempSync(join(tmpdir(), "research-browser-"));
const browser = new ResearchBrowser(app, { headless: true, root: resolve(".") });

// A fictional archive that signs a visitor in with a cookie.
const archive = createServer((req, res) => {
  if (req.url === "/sign-in") {
    res.setHeader("Set-Cookie", "archive-session=signed-in; Path=/");
    return res.end("<p>Signed in to the fictional archive.</p>");
  }
  res.end(`<p>Session: ${req.headers.cookie || "none"}</p>`);
}).listen(0, "127.0.0.1");
await new Promise((resolve) => archive.once("listening", resolve));
const site = `http://127.0.0.1:${archive.address().port}`;

// A worker's MCP connection to the browser, speaking MCP over stdio as an agent CLI does.
function worker(server) {
  const child = spawn(server.command, server.args, { env: { ...process.env, ...server.env }, stdio: ["pipe", "pipe", "ignore"] });
  let id = 0;
  let pending = "";
  const waiting = new Map();
  child.stdout.on("data", (chunk) => {
    pending += chunk;
    const lines = pending.split("\n");
    pending = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      if (message.id !== undefined) waiting.get(message.id)?.(message);
    }
  });
  const request = (method, params) =>
    new Promise((done, fail) => {
      waiting.set(++id, (m) => (m.error ? fail(new Error(m.error.message)) : done(m.result)));
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  const text = (result) => result.content.map((c) => c.text || "").join("\n");
  return {
    async start() {
      await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "worker", version: "1" } });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    },
    call: async (name, args) => text(await request("tools/call", { name, arguments: args })),
    stop: () => child.kill(),
  };
}

const workers = [];
try {
  const url = await browser.open();
  assert.equal(await new ResearchBrowser(app, { headless: true, root: resolve(".") }).open(), url, "a second service reuses the running browser");
  const one = worker(browser.mcpServer(url));
  const two = worker(browser.mcpServer(url));
  workers.push(one, two);
  await one.start();
  await two.start();
  // Each worker opens its own tab and addresses it by the page ID it is given.
  const pageOf = (listing) => Number(listing.match(/^(\d+): .*\[selected\]$/m)?.[1]);
  const mine = pageOf(await one.call("new_page", { url: `${site}/sign-in` }));
  const theirs = pageOf(await two.call("new_page", { url: `${site}/check` }));
  assert.ok(mine && theirs && mine !== theirs, "each worker has its own tab");
  const seen = await two.call("evaluate_script", { pageId: theirs, function: "() => document.body.innerText" });
  assert.match(seen, /Session: archive-session=signed-in/, "a sign-in made by one worker reaches the other");
  const own = await one.call("evaluate_script", { pageId: mine, function: "() => location.pathname" });
  assert.match(own, /\/sign-in/, "each worker stays in its own tab");
  const pages = await one.call("list_pages", {});
  assert.match(pages, /sign-in/);
  assert.match(pages, /check/);
  // The browser runs on the app's own profile, never the human's.
  const processes = execFileSync("ps", ["-Ao", "command="], { encoding: "utf8" }).split("\n");
  const ours = processes.filter((p) => p.includes(`--user-data-dir=${browser.profile}`));
  assert.ok(ours.length, "the research browser runs with the app's profile");
  assert.ok(!browser.profile.startsWith(join(homedir(), "Library", "Application Support", "Google")), "the profile is not the human's Chrome profile");
  assert.ok(!browser.profile.startsWith(join(homedir(), ".config", "google-chrome")), "the profile is not the human's Chrome profile");
  console.log("Research browser: one profile shared by workers, a tab each, separate from the human's browsers: passed.");
} finally {
  for (const w of workers) w.stop();
  await browser.stop();
  archive.close();
  await new Promise((resolve) => setTimeout(resolve, 500));
  rmSync(app, { recursive: true, force: true });
}
