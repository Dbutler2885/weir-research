import { spawn, spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { executableOnPath } from './researchers.mjs';

// The Chromium browsers the research browser can drive, in the order it prefers
// them when the human's default browser is not one of them.
const BROWSERS = [
  {name: 'Google Chrome', mac: 'Google Chrome', bundle: 'com.google.chrome', linux: ['google-chrome', 'google-chrome-stable'], desktop: 'google-chrome'},
  {name: 'Brave', mac: 'Brave Browser', bundle: 'com.brave.browser', linux: ['brave-browser', 'brave'], desktop: 'brave'},
  {name: 'Microsoft Edge', mac: 'Microsoft Edge', bundle: 'com.microsoft.edgemac', linux: ['microsoft-edge', 'microsoft-edge-stable'], desktop: 'microsoft-edge'},
  {name: 'Vivaldi', mac: 'Vivaldi', bundle: 'com.vivaldi.vivaldi', linux: ['vivaldi', 'vivaldi-stable'], desktop: 'vivaldi'},
  {name: 'Chromium', mac: 'Chromium', bundle: 'org.chromium.chromium', linux: ['chromium', 'chromium-browser'], desktop: 'chromium'},
];
// Browsers people use that researchers cannot drive, named when one is the default.
const OTHERS = [
  {name: 'Safari', bundle: 'com.apple.safari', desktop: 'safari'},
  {name: 'Firefox', bundle: 'org.mozilla.firefox', desktop: 'firefox'},
  {name: 'Arc', bundle: 'company.thebrowser.browser', desktop: 'arc'},
];

// The human's default browser, as the system records it: a bundle id on macOS,
// a desktop entry on Linux.
export function defaultBrowserId(run = (command, args) => spawnSync(command, args, {encoding: 'utf8', timeout: 5000}).stdout || '') {
  if (process.platform === 'darwin') {
    try {
      const plist = `${homedir()}/Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist`;
      const handlers = JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', plist])).LSHandlers || [];
      return handlers.find((h) => h.LSHandlerURLScheme === 'https')?.LSHandlerRoleAll?.toLowerCase() || null;
    } catch {
      return null;
    }
  }
  return run('xdg-settings', ['get', 'default-web-browser']).trim().toLowerCase() || null;
}

const matches = (browser, id) => Boolean(id) && (id === browser.bundle || id.startsWith(browser.desktop));

// The installed browser the research browser drives: the human's default when it
// is a Chromium browser, or else the first one installed. Also says what the
// default is, when it is a browser researchers cannot drive.
export function findBrowser(find = executableOnPath, exists = existsSync, defaultId = defaultBrowserId) {
  if (process.env.RESEARCH_BROWSER_CHROME) return {path: process.env.RESEARCH_BROWSER_CHROME, name: 'The browser RESEARCH_BROWSER_CHROME names', isDefault: false};
  const pathOf = (browser) => process.platform === 'darwin'
    ? [`/Applications/${browser.mac}.app/Contents/MacOS/${browser.mac}`].find((file) => exists(file))
    : browser.linux.map(find).find(Boolean);
  const id = defaultId();
  const preferred = BROWSERS.find((b) => matches(b, id));
  const other = OTHERS.find((b) => matches(b, id))?.name || null;
  for (const browser of preferred ? [preferred, ...BROWSERS.filter((b) => b !== preferred)] : BROWSERS) {
    const path = pathOf(browser);
    if (path) return {path, name: browser.name, isDefault: browser === preferred, unsupportedDefault: other};
  }
  return {path: null, name: null, isDefault: false, unsupportedDefault: other};
}
export const findChrome = () => findBrowser().path;

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
