// What the coordinator reads from a snapshot. The full snapshot is
// saved beside the session; this is the part printed into the agent's context.
export function snapshotView(result, sessionFile, snapshotFile) {
  // The layered startup context replaces the index once it is proven; until then it is opt-in.
  if (layered() && result.context)
    return {
      sessionFile,
      snapshotFile,
      revision: result.revision,
      instruction:
        "Read the context below, act on what needs attention, and answer new messages and sent annotations in the conversation.",
      context: result.context.text,
    };
  return {
    sessionFile,
    snapshotFile,
    revision: result.revision,
    coordinator: result.coordinator,
    project: result.project,
    investigations: result.investigations,
    investigationCount: result.investigationCount,
    indexHint: result.indexHint,
    candidates: result.candidates,
    conversation: result.conversation,
    instruction:
      "Read the snapshot, answer new messages and sent annotations in the conversation, and act on dispatched work and returned findings.",
  };
}

export function layered() {
  return process.env.COORDINATOR_CONTEXT === "layered";
}

// Prints a view as JSON, with the layered context as readable text after it.
export function printView(view) {
  if (typeof view?.context !== "string") return console.log(JSON.stringify(view, null, 2));
  const { context, ...rest } = view;
  console.log(JSON.stringify(rest, null, 2));
  console.log(`\n${context}`);
}
