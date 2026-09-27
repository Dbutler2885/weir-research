// The launcher: a small service that shows the setup screen before any project
// exists, and the welcome page once a project is closed. Starting or opening a
// project hands over to that project's own service; the launcher closes once it
// has been idle for a while.
//
// node server/launcher.mjs <url-file>
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { launcherFile } from './start-launcher.mjs';
import { agentHomes } from './agents/isolation.mjs';
import { setupRoutes } from './setup-routes.mjs';
import { home } from '../scripts/workspace-lib.mjs';

const setup = setupRoutes({homes: agentHomes(resolve(home)), next: {label: 'Continue', href: '/welcome'}});
let lastRequest = Date.now();
const server = createServer(async (req, res) => {
  lastRequest = Date.now();
  const url = new URL(req.url, 'http://127.0.0.1');
  const json = (value, status = 200) => {
    res.writeHead(status, {'Content-Type': 'application/json'});
    res.end(JSON.stringify(value));
  };
  try {
    // Only this computer's own pages, as the project services require.
    const port = server.address().port;
    const host = req.headers.host;
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(host)) return json({error: 'Local host required.'}, 403);
    if (req.headers.origin && req.headers.origin !== `http://${host}`) return json({error: 'Cross-origin requests are not allowed.'}, 403);
    if (req.headers['sec-fetch-site'] === 'cross-site') return json({error: 'Open the setup screen directly.'}, 403);
    const redirect = (location) => {
      res.writeHead(302, {Location: location});
      res.end();
    };
    if (url.pathname === '/') return redirect('/setup');
    const handled = await setup(req, url, {
      json,
      redirect,
      html: (text) => {
        res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'});
        res.end(text);
      },
      body: async () => {
        let text = '';
        for await (const chunk of req) text += chunk;
        return text ? JSON.parse(text) : {};
      },
    });
    if (handled === false) json({error: 'Not found.'}, 404);
  } catch (error) {
    json({error: error.message}, 400);
  }
});
server.listen(0, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${server.address().port}`;
  mkdirSync(dirname(launcherFile), {recursive: true});
  writeFileSync(launcherFile, url);
  writeFileSync(process.argv[2], url);
});
// Idle for half an hour, the launcher has done its job.
setInterval(() => {
  if (Date.now() - lastRequest > 30 * 60_000) process.exit(0);
}, 60_000).unref();
