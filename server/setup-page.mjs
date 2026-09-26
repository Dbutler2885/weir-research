// The setup screen: the first thing a visitor sees. It connects the AI accounts
// the app works with, through the Claude Code and Codex apps on this computer,
// installs what is missing where it can, and asks nothing about models.

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);

// One row per account: what it is, where it stands, and the one thing to do next.
function accountRow(agent, {signingIn, installing, sandboxMissing}) {
  const via = `through ${esc(agent.label)}${agent.version ? ` <span class="version">${esc(agent.version)}</span>` : ''}`;
  let status;
  let action = '';
  if (installing?.id === agent.id) {
    status = `<p class="status is-waiting">Installing ${esc(agent.label)}…</p>`;
    action = `<button type="button" disabled>Installing…</button>`;
  } else if (!agent.installed) {
    status = `<p class="status">${esc(agent.label)} isn't on this computer yet.</p>`;
    action = `<button type="button" data-install="${agent.id}">Install ${esc(agent.label)}</button>`;
  } else if (agent.outdated) {
    status = `<p class="status is-missing">This ${esc(agent.label)} is older than the app supports.</p>`;
    action = `<button type="button" data-install="${agent.id}">Update ${esc(agent.label)}</button>`;
  } else if (agent.signedIn && sandboxMissing && agent.id === 'claude') {
    status = `<p class="status is-missing">Connected${agent.email ? ` as ${esc(agent.email)}` : ''}, but Claude Code needs the sandbox tools below before it can work.</p>`;
  } else if (agent.signedIn) {
    status = `<p class="status is-ok">Connected${agent.email ? ` as ${esc(agent.email)}` : ''}.</p>`;
  } else if (signingIn?.agent === agent.id) {
    status = `<p class="status is-waiting">Finish connecting in your browser.</p><p class="detail">${signingIn.url ? `No page opened? <a href="${esc(signingIn.url)}" target="_blank" rel="noopener">Open the sign-in page</a>. ` : ''}This page updates when you're done.</p>`;
    action = `<button type="button" disabled>Waiting…</button>`;
  } else {
    status = `<p class="status">Not connected yet.</p>`;
    action = `<button type="button" data-sign-in="${agent.id}">Connect</button>`;
  }
  const note = agent.id === 'codex' && agent.installed && !agent.signedIn
    ? `<p class="detail">The app keeps its own Codex sign-in, separate from yours, so your personal Codex setup stays out of its work.</p>`
    : '';
  return `<li class="row"><div class="row-text"><h3>${esc(agent.account)} <span class="via">${via}</span></h3>${status}${note}</div><div class="row-action">${action}</div></li>`;
}

function browserRow(d) {
  return d.ok
    ? `<li class="row"><div class="row-text"><h3>Research browser</h3><p class="status is-ok">Uses ${esc(d.name)}, with its own profile, so it never touches your own browsing.</p><p class="detail">Researchers open pages there, including archives you sign in to once.</p></div><div class="row-action"></div></li>`
    : `<li class="row"><div class="row-text"><h3>Research browser</h3><p class="status">No Chromium browser found, such as Chrome or Brave.</p><p class="detail">Researchers can still search and read the web. A browser lets them use pages that need one, and archives you sign in to.</p></div><div class="row-action"><a class="button" href="${esc(d.download)}" target="_blank" rel="noopener">Get Chrome</a></div></li>`;
}

function sandboxRow(d, installing) {
  if (d.ok)
    return `<li class="row"><div class="row-text"><h3>Sandbox tools</h3><p class="status is-ok">Installed.</p></div><div class="row-action"></div></li>`;
  const action = installing?.id === 'sandbox'
    ? '<button type="button" disabled>Installing…</button>'
    : d.canInstall ? '<button type="button" data-install="sandbox">Install</button>' : '';
  return `<li class="row"><div class="row-text"><h3>Sandbox tools</h3><p class="status is-missing">Claude Code needs ${esc(d.packages.join(' and '))} to keep its work contained.</p><p class="detail">${d.canInstall ? 'Installing asks for your computer\'s password.' : `Install them with <code>${esc(d.command)}</code> in a terminal, then come back.`}</p></div><div class="row-action">${action}</div></li>`;
}

// The whole page, drawn from a setup check. Next is where Continue leads: the
// start screen on a first visit, or back to the project the human came from.
export function setupPage({setup, signingIn = null, installing = null, installProblem = null, next = {label: 'Continue', href: '/welcome'}}) {
  const sandbox = setup.dependencies.find((d) => d.id === 'sandbox');
  const sandboxMissing = Boolean(sandbox && !sandbox.ok);
  const connected = setup.agents.filter((a) => a.installed && a.signedIn && !a.outdated);
  const rows = setup.agents.map((a) => accountRow(a, {signingIn, installing, sandboxMissing})).join('');
  const others = setup.dependencies.map((d) => (d.id === 'sandbox' ? sandboxRow(d, installing) : browserRow(d))).join('');
  const ready = setup.ready
    ? `<p class="ready-note">${connected.length > 1 ? 'Both accounts can take on any job.' : `${esc(connected[0]?.account)} can take on every job.`} You can choose which does what later, in Research settings.</p><a class="button primary" href="${esc(next.href)}">${esc(next.label)}</a>`
    : `<p class="ready-note">${sandboxMissing && setup.agents.some((a) => a.id === 'claude' && a.signedIn) ? 'Install the sandbox tools to continue.' : 'Connect an account to continue.'}</p><span class="button primary is-disabled" aria-disabled="true">${esc(next.label)}</span>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Welcome to the research workspace</title>
<style>
:root {
  --ink: #18333c; --ink-soft: #5d6d70; --paper: #f7f3e9; --paper-deep: #eee8da; --line: #c9c2b3;
  --rust: #ae4f32; --sea: #277177; --sea-dark: #164e54; --gold: #9a6f22;
  color-scheme: light;
  font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: var(--ink);
  background: #e8e3d8;
}
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; background: radial-gradient(ellipse at 50% -10%, #fbf8f1 0%, #efe9dd 45%, #e8e3d8 80%); }
.setup { max-width: 640px; margin: 0 auto; padding: 72px 24px 80px; }
.eyebrow { margin: 0 0 12px; color: var(--rust); font-size: 12px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; }
h1 { font-family: Georgia, serif; font-weight: 500; font-size: 42px; letter-spacing: -0.8px; margin: 0 0 16px; line-height: 1.12; }
.lede { font-size: 18px; line-height: 1.6; color: var(--ink-soft); margin: 0 0 40px; }
h2 { font-family: Georgia, serif; font-weight: 500; font-size: 21px; margin: 0 0 4px; }
section { padding: 26px 0 8px; border-top: 1px solid var(--line); }
.rows { list-style: none; margin: 0; padding: 0; }
.row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 20px; align-items: center; padding: 16px 0; border-bottom: 1px solid var(--paper-deep); }
.row:last-child { border-bottom: 0; }
h3 { font-size: 16px; font-weight: 600; margin: 0; }
.via { font-weight: 400; color: var(--ink-soft); font-size: 14px; margin-left: 4px; }
.version { font-size: 12px; font-variant-numeric: tabular-nums; opacity: 0.8; }
.status { margin: 5px 0 0; font-size: 15px; color: var(--ink-soft); }
.status.is-ok { color: var(--sea-dark); }
.status.is-missing { color: var(--rust); }
.status.is-waiting { color: var(--gold); }
.detail { margin: 4px 0 0; font-size: 14px; line-height: 1.55; color: var(--ink-soft); }
code { font-family: ui-monospace, monospace; font-size: 13px; background: var(--paper-deep); padding: 1px 6px; border-radius: 4px; color: var(--ink); overflow-wrap: anywhere; }
a { color: var(--sea-dark); }
button, .button { display: inline-block; font: inherit; font-size: 15px; line-height: 1.2; border-radius: 6px; border: 1px solid var(--line); background: var(--paper); color: var(--ink); padding: 9px 16px; cursor: pointer; text-decoration: none; white-space: nowrap; }
button:hover, .button:hover { border-color: var(--sea); }
button:disabled { opacity: 0.55; cursor: default; }
.primary { background: var(--sea-dark); border-color: var(--sea-dark); color: #fff; }
.primary:hover { background: var(--sea); }
.is-disabled { opacity: 0.4; pointer-events: none; }
.continue { display: flex; align-items: center; justify-content: space-between; gap: 24px; margin-top: 12px; padding-top: 26px; border-top: 1px solid var(--line); }
.ready-note { margin: 0; color: var(--ink-soft); font-size: 14px; line-height: 1.55; max-width: 420px; }
.continue .button { padding: 11px 26px; font-size: 16px; }
.problem { color: var(--rust); font-size: 14px; margin: 12px 0 0; }
.recheck { margin-top: 28px; font-size: 13px; color: var(--ink-soft); }
.recheck button { border: 0; background: none; padding: 0; color: var(--sea-dark); text-decoration: underline; text-underline-offset: 3px; font-size: 13px; }
@media (max-width: 560px) {
  .setup { padding: 40px 16px 56px; }
  h1 { font-size: 32px; }
  .row { grid-template-columns: 1fr; gap: 12px; }
  .continue { flex-direction: column; align-items: stretch; }
  .continue .button { text-align: center; }
}
</style>
</head>
<body>
<main class="setup">
<p class="eyebrow">Welcome</p>
<h1>Connect the AI you already use</h1>
<p class="lede">This workspace does its research with your own Claude or ChatGPT account, through the Claude Code or Codex app on this computer. Connect either one and you're ready; the other can come later.</p>
<section aria-labelledby="accounts-heading">
<h2 id="accounts-heading">Your AI accounts</h2>
<ul class="rows">${rows}</ul>
</section>
<section aria-labelledby="computer-heading">
<h2 id="computer-heading">On this computer</h2>
<ul class="rows">${others}</ul>
</section>
${installProblem ? `<p class="problem">${esc(installProblem)}</p>` : ''}
<p class="problem" data-problem hidden></p>
<div class="continue">${ready}</div>
<p class="recheck">Installed or connected something outside this page? <button type="button" data-check-again>Check again</button></p>
</main>
<script>
const problem = document.querySelector('[data-problem]');
const post = async (path, body) => {
  const response = await fetch(path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body || {})});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Something went wrong.');
  return result;
};
document.addEventListener('click', async (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  try {
    if (button.dataset.signIn) {
      button.disabled = true;
      await post('/api/setup/sign-in', {agent: button.dataset.signIn});
      location.reload();
    } else if (button.dataset.install) {
      button.disabled = true;
      await post('/api/setup/install', {id: button.dataset.install});
      location.reload();
    } else if (button.hasAttribute('data-check-again')) location.reload();
  } catch (error) {
    button.disabled = false;
    problem.textContent = error.message;
    problem.hidden = false;
  }
});
// Coming back from a browser sign-in or a terminal, the page checks again.
document.addEventListener('visibilitychange', () => { if (!document.hidden) location.reload(); });
${signingIn || installing ? `setInterval(async () => { const s = await (await fetch('/api/setup')).json(); if (!s.signingIn && !s.installing) location.reload(); }, 2000);` : ''}
</script>
</body>
</html>`;
}
