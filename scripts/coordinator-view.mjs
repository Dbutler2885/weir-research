// What the coordinator reads from a snapshot or wait. The full snapshot is
// saved beside the session; this is the part printed into the agent's context.
export function snapshotView(result, sessionFile, snapshotFile, acknowledged) {
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
