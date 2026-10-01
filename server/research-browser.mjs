import { spawn, spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { executableOnPath } from './researchers.mjs';

// The browsers the research browser can drive, in the order it prefers them when
// the human's default browser is not one of them. Chromium browsers come first,
// since each worker reaches them directly; Firefox goes through a relay.
const BROWSERS = [
  {name: 'Google Chrome', mac: 'Google Chrome', bundle: 'com.google.chrome', linux: ['google-chrome', 'google-chrome-stable'], desktop: 'google-chrome'},
  {name: 'Brave', mac: 'Brave Browser', bundle: 'com.brave.browser', linux: ['brave-browser', 'brave'], desktop: 'brave'},
  {name: 'Microsoft Edge', mac: 'Microsoft Edge', bundle: 'com.microsoft.edgemac', linux: ['microsoft-edge', 'microsoft-edge-stable'], desktop: 'microsoft-edge'},
  {name: 'Vivaldi', mac: 'Vivaldi', bundle: 'com.vivaldi.vivaldi', linux: ['vivaldi', 'vivaldi-stable'], desktop: 'vivaldi'},
  {name: 'Chromium', mac: 'Chromium', bundle: 'org.chromium.chromium', linux: ['chromium', 'chromium-browser'], desktop: 'chromium'},
  {name: 'Firefox', mac: 'Firefox', binary: 'firefox', bundle: 'org.mozilla.firefox', linux: ['firefox'], desktop: 'firefox', engine: 'firefox'},
];
// Browsers people use that researchers cannot drive, named when one is the default.
const OTHERS = [
  {name: 'Safari', bundle: 'com.apple.safari', desktop: 'safari'},
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

// The installed browser the research browser drives: the human's default when
// researchers can drive it, or else the first one installed. Also says what the
// default is, when it is a browser researchers cannot drive.
export function findBrowser(find = executableOnPath, exists = existsSync, defaultId = defaultBrowserId) {
  if (process.env.RESEARCH_BROWSER_CHROME) return {path: process.env.RESEARCH_BROWSER_CHROME, name: 'The browser RESEARCH_BROWSER_CHROME names', engine: 'chromium', isDefault: false};
  if (process.env.RESEARCH_BROWSER_FIREFOX) return {path: process.env.RESEARCH_BROWSER_FIREFOX, name: 'The Firefox RESEARCH_BROWSER_FIREFOX names', engine: 'firefox', isDefault: false};
  const pathOf = (browser) => process.platform === 'darwin'
    ? [`/Applications/${browser.mac}.app/Contents/MacOS/${browser.binary || browser.mac}`].find((file) => exists(file))
    : browser.linux.map(find).find(Boolean);
  const id = defaultId();
  const preferred = BROWSERS.find((b) => matches(b, id));
  const other = OTHERS.find((b) => matches(b, id))?.name || null;
  for (const browser of preferred ? [preferred, ...BROWSERS.filter((b) => b !== preferred)] : BROWSERS) {
    const path = pathOf(browser);
    if (path) return {path, name: browser.name, engine: browser.engine || 'chromium', isDefault: browser === preferred, unsupportedDefault: other};
  }
  return {path: null, name: null, engine: null, isDefault: false, unsupportedDefault: other};
}

// One research browser for the app: an installed browser, such as Chrome, Brave
// or Firefox, run with the app's own profile, separate from the human's browsers.
// The human signs in to archives in it once; every worker reaches it through its
// browser tools and works in its own tab.
export class ResearchBrowser {
  constructor(appDirectory, {browser = findBrowser(), headless = false, root} = {}) {
    this.folder = join(appDirectory, 'research-browser');
    this.browser = browser;
    this.engine = browser.path ? (browser.engine === 'firefox' ? new FirefoxEngine(this.folder, browser.path, {headless, root}) : new ChromiumEngine(this.folder, browser.path, {headless, root})) : null;
  }
  get available() {
    return Boolean(this.engine);
  }
  get profile() {
    return this.engine?.profile;
  }
  // The address workers' tools reach the browser at, starting it when it is not
  // already running. Every project's service shares it, so a running one is reused.
  async open() {
    if (!this.engine) throw new Error('No browser researchers can drive, such as Chrome, Brave or Firefox, is installed.');
    return (await this.engine.running()) || this.engine.start();
  }
  // Opens a tab for the human, to sign in to archives: a blank one, or the page a
  // worker asked for help with. Only web pages are opened.
  async show(page = null) {
    if (page !== null && !/^https?:\/\//.test(String(page))) throw new Error('Only a web page can be opened in the research browser.');
    await this.engine.show(await this.open(), page);
  }
  // The MCP server a worker uses to reach the browser.
  mcpServer(url) {
    return this.engine.mcpServer(url);
  }
  async stop() {
    await this.engine?.stop();
  }
}

// Chrome, Brave and the other Chromium browsers: each worker's Chrome DevTools MCP
// connects to the browser itself.
class ChromiumEngine {
  constructor(folder, path, {headless, root}) {
    this.profile = join(folder, 'profile');
    this.path = path;
    this.headless = headless;
    this.root = root;
  }
  async start() {
    mkdirSync(this.profile, {recursive: true});
    rmSync(join(this.profile, 'DevToolsActivePort'), {force: true});
    const child = spawn(this.path, [
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
    return url;
  }
  async show(url, page) {
    const tab = await fetch(`${url}/json/new?${page ? encodeURI(page) : 'about:blank'}`, {method: 'PUT'}).then((r) => r.json()).catch(() => null);
    if (tab?.id) await fetch(`${url}/json/activate/${tab.id}`).catch(() => {});
  }
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

// Firefox: it allows one automation session, so a relay process holds it and
// runs every worker's browser tools through it.
class FirefoxEngine {
  constructor(folder, path, {headless, root}) {
    this.folder = folder;
    this.profile = join(folder, 'firefox-profile');
    this.relayFile = join(folder, 'firefox-relay.json');
    this.path = path;
    this.headless = headless;
    this.root = root;
  }
  relay() {
    try {
      return JSON.parse(readFileSync(this.relayFile, 'utf8'));
    } catch {
      return null;
    }
  }
  async start() {
    mkdirSync(this.folder, {recursive: true});
    // The relay's own account of a start that fails, kept for saying why.
    const logFile = join(this.folder, 'firefox-relay.log');
    const log = openSync(logFile, 'w');
    const child = spawn(process.execPath, [join(this.root, 'server', 'firefox-relay.mjs'), this.folder, this.path, ...(this.headless ? ['--headless'] : [])], {detached: true, stdio: ['ignore', log, log]});
    closeSync(log);
    child.unref();
    // A relay that fails ends the wait; one that exits cleanly found another relay running.
    let failed = false;
    child.on('exit', (code) => (failed = code !== 0));
    // Firefox makes a new profile slowly the first time, slower still on a busy machine.
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline && !failed) {
      const url = await this.running();
      if (url) return url;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    let said = '';
    try {
      // The error itself, rather than the stack and version lines around it.
      const text = readFileSync(logFile, 'utf8').trim();
      said = text.match(/^\w*Error: .*$/m)?.[0] || text.split('\n').at(-1) || '';
    } catch {
      /* No account of it. */
    }
    throw new Error(`The research browser did not start${said ? `: ${said}` : '.'}`);
  }
  // The relay's address, when it is running.
  async running() {
    const relay = this.relay();
    if (!relay) return null;
    try {
      const response = await fetch(`${relay.url}/status`, {headers: {authorization: `Bearer ${relay.token}`}, signal: AbortSignal.timeout(1500)});
      return response.ok ? relay.url : null;
    } catch {
      return null;
    }
  }
  async show(_url, page) {
    const relay = this.relay();
    await fetch(`${relay.url}/show`, {method: 'POST', headers: {authorization: `Bearer ${relay.token}`, 'content-type': 'application/json'}, body: JSON.stringify({page})}).catch(() => {});
  }
  mcpServer() {
    return {command: process.execPath, args: [join(this.root, 'server', 'firefox-mcp.mjs')], env: {RESEARCH_BROWSER_RELAY: this.relayFile}};
  }
  // Stops the relay, which quits Firefox.
  async stop() {
    const relay = this.relay();
    if (!relay) return;
    try {
      process.kill(relay.pid);
    } catch {
      /* Already closed. */
    }
  }
}
