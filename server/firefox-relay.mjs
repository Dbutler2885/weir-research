// The Firefox research browser's relay: a process of its own that starts Firefox
// on the app's profile, holds the one automation session Firefox allows, and runs
// every worker's browser tools through it. Every project's service shares it; it
// ends when the human quits Firefox.
//
// node server/firefox-relay.mjs <research-browser-folder> <firefox> [--headless]
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { FirefoxPages } from './firefox-pages.mjs';

const [folder, firefox, ...flags] = process.argv.slice(2);
const headless = flags.includes('--headless');
const profile = join(folder, 'firefox-profile');
const relayFile = join(folder, 'firefox-relay.json');
const lockFile = join(folder, 'firefox-relay.lock');
const serverFile = join(profile, 'WebDriverBiDiServer.json');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// One relay at a time: another service may be starting one already.
function lock() {
  mkdirSync(folder, {recursive: true});
  for (let n = 0; n < 2; n++) {
    try {
      const fd = openSync(lockFile, 'wx');
      writeFileSync(fd, String(process.pid));
      closeSync(fd);
      return true;
    } catch {
      const holder = Number(readFileSync(lockFile, 'utf8')) || 0;
      if (holder && alive(holder)) return false;
      rmSync(lockFile, {force: true});
    }
  }
  return false;
}

// Settings for a profile the app made: no first-run pages or default-browser
// prompts in the human's way.
const PREFERENCES = [
  ['browser.shell.checkDefaultBrowser', false],
  ['browser.aboutwelcome.enabled', false],
  ['browser.startup.homepage_override.mstone', '"ignore"'],
  ['datareporting.policy.dataSubmissionPolicyBypassNotification', true],
  ['browser.tabs.warnOnClose', false],
];

// Connects to the Firefox already running on the profile, or starts it.
async function connect() {
  const address = () => {
    const {ws_host: host, ws_port: port} = JSON.parse(readFileSync(serverFile, 'utf8'));
    return `ws://${host}:${port}/session`;
  };
  if (existsSync(serverFile)) {
    try {
      return await puppeteer.connect({browserWSEndpoint: address(), protocol: 'webDriverBiDi'});
    } catch {
      rmSync(serverFile, {force: true});
    }
  }
  if (!existsSync(profile)) {
    mkdirSync(profile, {recursive: true});
    writeFileSync(join(profile, 'user.js'), PREFERENCES.map(([name, value]) => `user_pref("${name}", ${value});`).join('\n'));
  }
  const child = spawn(firefox, ['--profile', profile, '--new-instance', '--remote-debugging-port=0', ...(headless ? ['--headless'] : []), 'about:blank'], {detached: true, stdio: 'ignore'});
  child.unref();
  for (let n = 0; n < 300; n++) {
    await sleep(100);
    if (!existsSync(serverFile)) continue;
    try {
      return await puppeteer.connect({browserWSEndpoint: address(), protocol: 'webDriverBiDi'});
    } catch {
      /* Still starting. */
    }
  }
  throw new Error('Firefox did not start.');
}

const body = async (req) => {
  let text = '';
  for await (const chunk of req) text += chunk;
  return text ? JSON.parse(text) : {};
};

async function main() {
  if (!lock()) return;
  const release = () => {
    rmSync(relayFile, {force: true});
    rmSync(lockFile, {force: true});
  };
  process.on('exit', release);
  let browser = null;
  // Stopping the relay quits Firefox with it.
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => (browser ? browser.close() : Promise.resolve()).catch(() => {}).finally(() => process.exit(0)));
  browser = await connect();
  // The human quitting Firefox ends the relay; the next worker starts both again.
  browser.on('disconnected', () => process.exit(0));
  const pages = new FirefoxPages(browser);
  const token = randomBytes(24).toString('hex');
  const server = createServer(async (req, res) => {
    const reply = (status, value) => {
      res.writeHead(status, {'Content-Type': 'application/json'});
      res.end(JSON.stringify(value));
    };
    if (req.headers.authorization !== `Bearer ${token}`) return reply(403, {error: 'Not allowed.'});
    try {
      if (req.method === 'GET' && req.url === '/status') return reply(200, {ok: true});
      const request = await body(req);
      if (req.url === '/call') return reply(200, await pages.call(request.client, request.name, request.arguments));
      if (req.url === '/release') {
        await pages.release(request.client);
        return reply(200, {ok: true});
      }
      // The human opens the research browser to sign in: a tab of their own, in front.
      if (req.url === '/show') {
        const page = await browser.newPage();
        if (/^https?:\/\//.test(request.page || '')) await page.goto(request.page).catch(() => {});
        await page.bringToFront().catch(() => {});
        return reply(200, {ok: true});
      }
      reply(404, {error: 'Not found.'});
    } catch (error) {
      // A tool that fails tells the worker why, as a tool result.
      if (req.url === '/call') reply(200, {content: [{type: 'text', text: error.message}], isError: true});
      else reply(500, {error: error.message});
    }
  });
  server.listen(0, '127.0.0.1', () => {
    writeFileSync(`${relayFile}.tmp`, JSON.stringify({url: `http://127.0.0.1:${server.address().port}`, token, pid: process.pid}));
    renameSync(`${relayFile}.tmp`, relayFile);
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
