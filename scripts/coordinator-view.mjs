// What the coordinator reads from a snapshot or wait. The full snapshot is
// saved beside the session; this is the part printed into the agent's context.
export function snapshotView(result, sessionFile, snapshotFile, acknowledged) {
  // The layered startup context replaces the index once it is proven; until then it is opt-in.
  if (layered() && result.context)
    return {
      sessionFile,
      snapshotFile,
      revision: result.revision,
      acknowledged,
      instruction:
        "Read the context below, act on what needs attention, answer new messages and sent annotations in the conversation, then acknowledge the last processed revision and wait again. Unacknowledged activity is replayed.",
      context: result.context.text,
    };
  return {
    sessionFile,
    snapshotFile,
    revision: result.revision,
    acknowledged,
    coordinator: result.coordinator,
    project: result.project,
    investigations: result.investigations,
    investigationCount: result.investigationCount,
    indexHint: result.indexHint,
    candidates: result.candidates,
    conversation: result.conversation,
    instruction:
      "Read the snapshot, answer new messages and sent annotations in the conversation, act on dispatched work and returned findings, save a handoff, then acknowledge the last processed revision and wait again. Unacknowledged activity is replayed.",
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
