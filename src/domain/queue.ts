import type { Investigation, ResearchState } from "./research.ts";

// The queue: open batches in the order they should be worked, which the human can
// change and hold. A batch's place starts as its number.
const isOpen = (b: Investigation) => Boolean(b.number) && !b.closedAt && b.status !== "closed";
const place = (b: Investigation) => b.queuePosition ?? b.number ?? Number.MAX_SAFE_INTEGER;

export function queueOf(state: Pick<ResearchState, "investigations">): Investigation[] {
  return state.investigations.filter(isOpen).sort((a, b) => place(a) - place(b));
}

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

// Moves a batch one place up or down; the new order is kept as every open batch's place.
export function moveInQueue(state: ResearchState, id: string, direction: "up" | "down", now: string) {
  const queue = queueOf(state);
  const at = queue.findIndex((b) => b.id === id);
  assert(at >= 0, "Only an open batch has a place in the queue.");
  const to = direction === "up" ? at - 1 : at + 1;
  assert(direction === "up" || direction === "down", "Move a batch up or down.");
  if (to < 0 || to >= queue.length) return { moved: false };
  [queue[at], queue[to]] = [queue[to]!, queue[at]!];
  queue.forEach((b, n) => (b.queuePosition = n + 1));
  queue[to]!.events.push({ at: now, message: `You moved this batch ${direction} the queue, to place ${to + 1}.` });
  return { moved: true, place: to + 1 };
}

// A held batch keeps its place and waits; nothing starts on it until it is released.
export function holdInQueue(state: ResearchState, id: string, held: boolean, now: string) {
  const batch = queueOf(state).find((b) => b.id === id);
  assert(batch, "Only an open batch has a place in the queue.");
  if (Boolean(batch.held) === held) return { held };
  batch.held = held || undefined;
  batch.events.push({ at: now, message: held ? "You held this batch; it waits until you release it." : "You released this batch; it can be worked again." });
  return { held };
}
