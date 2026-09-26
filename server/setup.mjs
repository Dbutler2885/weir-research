import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { executableOnPath } from './researchers.mjs';
import { findBrowser } from './research-browser.mjs';
import { TESTED_CODEX } from './agents/codex.mjs';

const output = (command, args, env) => {
  const result = spawnSync(command, args, {encoding: 'utf8', timeout: 20_000, env: env || process.env});
  return {ok: result.status === 0, stdout: result.stdout || '', stderr: result.stderr || ''};
};
const version = (text) => text.match(/\d+\.\d+\.\d+/)?.[0] || null;
const older = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number));
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i];
  return false;
};

// Which Linux family this is, for the install command of anything missing.
function linuxInstaller(read = (file) => readFileSync(file, 'utf8')) {
  try {
    const release = read('/etc/os-release');
    if (/ID(_LIKE)?=.*(fedora|rhel|centos)/.test(release)) return 'sudo dnf install';
    if (/ID(_LIKE)?=.*arch/.test(release)) return 'sudo pacman -S';
  } catch {
    /* Unknown distribution. */
  }
  return 'sudo apt install';
}

// What the app needs, and where each part stands: the agent CLIs, whether each is
// signed in by its own status command, and the tools the research browser and
// sandboxes use. It reads no credentials; the CLIs report on themselves.
export function checkSetup({findExecutable = executableOnPath, homes = null, run = output, platform = process.platform, browser = findBrowser, installer = linuxInstaller} = {}) {
  const claudePath = findExecutable('claude');
  const codexPath = findExecutable('codex');
  const claude = {id: 'claude', label: 'Claude Code', account: 'Claude', installed: Boolean(claudePath), package: '@anthropic-ai/claude-code'};
  if (claudePath) {
    claude.version = version(run(claudePath, ['--version']).stdout);
    try {
      const status = JSON.parse(run(claudePath, ['auth', 'status', '--json']).stdout);
      claude.signedIn = Boolean(status.loggedIn);
      claude.email = status.email || null;
    } catch {
      claude.signedIn = false;
    }
  }
  const codex = {id: 'codex', label: 'Codex', account: 'ChatGPT', installed: Boolean(codexPath), package: '@openai/codex'};
  if (codexPath) {
    codex.version = version(run(codexPath, ['--version']).stdout);
    // Codex agents use the app's own Codex home, so it is that home that must be signed in.
    const env = homes ? {...process.env, CODEX_HOME: homes.codexHome, HOME: homes.home} : process.env;
    codex.signedIn = run(codexPath, ['login', 'status'], env).ok;
    if (codex.version && older(codex.version, TESTED_CODEX)) codex.outdated = TESTED_CODEX;
  }
  // The research browser is any Chromium browser, used with its own profile.
  const found = browser();
  const dependencies = [
    {id: 'browser', label: 'Research browser', required: false, ok: Boolean(found.path), name: found.name, isDefault: found.isDefault, unsupportedDefault: found.unsupportedDefault},
  ];
  // Claude Code's sandbox needs two packages on Linux; they install together.
  if (platform === 'linux') {
    const missing = ['bubblewrap', 'socat'].filter((p) => !findExecutable(p === 'bubblewrap' ? 'bwrap' : p));
    dependencies.push({id: 'sandbox', label: 'Sandbox tools', required: true, ok: !missing.length, packages: missing, command: `${installer()} ${missing.join(' ')}`, canInstall: Boolean(findExecutable('pkexec'))});
  }
  const agents = [claude, codex];
  // Claude Code cannot sandbox its agents on Linux without its packages.
  const sandboxed = dependencies.filter((d) => d.required).every((d) => d.ok);
  const usable = (a) => a.installed && a.signedIn && !a.outdated && (a.id !== 'claude' || sandboxed);
  return {agents, dependencies, ready: agents.some(usable)};
}

// Starts a CLI's own sign-in, which opens the provider's page in the browser. The
// app only watches for the address it prints, in case the browser did not open.
export function startSignIn(agent, {findExecutable = executableOnPath, homes = null, launch = spawn} = {}) {
  const executable = findExecutable(agent);
  if (!executable) throw new Error(`${agent === 'codex' ? 'Codex' : 'Claude Code'} is not installed.`);
  const args = agent === 'codex' ? ['login'] : ['auth', 'login'];
  const env = agent === 'codex' && homes ? {...process.env, CODEX_HOME: homes.codexHome, HOME: homes.home} : process.env;
  const child = launch(executable, args, {env, stdio: ['ignore', 'pipe', 'pipe']});
  const flow = {agent, started: Date.now(), url: null, done: false, child};
  const find = (chunk) => {
    flow.url ||= chunk.toString().match(/https:\/\/\S+/)?.[0] || null;
  };
  child.stdout?.on('data', find);
  child.stderr?.on('data', find);
  child.on('close', (code) => {
    flow.done = true;
    flow.code = code;
  });
  child.on('error', () => {
    flow.done = true;
    flow.code = 1;
  });
  // A sign-in left unfinished stops after ten minutes.
  setTimeout(() => child.kill(), 600_000).unref();
  return flow;
}

// Installs what the app needs without a terminal: an agent CLI through npm, or on
// Linux the sandbox packages through the system's own password prompt.
export function startInstall(id, {platform = process.platform, installer = linuxInstaller, launch = spawn} = {}) {
  const npm = platform === 'win32' ? 'npm.cmd' : 'npm';
  const commands = {
    claude: [npm, ['install', '-g', '@anthropic-ai/claude-code']],
    codex: [npm, ['install', '-g', '@openai/codex']],
    sandbox: ['pkexec', [...installer().replace(/^sudo /, '').split(' '), installer().includes('pacman') ? '--noconfirm' : '-y', 'bubblewrap', 'socat']],
  };
  if (!commands[id]) throw new Error('Nothing to install by that name.');
  const [command, args] = commands[id];
  const child = launch(command, args, {stdio: ['ignore', 'pipe', 'pipe']});
  const flow = {id, done: false, ok: false, output: ''};
  const keep = (chunk) => {
    flow.output = (flow.output + chunk.toString()).slice(-4000);
  };
  child.stdout?.on('data', keep);
  child.stderr?.on('data', keep);
  child.on('close', (code) => Object.assign(flow, {done: true, ok: code === 0}));
  child.on('error', (error) => Object.assign(flow, {done: true, ok: false, output: error.message}));
  return flow;
}