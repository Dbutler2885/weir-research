import type {
  Evidence,
  Investigation,
  Proposal,
  ResearchState,
  AnnotationTarget,
} from "../domain/research";
import { sourceLibrary } from "../domain/findings";
export const html = (value: unknown): string =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export const target = (value: AnnotationTarget) =>
  `data-research-target="${html(JSON.stringify(value))}"`;
export function evidenceCard(
  state: ResearchState,
  p: Proposal,
  e: Evidence,
  findingId?: string,
  groupId?: string,
): string {
  const source = sourceLibrary(state).find((s) => s.id === e.sourceId);
  return `<article class="evidence-card" ${target({ label: source?.title || e.sourceId, proposalId: p.id, findingId, groupId })}><span class="status-badge">${html(e.stance)}</span><h4>${html(source?.title || e.sourceId)}</h4><blockquote>${html(e.quote)}</blockquote><p class="muted">${html(e.locator)}</p><div class="interpretation"><span class="eyebrow">Interpretation</span><p class="preserve-lines">${html(e.interpretation)}</p></div><details><summary>Recorded context</summary><p class="preserve-lines">${html(e.context)}</p></details><button data-evidence="${html(e.id)}">Inspect source</button></article>`;
}
