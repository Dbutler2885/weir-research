import {html} from './finding-review';

// An escaped subset for research prose: headings, paragraphs, lists, and quotations.
// Source content cannot introduce HTML, scripts, or arbitrary links.
export const researchInline = (text: string) => html(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>');
export function researchText(value: string): string {
  const output: string[] = [];
  let lines: string[] = [], kind = '';
  const flush = () => {
    if (!lines.length) return;
    const text = lines.join('\n');
    output.push(kind === 'ul' || kind === 'ol' ? `<${kind}>${lines.map(line => `<li>${researchInline(line)}</li>`).join('')}</${kind}>`
      : kind === 'quote' ? `<blockquote>${researchInline(text)}</blockquote>`
      : kind === 'heading' ? `<h3>${researchInline(text)}</h3>`
      : `<p class="preserve-lines">${researchInline(text)}</p>`);
    lines = [];
  };
  for (const line of value.split('\n')) {
    if (!line.trim()) {flush();kind='';continue;}
    const next = /^[-*] /.test(line) ? 'ul' : /^\d+\. /.test(line) ? 'ol' : /^> ?/.test(line) ? 'quote' : /^#{1,6} /.test(line) ? 'heading' : 'paragraph';
    if (next !== kind || next === 'heading') flush();
    kind = next;
    lines.push(next === 'ul' ? line.slice(2) : next === 'ol' ? line.replace(/^\d+\. /,'') : next === 'quote' ? line.replace(/^> ?/,'') : next === 'heading' ? line.replace(/^#{1,6} /,'') : line);
  }
  flush();return output.join('');
}
