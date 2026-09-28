import { randomUUID } from "node:crypto";
import { GraphModel } from "../src/domain/model.ts";
function summary(plan) {
  return {
    id: plan.id,
    reason: plan.reason,
    removed: plan.removed,
    added: plan.added,
    remaining: plan.dataset.nodes.map((n) => ({ id: n.id, name: n.name, type: n.type })),
    focusId: plan.dataset.initialFocusId,
    message:
      "Sources, annotations, investigation history, and coordinator notes are retained. Active work will pause. A saved snapshot allows undo.",
  };
}
function invalidate(next) {
  for (const i of next.investigations) {
    if (["running", "queued", "review"].includes(i.status)) {
      i.status = "paused";
      delete i.lease;
      for (const p of i.proposals)
        if (p.status === "pending" && p.kind !== "findings")
          p.status = "superseded";
      i.events.push({
        at: new Date().toISOString(),
        message:
          "Graph organized by the user. Saved work is retained; review its references before resuming.",
      });
    }
  }
  if (next.coordination) next.coordination.assignments = {};
}
export function organize(store, command) {
  if (command.action === "organization-preview") {
    const data = structuredClone(store.state.dataset);
    const original = data.nodes;
    const keep = command.keepIds ?? original.map((n) => n.id);
    if (
      !Array.isArray(keep) ||
      keep.some((id) => !original.some((n) => n.id === id))
    )
      throw new Error("Choose existing nodes to keep.");
    const kept = new Set(keep);
    data.nodes = data.nodes.filter((n) => kept.has(n.id));
    data.claims = (data.claims || []).filter(c => kept.has(c.subjectId) && (!c.object.entityId || kept.has(c.object.entityId)));
    const added = [];
    if (command.seed) {
      const { name, type } = command.seed;
      const valid = (text) => typeof text === "string" && text.trim() && text.length <= 200;
      if (!valid(name) || !valid(type)) throw new Error("A starting point needs a name and a type.");
      // The project's own spelling of an existing type, or a new type with the default look.
      const known = data.types.find((t) => t.name.trim().toLowerCase() === type.trim().toLowerCase());
      if (!known) data.types.push({ name: type.trim(), fields: [] });
      const node = { id: randomUUID(), name: name.trim(), type: known?.name || type.trim() };
      data.nodes.push(node);
      added.push({ id: node.id, name: node.name, type: node.type });
    }
    const available = data.nodes;
    data.initialFocusId =
      command.focusId ??
      (available.some((n) => n.id === data.initialFocusId)
        ? data.initialFocusId
        : (available[0]?.id ?? null));
    new GraphModel(data);
    const reason =
      typeof command.reason === "string" && command.reason.trim()
        ? command.reason.slice(0, 1000)
        : "Organize research graph";
    const plan = {
      id: randomUUID(),
      baseRevision: store.state.revision + 1,
      reason,
      dataset: data,
      removed: original
        .filter((n) => !kept.has(n.id))
        .map((n) => ({ id: n.id, name: n.name })),
      added,
    };
    store.update((next) => {
      next.organization ||= { history: [] };
      next.organization.preview = plan;
    });
    return summary(plan);
  }
  if (command.action === "organization-apply") {
    const plan = store.state.organization?.preview;
    if (!plan || plan.id !== command.previewId)
      throw new Error("Preview this organization change first.");
    if (plan.baseRevision !== store.state.revision)
      throw new Error(
        "The workspace changed since preview. Prepare a fresh preview.",
      );
    const id = randomUUID();
    store.update((next) => {
      next.organization.history.push({
        id,
        at: new Date().toISOString(),
        reason: plan.reason,
        before: next.dataset,
        ...(plan.graphProposal ? { graphProposal: plan.graphProposal } : {}),
        appliedRevision: next.datasetRevision + 1,
      });
      next.dataset = plan.dataset;
      next.datasetRevision++;
      delete next.organization.preview;
      invalidate(next);
    });
    return {
      saved: true,
      undoId: id,
      datasetRevision: store.state.datasetRevision,
    };
  }
  if (command.action === "organization-undo") {
    const record = store.state.organization?.history.find(
      (h) => h.id === command.undoId,
    );
    if (!record || record.appliedRevision !== store.state.datasetRevision)
      throw new Error("Undo is available only before another graph change.");
    const id = randomUUID();
    store.update((next) => {
      const restored = structuredClone(record.before);
      // Research records are only ever added, so undoing keeps any that arrived since.
      for (const key of ["sources", "evidence"])
        if (restored[key] || next.dataset[key]) restored[key] = [
          ...new Map(
            [...(restored[key] || []), ...(next.dataset[key] || [])].map(
              (r) => [r.id, r],
            ),
          ).values(),
        ];
      new GraphModel(restored);
      next.organization.history.push({
        id,
        at: new Date().toISOString(),
        reason: `Undo: ${record.reason}`,
        before: next.dataset,
        appliedRevision: next.datasetRevision + 1,
      });
      next.dataset = restored;
      next.datasetRevision++;
      delete next.organization.preview;
      // Undoing an accepted draft reopens its batch for a revised draft. Like accepting
      // it, this leaves running research alone.
      const batch = record.graphReviewId && next.investigations.find((i) => i.reviewFlow?.graphReviews.some((r) => r.id === record.graphReviewId));
      if (batch) {
        const review = batch.reviewFlow.graphReviews.find((r) => r.id === record.graphReviewId);
        review.status = "undone";
        review.undoneAt = new Date().toISOString();
        delete batch.closedAt;
        batch.status = "review";
        batch.events.push({ at: review.undoneAt, message: "Accepted graph draft undone; the batch is open for a revised draft." });
      } else invalidate(next);
    });
    return {
      saved: true,
      undoId: id,
      datasetRevision: store.state.datasetRevision,
    };
  }
  throw new Error("Unknown graph organization action.");
}
