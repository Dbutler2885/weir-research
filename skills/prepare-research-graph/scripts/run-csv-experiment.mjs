import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, copyFileSync, unlinkSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { inspectDelivery, freezeDelivery } from './csv-delivery.mjs';

// Usage: node run-csv-experiment.mjs RUN_DIR PACKET [FOLLOWUP_FILE]
// A follow-up resumes the saved session. It never replaces earlier stream logs.
const [directory, packetPath, followupPath] = process.argv.slice(2);
if (!directory || !packetPath) throw new Error('RUN_DIR and PACKET are required');
const root = resolve(directory);
const work = join(root, 'work');
mkdirSync(work, { recursive: true });
const sessionPath = join(root, 'session.json');
const resumed = existsSync(sessionPath);
if (resumed && !followupPath) throw new Error('Existing experiment: provide a follow-up to resume; outputs are preserved');
const session = resumed ? JSON.parse(readFileSync(sessionPath, 'utf8')) : { id: randomUUID(), attempts: 0 };
session.attempts += 1;
writeFileSync(sessionPath, JSON.stringify(session, null, 2) + '\n');
const attempt = join(root, `attempt-${session.attempts}`);
mkdirSync(attempt);
if (resumed && existsSync(join(work, 'submission.txt'))) {
  copyFileSync(join(work, 'submission.txt'), join(attempt, 'prior-submission.txt'));
  unlinkSync(join(work, 'submission.txt'));
}
const skill = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (resumed) copyFileSync(join(work, 'packet.json'), join(attempt, 'previous-packet.json'));
copyFileSync(resolve(packetPath), join(attempt, 'packet.json'));
copyFileSync(join(attempt, 'packet.json'), join(work, 'packet.json'));
if (!resumed) {
  for (const name of ['graph-builder-system.md', 'contract.md']) copyFileSync(join(skill, 'references', name), join(work, name));
}
const system = readFileSync(join(work, 'graph-builder-system.md'), 'utf8');
const prompt = followupPath ? readFileSync(resolve(followupPath), 'utf8') : `Build the proposed research graph from packet.json following contract.md.
Your working directory is ${work}. Read the packet and contract with your file tools.
Create the CSV deliverables here, saving and revising your work as you go.
Choose useful divisions yourself, across as many tool calls as needed.
In the designated notes and issues, cite the evidence for proposed relationships and explain any unresolved historical questions.
Keep checkpoint.md useful for a replacement worker, and update status.txt at meaningful phase changes.
When the files are complete, write done to submission.txt and finish with a short handoff.
The coordinator will inspect the saved files and prepare the graphical walkthrough.
All work is an isolated experiment; the complete empty accepted graph is supplied in the packet.`;
writeFileSync(join(attempt, 'prompt.txt'), prompt);
writeFileSync(join(root, 'status.txt'), `Running attempt ${session.attempts}; saved work is in work/.\n`);
const args = ['--print', '--model', 'opus', '--effort', 'high', '--output-format', 'stream-json', '--verbose',
  '--restricted', '--tools', 'Read,Write,Edit,Glob,Grep', '--allowedTools', 'Read,Write,Edit,Glob,Grep',
  '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--disable-slash-commands', '--no-chrome',
  '--permission-mode', 'dontAsk', ...(resumed ? ['--resume', session.id] : ['--session-id', session.id, '--append-system-prompt', system])];
writeFileSync(join(attempt, 'invocation.json'), JSON.stringify({ args, cwd: work }, null, 2) + '\n');
const started = Date.now();
let pending = '', result;
const decoder = new StringDecoder('utf8');
const child = spawn('claude', args, { cwd: work, stdio: ['pipe', 'pipe', 'pipe'] });
// Persist every received byte immediately, including all intermediate messages.
child.stdout.on('data', chunk => {
  appendFileSync(join(attempt, 'stream.ndjson'), chunk);
  pending += decoder.write(chunk);
  let end;
  while ((end = pending.indexOf('\n')) !== -1) {
    const line = pending.slice(0, end); pending = pending.slice(end + 1);
    try { const event = JSON.parse(line); if (event.type === 'result') result = event; } catch { /* Raw bytes remain available for diagnosis. */ }
  }
});
child.stderr.on('data', chunk => appendFileSync(join(attempt, 'stderr.txt'), chunk));
child.stdin.on('error', error => appendFileSync(join(attempt, 'stderr.txt'), error.message + '\n'));
try {
  child.stdin.end(prompt);
  const code = await new Promise((accept, reject) => { child.on('error', reject); child.on('close', accept); });
  pending += decoder.end();
  if (!result && pending.trim()) { try { const event = JSON.parse(pending); if (event.type === 'result') result = event; } catch { /* Report missing result below. */ } }
  writeFileSync(join(attempt, 'result.json'), JSON.stringify({ code, milliseconds: Date.now() - started, result }, null, 2) + '\n');
  const packet = JSON.parse(readFileSync(join(work, 'packet.json'), 'utf8'));
  // The input copy must remain byte-identical to the coordinator's supplied packet.
  if (!readFileSync(join(work, 'packet.json')).equals(readFileSync(join(attempt, 'packet.json')))) throw new Error('Worker changed its input packet; inspect before continuing');
  const checked = inspectDelivery(work, packet);
  writeFileSync(join(attempt, 'validation.json'), JSON.stringify(checked.validation, null, 2) + '\n');
  if (code !== 0 || result?.is_error || !result) throw new Error(result?.result || 'Worker interrupted or failed; saved files and stream are available for recovery');
  const frozen = freezeDelivery(work, join(root, `submission-${session.attempts}`), packet);
  writeFileSync(join(root, 'status.txt'), `Complete: submission-${session.attempts}/. CSV validation passed.\n`);
  console.log(JSON.stringify(frozen.validation, null, 2));
} catch (error) {
  writeFileSync(join(root, 'status.txt'), `Needs attention: ${error.message}\nSaved work and session are preserved.\n`);
  console.error(error.message); process.exitCode = 1;
}
