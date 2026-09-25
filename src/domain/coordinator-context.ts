import type { Investigation, LiveWorker, ResearchState } from "./research.ts";
import type { Message } from "./conversation.ts";
import { unassignedAnnotations } from "./conversation.ts";
import { nextAction, currentCandidates } from "./next-action.ts";
import { sourceLibrary } from "./findings.ts";

// What a coordinator reads when it starts, ordered by urgency so it can act
// without reading everything. Built from saved state alone; it never writes.

export interface Skill {
  name: string;
  description: string;
}
export interface ContextLayer {
  id: "attention" | "queue" | "orientation" | "conversation" | "more";
  title: string;
  text: string;
  characters: number;
  budget: number;
  // Items left out to stay within the budget, each still reachable by inspection.
  omitted: number;
}
export interface CoordinatorContext {
  layers: ContextLayer[];
  text: string;
}

export const layerBudgets: Record<ContextLayer["id"], number> = {
  attention: 6000,
  queue: 14_000,
  orientation: 9000,
  conversation: 6000,
  more: 4000,
};

const oneLine = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();
export function clip(value: unknown, limit: number): string {
  const text = oneLine(value);
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1).replace(/\s+\S*$/, "")}…`;
}
const day = (at?: string) => (at ? at.slice(0, 10) : "unknown date");
const batchName = (b: Investigation) => (b.number ? `Batch ${b.number}` : "Investigation");

// Whole blocks until the budget is spent, then a count of what was left out.
function fit(blocks: string[], budget: number, more: (omitted: number) => string) {
  const kept: string[] = [];
  let used = 0;
  for (const block of blocks) {
    if (used + block.length + 1 > budget && kept.length) break;
    kept.push(block);
    used += block.length + 1;
  }
  const omitted = blocks.length - kept.length;
  if (omitted) kept.push(more(omitted));
  return { text: kept.join("\n"), omitted };
}

function layer(id: ContextLayer["id"], title: string, blocks: string[], more: (n: number) => string): ContextLayer {
  const budget = layerBudgets[id];
  const { text, omitted } = fit(blocks, budget, more);
  const body = `## ${title}\n\n${text || "Nothing."}`;
  return { id, title, text: body, characters: body.length, budget, omitted };
}

function isOpen(b: Investigation) {
  return !b.closedAt && b.status !== "closed";
}

function attention(state: ResearchState): ContextLayer {
  const blocks: string[] = [];
  for (const a of unassignedAnnotations(state)) {
    const refs = (a.references || []).map((r) => r.label).filter(Boolean);
    blocks.push(
      `- Sent note not yet in a batch (${a.id}): "${clip(a.question, 300)}"${refs.length ? ` on ${refs.map((r) => clip(r, 80)).join(", ")}` : ""}. Answer it, then place it in a batch with open-batch or add-to-batch.`,
    );
  }
  for (const m of state.conversation || [])
    if (m.decision?.status === "pending")
      blocks.push(`- Your request "${clip(m.decision.title, 160)}" (${m.id}) is waiting for the human's decision.`);
  const open = state.investigations.filter(isOpen);
  for (const b of open) {
    if (!b.brief) blocks.push(`- ${batchName(b)} (${b.id}) has no brief. Write one with set-brief before relying on it.`);
    const next = nextAction(state, b);
    if (next.waitingOn === "coordinator") blocks.push(`- ${batchName(b)}: ${next.action}`);
  }
  const human = open.filter((b) => nextAction(state, b).waitingOn === "human").length;
  if (human) blocks.push(`- ${human} batch${human === 1 ? " is" : "es are"} waiting on the human; see the queue.`);
  return layer("attention", "Needs attention now", blocks, (n) => `- …and ${n} more; inspect investigations for the rest.`);
}

function findingsLine(b: Investigation) {
  const proposals = b.proposals.filter((p) => p.kind === "findings" || !p.kind);
  const findings = proposals.flatMap((p) => p.findings || []);
  if (!proposals.length) return "No findings published yet.";
  const latest = proposals.at(-1)!;
  return `${findings.length} findings in ${proposals.length} proposal${proposals.length === 1 ? "" : "s"}; latest "${clip(latest.title, 120)}" (${latest.id}).`;
}

function reviewLine(b: Investigation) {
  const flow = b.reviewFlow;
  if (!flow) return null;
  const parts: string[] = [];
  if (flow.walkthroughs.length) parts.push(`walkthrough revision ${flow.walkthroughs.length}`);
  const review = flow.graphReviews.filter((r) => r.status !== "superseded").at(-1);
  if (review) parts.push(`graph draft ${review.status}${review.decidedAt ? ` ${day(review.decidedAt)}` : ""}`);
  return parts.length ? `Review: ${parts.join(", ")}.` : null;
}

function batchBlock(state: ResearchState, b: Investigation, workers: LiveWorker[]) {
  const lines = [`### ${batchName(b)}: ${clip(b.title, 160)}`, `ID ${b.id} · status ${b.status}${b.readyAt ? " · marked ready" : ""}`];
  if (b.brief)
    lines.push(
      `Purpose: ${clip(b.brief.purpose, 400)}`,
      `Scope: ${clip(b.brief.scope, 400)}`,
      `Direction (${day(b.brief.updatedAt)}): ${clip(b.brief.direction, 500)}`,
    );
  else lines.push("No brief yet.");
  const questions = b.questions || [];
  if (questions.length)
    lines.push(
      `Questions: ${questions
        .slice(0, 6)
        .map((q) => `"${clip(q.title, 110)}"`)
        .join("; ")}${questions.length > 6 ? `; and ${questions.length - 6} more` : ""}.`,
    );
  lines.push(`Findings: ${findingsLine(b)}`);
  const review = reviewLine(b);
  if (review) lines.push(review);
  const checkpoint = b.checkpoints.at(-1);
  if (checkpoint && ["queued", "running", "paused"].includes(b.status))
    lines.push(`Latest checkpoint (${day(checkpoint.at)}): ${clip(checkpoint.summary, 300)}`);
  if (b.status === "paused" && b.events.length) lines.push(`Last event: ${clip(b.events.at(-1)!.message, 240)}`);
  for (const w of workers.filter((w) => w.investigationId === b.id))
    lines.push(`Worker: ${w.name}${w.latest ? `, ${clip(w.latest.text, 200)}` : ", starting"}.`);
  const candidates = currentCandidates(state, b).length;
  if (candidates) lines.push(`Returned results awaiting your judgment: ${candidates}.`);
  const next = nextAction(state, b);
  lines.push(`Next (waiting on ${next.waitingOn}): ${next.action}`);
  return lines.join("\n");
}

function queue(state: ResearchState, workers: LiveWorker[]): ContextLayer {
  // Batch numbers are the queue order until the human can reorder it.
  const order = (b: Investigation) => b.number ?? Number.MAX_SAFE_INTEGER;
  const open = state.investigations.filter(isOpen).sort((a, b) => order(a) - order(b));
  const blocks = open.map((b) => batchBlock(state, b, workers));
  const closed = state.investigations
    .filter((b) => !isOpen(b))
    .sort((a, b) => (a.closedAt || "").localeCompare(b.closedAt || ""))
    .slice(-5);
  if (closed.length)
    blocks.push(
      [
        "### Recently closed",
        ...closed.map((b) => `- ${batchName(b)}: ${clip(b.title, 120)} (${b.id}), closed ${day(b.closedAt)}.`),
      ].join("\n"),
    );
  return layer(
    "queue",
    `The queue: ${open.length} open batch${open.length === 1 ? "" : "es"}`,
    blocks,
    (n) => `…and ${n} more batches; inspect investigations to list them.`,
  );
}

function orientation(state: ResearchState): ContextLayer {
  const d = state.dataset;
  const counts = [
    `${d.people.length} people`,
    `${(d.contextEntities || []).length} other entities`,
    `${(d.claims || []).length} connections`,
    `${sourceLibrary(state).length} sources`,
  ].join(", ");
  const settings = [
    `researcher: ${state.engine || "manual"}`,
    `automatic walkthrough: ${state.reviewSettings?.autoWalkthrough ? "on" : "off"}`,
    `automatic graph update: ${state.reviewSettings?.autoGraph ? "on" : "off"}`,
    `research time limit: ${state.researchSettings?.timeLimitMinutes ? `${state.researchSettings.timeLimitMinutes} minutes` : "none"}`,
  ].join("; ");
  const coordination = (state as { coordination?: { researchMap?: string; handoff?: string } }).coordination;
  const blocks = [
    `Project: ${clip(d.title, 300)}`,
    `Graph: ${counts}. Source collections: ${state.collections.map((c) => `${c.name} (${c.id})`).join(", ")}.`,
    `The human's settings, which you follow: ${settings}.`,
  ];
  const map = coordination?.researchMap?.trim();
  blocks.push(
    map
      ? `### Research map\n\n${map.length > 4000 ? `${map.slice(0, 4000).replace(/\n[^\n]*$/, "")}\n…the rest of the map is one inspect away.` : map}`
      : "### Research map\n\nNone yet. Write a short one with the map command.",
  );
  const accepted = state.investigations.flatMap((b) =>
    (b.reviewFlow?.graphReviews || [])
      .filter((r) => r.status === "applied")
      .map((r) => `- ${batchName(b)} graph accepted ${day(r.decidedAt || r.createdAt)}: ${clip(r.summary, 300)} (${b.id})`),
  );
  blocks.push(
    accepted.length
      ? `### Accepted into the graph\n\n${accepted.join("\n")}`
      : "### Accepted into the graph\n\nNothing yet; published findings stay proposals until the human accepts a graph draft.",
  );
  const handoff = coordination?.handoff?.trim();
  if (handoff)
    blocks.push(`### Notes from an earlier session (may be out of date; the queue is current)\n\n${clip(handoff, 1500)}`);
  return layer("orientation", "Orientation", blocks, () => "…more orientation is available with inspect map.");
}

function messageBlock(m: Message) {
  const who = m.author === "human" ? "Human" : "You";
  const lines = [`- ${who}, ${m.at.slice(0, 16).replace("T", " ")} (${m.id})`];
  if (m.text) lines.push(`  ${clip(m.text, 500)}`);
  for (const a of m.annotations || []) lines.push(`  Note ${a.id}: "${clip(a.question, 200)}"`);
  if (m.decision) lines.push(`  Request "${clip(m.decision.title, 160)}": ${m.decision.status}`);
  if (m.readyBatchId) lines.push("  Announced a batch as ready.");
  return lines.join("\n");
}

function conversation(state: ResearchState): ContextLayer {
  const messages = (state.conversation || []).slice(-8);
  // Newest first when trimming, but read in order.
  const blocks = messages.map(messageBlock);
  const budget = layerBudgets.conversation;
  let used = 0;
  let start = blocks.length;
  while (start > 0 && used + blocks[start - 1]!.length + 1 <= budget) used += blocks[--start]!.length + 1;
  const kept = blocks.slice(start);
  const earlier = (state.conversation || []).length - kept.length;
  if (earlier > 0) kept.unshift(`(${earlier} earlier messages; search to find them.)`);
  return layer("conversation", "Recent conversation", kept, () => "");
}

function more(skills: Skill[]): ContextLayer {
  const blocks = [
    "Every ID above can be inspected. Use `npm run coordinator -- command <json-file> --session <sessionFile>` with:",
    '- `{"action":"inspect","kind":"investigation","id":"..."}` for a batch\'s findings, checkpoints and history.',
    '- `{"action":"inspect","kind":"investigations","status":"closed"}` to list batches.',
    '- `{"action":"inspect","kind":"map"}` for the full research map and handoff.',
    '- `{"action":"inspect","kind":"source","id":"...","offset":0,"limit":6000}` for a source passage.',
    '- `{"action":"inspect","kind":"entity","table":"people","id":"..."}` for a graph record.',
    '- `{"action":"set-brief","investigationId":"...","brief":{"direction":"..."}}` when a batch\'s direction changes.',
    "`npm run coordinator -- search \"words\" --session <sessionFile>` finds records, findings and passages.",
  ];
  if (skills.length)
    blocks.push(
      "\nInstruction skills; load one when its moment comes:\n" +
        skills.map((s) => `- ${s.name}: ${clip(s.description, 500)}`).join("\n"),
    );
  return layer("more", "How to get more", blocks, (n) => `…${n} more lines omitted.`);
}

export function buildCoordinatorContext(
  state: ResearchState,
  { workers = [], skills = [] }: { workers?: LiveWorker[]; skills?: Skill[] } = {},
): CoordinatorContext {
  const layers = [attention(state), queue(state, workers), orientation(state), conversation(state), more(skills)];
  return { layers, text: layers.map((l) => l.text).join("\n\n") };
}
