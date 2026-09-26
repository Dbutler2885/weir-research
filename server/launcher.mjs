// The first-run launcher: a small service that shows the setup screen before any
// project exists. Starting or opening a project hands over to that project's own
// service; the launcher closes once it has been idle for a while.
//
// node server/launcher.mjs <url-file>
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
    if (url.pathname === '/') {
      res.writeHead(302, {Location: '/setup'});
      return res.end();
    }
    const handled = await setup(req, url, {
      json,
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
  writeFileSync(process.argv[2], `http://127.0.0.1:${server.address().port}/setup`);
});
// Idle for half an hour, the launcher has done its job.
setInterval(() => {
  if (Date.now() - lastRequest > 30 * 60_000) process.exit(0);
}, 60_000).unref();
