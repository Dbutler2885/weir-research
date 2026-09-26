// The setup screen: the first thing a visitor sees. It says which agent CLIs the
// app found and whether each is signed in, starts a provider's own sign-in, names
// anything else missing with the command that installs it, and starts research.
// It asks nothing about models.

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);

// A row per agent. Until one is ready, a missing sign-in is what stands in the way;
// once one is, the other is optional.
function agentRow(agent, signingIn, ready, missing) {
  let status;
  let action = '';
  if (!agent.installed) {
    status = `<p class="status ${ready ? 'is-optional' : 'is-missing'}">Not installed.${ready ? ' Optional.' : ''}</p><p class="how">Install it with <code>${esc(agent.install)}</code>, then check again.</p>`;
  } else if (agent.update) {
    status = `<p class="status is-missing">This version is older than the app supports.</p><p class="how">${esc(agent.update.split(': ')[0])} with <code>${esc(agent.update.split(': ')[1])}</code>.</p>`;
  } else if (agent.signedIn && agent.id === 'claude' && missing.length) {
    status = `<p class="status is-missing">Signed in${agent.account ? ` as ${esc(agent.account)}` : ''}, but it needs ${esc(missing.map((d) => d.label).join(' and '))}, below, before it can run.</p>`;
  } else if (agent.signedIn) {
    status = `<p class="status is-ok">Signed in${agent.account ? ` as ${esc(agent.account)}` : ''}.</p>`;
  } else if (signingIn?.agent === agent.id) {
    status = `<p class="status is-waiting">Finish signing in in your browser.</p><p class="how">${signingIn.url ? `If no page opened, <a href="${esc(signingIn.url)}" target="_blank" rel="noopener">open the sign-in page</a>. ` : ''}This page updates when you are done.</p>`;
  } else {
    status = `<p class="status ${ready ? 'is-optional' : 'is-missing'}">${agent.id === 'codex' ? 'Not signed in for this app.' : 'Not signed in.'}${ready ? ' Optional: you can use it too.' : ''}</p>${agent.id === 'codex' ? `<p class="how">Codex agents use the app's own Codex home, so your personal Codex setup stays out of them. Sign in once here.</p>` : ''}`;
    action = `<button type="button" ${ready ? '' : 'class="primary"'} data-sign-in="${agent.id}">Sign in to ${esc(agent.label)}</button>`;
  }
  return `<li class="check"><div class="check-head"><h3>${esc(agent.label)}</h3>${agent.version ? `<span class="version">${esc(agent.version)}</span>` : ''}</div>${status}${action ? `<div class="check-action">${action}</div>` : ''}</li>`;
}

function dependencyRow(d) {
  const how = d.install.startsWith('Download')
    ? `<a href="${esc(d.install.split(' ').find((w) => w.startsWith('https://')))}" target="_blank" rel="noopener">Download Google Chrome</a>, then check again.`
    : `Install it with <code>${esc(d.install)}</code>, then check again.`;
  const missing = d.required
    ? '<p class="status is-missing">Not found. Claude Code needs it to keep its agents in their folders.</p>'
    : '<p class="status is-optional">Not found. Researchers can still search and read the web without it.</p>';
  return `<li class="check"><div class="check-head"><h3>${esc(d.label)}</h3></div><p class="purpose">${esc(d.purpose)}.</p>${d.ok ? '<p class="status is-ok">Installed.</p>' : `${missing}<p class="how">${how}</p>`}</li>`;
}

// The whole page, drawn from a setup check and the projects that already exist.
export function setupPage({setup, projects = [], signingIn = null, sample = false}) {
  // Packages an agent cannot run without, such as Claude Code's sandbox on Linux.
  const missing = setup.dependencies.filter((d) => d.required && !d.ok);
  const first = setup.agents.find((a) => a.installed && a.signedIn && !a.update && (a.id !== 'claude' || !missing.length));
  const blocked = !setup.ready && setup.agents.some((a) => a.signedIn && !a.update);
  const projectList = projects.length
    ? `<div class="projects"><h3>Your projects</h3><ul>${projects.map((p) => `<li><button type="button" class="text-action" data-open-project="${esc(p.id)}">${esc(p.name)}</button></li>`).join('')}</ul></div>`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Set up the research workspace</title>
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
body { margin: 0; min-height: 100vh; background: radial-gradient(ellipse at 50% 0%, #f5f1e7, #e8e3d8 70%); }
.setup { max-width: 680px; margin: 0 auto; padding: 64px 24px 80px; }
.eyebrow { margin: 0 0 10px; color: var(--rust); font-size: 12px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; }
h1 { font-family: Georgia, serif; font-weight: 500; font-size: 40px; letter-spacing: -0.8px; margin: 0 0 14px; line-height: 1.1; }
.lede { font-size: 17px; line-height: 1.6; color: var(--ink-soft); margin: 0 0 32px; }
h2 { font-family: Georgia, serif; font-weight: 500; font-size: 22px; margin: 0 0 6px; }
section { padding: 24px 0; border-top: 1px solid var(--line); }
.checks { list-style: none; margin: 0; padding: 0; }
.check { padding: 16px 0; border-bottom: 1px solid var(--paper-deep); }
.check:last-child { border-bottom: 0; }
.check-head { display: flex; align-items: baseline; gap: 10px; }
h3 { font-size: 16px; font-weight: 600; margin: 0; }
.version { color: var(--ink-soft); font-size: 13px; font-variant-numeric: tabular-nums; }
.status { margin: 6px 0 0; font-size: 15px; }
.status.is-ok { color: var(--sea-dark); }
.status.is-missing { color: var(--rust); }
.status.is-waiting { color: var(--gold); }
.status.is-optional { color: var(--ink-soft); }
.purpose, .how { margin: 4px 0 0; font-size: 14px; line-height: 1.55; color: var(--ink-soft); }
.check-action { margin-top: 12px; }
code { font-family: ui-monospace, monospace; font-size: 13px; background: var(--paper-deep); padding: 1px 6px; border-radius: 4px; color: var(--ink); overflow-wrap: anywhere; }
a { color: var(--sea-dark); }
.note { margin: 4px 0 0; color: var(--ink-soft); font-size: 14px; line-height: 1.6; }
button { font: inherit; font-size: 15px; border-radius: 6px; border: 1px solid var(--line); background: var(--paper); color: var(--ink); padding: 9px 16px; cursor: pointer; }
button:hover { border-color: var(--sea); }
button.primary { background: var(--sea-dark); border-color: var(--sea-dark); color: #fff; }
button.primary:hover { background: var(--sea); }
button:disabled { opacity: 0.45; cursor: not-allowed; }
.text-action { border: 0; background: none; padding: 0; color: var(--sea-dark); text-decoration: underline; text-underline-offset: 3px; }
.start label { display: block; font-size: 15px; margin: 12px 0 8px; }
.start-row { display: flex; gap: 10px; }
.start input { flex: 1; min-width: 0; font: inherit; font-size: 16px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--paper); color: var(--ink); }
.start input:focus { outline: 2px solid var(--sea); outline-offset: 1px; }
.start .how { margin-top: 10px; }
.projects { margin-top: 28px; }
.projects ul { list-style: none; margin: 8px 0 0; padding: 0; }
.projects li { padding: 5px 0; }
.check-again { padding-top: 24px; border-top: 1px solid var(--line); font-size: 14px; color: var(--ink-soft); }
.problem { color: var(--rust); font-size: 14px; margin: 10px 0 0; }
@media (max-width: 560px) {
  .setup { padding: 36px 16px 56px; }
  h1 { font-size: 32px; }
  .start-row { flex-direction: column; }
}
</style>
</head>
<body>
<main class="setup">
<p class="eyebrow">Research workspace</p>
<h1>Set up your research agents</h1>
<p class="lede">The app does its research on your computer with Claude Code or Codex. One of them, signed in, is enough to begin.</p>
<section aria-labelledby="agents-heading">
<h2 id="agents-heading">Agents</h2>
<ul class="checks">${setup.agents.map((a) => agentRow(a, signingIn, setup.ready, missing)).join('')}</ul>
<p class="note">${first ? `Every job starts with ${esc(first.label)}, using its own default model and effort.` : 'Every job starts with the agent you sign in to, using its own default model and effort.'} You can change which agent, model and effort does each job later, in Research settings.</p>
</section>
<section class="start" aria-labelledby="start-heading">
<h2 id="start-heading">Start researching</h2>
<form data-start>
<label for="topic">What would you like to research?</label>
<div class="start-row"><input id="topic" name="topic" autocomplete="off" required ${setup.ready ? '' : 'disabled'} placeholder="A place, a family, a question"><button class="primary" ${setup.ready ? '' : 'disabled'}>Start</button></div>
${setup.ready ? '' : `<p class="how">${blocked ? 'Install what is missing below to start.' : 'Sign in to an agent above to start.'}</p>`}
${sample ? '<p class="how">Or <button type="button" class="text-action" data-open-sample>open the sample project</button> to see what the app does before spending anything.</p>' : ''}
</form>
<p class="problem" data-problem hidden></p>
${projectList}
</section>
<section aria-labelledby="needed-heading">
<h2 id="needed-heading">Also used</h2>
<ul class="checks">${setup.dependencies.map(dependencyRow).join('')}</ul>
</section>
<p class="check-again">Installed something or signed in elsewhere? <button type="button" class="text-action" data-check-again>Check again</button></p>
</main>
<script>
const problem = document.querySelector('[data-problem]');
const post = async (path, body) => {
  const response = await fetch(path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body || {})});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Something went wrong.');
  return result;
};
const show = (error) => { problem.textContent = error.message; problem.hidden = false; };
document.addEventListener('click', async (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  try {
    if (button.dataset.signIn) {
      button.disabled = true;
      await post('/api/setup/sign-in', {agent: button.dataset.signIn});
      location.reload();
    } else if (button.dataset.openProject) location.href = (await post('/api/setup/open', {id: button.dataset.openProject})).url;
    else if (button.hasAttribute('data-open-sample')) location.href = (await post('/api/setup/sample')).url;
    else if (button.hasAttribute('data-check-again')) location.reload();
  } catch (error) { button.disabled = false; show(error); }
});
document.querySelector('[data-start]').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.target.querySelector('button');
  button.disabled = true;
  try { location.href = (await post('/api/setup/start', {topic: event.target.topic.value})).url; }
  catch (error) { button.disabled = false; show(error); }
});
// While a sign-in is under way, the page follows it and updates when it is done.
${signingIn ? `setInterval(async () => { const s = await (await fetch('/api/setup')).json(); if (!s.signingIn || s.setup.agents.find((a) => a.id === ${JSON.stringify(signingIn.agent)})?.signedIn) location.reload(); }, 2000);` : ''}
</script>
</body>
</html>`;
}
