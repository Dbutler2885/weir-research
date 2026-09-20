import {html} from './finding-review';

// An escaped subset for research prose: headings, paragraphs, lists, quotations, and tables.
// Source content cannot introduce HTML, scripts, or arbitrary links.
export const researchInline = (text: string) => html(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>');
const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
const separator = (line: string) => /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/.test(line.trim());
// A pipe table: a header row, a --- separator row, then body rows.
function table(lines: string[]): string {
  const [head, rule] = lines;
  if (!head || !rule || !separator(rule)) return `<p class="preserve-lines">${researchInline(lines.join('\n'))}</p>`;
  const row = (line: string, cell: string) => `<tr>${cells(line).map(c => `<${cell}>${researchInline(c)}</${cell}>`).join('')}</tr>`;
  return `<div class="research-table"><table><thead>${row(head, 'th')}</thead><tbody>${lines.slice(2).map(l => row(l, 'td')).join('')}</tbody></table></div>`;
}
export function researchText(value: string): string {
  const output: string[] = [];
  let lines: string[] = [], kind = '';
  const flush = () => {
    if (!lines.length) return;
    const text = lines.join('\n');
    output.push(kind === 'ul' || kind === 'ol' ? `<${kind}>${lines.map(line => `<li>${researchInline(line)}</li>`).join('')}</${kind}>`
      : kind === 'quote' ? `<blockquote>${researchInline(text)}</blockquote>`
      : kind === 'heading' ? `<h3>${researchInline(text)}</h3>`
      : kind === 'table' ? table(lines)
      : `<p class="preserve-lines">${researchInline(text)}</p>`);
    lines = [];
  };
  for (const line of value.split('\n')) {
    if (!line.trim()) {flush();kind='';continue;}
    const next = /^\s*\|/.test(line) ? 'table' : /^[-*] /.test(line) ? 'ul' : /^\d+\. /.test(line) ? 'ol' : /^> ?/.test(line) ? 'quote' : /^#{1,6} /.test(line) ? 'heading' : 'paragraph';
    if (next !== kind || next === 'heading') flush();
    kind = next;
    lines.push(next === 'ul' ? line.slice(2) : next === 'ol' ? line.replace(/^\d+\. /,'') : next === 'quote' ? line.replace(/^> ?/,'') : next === 'heading' ? line.replace(/^#{1,6} /,'') : line);
  }
  flush();return output.join('');
}
