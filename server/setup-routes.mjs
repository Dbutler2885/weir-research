import { statSync } from 'node:fs';
import { join } from 'node:path';
import { checkSetup, startInstall, startSignIn } from './setup.mjs';
import { setupPage, welcomePage } from './setup-page.mjs';
import { choosePdfReader, pdfReading } from './pdf/reading.mjs';
import { createTopicProject, openProject, project, projects, sampleProject } from '../scripts/workspace-lib.mjs';

// The setup screen's routes, served on first run by the launcher and later by any
// project's service, so the human can come back to it from Research settings.
// Next is where its Continue button leads; home is the app's folder, beside the projects.
export function setupRoutes({home, homes, next}) {
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
  return async (req, url, {json, html, body, redirect}) => {
    if (req.method === 'GET' && url.pathname === '/setup') {
      cached = null;
      return html(setupPage({setup: check(), ...current(), installProblem, pdfReading: pdfReading(home), next}));
    }
    // Until an account is connected, there is nothing to start.
    if (req.method === 'GET' && url.pathname === '/welcome') {
      cached = null;
      if (!check().ready) return redirect('/setup');
      // Most recently worked on first, going by when each project last saved.
      const updated = (p) => {
        try {
          return statSync(join(p.directory, 'workspace.json')).mtime.toISOString();
        } catch {
          return undefined;
        }
      };
      const mine = projects().filter((p) => !p.sample).map((p) => ({...p, updated: updated(p)}));
      mine.sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
      return html(welcomePage({projects: mine}));
    }
    if (req.method === 'GET' && url.pathname === '/api/setup') return json({setup: check(), ...current(), pdfReading: pdfReading(home)});
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
    if (url.pathname === '/api/setup/pdf-reader') {
      choosePdfReader(home, (await body()).reader);
      return json({pdfReading: pdfReading(home)});
    }
    if (url.pathname === '/api/setup/start') {
      const {topic} = await body();
      if (typeof topic !== 'string' || !topic.trim()) throw new Error('Say what you would like to research.');
      if (!check().ready) throw new Error('Connect an account first.');
      const opened = await openProject(createTopicProject(topic.trim()), {browser: false});
      return json({url: opened.url});
    }
    // The sample spends nothing on opening; its coordinator waits for the visitor.
    // It opens on its Review page, where its results are.
    if (url.pathname === '/api/setup/sample') {
      const address = new URL((await openProject(await sampleProject(), {browser: false})).url);
      address.searchParams.set('view', 'review');
      return json({url: address.href});
    }
    if (url.pathname === '/api/setup/open') {
      const {id} = await body();
      return json({url: (await openProject(project(id), {browser: false})).url});
    }
    return false;
  };
}
