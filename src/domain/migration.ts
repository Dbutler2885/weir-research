import type { Investigation, ResearchState } from "./research.ts";
import type { Assignment, Checkpoint, Choice } from "./assignments.ts";
import { settle } from "./assignments.ts";
import type { GraphDataset } from "./types.ts";

// A batch as it was saved before assignments: one researcher at a time, whose lease,
// session and checkpoints belonged to the batch, under questions headed over the
// human's annotations.
interface LegacyQuestion {
  id: string;
  title: string;
  origin: "human" | "coordinator";
  annotationIds: string[];
  explanation?: string;
  createdAt: string;
}
type LegacyBatch = Investigation & {
  questions?: LegacyQuestion[];
  lease?: { token: string; worker: string; at: string; annotationIds?: string[]; dataset: GraphDataset };
  researcherSession?: Assignment["session"];
};
interface LegacyCoordination {
  // A researcher the coordinator had briefed, waiting to start.
  assignments?: Record<string, { engine: Choice["engine"]; model?: string | null; effort?: string | null; brief: string; annotationIds?: string[] }>;
  candidates?: { investigationId: string; token: string }[];
}

// Converts a project from before assignments, once. Each past research pass becomes a
// finished assignment, titled from the questions it answered and started from the
// annotations it was sent; a question no pass took up becomes an assignment that never
// ran; the researcher working now, or briefed to start, keeps its place.
// Returns whether anything changed.
export function convertToAssignments(state: ResearchState): boolean {
  const legacy = state.investigations.filter((i) => !i.assignments) as LegacyBatch[];
  const coordination = (state as { coordination?: LegacyCoordination }).coordination;
  const renamed = new Map<string, string>();
  for (const batch of legacy) convertBatch(batch, coordination, renamed);
  if (coordination?.assignments) delete coordination.assignments;
  // What the human pinned to a question now points at the assignment that took it up.
  if (renamed.size) {
    const repoint = (target: Record<string, unknown> | undefined) => {
      if (!target || typeof target.questionId !== "string") return;
      const assignmentId = renamed.get(target.questionId);
      delete target.questionId;
      if (assignmentId) target.assignmentId = assignmentId;
    };
    const annotations = [
      ...(state.queue || []),
      ...(state.conversation || []).flatMap((m) => m.annotations || []),
      ...state.investigations.flatMap((i) => i.annotations),
    ];
    for (const a of annotations) for (const t of [a.target, ...(a.references || [])]) repoint(t as never);
    for (const m of state.conversation || []) for (const t of m.references || []) repoint(t as never);
    for (const f of state.interfaceFeedback || []) for (const t of f.references) repoint(t as never);
  }
  return legacy.length > 0;
}

function convertBatch(batch: LegacyBatch, coordination: LegacyCoordination | undefined, renamed: Map<string, string>) {
  const questions = batch.questions || [];
  const checkpoints = [...(batch.checkpoints || [])].sort((a, b) => a.at.localeCompare(b.at));
  const proposals = [...batch.proposals].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  // Each claim started a pass; without a record of claims, each report ended one.
  const starts = batch.executions?.length
    ? [...batch.executions].sort((a, b) => a.at.localeCompare(b.at))
    : proposals.map((p) => ({ at: p.createdAt, worker: "a researcher", provider: "", model: "" }));
  const assignments: Assignment[] = [];
  const answered = new Set<string>();
  let previous: LegacyQuestion[] = [];
  starts.forEach((start, n) => {
    const end = starts[n + 1]?.at;
    const within = (at: string) => (n === 0 || at >= start.at) && (!end || at < end);
    const reports = proposals.filter((p) => within(p.createdAt));
    const last = n === starts.length - 1;
    const current = last ? batch.lease : undefined;
    const annotationIds = [
      ...new Set(reports.length ? reports.flatMap((p) => p.addressedAnnotationIds) : current?.annotationIds || dispatchedBefore(batch, end)),
    ];
    // A pass answers the questions it took up first; one that adds none revises the last.
    const fresh = questions.filter((q) => q.annotationIds.some((id) => annotationIds.includes(id) && !answered.has(id)));
    annotationIds.forEach((id) => answered.add(id));
    const headed = fresh.length ? fresh : previous;
    if (fresh.length) previous = fresh;
    const id = `pass-${n + 1}-${batch.id}`;
    for (const q of fresh) if (!renamed.has(q.id)) renamed.set(q.id, id);
    const assignment: Assignment = {
      id,
      title: headed.map((q) => q.title).join("; ").slice(0, 300) || batch.title,
      brief: headed.filter((q) => q.origin === "coordinator" && q.explanation).map((q) => q.explanation).join("\n\n"),
      annotationIds,
      status: reports.length ? "done" : "stopped",
      createdAt: start.at,
      startedAt: start.at,
      ...(reports.length ? { endedAt: reports.at(-1)!.createdAt } : end ? { endedAt: end } : {}),
      worker: start.worker,
      checkpoints: checkpoints.filter((c) => within(c.at)) as Checkpoint[],
      steering: [],
    };
    if (current) {
      // The researcher working now, or whose result waits for the coordinator.
      const returned = coordination?.candidates?.some((c) => c.investigationId === batch.id && c.token === current.token);
      assignment.status = returned ? "returned" : "running";
      assignment.lease = { token: current.token, worker: current.worker, at: current.at, dataset: current.dataset };
      delete assignment.endedAt;
    } else if (last && batch.status === "paused" && !reports.length) assignment.status = "paused";
    if (last && batch.researcherSession && ["running", "paused"].includes(assignment.status)) assignment.session = batch.researcherSession;
    for (const p of reports) p.assignmentId = id;
    const execution = batch.executions?.find((e) => e === start);
    if (execution) execution.assignmentId = id;
    assignments.push(assignment);
  });
  const briefed = coordination?.assignments?.[batch.id];
  const untaken = questions.filter((q) => !q.annotationIds.some((id) => answered.has(id)));
  if (briefed) {
    // Briefed and waiting for a researcher: it starts as the coordinator asked.
    const id = `pass-${assignments.length + 1}-${batch.id}`;
    untaken.forEach((q) => renamed.set(q.id, id));
    assignments.push({
      id,
      title: untaken.map((q) => q.title).join("; ").slice(0, 300) || batch.title,
      brief: briefed.brief,
      annotationIds: briefed.annotationIds || untaken.flatMap((q) => q.annotationIds),
      choice: { engine: briefed.engine, model: briefed.model ?? null, effort: briefed.effort ?? null },
      status: batch.status === "paused" ? "paused" : "waiting",
      createdAt: batch.events.at(-1)?.at || batch.createdAt,
      checkpoints: [],
      steering: [],
    });
  } else
    for (const q of untaken) {
      const id = `question-${q.id}`;
      renamed.set(q.id, id);
      assignments.push({
        id,
        title: q.title,
        brief: q.origin === "coordinator" ? q.explanation || "" : "",
        annotationIds: q.annotationIds,
        status: "stopped",
        createdAt: q.createdAt,
        checkpoints: [],
        steering: [],
      });
    }
  // Checkpoints from before the first recorded claim belong to the first pass.
  const placed = new Set(assignments.flatMap((a) => a.checkpoints));
  const stray = checkpoints.filter((c) => !placed.has(c));
  if (stray.length && assignments[0]) assignments[0].checkpoints.unshift(...(stray as Checkpoint[]));
  if (batch.accessRequest && !batch.accessRequest.resolvedAt && assignments.at(-1))
    batch.accessRequest.assignmentId = assignments.at(-1)!.id;
  batch.assignments = assignments;
  delete batch.questions;
  delete batch.lease;
  delete batch.researcherSession;
  delete batch.checkpoints;
}

function dispatchedBefore(batch: Investigation, end: string | undefined): string[] {
  return batch.annotations.filter((a) => a.dispatchedAt && (!end || a.dispatchedAt < end)).map((a) => a.id);
}

// Converts a project from the time the coordinator could do research itself.
// Work it had claimed stays paused and resumes through a worker the app starts,
// once the human approves; a graph job it built itself waits for a builder.
// Returns whether anything changed.
export function convertToAppWorkers(state: ResearchState, now = new Date().toISOString()): boolean {
  let changed = false;
  for (const i of state.investigations) {
    const native = (i.assignments || []).filter((a) => a.status === "running" && a.lease?.worker.startsWith("Coordinator:"));
    if (native.length) {
      for (const a of native) {
        a.status = "paused";
        delete a.lease;
      }
      settle(i);
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
