import type { ResearchState } from "./research.ts";

// Converts a project from the time the coordinator could do research itself.
// Work it had claimed stays paused and resumes through a worker the app starts,
// once the human approves; a graph job it built itself waits for a builder.
// Returns whether anything changed.
export function convertToAppWorkers(state: ResearchState, now = new Date().toISOString()): boolean {
  let changed = false;
  for (const i of state.investigations) {
    if (i.status === "running" && i.lease?.worker.startsWith("Coordinator:")) {
      i.status = "paused";
      delete i.lease;
      i.events.push({
        at: now,
        message: "Paused when the app took over running workers. Saved findings are kept; ask to resume, and a researcher the app starts carries on.",
      });
      changed = true;
    }
    for (const job of i.reviewFlow?.jobs || []) {
      if (job.engine === "manual" && job.status === "running") {
        job.status = "paused";
        job.progress = "Paused when the app took over running workers. Saved graph files are kept; ask to resume with a graph builder.";
        i.events.push({ at: now, message: "Graph update paused when the app took over running workers; saved files are kept." });
        changed = true;
      }
    }
  }
  return changed;
}
