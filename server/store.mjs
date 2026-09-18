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
