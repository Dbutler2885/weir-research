import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  openSync,
  closeSync,
  fsyncSync,
} from "node:fs";
import { join } from "node:path";
import { initialState, transition } from "../src/domain/research.ts";
import { needsGraphUpgrade, upgradeGraphState } from "../src/domain/graph-upgrade.ts";
import { repairClosedBatches } from "../src/domain/conversation.ts";

export class WorkspaceStore {
  constructor(directory, dataset) {
    mkdirSync(directory, { recursive: true });
    this.path = join(directory, "workspace.json");
    this.state = existsSync(this.path)
      ? JSON.parse(readFileSync(this.path, "utf8"))
      : initialState(dataset);
    if (this.state.version !== 1 || !Array.isArray(this.state.investigations))
      throw new Error(
        "Unsupported or corrupt workspace. Original state has been preserved.",
      );
    if (!existsSync(this.path)) this.save(this.state);
    // A graph stored before it was reduced to nodes and edges is converted once,
    // keeping the original beside it.
    if (needsGraphUpgrade(this.state)) {
      const backup = join(directory, "workspace.before-nodes-edges.json");
      if (!existsSync(backup)) writeFileSync(backup, readFileSync(this.path), { mode: 0o600 });
      this.save(upgradeGraphState(this.state));
    }
    if (repairClosedBatches(this.state)) this.save(this.state);
    this.marks = [];
    this.mark(this.state);
    this.listeners = new Set();
  }
  // Calls back after every saved change, for work that follows the project's state.
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  // A compact fingerprint per revision, so a waiting coordinator can be told
  // what changed instead of the whole project index.
  mark(state) {
    this.marks.push({
      revision: state.revision,
      conversation: (state.conversation || []).length,
      // Deciding a request edits a message in place rather than adding one.
      decisions: new Map(
        (state.conversation || []).filter((m) => m.decision).map((m) => [m.id, m.decision.status]),
      ),
      candidates: (state.coordination?.candidates || []).length,
      dispatch: JSON.stringify(state.dispatch ?? null),
      investigations: new Map(state.investigations.map((i) => [i.id, fingerprint(i)])),
    });
    if (this.marks.length > 300) this.marks.shift();
  }
  // What changed since a revision, or null when that revision is too old to compare.
  since(revision) {
    const mark = this.marks.find((m) => m.revision === revision);
    if (!mark) return null;
    const now = this.marks.at(-1);
    return {
      investigationIds: this.state.investigations
        .filter((i) => fingerprint(i) !== mark.investigations.get(i.id))
        .map((i) => i.id),
      removedInvestigationIds: [...mark.investigations.keys()].filter(
        (id) => !this.state.investigations.some((i) => i.id === id),
      ),
      conversationFrom: mark.conversation,
      // Only a request the human answered is news; the coordinator wrote the rest.
      decisionsChanged: [...mark.decisions].some(
        ([id, status]) => now.decisions.get(id) !== status,
      ),
      candidatesChanged: now.candidates !== mark.candidates,
      dispatchChanged: now.dispatch !== mark.dispatch,
    };
  }
  save(next) {
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, JSON.stringify(next, null, 2), { mode: 0o600 });
    const descriptor = openSync(temporary, "r");
    try {
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    renameSync(temporary, this.path);
    this.state = next;
    if (this.marks) this.mark(next);
    for (const listener of this.listeners || []) listener(next);
  }
  command(command) {
    const { state, result } = transition(this.state, command);
    if (command.type === "pause") {
      const i = state.investigations.find(i => i.id === command.investigationId);
      for (const job of i?.reviewFlow?.jobs || []) if (["queued", "running"].includes(job.status)) {
        job.status = "paused";
        job.progress = "Paused with the investigation. Saved graph files are retained.";
      }
    }
    if (
      command.type === "reclassify-annotation" &&
      state.coordination?.assignments
    )
      delete state.coordination.assignments[command.investigationId];
    if (state !== this.state) this.save(state);
    return result;
  }
  update(operation) {
    const next = structuredClone(this.state);
    const result = operation(next);
    next.revision++;
    this.save(next);
    return result;
  }
  publicState() {
    const state = structuredClone(this.state);
    for (const i of state.investigations)
      if (i.lease) i.lease = { worker: i.lease.worker, at: i.lease.at };
    for (const i of state.investigations) for (const job of i.reviewFlow?.jobs || []) {
      for (const key of ["packet", "baseDataset", "candidate", "submissions", "runToken", "directory"]) delete job[key];
    }
    if (state.organization) {
      delete state.organization.preview;
      state.organization.history = state.organization.history.map(
        ({ before, ...record }) => record,
      );
    }
    if (state.coordination) {
      delete state.coordination.assignments;
      delete state.coordination.candidates;
    }
    return state;
  }
}

// Cheap per-investigation stamp: identity and sizes only, never deep content.
function fingerprint(i) {
  const flow = i.reviewFlow;
  return [
    i.status,
    i.title,
    i.phase,
    i.number,
    i.queuePosition,
    i.held,
    i.readyAt,
    i.closedAt,
    i.walkthroughRequestedAt,
    i.annotations.length,
    i.annotations.filter((a) => a.dispatchedAt).length,
    i.proposals.length,
    i.checkpoints.length,
    i.events.length,
    (i.questions || []).length,
    i.accessRequest?.resolvedAt ?? i.accessRequest?.at,
    i.resumeRequest?.status,
    i.lease?.token,
    i.graphRequest?.at,
    flow?.walkthroughs.length,
    flow?.jobs.map((j) => `${j.status}:${j.updates.length}:${j.resumeRequest?.status}`).join(),
    flow?.graphReviews
      .map((r) => `${r.status}:${r.decidedAt ?? ""}`)
      .join(),
  ].join("|");
}
