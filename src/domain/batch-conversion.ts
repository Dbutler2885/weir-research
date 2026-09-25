import type { Annotation, ResearchState } from "./research.ts";
import type { Message } from "./conversation.ts";

// One-time conversion of projects created before the shared conversation:
// each investigation becomes a numbered batch, sent annotations become
// conversation history, and unsent annotations return to the project queue.
export function convertToBatches(source: ResearchState): ResearchState {
  const state = structuredClone(source);
  if (state.investigations.some((i) => i.number)) return state;
  const queue: Annotation[] = [...(state.queue || [])];
  const sends = new Map<string, Annotation[]>();
  state.investigations = state.investigations.filter(
    (i) =>
      i.annotations.length ||
      i.proposals.length ||
      i.checkpoints.length ||
      i.reviewFlow,
  );
  state.investigations.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  state.investigations.forEach((i, index) => {
    queue.push(...i.annotations.filter((a) => !a.dispatchedAt));
    i.annotations = i.annotations.filter((a) => a.dispatchedAt);
    for (const a of i.annotations) {
      const group = sends.get(a.dispatchedAt!) || [];
      group.push(structuredClone(a));
      sends.set(a.dispatchedAt!, group);
    }
    const walkthroughs = i.reviewFlow?.walkthroughs || [];
    i.number = index + 1;
    i.title =
      walkthroughs.at(-1)?.title ||
      i.proposals.filter((p) => p.kind === "findings").at(-1)?.title ||
      i.proposals.at(-1)?.title ||
      headline(i.title);
    i.questions = i.annotations.map((a) => ({
      id: `converted-${a.id}`,
      title: headline(a.question),
      origin: "human" as const,
      annotationIds: [a.id],
      createdAt: a.dispatchedAt!,
    }));
    const ready = walkthroughs[0]?.createdAt || i.proposals.at(-1)?.createdAt;
    if (ready && !["queued", "running"].includes(i.status)) i.readyAt = ready;
    // Older projects could hold several pending revisions; only the latest stays open.
    i.reviewFlow?.graphReviews.slice(0, -1).forEach((r) => {
      if (r.status === "pending") r.status = "superseded";
    });
    // Closed only when nothing happened after its approved graph review.
    const review = i.reviewFlow?.graphReviews.at(-1);
    const continued =
      review &&
      [
        ...walkthroughs.map((w) => w.createdAt),
        ...i.proposals.map((p) => p.createdAt),
        ...i.annotations.map((a) => a.dispatchedAt!),
      ].some((at) => at > review.createdAt);
    if (review && review.status !== "pending" && !continued) {
      i.closedAt = i.events.at(-1)?.at || review.createdAt;
      i.status = "closed";
    }
    i.events.push({
      at: new Date().toISOString(),
      message: `Converted to batch ${i.number}.`,
    });
  });
  const history: Message[] = [...sends.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([at, annotations]) => ({
      id: `converted-send-${at}`,
      at,
      author: "human",
      annotations,
    }));
  state.conversation = [...history, ...(state.conversation || [])].sort(
    (a, b) => a.at.localeCompare(b.at),
  );
  state.queue = queue;
  state.revision++;
  return state;
}

// A readable heading from the human's own words, until the coordinator retitles it.
export function headline(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const sentence = clean.match(/^.{12,}?[.?!](?=\s|$)/)?.[0] || clean;
  const short =
    sentence.length > 120
      ? `${sentence.slice(0, 117).replace(/\s+\S*$/, "")}…`
      : sentence;
  return short.charAt(0).toUpperCase() + short.slice(1);
}
