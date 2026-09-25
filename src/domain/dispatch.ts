// Who does which job: the agent, model and effort each role uses. One document per
// project, which the human edits in settings and the coordinator edits when the
// human states a preference. The settings view is drawn from it.

export const ROLES = [
  { id: "coordinator", label: "Coordinator" },
  { id: "researcher", label: "Researcher" },
  { id: "graph-builder", label: "Graph builder" },
  { id: "walkthrough-writer", label: "Walkthrough writer" },
  { id: "helper", label: "Helper", note: "Small tasks the coordinator hands off" },
] as const;
export type Role = (typeof ROLES)[number]["id"];
export type AgentId = "claude" | "codex";

// A choice of agent, with a model and effort, or that CLI's own defaults when absent.
export interface Choice {
  agent: AgentId;
  model?: string | null;
  effort?: string | null;
}
// A rule the coordinator applies when its condition fits the work it is assigning.
export interface DispatchRule {
  id: string;
  role: Role;
  when: string;
  choose: Choice;
  reason: string;
  by: "human" | "coordinator";
  at: string;
}
export interface Dispatch {
  default: Choice;
  roles: Partial<Record<Role, Choice>>;
  rules: DispatchRule[];
}

// What the installed CLIs offer, for the menus and for validation.
export interface Catalog {
  agents: {
    id: AgentId;
    label: string;
    installed: boolean;
    models: { id: string; label: string; efforts: string[] }[];
    efforts: string[];
  }[];
}

const agentIds = ["claude", "codex"];
const fail = (ok: unknown, message: string) => {
  if (!ok) throw new Error(message);
};
const text = (value: unknown, max = 2000) => typeof value === "string" && value.trim().length > 0 && value.length <= max;

// A new project uses one CLI, with its own model and effort, for every role.
export function defaultDispatch(agent: AgentId): Dispatch {
  return { default: { agent }, roles: {}, rules: [] };
}

// The first installed agent, preferring the one already chosen.
export function firstAgent(catalog: Catalog, preferred?: string | null): AgentId | null {
  const installed = catalog.agents.filter((a) => a.installed).map((a) => a.id);
  return installed.includes(preferred as AgentId) ? (preferred as AgentId) : installed[0] || null;
}

export function validateChoice(choice: unknown, catalog: Catalog, where: string): Choice {
  fail(choice && typeof choice === "object", `${where} needs an agent.`);
  const c = choice as Record<string, unknown>;
  fail(agentIds.includes(c.agent as string), `${where}: the agent must be claude or codex.`);
  const agent = catalog.agents.find((a) => a.id === c.agent);
  fail(agent?.installed, `${where}: ${agent?.label || c.agent} is not installed.`);
  const model = c.model ?? null;
  const effort = c.effort ?? null;
  const offered = agent!.models.find((m) => m.id === model);
  if (model !== null) fail(offered, `${where}: ${agent!.label} does not offer the model "${model}". Choose one of: ${agent!.models.map((m) => m.id).join(", ")}.`);
  if (effort !== null) {
    const efforts = offered ? offered.efforts : agent!.efforts;
    fail(efforts.includes(effort as string), `${where}: effort "${effort}" is not offered${offered ? ` for ${model}` : ""}. Choose one of: ${efforts.join(", ")}.`);
  }
  return { agent: c.agent as AgentId, model: model as string | null, effort: effort as string | null };
}

// The whole document, refused with the first problem named.
export function validateDispatch(doc: unknown, catalog: Catalog): Dispatch {
  fail(doc && typeof doc === "object", "Dispatch rules must be an object.");
  const d = doc as Record<string, unknown>;
  const roles = (d.roles ?? {}) as Record<string, unknown>;
  fail(typeof roles === "object" && !Array.isArray(roles), "Roles must be an object keyed by role.");
  for (const key of Object.keys(roles)) fail(ROLES.some((r) => r.id === key), `Unknown role "${key}". The roles are ${ROLES.map((r) => r.id).join(", ")}.`);
  fail(Array.isArray(d.rules ?? []), "Rules must be a list.");
  return {
    default: validateChoice(d.default, catalog, "The default"),
    roles: Object.fromEntries(Object.entries(roles).map(([role, choice]) => [role, validateChoice(choice, catalog, `The ${role} role`)])),
    rules: ((d.rules ?? []) as unknown[]).map((rule, n) => validateRule(rule, catalog, `Rule ${n + 1}`)),
  };
}

function validateRule(rule: unknown, catalog: Catalog, where: string): DispatchRule {
  fail(rule && typeof rule === "object", `${where} must be an object.`);
  const r = rule as Record<string, unknown>;
  fail(ROLES.some((role) => role.id === r.role), `${where}: choose a role, one of ${ROLES.map((role) => role.id).join(", ")}.`);
  fail(text(r.when), `${where}: say when it applies, in up to 2,000 characters.`);
  fail(text(r.reason), `${where}: give the reason for it, in up to 2,000 characters.`);
  fail(r.by === "human" || r.by === "coordinator", `${where}: say whether the human or the coordinator added it.`);
  return {
    id: String(r.id),
    role: r.role as Role,
    when: (r.when as string).trim(),
    choose: validateChoice(r.choose, catalog, where),
    reason: (r.reason as string).trim(),
    by: r.by as "human" | "coordinator",
    at: String(r.at),
  };
}

// The choice for a role: what was named for this assignment, else the role's own
// entry, else the default.
export function choose(doc: Dispatch, role: Role, named?: Partial<Choice> | null): Choice {
  if (named?.agent) return { agent: named.agent, model: named.model ?? null, effort: named.effort ?? null };
  return doc.roles[role] ?? doc.default;
}

// A change from settings or the coordinator: set a role or the default, add a
// rule, or remove one. Returns the new document, validated whole.
export function changeDispatch(
  doc: Dispatch,
  command: Record<string, unknown>,
  catalog: Catalog,
  by: "human" | "coordinator",
  id: () => string,
  now: string,
): Dispatch {
  const next: Dispatch = structuredClone(doc);
  if (command.action === "set-role") {
    const choice = command.agent ? { agent: command.agent, model: command.model ?? null, effort: command.effort ?? null } : null;
    if (command.role === "default") {
      fail(choice, "The default needs an agent.");
      next.default = choice as Choice;
    } else {
      fail(ROLES.some((r) => r.id === command.role), `Choose a role, one of default, ${ROLES.map((r) => r.id).join(", ")}.`);
      if (choice) next.roles[command.role as Role] = choice as Choice;
      else delete next.roles[command.role as Role];
    }
  } else if (command.action === "add-rule") {
    next.rules.push({
      id: id(),
      role: command.role as Role,
      when: command.when as string,
      choose: { agent: command.agent as AgentId, model: (command.model as string) ?? null, effort: (command.effort as string) ?? null },
      reason: command.reason as string,
      by,
      at: now,
    });
  } else if (command.action === "remove-rule") {
    fail(next.rules.some((r) => r.id === command.ruleId), "That rule does not exist.");
    next.rules = next.rules.filter((r) => r.id !== command.ruleId);
  } else throw new Error("Change dispatch with set-role, add-rule or remove-rule.");
  return validateDispatch(next, catalog);
}

// How a choice reads in settings and the coordinator's context.
export function describeChoice(choice: Choice, catalog: Catalog): string {
  const agent = catalog.agents.find((a) => a.id === choice.agent);
  const model = agent?.models.find((m) => m.id === choice.model)?.label || choice.model;
  return [agent?.label || choice.agent, model || "its default model", choice.effort ? `${choice.effort} effort` : "its default effort"].join(", ");
}
