// Local integration test: starts the research browser headless with a throwaway
// profile, connects two workers to it through their browser tools, as agents do,
// and checks that a sign-in made in one reaches the other, that each works in its
// own tab, and that the browser uses only the app's own profile. It runs for each
// kind of browser found: a Chromium browser, and Firefox through its relay.
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { ResearchBrowser, findBrowser } from "../server/research-browser.mjs";

// The browsers Puppeteer caches stand in for installed ones: the Chrome headless
// shell, which runs where there is no display, and a stock Firefox.
const cachedIn = (name, files) => {
  const cache = join(homedir(), ".cache", "puppeteer", name);
  if (!existsSync(cache)) return null;
  for (const version of readdirSync(cache))
    for (const file of files) if (existsSync(join(cache, version, file))) return join(cache, version, file);
  return null;
};
const chromium =
  process.env.RESEARCH_BROWSER_CHROME ||
  (() => {
    const found = findBrowser();
    return found.engine === "chromium" ? found.path : null;
  })() ||
  cachedIn("chrome-headless-shell", ["mac-arm64", "mac-x64", "linux64"].map((platform) => `chrome-headless-shell-${platform}/chrome-headless-shell`));
const firefox =
  process.env.RESEARCH_BROWSER_FIREFOX ||
  ["/Applications/Firefox.app/Contents/MacOS/firefox", "/usr/bin/firefox"].find((file) => existsSync(file)) ||
  cachedIn("firefox", ["Firefox.app/Contents/MacOS/firefox", "firefox/firefox"]);
const browsers = [
  chromium && { path: chromium, name: "Chromium", engine: "chromium" },
  firefox && { path: firefox, name: "Firefox", engine: "firefox" },
].filter(Boolean);
if (!browsers.length) {
  console.log("No Chromium browser or Firefox is installed; research browser check skipped.");
  process.exit(0);
}

// A fictional archive that signs a visitor in with a cookie.
const archive = createServer((req, res) => {
  if (req.url === "/sign-in") {
    res.setHeader("Set-Cookie", "archive-session=signed-in; Path=/");
    return res.end("<p>Signed in to the fictional archive.</p>");
  }
  if (req.url === "/form")
    return res.end(`<h1>Search the fictional archive</h1><form action="/results"><label>Surname <input name="surname"></label><label for="parish">Parish</label><select id="parish" name="parish"><option value="">Any</option><option value="upton">Upton</option></select><button>Search</button></form>`);
  if (req.url.startsWith("/results")) {
    const query = new URL(req.url, site).searchParams;
    return res.end(`<p>Results for ${query.get("surname")} in ${query.get("parish")}</p>`);
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
    raw: (name, args) => request("tools/call", { name, arguments: args }),
    stop: () => child.kill(),
  };
}

for (const kind of browsers) {
  const app = mkdtempSync(join(tmpdir(), "research-browser-"));
  const browser = new ResearchBrowser(app, { browser: kind, headless: true, root: resolve(".") });
  const workers = [];
  try {
    const url = await browser.open();
    assert.equal(await new ResearchBrowser(app, { browser: kind, headless: true, root: resolve(".") }).open(), url, "a second service reuses the running browser");
    const one = worker(browser.mcpServer(url));
    const two = worker(browser.mcpServer(url));
    workers.push(one, two);
    await one.start();
    await two.start();
    // Each worker opens its own tab and addresses it by the page ID it is given.
    const pageOf = (listing) => Number(listing.match(/^(\d+): .*\[selected\]$/m)?.[1]);
    const mine = pageOf(await one.call("new_page", { url: `${site}/sign-in`, background: true }));
    const theirs = pageOf(await two.call("new_page", { url: `${site}/check`, background: true }));
    assert.ok(mine && theirs && mine !== theirs, "each worker has its own tab");
    const seen = await two.call("evaluate_script", { pageId: theirs, function: "() => document.body.innerText" });
    assert.match(seen, /Session: archive-session=signed-in/, "a sign-in made by one worker reaches the other");
    const own = await one.call("evaluate_script", { pageId: mine, function: "() => location.pathname" });
    assert.match(own, /\/sign-in/, "each worker stays in its own tab");
    if (kind.engine === "chromium") {
      const pages = await one.call("list_pages", {});
      assert.match(pages, /sign-in/);
      assert.match(pages, /check/);
    } else {
      // Through the relay, a worker sees and reaches only its own tabs.
      const pages = await one.call("list_pages", {});
      assert.match(pages, /sign-in/);
      assert.doesNotMatch(pages, /check/);
      assert.match(await one.call("evaluate_script", { pageId: theirs, function: "() => 1" }), /not one of your tabs/);
      // A worker reads a page, fills in a form and follows a link by their uids.
      const form = pageOf(await one.call("new_page", { url: `${site}/form` }));
      const snapshot = await one.call("take_snapshot", { pageId: form });
      assert.match(snapshot, /heading "Search the fictional archive" level=1/);
      const uid = (role, name) => snapshot.match(new RegExp(`uid=(\\d+) ${role} "${name}"`))?.[1];
      await one.call("fill", { pageId: form, uid: uid("textbox", "Surname"), value: "Marrow" });
      await one.call("fill", { pageId: form, uid: uid("combobox", "Parish"), value: "Upton" });
      assert.match(await one.call("click", { pageId: form, uid: uid("button", "Search") }), /surname=Marrow&parish=upton/);
      assert.match(await one.call("take_snapshot", { pageId: form }), /Results for Marrow in upton/);
      const shot = (await one.raw("take_screenshot", { pageId: form })).content[0];
      assert.ok(shot.type === "image" && Buffer.from(shot.data, "base64").subarray(1, 4).toString() === "PNG", "a screenshot comes back as an image");
      // A worker's tabs close when its tool server ends.
      one.stop();
      await new Promise((resolve) => setTimeout(resolve, 1000));
      assert.doesNotMatch(await two.call("evaluate_script", { pageId: theirs, function: "() => 'still here'" }), /not one/);
    }
    // The browser runs on the app's own profile, never the human's.
    const processes = execFileSync("ps", ["-Ao", "command="], { encoding: "utf8" }).split("\n");
    const flag = kind.engine === "firefox" ? `--profile ${browser.profile}` : `--user-data-dir=${browser.profile}`;
    assert.ok(processes.some((p) => p.includes(flag)), "the research browser runs with the app's profile");
    assert.ok(browser.profile.startsWith(app), "the profile is the app's own, not the human's");
    console.log(`Research browser (${kind.engine}): one profile shared by workers, a tab each, separate from the human's browsers: passed.`);
  } finally {
    for (const w of workers) w.stop();
    await browser.stop();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    rmSync(app, { recursive: true, force: true });
  }
}
archive.close();
