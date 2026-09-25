// Local integration test: runs the installed Codex app server with the app's own
// sandbox arguments and homes, and checks what a command in it can reach. It
// runs commands directly, so it needs neither a sign-in nor a model.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { codexAdapter } from "../server/agents/codex.mjs";
import { agentHomes } from "../server/agents/isolation.mjs";

if (spawnSync("codex", ["--version"]).error) {
  console.log("Codex is not installed; isolation check skipped.");
  process.exit(0);
}
// Inside the home folder, as a real project is, so the profile must carve out the agent's folder.
const app = mkdtempSync(join(resolve(".research"), "isolation-"));
const folder = join(app, "agents", "one");
const other = join(app, "agents", "two");
mkdirSync(folder, { recursive: true });
mkdirSync(other, { recursive: true });
const homes = agentHomes(app);
const server = spawn("codex", codexAdapter.args({ folder }), {
  cwd: folder,
  env: codexAdapter.env({ ...process.env }, { homes }),
  stdio: ["pipe", "pipe", "ignore"],
});
let id = 0;
const waiting = new Map();
let pending = "";
server.stdout.on("data", (chunk) => {
  pending += chunk;
  const lines = pending.split("\n");
  pending = lines.pop();
  for (const line of lines) {
    const message = line && JSON.parse(line);
    if (message && message.id && !message.method) waiting.get(message.id)?.(message);
  }
});
const request = (method, params) =>
  new Promise((done) => {
    waiting.set(++id, done);
    server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
const exec = async (...command) => (await request("command/exec", { command, cwd: realpathSync(folder) })).result;
try {
  await request("initialize", { clientInfo: { name: "isolation-test", title: null, version: "1" }, capabilities: null });
  server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "initialized" })}\n`);
  const account = (await request("account/read", {})).result;
  assert.equal(account.account, null, "The app's Codex home starts signed out, separate from the human's.");
  assert.equal((await exec("/bin/sh", "-c", "echo ok > made.txt && cat made.txt")).stdout, "ok\n");
  assert.equal((await exec(process.execPath, "--version")).exitCode, 0, "node runs in the sandbox");
  for (const outside of [join(homedir(), "Documents"), join(homedir(), ".codex"), other]) {
    const listed = await exec("/bin/ls", outside);
    assert.notEqual(listed.exitCode, 0, `${outside} must be out of reach`);
  }
  assert.notEqual((await exec("/bin/sh", "-c", `echo x > ${other}/written.txt`)).exitCode, 0, "another agent's folder is not writable");
  const web = await exec("/usr/bin/curl", "-sS", "-o", "/dev/null", "-w", "%{http_code}", "https://example.com");
  assert.equal(web.stdout, "200", "the web is reachable");
  console.log("Codex isolation: own folder, node and the web reachable; home, Codex sign-in and other agents' folders out of reach: passed.");
} finally {
  server.kill();
  rmSync(app, { recursive: true, force: true });
}
