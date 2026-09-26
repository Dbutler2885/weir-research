import { checkSetup, startSignIn } from './setup.mjs';
import { setupPage } from './setup-page.mjs';
import { createTopicProject, openProject, project, projects } from '../scripts/workspace-lib.mjs';

// The setup screen's routes, served on first run by the launcher and later by any
// project's service, so the human can come back to it from Research settings.
export function setupRoutes({homes, sample = null}) {
  let signingIn = null;
  let cached = null;
  // Each check runs the CLIs' own commands; a page and its polling share one.
  const check = () => {
    if (cached && Date.now() - cached.at < 1500) return cached.setup;
    cached = {at: Date.now(), setup: checkSetup({homes})};
    return cached.setup;
  };
  const current = () => {
    if (signingIn?.done) signingIn = null;
    return signingIn && {agent: signingIn.agent, url: signingIn.url};
  };
  const known = () => projects().filter((p) => p.name).map(({id, name}) => ({id, name}));
  // Handles a setup request, returning false for any other.
  return async (req, url, {json, html, body}) => {
    if (req.method === 'GET' && url.pathname === '/setup') {
      cached = null;
      return html(setupPage({setup: check(), projects: known(), signingIn: current(), sample: Boolean(sample)}));
    }
    if (req.method === 'GET' && url.pathname === '/api/setup') return json({setup: check(), signingIn: current()});
    if (req.method !== 'POST') return false;
    if (url.pathname === '/api/setup/sign-in') {
      const {agent} = await body();
      if (!['claude', 'codex'].includes(agent)) throw new Error('Sign in to claude or codex.');
      signingIn?.child?.kill();
      signingIn = startSignIn(agent, {homes});
      cached = null;
      // Give the CLI a moment to print its sign-in address.
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return json({signingIn: current()});
    }
    if (url.pathname === '/api/setup/start') {
      const {topic} = await body();
      if (typeof topic !== 'string' || !topic.trim()) throw new Error('Say what you would like to research.');
      if (!check().ready) throw new Error('Sign in to an agent first.');
      const opened = await openProject(createTopicProject(topic.trim()), {browser: false});
      return json({url: opened.url});
    }
    if (url.pathname === '/api/setup/open') {
      const {id} = await body();
      return json({url: (await openProject(project(id), {browser: false})).url});
    }
    if (url.pathname === '/api/setup/sample' && sample) return json({url: (await sample()).url});
    return false;
  };
}
