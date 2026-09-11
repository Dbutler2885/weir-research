import { randomUUID } from "node:crypto";
import { GenealogyModel } from "../src/domain/model.ts";
const nodes = (d) => [...d.people, ...(d.contextEntities || [])];
function summary(plan) {
  return {
    id: plan.id,
    reason: plan.reason,
    removed: plan.removed,
    added: plan.added,
    remaining: nodes(plan.dataset).map((n) => ({
      id: n.id,
      name: n.name,
      kind: n.kind || "person",
    })),
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
    const original = nodes(data);
    const keep = command.keepIds ?? original.map((n) => n.id);
    if (
      !Array.isArray(keep) ||
      keep.some((id) => !original.some((n) => n.id === id))
    )
      throw new Error("Choose existing nodes to keep.");
    const kept = new Set(keep);
    data.people = data.people.filter((n) => kept.has(n.id));
    data.contextEntities = (data.contextEntities || []).filter((n) =>
      kept.has(n.id),
    );
    data.unions = data.unions
      .filter((u) => u.partnerIds.every((id) => kept.has(id)))
      .map((u) => ({
        ...u,
        childIds: (u.childIds || []).filter((id) => kept.has(id)),
      }));
    data.directParentage = (data.directParentage || []).filter(
      (c) => kept.has(c.parentId) && kept.has(c.childId),
    );
    data.contextConnections = (data.contextConnections || []).filter(
      (c) => kept.has(c.fromId) && kept.has(c.toId),
    );
    const added = [];
    if (command.seed) {
      const { name, kind } = command.seed;
      if (
        typeof name !== "string" ||
        !name.trim() ||
        name.length > 200 ||
        ![
          "person",
          "place",
          "organization",
          "family",
          "event",
          "vessel",
        ].includes(kind)
      )
        throw new Error("A name and supported node kind are required.");
      const node = {
        id: randomUUID(),
        name: name.trim(),
        ...(kind === "person" ? {} : { kind }),
      };
      if (kind === "person") data.people.push(node);
      else data.contextEntities.push(node);
      added.push({ id: node.id, name: node.name, kind });
    }
    const available = nodes(data);
    data.initialFocusId =
      command.focusId ??
      (available.some((n) => n.id === data.initialFocusId)
        ? data.initialFocusId
        : (available[0]?.id ?? null));
    new GenealogyModel(data);
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
      restored.sources = [
        ...new Map(
          [...(restored.sources || []), ...(next.dataset.sources || [])].map(
            (s) => [s.id, s],
          ),
        ).values(),
      ];
      new GenealogyModel(restored);
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
      invalidate(next);
    });
    return {
      saved: true,
      undoId: id,
      datasetRevision: store.state.datasetRevision,
    };
  }
  throw new Error("Unknown graph organization action.");
}
