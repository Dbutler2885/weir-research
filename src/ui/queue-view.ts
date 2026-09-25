import type { Investigation, ResearchState } from "../domain/research";
import { queueOf } from "../domain/queue";
import { html } from "./finding-review";

// Where a batch stands, in the words the queue uses.
function standing(b: Investigation, state: ResearchState): string {
  if (b.held) return "Held. Nothing starts on it until you release it.";
  const working = (state.live || []).some((w) => w.investigationId === b.id);
  if (b.status === "running" || working) return "Being worked on now.";
  if (b.status === "queued") return "Waiting for a researcher.";
  if (b.status === "paused") return "Paused.";
  if (b.readyAt) return "Ready for you to review.";
  return "Findings returned; the coordinator is checking them.";
}

// The queue: open batches in the order they are worked, with controls to move and hold them.
export function queueSection(state: ResearchState): string {
  const queue = queueOf(state);
  if (!queue.length)
    return '<div class="findings-scroll"><div class="findings-empty"><h2>Nothing in the queue</h2><p>Batches your coordinator opens wait here in order. Move one up to have it worked sooner, or hold it to keep it waiting.</p></div></div>';
  const rows = queue
    .map(
      (b, n) =>
        `<li class="queue-row${b.held ? " is-held" : ""}" data-investigation-id="${html(b.id)}"><span class="queue-place">${n + 1}</span><div class="queue-batch"><strong>Batch ${b.number} · ${html(b.title)}</strong><p>${html(standing(b, state))}</p></div><div class="queue-controls"><button type="button" class="text-action" data-queue-move="up" ${n === 0 ? "disabled" : ""} aria-label="Move batch ${b.number} up">Move up</button><button type="button" class="text-action" data-queue-move="down" ${n === queue.length - 1 ? "disabled" : ""} aria-label="Move batch ${b.number} down">Move down</button><button type="button" class="text-action" data-queue-hold="${b.held ? "release" : "hold"}">${b.held ? "Release" : "Hold"}</button></div></li>`,
    )
    .join("");
  return `<div class="findings-scroll"><p class="queue-intro">Your coordinator works these from the top. A held batch keeps its place and waits.</p><ol class="queue-list">${rows}</ol></div>`;
}
