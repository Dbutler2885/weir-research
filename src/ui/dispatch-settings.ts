import { ROLES, describeChoice, type Catalog, type Choice, type Dispatch } from "../domain/dispatch";
import { html } from "./finding-review";

const option = (value: string, label: string, selected: boolean, disabled = false) =>
  `<option value="${html(value)}" ${selected ? "selected" : ""} ${disabled ? "disabled" : ""}>${html(label)}</option>`;

// Agent, model and effort menus for one choice. A role row can also follow the default.
export function menus(catalog: Catalog, choice: Choice | undefined, name: string, followsDefault: boolean): string {
  const agent = catalog.agents.find((a) => a.id === choice?.agent);
  const model = agent?.models.find((m) => m.id === choice?.model);
  const efforts = model ? model.efforts : agent?.efforts || [];
  const agents = [
    ...(followsDefault ? [option("", "Default", !choice)] : []),
    ...catalog.agents.map((a) => option(a.id, a.installed ? a.label : `${a.label} (not installed)`, a.id === choice?.agent, !a.installed)),
  ].join("");
  const off = !choice ? "disabled" : "";
  return `<select data-field="agent" aria-label="${html(name)} agent">${agents}</select>
<select data-field="model" aria-label="${html(name)} model" ${off}>${option("", "Its default model", !choice?.model)}${(agent?.models || []).filter((m) => !m.older || m.id === choice?.model).map((m) => option(m.id, m.label, m.id === choice?.model)).join("")}</select>
<select data-field="effort" aria-label="${html(name)} effort" ${off}>${option("", "Its default effort", !choice?.effort)}${efforts.map((e) => option(e, e, e === choice?.effort)).join("")}</select>`;
}

// Who does which job, drawn from the project's dispatch rules; every entry can be changed here.
export function dispatchSettings(dispatch: Dispatch | undefined, catalog: Catalog | undefined): string {
  if (!dispatch || !catalog)
    return `<section><h2>Who does which job</h2><p class="page-context">Install Claude Code or Codex to choose which agent does each job.</p></section>`;
  const roleRows = ROLES.map((role) => {
    const choice = dispatch.roles[role.id];
    return `<div class="dispatch-row" data-dispatch-role="${role.id}"><div class="dispatch-job"><span>${html(role.label)}</span>${"note" in role ? `<small>${html(role.note)}</small>` : ""}</div><div class="dispatch-menus">${menus(catalog, choice, role.label, true)}</div></div>`;
  }).join("");
  const rules = dispatch.rules.length
    ? `<ul class="dispatch-rules">${dispatch.rules
        .map(
          (r) =>
            `<li><p><strong>${html(ROLES.find((role) => role.id === r.role)?.label || r.role)}</strong>, when ${html(r.when)}: ${html(describeChoice(r.choose, catalog))}.</p><p class="dispatch-reason">${html(r.reason)} Added by ${r.by === "human" ? "you" : "the coordinator"}.</p><button type="button" class="text-action" data-remove-rule="${html(r.id)}">Remove</button></li>`,
        )
        .join("")}</ul>`
    : `<p class="dispatch-empty">No rules yet.</p>`;
  return `<section class="dispatch-settings"><h2>Who does which job</h2>
<p class="page-context">Every job uses the default unless you choose otherwise. For anything more specific, such as a different agent for one kind of work, ask the coordinator in the conversation; it adds the rule here.</p>
<div class="dispatch-row is-default" data-dispatch-role="default"><div class="dispatch-job"><span>Default</span></div><div class="dispatch-menus">${menus(catalog, dispatch.default, "Default", false)}</div></div>
${roleRows}
<h3>Rules</h3>
${rules}
<form id="add-rule-form" class="dispatch-add"><label>For <select name="role" aria-label="Rule job">${ROLES.map((r) => option(r.id, r.label, r.id === "researcher")).join("")}</select></label>
<label class="dispatch-wide">when <input name="when" required maxlength="2000" placeholder="the work is web research"></label>
<div class="dispatch-menus" data-rule-menus>${menus(catalog, dispatch.default, "Rule", false)}</div>
<label class="dispatch-wide">because <input name="reason" required maxlength="2000" placeholder="it finds archives better"></label>
<button>Add rule</button></form></section>`;
}

// The choice a row's menus show. A changed agent starts from its own defaults, and
// a changed model keeps the effort only if the new model offers it.
export function rowChoice(row: Element, catalog: Catalog, changed?: string): Choice | null {
  const value = (field: string) => row.querySelector<HTMLSelectElement>(`[data-field="${field}"]`)?.value || null;
  const agent = value("agent") as Choice["agent"] | null;
  if (!agent) return null;
  if (changed === "agent") return { agent, model: null, effort: null };
  const model = value("model");
  const offered = catalog.agents.find((a) => a.id === agent)?.models.find((m) => m.id === model);
  const effort = value("effort");
  return { agent, model, effort: effort && offered && !offered.efforts.includes(effort) ? null : effort };
}
