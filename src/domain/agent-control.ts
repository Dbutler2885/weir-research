import type { Choice, Dispatch, Role } from "./dispatch.ts";
import type { ResearchState } from "./research.ts";

// The agents the human can pause, resume and switch to another model, each named by
// what it works on: an assignment, a graph job, a batch's walkthrough, or the project.
export type AgentRef =
  | { kind: "researcher"; assignmentId: string }
  | { kind: "builder"; jobId: string }
  | { kind: "writer"; investigationId: string }
  | { kind: "coordinator" };

// An agent's conversation with its program, kept so a paused or interrupted agent
// picks it up again where it stopped.
export interface SavedSession {
  engine: string;
  id: string;
  directory: string;
  at: string;
}

export interface ControlledAgent {
  ref: AgentRef;
  // The dispatch role whose choice it follows.
  role: Role;
  who: string;
  batch?: { id: string; number: number };
  // What it is doing now, or what it was doing when it stopped.
  activity: string;
  // Running includes an agent the usage limit is holding; paused is one the human or
  // an interruption stopped, waiting to be resumed.
  status: "running" | "paused";
  choice: Choice | null;
  // How much conversation it carries, as its program last reported it.
  tokens: number | null;
}

export const sameAgentRef = (a: AgentRef, b: AgentRef) => JSON.stringify(a) === JSON.stringify(b);
export const agentKey = (ref: AgentRef) =>
  ref.kind === "researcher" ? `researcher:${ref.assignmentId}` : ref.kind === "builder" ? `builder:${ref.jobId}` : ref.kind === "writer" ? `writer:${ref.investigationId}` : "coordinator";

const engines = ["claude", "codex"];
const choiceOf = (engine: unknown, model?: string | null, effort?: string | null): Choice | null =>
  engines.includes(engine as string) ? { agent: engine as Choice["agent"], model: model ?? null, effort: effort ?? null } : null;

// Every agent the human can control now: the coordinator, and the researchers, graph
// builders and walkthrough writers of open batches that are running or paused.
export function controlledAgents(state: ResearchState): ControlledAgent[] {
  const live = state.live || [];
  const agents: ControlledAgent[] = [];
  const c = state.coordinator;
  if (c?.connected && c.choice)
    agents.push({ ref: { kind: "coordinator" }, role: "coordinator", who: "Coordinator", activity: c.listening ? "Listening" : c.latest?.text || "Working", status: "running", choice: c.choice, tokens: c.context?.tokens ?? null });
  for (const i of state.investigations.filter((i) => i.number && !i.closedAt)) {
    const batch = { id: i.id, number: i.number! };
    for (const a of i.assignments || []) {
      if (a.status !== "running" && a.status !== "paused") continue;
      const worker = live.find((w) => w.role === "researcher" && w.assignmentId === a.id);
      // One still starting has no live entry yet, and nothing to switch.
      if (a.status === "running" && !worker) continue;
      agents.push({
        ref: { kind: "researcher", assignmentId: a.id },
        role: "researcher",
        who: "Researcher",
        batch,
        activity: a.title,
        status: a.status,
        choice: worker?.choice ?? (a.choice ? choiceOf(a.choice.engine, a.choice.model, a.choice.effort) : null),
        tokens: worker?.tokens ?? null,
      });
    }
    for (const job of i.reviewFlow?.jobs || []) {
      const worker = live.find((w) => w.jobId === job.id);
      const status = worker && job.status === "running" ? "running" : job.status === "paused" ? "paused" : null;
      if (!status) continue;
      agents.push({ ref: { kind: "builder", jobId: job.id }, role: "graph-builder", who: "Graph builder", batch, activity: job.progress, status, choice: choiceOf(job.engine, job.model, job.effort), tokens: worker?.tokens ?? null });
    }
    const writer = i.reviewFlow?.writer;
    if (writer) {
      const worker = live.find((w) => w.role === "writer" && w.investigationId === i.id);
      const status = worker && writer.status === "running" ? "running" : writer.status === "paused" ? "paused" : null;
      if (status)
        agents.push({ ref: { kind: "writer", investigationId: i.id }, role: "walkthrough-writer", who: "Walkthrough writer", batch, activity: writer.progress, status, choice: choiceOf(writer.engine, writer.model, writer.effort), tokens: worker?.tokens ?? null });
    }
  }
  return agents;
}

const norm = (c: Partial<Choice> | null | undefined) => ({ agent: c?.agent ?? null, model: c?.model ?? null, effort: c?.effort ?? null });
export const sameChoice = (a: Partial<Choice> | null | undefined, b: Partial<Choice> | null | undefined) =>
  JSON.stringify(norm(a)) === JSON.stringify(norm(b));

// What switching an agent to another choice costs it.
// rereads: the same program keeps its conversation, and its next turn reads it again
//   without the cache, since a cache belongs to one model and its settings;
// restarts: another program cannot take the conversation, so it starts again from its
//   last checkpoint;
// fresh: the coordinator starts afresh on the new choice from the project's saved state.
export type SwitchCost = { kind: "unchanged" } | { kind: "rereads"; tokens: number | null } | { kind: "restarts" } | { kind: "fresh" };

export function switchCost(agent: Pick<ControlledAgent, "ref" | "choice" | "tokens">, next: Choice): SwitchCost {
  if (sameChoice(agent.choice, next)) return { kind: "unchanged" };
  if (agent.ref.kind === "coordinator") return { kind: "fresh" };
  if (agent.choice?.agent !== next.agent) return { kind: "restarts" };
  return { kind: "rereads", tokens: agent.tokens };
}

const programs: Record<string, string> = { claude: "Claude Code", codex: "Codex" };
const thousands = (n: number) => (n < 1000 ? `${n}` : `${Math.round(n / 1000).toLocaleString("en-US")}k`);

// The cost as the human reads it before choosing.
export function costLine(cost: SwitchCost, from?: Choice | null, to?: Choice): string {
  if (cost.kind === "unchanged") return "It already uses this.";
  if (cost.kind === "fresh") return "A fresh coordinator starts on it and reads the project's saved state. Nothing in the project is lost; its conversation so far is left behind.";
  if (cost.kind === "restarts")
    return `${programs[to?.agent || ""] || "The other program"} cannot take over ${programs[from?.agent || ""] || "its program"}'s conversation, so it starts again from its last checkpoint. Its saved files are kept.`;
  return cost.tokens
    ? `It keeps its conversation. Its next turn re-reads about ${thousands(cost.tokens)} tokens of it without the cache.`
    : "It keeps its conversation. Its next turn re-reads all of it without the cache.";
}

// The running agents that follow a role's choice, or the default, when the human
// changes it: those still on what the old setting gave them, with what the new one gives.
export function affectedBy(agents: ControlledAgent[], before: Dispatch, after: Dispatch): { agent: ControlledAgent; to: Choice }[] {
  return agents.flatMap((agent) => {
    if (agent.status !== "running") return [];
    const was = before.roles[agent.role] ?? before.default;
    const now = after.roles[agent.role] ?? after.default;
    if (sameChoice(was, now) || !sameChoice(agent.choice, was)) return [];
    return [{ agent, to: now }];
  });
}
