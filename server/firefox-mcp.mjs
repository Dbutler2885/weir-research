// A worker's browser tools when the research browser is Firefox: an MCP server
// its agent CLI starts, passing each call to the relay that holds Firefox's one
// automation session. The worker's tabs close when its CLI ends.
//
// RESEARCH_BROWSER_RELAY=<relay file> node server/firefox-mcp.mjs
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { TOOLS } from './firefox-pages.mjs';

const client = randomUUID();
// The relay's address, read on every call, since Firefox and its relay may have
// been restarted since the worker began.
const relay = async (path, request) => {
  const {url, token} = JSON.parse(readFileSync(process.env.RESEARCH_BROWSER_RELAY, 'utf8'));
  const response = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'},
    body: JSON.stringify({client, ...request}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'The research browser did not answer.');
  return result;
};

const server = new Server({name: 'research-browser', version: '1.0.0'}, {capabilities: {tools: {}}});
server.setRequestHandler(ListToolsRequestSchema, async () => ({tools: TOOLS}));
server.setRequestHandler(CallToolRequestSchema, async ({params}) => {
  try {
    return await relay('/call', {name: params.name, arguments: params.arguments || {}});
  } catch {
    return {content: [{type: 'text', text: 'The research browser was closed. Carry on without it, or say in your result that you needed it.'}], isError: true};
  }
});
server.onclose = () => relay('/release', {}).catch(() => {}).finally(() => process.exit(0));
process.stdin.on('end', () => server.close());
await server.connect(new StdioServerTransport());
