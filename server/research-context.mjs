import { sourceLibrary } from "../src/domain/findings.ts";
const tables = [
  "people",
  "unions",
  "directParentage",
  "contextEntities",
  "contextConnections",
  "sources",
];
const label = (record) =>
  record.name || record.title || record.label || record.id;
const clip = (value, limit = 500) => String(value || "").slice(0, limit);
const withoutLease = (investigation) => {
  const result = structuredClone(investigation);
  if (result.lease)
    result.lease = { worker: result.lease.worker, at: result.lease.at };
  return result;
};
export function projectIndex(state) {
  return {
    title: state.dataset.title,
    latestOrganization: state.organization?.history.at(-1)
      ? {
          reason: state.organization.history.at(-1).reason,
          at: state.organization.history.at(-1).at,
          instruction:
            "Graph was organized; recheck map references and paused investigations before resuming.",
        }
      : null,
    startingEntity: state.dataset.initialFocusId
      ? {
          table: state.dataset.people.some(
            (p) => p.id === state.dataset.initialFocusId,
          )
            ? "people"
            : "contextEntities",
          id: state.dataset.initialFocusId,
        }
      : null,
    counts: Object.fromEntries(
      tables.map((t) => [
        t,
        t === "sources"
          ? sourceLibrary(state).length
          : (state.dataset[t] || []).length,
      ]),
    ),
    sourceCollections: state.collections.map(({ id, name, kind }) => ({
      id,
      name,
      kind,
    })),
    researchMap: clip(state.coordination?.researchMap, 6000),
    researchMapTruncated: (state.coordination?.researchMap?.length || 0) > 6000,
    retrieval:
      "Search to locate relevant records; inspect a specific investigation, candidate, entity, source passage, or the complete research map. IDs are durable references, not proof of a finding.",
  };
}
export function investigationIndex(i) {
  return {
    guidedReview: i.reviewFlow ? {
      walkthrough: i.reviewFlow.walkthroughs.at(-1)?.id,
      jobs: i.reviewFlow.jobs.filter(j => j.status !== "superseded").map(j => ({id: j.id, status: j.status, progress: j.progress, engine: j.engine, consumedUpdateSequence: j.consumedUpdateSequence, latestUpdateSequence: j.updates.length, resumeRequest: j.resumeRequest, issues: j.issues})),
      graphReview: i.reviewFlow.graphReviews.at(-1)?.id,
      nextAction: i.reviewFlow.jobs.some(j => j.status === "returned") ? "Inspect flow, then author and publish the graphical walkthrough." : null,
    } : i.proposals.some(p => p.kind === "findings") ? {nextAction: "Use the present-research skill to publish a guided walkthrough; graph preparation follows automatically."} : null,
    id: i.id,
    title: i.title,
    status: i.status,
    sourceScope: i.scope,
    phase: i.phase || "research",
    graphRequest: i.graphRequest,
    accessRequest: i.accessRequest,
    resumeRequest: i.resumeRequest,
    execution: i.executions?.at(-1),
    findings: i.proposals
      .flatMap((p) =>
        (p.findings || []).map((f) => ({
          proposalId: p.id,
          id: f.id,
          statement: clip(f.statement),
          qualification: f.qualification,
          status: f.status,
        })),
      )
      .slice(-30),
    annotationCount: i.annotations.length,
    unsent: i.annotations.filter((a) => !a.dispatchedAt).length,
    checkpointCount: i.checkpoints.length,
    proposalCount: i.proposals.length,
    latestActivity: i.events.at(-1),
    latestCheckpoint: i.checkpoints.at(-1)
      ? {
          id: i.checkpoints.at(-1).id,
          summary: clip(i.checkpoints.at(-1).summary),
        }
      : null,
    latestProposal: i.proposals.at(-1)
      ? {
          id: i.proposals.at(-1).id,
          title: i.proposals.at(-1).title,
          status: i.proposals.at(-1).status,
        }
      : null,
  };
}
export function inspectContext(state, request, candidates) {
  if (request.kind === "interface-feedback")
    return { items: state.interfaceFeedback || [] };
  if (request.kind === "map")
    return {
      researchMap: state.coordination?.researchMap || "",
      handoff: state.coordination?.handoff || "",
    };
  if (request.kind === "investigations") {
    const items = state.investigations.filter(
      (i) => !request.status || i.status === request.status,
    );
    const offset = Math.max(0, Math.floor(Number(request.offset) || 0));
    return {
      items: items.slice(offset, offset + 50).map(investigationIndex),
      total: items.length,
      nextOffset: offset + 50 < items.length ? offset + 50 : null,
    };
  }
  if (request.kind === "investigation") {
    const i = state.investigations.find((i) => i.id === request.id);
    if (!i) throw new Error("Investigation not found.");
    return withoutLease(i);
  }
  if (request.kind === "candidate") {
    const c = (state.coordination?.candidates || []).find(
      (c) => c.id === request.id,
    );
    if (!c) throw new Error("Candidate not found.");
    const { token, ...result } = c;
    return {
      ...structuredClone(result),
      current: candidates.some((item) => item.id === c.id),
    };
  }
  if (request.kind === "entity") {
    if (!tables.includes(request.table))
      throw new Error("Choose a supported record table.");
    const record = state.dataset[request.table]?.find(
      (r) => r.id === request.id,
    );
    if (!record) throw new Error("Record not found.");
    const neighbors = [];
    const references = Object.values(record).flatMap((v) =>
      Array.isArray(v) ? v : [v],
    );
    for (const table of tables)
      for (const r of state.dataset[table] || []) {
        if (r === record) continue;
        if (
          Object.values(r).some(
            (v) =>
              v === request.id || (Array.isArray(v) && v.includes(request.id)),
          ) ||
          references.includes(r.id)
        )
          neighbors.push({ table, id: r.id, label: label(r) });
      }
    return {
      table: request.table,
      record,
      neighbors: neighbors.slice(0, 100),
      neighborCount: neighbors.length,
      investigations: state.investigations
        .filter((i) =>
          i.annotations.some((a) => a.target.recordId === request.id),
        )
        .map(investigationIndex),
    };
  }
  if (request.kind === "source") {
    const record = sourceLibrary(state).find((s) => s.id === request.id);
    if (!record) throw new Error("Source not found.");
    const doc = state.documents.find((d) => d.id === request.id);
    if (!doc)
      return {
        source: record,
        access: "Citation metadata only; original text is not preserved here.",
      };
    const { text, ...metadata } = doc;
    const offset = Math.max(0, Math.floor(Number(request.offset) || 0));
    const limit = Math.max(
      1,
      Math.min(20_000, Math.floor(Number(request.limit) || 6000)),
    );
    return {
      source: record,
      document: metadata,
      offset,
      text: text?.slice(offset, offset + limit),
      totalCharacters: text?.length,
      nextOffset: text && offset + limit < text.length ? offset + limit : null,
      original: `/api/documents/${doc.id}`,
    };
  }
  throw new Error(
    "Inspect supports map, investigation, candidate, entity, or source.",
  );
}
export function searchContext(state, query, requestedOffset = 0) {
  if (typeof query !== "string" || !query.trim() || query.length > 300)
    throw new Error("Supply a search query of 1-300 characters.");
  const terms = query.toLowerCase().trim().split(/\s+/);
  const hits = [];
  const consider = (ref, text) => {
    const lower = text.toLowerCase();
    if (!terms.every((t) => lower.includes(t))) return;
    const start = Math.max(0, lower.indexOf(terms[0]) - 120);
    hits.push({
      ...ref,
      ...(ref.kind === "source" ? { offset: start } : {}),
      excerpt: text.slice(start, start + 600),
    });
  };
  for (const table of tables)
    for (const r of state.dataset[table] || [])
      consider(
        { kind: "entity", table, id: r.id, label: label(r) },
        JSON.stringify(r),
      );
  for (const i of state.investigations)
    consider(
      { kind: "investigation", id: i.id, label: i.title },
      JSON.stringify({
        title: i.title,
        annotations: i.annotations,
        checkpoints: i.checkpoints,
        proposals: i.proposals,
        graphRequest: i.graphRequest,
      }),
    );
  for (const c of state.coordination?.candidates || [])
    consider(
      {
        kind: "candidate",
        id: c.id,
        investigationId: c.investigationId,
        label: c.proposal.title,
      },
      JSON.stringify(c.proposal),
    );
  for (const s of sourceLibrary(state))
    consider({ kind: "source", id: s.id, label: s.title }, JSON.stringify(s));
  for (const d of state.documents)
    if (d.text) consider({ kind: "source", id: d.id, label: d.name }, d.text);
  const offset = Math.max(0, Math.floor(Number(requestedOffset) || 0));
  return {
    query,
    hits: hits.slice(offset, offset + 20),
    total: hits.length,
    nextOffset: offset + 20 < hits.length ? offset + 20 : null,
    reminder:
      "Search excerpts locate evidence; inspect the original record or preserved passage before relying on them.",
  };
}
