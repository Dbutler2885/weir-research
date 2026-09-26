import { checkSetup, startInstall, startSignIn } from './setup.mjs';
import { setupPage } from './setup-page.mjs';
import { createTopicProject, openProject, project } from '../scripts/workspace-lib.mjs';

// The setup screen's routes, served on first run by the launcher and later by any
// project's service, so the human can come back to it from Research settings.
// Next is where its Continue button leads.
export function setupRoutes({homes, next}) {
  let signingIn = null;
  let installing = null;
  let installProblem = null;
  let cached = null;
  // Each check runs the CLIs' own commands; a page and its polling share one.
  const check = () => {
    if (cached && Date.now() - cached.at < 1500) return cached.setup;
    cached = {at: Date.now(), setup: checkSetup({homes})};
    return cached.setup;
  };
  const current = () => {
    // A sign-in is over when its CLI exits, or once the account shows as connected.
    if (signingIn && (signingIn.done || check().agents.find((a) => a.id === signingIn.agent)?.signedIn)) {
      signingIn.child?.kill();
      signingIn = null;
    }
    if (installing?.done) {
      installProblem = installing.ok
        ? null
        : /EACCES|permission denied/i.test(installing.output)
          ? 'npm needs administrator rights to install programs on this computer. Install it from a terminal with sudo, then check again.'
          : `The install did not finish. ${installing.output.trim().split('\n').at(-1) || ''}`.trim();
      installing = null;
      cached = null;
    }
    return {signingIn: signingIn && {agent: signingIn.agent, url: signingIn.url}, installing: installing && {id: installing.id}};
  };
  // Handles a setup request, returning false for any other.
  return async (req, url, {json, html, body}) => {
    if (req.method === 'GET' && url.pathname === '/setup') {
      cached = null;
      return html(setupPage({setup: check(), ...current(), installProblem, next}));
    }
    if (req.method === 'GET' && url.pathname === '/api/setup') return json({setup: check(), ...current()});
    if (req.method !== 'POST') return false;
    if (url.pathname === '/api/setup/sign-in') {
      const {agent} = await body();
      if (!['claude', 'codex'].includes(agent)) throw new Error('Connect Claude or ChatGPT.');
      signingIn?.child?.kill();
      signingIn = startSignIn(agent, {homes});
      cached = null;
      // Give the CLI a moment to print its sign-in address.
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return json(current());
    }
    if (url.pathname === '/api/setup/cancel') {
      signingIn?.child?.kill();
      signingIn = null;
      return json(current());
    }
    if (url.pathname === '/api/setup/install') {
      const {id} = await body();
      if (installing) throw new Error('Something is already installing.');
      installProblem = null;
      installing = startInstall(id);
      return json(current());
    }
    if (url.pathname === '/api/setup/start') {
      const {topic} = await body();
      if (typeof topic !== 'string' || !topic.trim()) throw new Error('Say what you would like to research.');
      if (!check().ready) throw new Error('Connect an account first.');
      const opened = await openProject(createTopicProject(topic.trim()), {browser: false});
      return json({url: opened.url});
    }
    if (url.pathname === '/api/setup/open') {
      const {id} = await body();
      return json({url: (await openProject(project(id), {browser: false})).url});
    }
    return false;
  };
}
