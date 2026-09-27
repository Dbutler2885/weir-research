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
    status = `<p class="status is-waiting">A ${esc(agent.account)} sign-in page opened in your browser.</p><p class="detail">Sign in there, then come back; this page notices by itself.${signingIn.url ? ` Didn't see it? <a href="${esc(signingIn.url)}" target="_blank" rel="noopener">Open the sign-in page</a>.` : ''}</p>`;
    action = `<button type="button" data-cancel-sign-in>Cancel</button>`;
  } else {
    status = `<p class="status">Not connected yet.</p>`;
    action = `<button type="button" data-sign-in="${agent.id}">Connect</button>`;
  }
  const note = agent.id === 'codex' && agent.installed && !agent.signedIn
    ? `<p class="detail">The app keeps its own Codex sign-in, separate from yours, so your personal Codex setup stays out of its work.</p>`
    : '';
  return `<li class="row"><div class="row-text"><h3>${esc(agent.account)} <span class="via">${via}</span></h3>${status}${note}</div><div class="row-action">${action}</div></li>`;
}

// The research browser: the human's own default when researchers can drive it,
// always with a separate profile.
function browserRow(d) {
  let status;
  let detail;
  if (d.ok && d.isDefault) {
    status = `Uses ${esc(d.name)}, your default browser, with a separate profile so it never touches your own browsing.`;
    detail = 'Researchers open pages there, including archives you sign in to once.';
  } else if (d.ok) {
    status = `Uses ${esc(d.name)}, with a separate profile so it never touches your own browsing.`;
    detail = d.unsupportedDefault
      ? `Researchers can't drive ${esc(d.unsupportedDefault)}, your default, so they use ${esc(d.name)} instead.`
      : 'Researchers open pages there, including archives you sign in to once.';
  } else {
    status = 'Researchers can search and read the web without one.';
    detail = `For pages that need a real browser, they drive Chrome, Brave, Edge, Firefox or Chromium${d.unsupportedDefault ? `; ${esc(d.unsupportedDefault)} can't be driven` : ''}. Install one whenever you like.`;
  }
  return `<li class="row"><div class="row-text"><h3>Research browser</h3><p class="status${d.ok ? ' is-ok' : ''}">${status}</p><p class="detail">${detail}</p></div><div class="row-action"></div></li>`;
}

function sandboxRow(d, installing) {
  if (d.ok)
    return `<li class="row"><div class="row-text"><h3>Sandbox tools</h3><p class="status is-ok">Installed.</p></div><div class="row-action"></div></li>`;
  const action = installing?.id === 'sandbox'
    ? '<button type="button" disabled>Installing…</button>'
    : d.canInstall ? '<button type="button" data-install="sandbox">Install</button>' : '';
  return `<li class="row"><div class="row-text"><h3>Sandbox tools</h3><p class="status is-missing">Claude Code needs ${esc(d.packages.join(' and '))} to keep its work contained.</p><p class="detail">${d.canInstall ? 'Installing asks for your computer\'s password.' : `Install them with <code>${esc(d.command)}</code> in a terminal, then come back.`}</p></div><div class="row-action">${action}</div></li>`;
}

// The look the setup and welcome screens share.
const STYLE = `:root {
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
`;

// The whole page, drawn from a setup check. Next is where Continue leads: the
// start screen on a first visit, or back to the project the human came from.
export function setupPage({setup, signingIn = null, installing = null, installProblem = null, next = {label: 'Continue', href: '/welcome'}}) {
  const sandbox = setup.dependencies.find((d) => d.id === 'sandbox');
  const sandboxMissing = Boolean(sandbox && !sandbox.ok);
  const connected = setup.agents.filter((a) => a.installed && a.signedIn && !a.outdated);
  const rows = setup.agents.map((a) => accountRow(a, {signingIn, installing, sandboxMissing})).join('');
  const others = setup.dependencies.map((d) => (d.id === 'sandbox' ? sandboxRow(d, installing) : browserRow(d))).join('');
  const ready = setup.ready
    ? `<p class="ready-note">${connected.length > 1 ? 'Both accounts can take on any job.' : `${esc(connected[0]?.account)} can take on every job.`} You can choose which does what, and with which model, later in Research settings.</p><a class="button primary" href="${esc(next.href)}">${esc(next.label)}</a>`
    : `<p class="ready-note">${sandboxMissing && setup.agents.some((a) => a.id === 'claude' && a.signedIn) ? 'Install the sandbox tools to continue.' : 'Connect an account to continue.'}</p><span class="button primary is-disabled" aria-disabled="true">${esc(next.label)}</span>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Welcome to the research workspace</title>
<style>
${STYLE}</style>
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
    } else if (button.hasAttribute('data-cancel-sign-in')) {
      await post('/api/setup/cancel');
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

// Where Continue leads on a first visit: start a project, open one already made,
// or look around the fictional sample first.
/** @param {{projects?: {id: string, name: string}[]}} options */
export function welcomePage({projects = []}) {
  const rows = projects.map((p) => `<li class="row"><div class="row-text"><h3>${esc(p.name)}</h3></div><div class="row-action"><button type="button" data-open="${esc(p.id)}">Open</button></div></li>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Start researching</title>
<style>
${STYLE}
.topic { display: grid; gap: 14px; margin: 0 0 44px; }
.topic textarea { font: inherit; font-size: 17px; line-height: 1.5; color: var(--ink); background: #fffdf8; border: 1px solid var(--line); border-radius: 6px; padding: 12px 14px; resize: vertical; min-height: 84px; }
.topic textarea:focus { outline: 2px solid var(--sea); outline-offset: 1px; border-color: var(--sea); }
.topic .button { justify-self: end; padding: 11px 26px; font-size: 16px; }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
</style>
</head>
<body>
<main class="setup">
<p class="eyebrow">Welcome</p>
<h1>What would you like to research?</h1>
<p class="lede">Name a person, a family or a question. Your coordinator plans the research with you from there.</p>
<form class="topic" data-start>
<label class="visually-hidden" for="topic">Your research topic</label>
<textarea id="topic" name="topic" maxlength="300" required placeholder="For example, where my great-grandparents came from"></textarea>
<button class="button primary">Start researching</button>
</form>
${rows ? `<section aria-labelledby="projects-heading"><h2 id="projects-heading">Your projects</h2><ul class="rows">${rows}</ul></section>` : ''}
<section aria-labelledby="sample-heading">
<h2 id="sample-heading">Or look around first</h2>
<ul class="rows"><li class="row"><div class="row-text"><h3>Sample project</h3><p class="detail">Finished research on an invented family, with its sources, findings and a draft family graph to review. It uses nothing from your account until you write to it.</p></div><div class="row-action"><button type="button" data-sample>Open the sample</button></div></li></ul>
</section>
<p class="problem" data-problem hidden></p>
<p class="recheck"><a href="/setup">Back to setup</a></p>
</main>
<script>
const problem = document.querySelector('[data-problem]');
const post = async (path, body) => {
  const response = await fetch(path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body || {})});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Something went wrong.');
  return result;
};
// Opening a project starts its own service, which takes a moment.
const go = async (control, path, body, busy) => {
  const label = control.textContent;
  control.disabled = true;
  control.textContent = busy;
  problem.hidden = true;
  try {
    location.href = (await post(path, body)).url;
  } catch (error) {
    control.disabled = false;
    control.textContent = label;
    problem.textContent = error.message;
    problem.hidden = false;
  }
};
document.querySelector('[data-start]').addEventListener('submit', (event) => {
  event.preventDefault();
  go(event.target.querySelector('button'), '/api/setup/start', {topic: event.target.topic.value}, 'Starting…');
});
document.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (button?.dataset.open) go(button, '/api/setup/open', {id: button.dataset.open}, 'Opening…');
  else if (button?.hasAttribute('data-sample')) go(button, '/api/setup/sample', {}, 'Opening…');
});
</script>
</body>
</html>`;
}
