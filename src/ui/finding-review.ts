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
export function findingReview(
  state: ResearchState,
  i: Investigation,
  p: Proposal,
  mode: string,
  index: number,
  selectedGroups?: Set<string>,
): string {
  const findings = p.findings || [];
  const groups = p.groups || [];
  const count = p.kind === "findings" ? findings.length : groups.length;
  const selected = Math.min(index, Math.max(0, count - 1));
  const cards =
    p.kind === "findings"
      ? findings
          .map(
            (
              f,
              n,
            ) => `<section class="decision-card" ${mode === "cards" && n !== selected ? "hidden" : ""} ${target({ label: f.statement, proposalId: p.id, findingId: f.id })}>
 <div class="detail-topline"><span class="status-badge">${html(f.qualification)}</span><strong>${html(f.status)}</strong></div><h3>${html(f.statement)}</h3><p class="preserve-lines">${html(f.explanation)}</p>${f.replaces ? '<p class="revision-note">Revises an earlier finding. Keeping this version supersedes that finding; its history remains available.</p>' : ""}
 ${
   f.evidenceIds
     .map((id) => p.evidence.find((e) => e.id === id))
     .filter(Boolean)
     .map((e) => evidenceCard(state, p, e!, f.id))
     .join("") ||
   '<p class="muted">No supporting passage yet. This records an unresolved question.</p>'
 }
 <div class="decision-actions">${f.status !== "superseded" ? `<button class="primary" data-keep-finding="${html(f.id)}" ${f.status === "kept" ? "disabled" : ""}>Keep finding</button><button data-defer-finding="${html(f.id)}" ${f.status === "deferred" ? "disabled" : ""}>Set aside</button><button data-question-finding="${html(f.id)}">Question or revise</button>` : ""}</div>
 </section>`,
          )
          .join("")
      : groups
          .map(
            (
              g,
              n,
            ) => `<section class="decision-card" ${mode === "cards" && n !== selected ? "hidden" : ""} ${target({ label: g.title, proposalId: p.id, groupId: g.id })}><div class="detail-topline"><span class="status-badge">${html(g.status)}</span>${g.status === "pending" && p.status === "pending" ? `<label><input type="checkbox" data-graph-group="${html(g.id)}" ${selectedGroups?.has(g.id) ? "checked" : ""}> Include in graph preview</label>` : ""}</div><h3>${html(g.title)}</h3>${g.dependsOn.length ? `<p>Requires: ${g.dependsOn.map((id) => html(groups.find((x) => x.id === id)?.title)).join(", ")}. Select these groups too unless already accepted.</p>` : ""}
 ${g.findingRefs
   .map((r) => {
     const f = i.proposals
       .find((p) => p.id === r.proposalId)
       ?.findings?.find((f) => f.id === r.findingId);
     return `<p class="muted">From kept finding: ${html(f?.statement)}</p>`;
   })
   .join("")}
 ${g.changeIndexes
   .map((n) => {
     const c = p.changes[n]!;
     return `<div class="graph-change" ${target({ label: String(c.after?.name || c.after?.label || c.recordId), table: c.table, recordId: c.recordId, proposalId: p.id, groupId: g.id })}><h4>${html(c.after === null ? "Remove" : c.before === null ? "Add" : "Revise")}: ${html(c.after?.name || c.after?.label || c.before?.name || c.recordId)}</h4><p>${html(c.reason)}</p><details><summary>Exact record comparison</summary><div class="change-comparison"><pre>${html(JSON.stringify(c.before, null, 2))}</pre><pre>${html(JSON.stringify(c.after, null, 2))}</pre></div></details>${c.evidenceIds
       .map((id) => p.evidence.find((e) => e.id === id))
       .filter(Boolean)
       .map((e) => evidenceCard(state, p, e!, undefined, g.id))
       .join("")}</div>`;
   })
   .join(
     "",
   )}<button data-question-group="${html(g.id)}">Question this representation</button></section>`,
          )
          .join("");
  const kept = i.proposals.flatMap((p) =>
    (p.findings || [])
      .filter((f) => f.status === "kept")
      .map((f) => ({
        proposalId: p.id,
        findingId: f.id,
        statement: f.statement,
      })),
  );
  const pendingFindings = i.proposals.filter(
    (v) =>
      v.kind === "findings" && v.findings?.some((f) => f.status === "pending"),
  );
  return `<div data-proposal-id="${p.id}" ${target({ label: p.title, proposalId: p.id })}><div class="detail-topline"><span class="status-badge">${p.kind === "findings" ? "Findings review" : "Graph review"}</span><span>Revision ${p.revision} · ${html(p.status)}</span></div><h2>${html(p.title)}</h2>${pendingFindings.length ? `<nav class="pending-findings" aria-label="Findings awaiting review">${pendingFindings.map((v) => `<button data-proposal="${v.id}">Findings revision ${v.revision}: ${v.findings!.filter((f) => f.status === "pending").length} awaiting review</button>`).join("")}</nav>` : ""}<p class="proposal-summary">${html(p.summary)}</p><p class="muted">${p.kind === "findings" ? "Keeping a finding preserves its stated qualification. It does not change the graph." : "Review the representation separately from the findings it expresses."}</p>
 <div class="review-toolbar"><button data-reading-mode="cards" aria-pressed="${mode === "cards"}">One at a time</button><button data-reading-mode="scroll" aria-pressed="${mode === "scroll"}">Continuous</button>${mode === "cards" ? `<button data-card-step="-1" ${selected === 0 ? "disabled" : ""}>Previous</button><label>Item <select data-card-jump>${Array.from({ length: count }, (_, n) => `<option value="${n}" ${selected === n ? "selected" : ""}>${n + 1} of ${count}</option>`).join("")}</select></label><button data-card-step="1" ${selected === count - 1 ? "disabled" : ""}>Next</button>` : ""}</div>${cards}
 ${p.ambiguity ? `<details class="ambiguity-card"><summary>Remaining uncertainty</summary><p class="preserve-lines">${html(p.ambiguity)}</p></details>` : ""}
 ${p.kind === "graph" ? `<p class="preserve-lines">Not represented: ${html(p.omissions)}</p><button data-preview-groups ${p.status !== "pending" ? "disabled" : ""}>${groups.length ? "Preview selected groups on graph" : "Review graph outcome"}</button><div id="graph-review-preview"></div>` : `<details class="build-findings"><summary>Build a graph from kept findings (${kept.length})</summary>${kept.map((f) => `<label><input type="checkbox" data-build-ref="${html(JSON.stringify({ proposalId: f.proposalId, findingId: f.findingId }))}" checked>${html(f.statement)}</label>`).join("")}<button data-build-graph ${!kept.length || i.status === "running" ? "disabled" : ""}>Request graph construction</button></details>`}
 <button data-followup>Add question or instruction</button><details class="history-section"><summary>Review history</summary>${i.proposals.map((v) => `<button data-proposal="${v.id}">Revision ${v.revision} · ${html(v.kind || "Legacy review")} · ${html(v.status)}</button>`).join("")}</details></div>`;
}
