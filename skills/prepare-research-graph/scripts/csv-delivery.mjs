import { readFileSync, writeFileSync, mkdirSync, lstatSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { validateProposal } from './validate-proposal.mjs';

export const csvFiles = ['proposal', 'nodes', 'node-evidence', 'claims', 'claim-evidence', 'groups', 'identities', 'coverage', 'issues', 'representation-notes'].map(n => `${n}.csv`);

export function renderReview(graph) {
  const cell = value => String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
  const label = id => graph.nodes.find(node => node.id === id)?.label || id;
  const relationships = graph.claims.filter(claim => claim.object.entityId);
  return [
    `# ${graph.title}`, graph.summary,
    'This is the builder\'s proposed representation, awaiting coordinator review.\nThe graphical walkthrough is a separate coordinator artifact.',
    `${graph.nodes.length} nodes, ${graph.claims.length} claims, ${relationships.length} relationships, ${graph.groups.length} proposal groups.`,
    '## Nodes', '| ID | Label | Kind |', '| --- | --- | --- |',
    ...graph.nodes.map(node => `| ${cell(node.id)} | ${cell(node.label)} | ${cell(node.kind)} |`),
    '## Relationships', '| ID | From | Relationship | To | Qualification |', '| --- | --- | --- | --- | --- |',
    ...relationships.map(claim => `| ${cell(claim.id)} | ${cell(label(claim.subjectId))} | ${cell(claim.predicate)} | ${cell(label(claim.object.entityId))} | ${cell(claim.qualification)} |`),
    '## Properties and observations', '| ID | Subject | Property | Value | Qualification |', '| --- | --- | --- | --- | --- |',
    ...graph.claims.filter(claim => !claim.object.entityId).map(claim => `| ${cell(claim.id)} | ${cell(label(claim.subjectId))} | ${cell(claim.predicate)} | ${cell(claim.object.value)} | ${cell(claim.qualification)} |`),
    '## Representation notes', ...graph.representationNotes.map(note => `### ${note.id}\n\n${note.decision}\n\n${note.reason}\n\nAffected nodes: ${note.nodeIds.map(label).join(', ')}.`),
    '## Open issues', ...graph.issues.map(issue => `### ${issue.id}\n\n${issue.question}\n\n${issue.provisionalTreatment}\n\nSuggested research: ${issue.requestedResearch || 'None required.'}`),
    '## Findings left outside the graph', ...graph.coverage.filter(row => !row.nodeIds.length && !row.claimIds.length).map(row => `- ${row.findingRef}: ${row.omissionReason}`),
  ].join('\n\n') + '\n';
}

export function inspectDelivery(directory, packet) {
  const converted = spawnSync('python3', [join(dirname(fileURLToPath(import.meta.url)), 'read-csv-proposal.py'), directory], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (converted.error || converted.status !== 0) return { validation: { valid: false, errors: [converted.error?.message || converted.stderr.trim() || 'CSV reader failed'] } };
  try {
    const graph = JSON.parse(converted.stdout);
    return { graph, validation: validateProposal(graph, packet) };
  } catch (error) {
    return { validation: { valid: false, errors: [error.message] } };
  }
}

// Call after the worker exits, so it cannot race inspection with another edit.
// The destination is exclusively created and kept outside the worker's directory.
export function freezeDelivery(directory, destination, packet) {
  const signal = join(directory, 'submission.txt');
  if (!lstatSync(signal).isFile() || readFileSync(signal, 'utf8').trim() !== 'done') throw new Error('Explicit done submission required');
  const result = inspectDelivery(directory, packet);
  if (!result.validation.valid) throw new Error(result.validation.errors.join('\n'));
  mkdirSync(destination);
  const hashes = {};
  for (const name of [...csvFiles, 'submission.txt', 'notes.md', 'checkpoint.md']) {
    const path = join(directory, name);
    try {
      if (!lstatSync(path).isFile()) throw new Error(`${name} must be a regular file`);
    } catch (error) {
      if (error.code === 'ENOENT' && ['notes.md', 'checkpoint.md'].includes(name)) continue;
      throw error;
    }
    const bytes = readFileSync(path);
    writeFileSync(join(destination, name), bytes, { flag: 'wx' });
    hashes[name] = createHash('sha256').update(bytes).digest('hex');
  }
  // Generated internal representation; the agent delivers only CSVs and notes.
  writeFileSync(join(destination, 'graph.json'), JSON.stringify(result.graph, null, 2) + '\n', { flag: 'wx' });
  writeFileSync(join(destination, 'validation.json'), JSON.stringify(result.validation, null, 2) + '\n', { flag: 'wx' });
  writeFileSync(join(destination, 'review.md'), renderReview(result.graph), { flag: 'wx' });
  writeFileSync(join(destination, 'manifest.json'), JSON.stringify({ baseGraphRevision: packet.baseGraphRevision, researchRevision: packet.researchRevision, hashes }, null, 2) + '\n', { flag: 'wx' });
  return result;
}
