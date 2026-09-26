import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { executableOnPath } from './researchers.mjs';

// The Chromium browsers the research browser can drive, in the order it prefers them.
const BROWSERS = [
  {name: 'Google Chrome', mac: 'Google Chrome', linux: ['google-chrome', 'google-chrome-stable']},
  {name: 'Brave', mac: 'Brave Browser', linux: ['brave-browser', 'brave']},
  {name: 'Microsoft Edge', mac: 'Microsoft Edge', linux: ['microsoft-edge', 'microsoft-edge-stable']},
  {name: 'Chromium', mac: 'Chromium', linux: ['chromium', 'chromium-browser']},
];

// The installed browser the research browser drives, and its name; or the one
// RESEARCH_BROWSER_CHROME names.
export function findBrowser(find = executableOnPath, exists = existsSync) {
  if (process.env.RESEARCH_BROWSER_CHROME) return {path: process.env.RESEARCH_BROWSER_CHROME, name: 'The browser RESEARCH_BROWSER_CHROME names'};
  for (const browser of BROWSERS) {
    const path = process.platform === 'darwin'
      ? [`/Applications/${browser.mac}.app/Contents/MacOS/${browser.mac}`].find((file) => exists(file))
      : browser.linux.map(find).find(Boolean);
    if (path) return {path, name: browser.name};
  }
  return null;
}
export const findChrome = () => findBrowser()?.path || null;

// One research browser for the app: an installed Chromium browser, such as Chrome
// or Brave, run with the app's own profile,
// separate from the human's browsers. The human signs in to archives in it once;
// every worker reaches it through Chrome DevTools MCP and works in its own tab.
export class ResearchBrowser {
  constructor(appDirectory, {chrome = findChrome(), headless = false, root} = {}) {
    this.profile = join(appDirectory, 'research-browser', 'profile');
    this.chrome = chrome;
    this.headless = headless;
    this.root = root;
    this.url = null;
  }
  // The browser's DevTools address, starting it when it is not already running.
  // Every project's service shares it, so a running one is reused.
  async open() {
    if (!this.chrome) throw new Error('No Chromium browser, such as Chrome or Brave, is installed for researchers to share.');
    const running = await this.running();
    if (running) return running;
    mkdirSync(this.profile, {recursive: true});
    rmSync(join(this.profile, 'DevToolsActivePort'), {force: true});
    const child = spawn(this.chrome, [
      `--user-data-dir=${this.profile}`,
      '--remote-debugging-port=0',
      '--remote-debugging-address=127.0.0.1',
      '--no-first-run',
      '--no-default-browser-check',
      ...(this.headless ? ['--headless=new'] : []),
      'about:blank',
    ], {detached: true, stdio: 'ignore'});
    child.unref();
    this.child = child;
    for (let n = 0; n < 150; n++) {
      const url = await this.running();
      if (url) return url;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('The research browser did not start.');
  }
  // The DevTools address of a research browser already running on this profile.
  async running() {
    const file = join(this.profile, 'DevToolsActivePort');
    if (!existsSync(file)) return null;
    const port = Number(readFileSync(file, 'utf8').split('\n')[0]);
    if (!port) return null;
    const url = `http://127.0.0.1:${port}`;
    try {
      const response = await fetch(`${url}/json/version`, {signal: AbortSignal.timeout(1500)});
      if (!response.ok) return null;
    } catch {
      return null;
    }
    this.url = url;
    return url;
  }
  // The MCP server a worker uses to reach the browser.
  mcpServer(url) {
    return {
      command: process.execPath,
      args: [join(this.root, 'node_modules', 'chrome-devtools-mcp', 'build', 'src', 'bin', 'chrome-devtools-mcp.js'), '--browserUrl', url, '--usageStatistics=false', '--experimentalPageIdRouting'],
      env: {CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS: '1'},
    };
  }
  async stop() {
    if (!this.child) return;
    try {
      process.kill(this.child.pid);
    } catch {
      /* Already closed. */
    }
  }
}
