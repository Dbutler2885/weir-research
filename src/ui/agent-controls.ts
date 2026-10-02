import { affectedBy, controlledAgents, costLine, sameAgentRef, switchCost, type AgentRef, type ControlledAgent } from "../domain/agent-control";
import { describeChoice, type Catalog, type Choice, type Dispatch } from "../domain/dispatch";
import type { ResearchState } from "../domain/research";
import { menus } from "./dispatch-settings";
import { html } from "./finding-review";

// Who an agent is, as a heading names it.
export const agentName = (agent: ControlledAgent) => (agent.batch ? `Batch ${agent.batch.number} ${agent.who.toLowerCase()}` : agent.who);

export const findAgent = (state: ResearchState, ref: AgentRef) => controlledAgents(state).find((a) => sameAgentRef(a.ref, ref));

// Pause and Switch model for a running agent, Resume for a paused one. The coordinator
// is only switched; it listens whenever the app is open.
export function agentButtons(agent: ControlledAgent | undefined): string {
  if (!agent) return "";
  const ref = html(JSON.stringify(agent.ref));
  const button = (action: string, label: string) => `<button type="button" class="text-action" data-agent-action="${action}" data-agent="${ref}">${label}</button>`;
  if (agent.status === "paused") return `<span class="agent-controls">${button("resume", "Resume")}</span>`;
  return `<span class="agent-controls">${agent.ref.kind === "coordinator" ? "" : button("pause", "Pause")}${agent.choice ? button("switch", "Switch model") : ""}</span>`;
}

const describe = (choice: Choice | null, catalog: Catalog) => (choice ? describeChoice(choice, catalog) : "its program's defaults");

// Choosing another agent, model and effort for one running agent, with what it costs.
export function switchDialog(agent: ControlledAgent, choice: Choice, catalog: Catalog): string {
  const cost = switchCost(agent, choice);
  return `<h2>Switch the ${html(agentName(agent).replace(/^Coordinator$/, "coordinator"))}</h2>
<p>${html(agent.activity)}</p>
<p>It runs on ${html(describe(agent.choice, catalog))}.</p>
<div class="dispatch-menus" data-switch-menus>${menus(catalog, choice, "Switch to", false)}</div>
<p class="switch-cost">${html(costLine(cost, agent.choice, choice))}</p>
<div class="quit-actions"><button type="button" class="primary" data-switch-confirm ${cost.kind === "unchanged" ? "disabled" : ""}>Switch</button><button type="button" data-switch-cancel>Cancel</button></div>`;
}

// After the human changes a role, or the default, in settings: each running agent still
// on the old choice, to switch now or leave as it is. Leaving it is the default.
export function followDialog(affected: { agent: ControlledAgent; to: Choice }[], catalog: Catalog): string {
  const rows = affected
    .map(({ agent, to }, n) => {
      const from = describe(agent.choice, catalog);
      return `<fieldset class="follow-agent" data-follow="${n}"><legend>${html(agentName(agent))}</legend><p class="follow-activity">${html(agent.activity)}</p>
<label><input type="radio" name="follow-${n}" value="leave" checked> Leave it on ${html(from)}</label>
<label><input type="radio" name="follow-${n}" value="switch"> Switch it now to ${html(describeChoice(to, catalog))}</label>
<p class="switch-cost">${html(costLine(switchCost(agent, to), agent.choice, to))}</p></fieldset>`;
    })
    .join("");
  const one = affected.length === 1;
  return `<h2>${one ? "An agent is running on the old choice" : `${affected.length} agents are running on the old choice`}</h2>
<p>Your change applies to work that starts from now on. Choose whether ${one ? "this one switches" : "each of these switches"} now.</p>
${rows}
<div class="quit-actions"><button type="button" class="primary" data-follow-done>Done</button></div>`;
}

export const affectedAgents = (state: ResearchState, before: Dispatch, after: Dispatch) => affectedBy(controlledAgents(state), before, after);
