import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const graph = JSON.parse(readFileSync(resolve('graph-snapshot.json'), 'utf8'));
const [action, query = '', cursor = '0'] = process.argv.slice(2);
const offset = Math.max(0, Number.parseInt(cursor, 10) || 0);
let records;
if (action === 'search') records = [...graph.nodes, ...graph.claims].filter(r => query.toLowerCase().split(/\s+/).every(word => JSON.stringify(r).toLowerCase().includes(word)));
else if (action === 'inspect') records = [...graph.nodes, ...graph.claims, ...(graph.relationships || [])].filter(r => r.id === query);
else if (action === 'neighborhood') {
  const claims = graph.claims.filter(c => c.subjectId === query || c.object.entityId === query);
  const relationships = (graph.relationships || []).filter(c => c.fromId === query || c.toId === query);
  const ids = new Set([query, ...claims.flatMap(c => [c.subjectId,c.object.entityId]), ...relationships.flatMap(c => [c.fromId,c.toId])]);
  records = [...graph.nodes.filter(n => ids.has(n.id)), ...claims, ...relationships];
} else if (action === 'evidence') {
  const claim = graph.claims.find(c => c.id === query);
  records = (claim?.evidence || []).map(link => ({...link, passage: (graph.evidence || []).find(e => e.id === link.ref)}));
} else throw new Error('Use search WORDS, inspect ID, neighborhood ID, or evidence CLAIM_ID [offset].');
console.log(JSON.stringify({items: records.slice(offset, offset + 40), total: records.length, nextOffset: offset + 40 < records.length ? offset + 40 : null}, null, 2));
