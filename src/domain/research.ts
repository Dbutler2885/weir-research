import { GenealogyModel } from "./model.ts";
import type { FamilyDataset } from "./types.ts";

export type Table =
  | "people"
  | "unions"
  | "directParentage"
  | "contextEntities"
  | "contextConnections"
  | "sources";
export interface AnnotationTarget {
  table?: Table;
  recordId?: string;
  label: string;
  selector?: string;
  text?: string;
  anchor?: unknown;
  proposalId?: string;
}
export interface Annotation {
  id: string;
  target: AnnotationTarget;
  question: string;
  createdAt: string;
  dispatchedAt?: string;
}
export interface Evidence {
  id: string;
  sourceId: string;
  documentId?: string;
  quote: string;
  context: string;
  locator: string;
  interpretation: string;
  stance: "supports" | "challenges" | "context";
}
export interface Change {
  table: Table;
  recordId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string;
  evidenceIds: string[];
}
export interface Proposal {
  id: string;
  revision: number;
  title: string;
  summary: string;
  ambiguity: string;
  evidence: Evidence[];
  changes: Change[];
  addressedAnnotationIds: string[];
  createdAt: string;
  status: "pending" | "accepted" | "rejected" | "superseded";
  decidedAt?: string;
}
export interface Investigation {
  id: string;
  title: string;
  status: "draft" | "queued" | "running" | "review" | "paused" | "closed";
  createdAt: string;
  scope: string[];
  annotations: Annotation[];
  checkpoints: {
    id: string;
    at: string;
    worker: string;
    summary: string;
    findings: string;
    nextSteps: string;
  }[];
  proposals: Proposal[];
  events: { at: string; message: string }[];
  lease?: {
    token: string;
    worker: string;
    at: string;
    annotationIds: string[];
    dataset: FamilyDataset;
  };
}
export interface SourceCollection {
  id: string;
  name: string;
  kind: "web" | "folder" | "imports";
  path?: string;
  description: string;
}
export interface ResearchDocument {
  id: string;
  collectionId: string;
  name: string;
  mime: string;
  size: number;
  sha256: string;
  importedAt: string;
  text?: string;
}
export interface ResearchState {
  version: 1;
  revision: number;
  datasetRevision: number;
  dataset: FamilyDataset;
  investigations: Investigation[];
  collections: SourceCollection[];
  documents: ResearchDocument[];
  engine?: "manual" | "codex" | "claude";
  organization?: {
    history: {
      id: string;
      at: string;
      reason: string;
      appliedRevision: number;
    }[];
  };
  coordinator?: {
    enabled: boolean;
    connected: boolean;
    name: string | null;
    handoff: string;
    awaitingSynthesis: string[];
  };
  researcher?: {
    selected: "manual" | "codex" | "claude";
    engines: { id: string; available: boolean }[];
    limit: number;
  };
}

export function initialState(dataset: FamilyDataset): ResearchState {
  new GenealogyModel(dataset);
  return {
    version: 1,
    revision: 0,
    datasetRevision: 0,
    dataset: structuredClone(dataset),
    investigations: [],
    documents: [],
    collections: [
      {
        id: "web",
        name: "Public web",
        kind: "web",
        description:
          "Publicly accessible sources. Search and retrieval depend on the assigned research agent.",
      },
      {
        id: "imports",
        name: "Imported documents",
        kind: "imports",
        description:
          "Preserved local copies. Text and Markdown are readable; PDFs retain their original pages.",
      },
    ],
  };
}
function requireThat(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function nonempty(value: unknown, label: string): asserts value is string {
  requireThat(
    typeof value === "string" &&
      value.trim().length > 0 &&
      value.length <= 50_000,
    `${label} is required (maximum 50,000 characters).`,
  );
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export function applyChanges(
  dataset: FamilyDataset,
  changes: Change[],
): FamilyDataset {
  const next = structuredClone(dataset);
  const touched = new Set<string>();
  const tables: Table[] = [
    "people",
    "unions",
    "directParentage",
    "contextEntities",
    "contextConnections",
    "sources",
  ];
  requireThat(Array.isArray(changes), "Changes must be a list.");
  for (const change of changes) {
    requireThat(tables.includes(change.table), "Unknown record collection.");
    nonempty(change.recordId, "Record identifier");
    nonempty(change.reason, "Change reason");
    const key = `${change.table}:${change.recordId}`;
    requireThat(
      !touched.has(key),
      "A proposal cannot change the same record twice.",
    );
    touched.add(key);
    const records = (next[change.table] ??= [] as never) as unknown as Record<
      string,
      unknown
    >[];
    const index = records.findIndex((r) => r.id === change.recordId);
    const current = index < 0 ? null : records[index];
    requireThat(
      canonical(current) === canonical(change.before),
      `Research changed since this proposal was prepared: ${change.recordId}. Request a revised proposal.`,
    );
    requireThat(
      change.before !== null || change.after !== null,
      "Empty change.",
    );
    if (change.after === null) records.splice(index, 1);
    else {
      requireThat(
        typeof change.after === "object" && change.after.id === change.recordId,
        "Replacement must preserve the record identifier.",
      );
      if (index < 0) records.push(structuredClone(change.after));
      else records[index] = structuredClone(change.after);
    }
  }
  if (
    next.initialFocusId &&
    ![...next.people, ...(next.contextEntities ?? [])].some(
      (n) => n.id === next.initialFocusId,
    )
  )
    next.initialFocusId = null;
  new GenealogyModel(next);
  return next;
}

export interface ResearchCommand {
  type:
    | "annotate"
    | "dispatch"
    | "pause"
    | "resume"
    | "claim"
    | "checkpoint"
    | "propose"
    | "accept"
    | "reject";
  investigationId?: string;
  [key: string]: unknown;
}
export function transition(
  state: ResearchState,
  command: ResearchCommand,
  now = new Date().toISOString(),
): { state: ResearchState; result: unknown } {
  const next = structuredClone(state);
  const id = () => crypto.randomUUID();
  let investigation = next.investigations.find(
    (i) => i.id === command.investigationId,
  );
  let result: unknown;
  if (command.type === "annotate") {
    nonempty(command.question, "Research question");
    const target = command.target as AnnotationTarget;
    requireThat(
      target && typeof target === "object",
      "An annotation target is required.",
    );
    nonempty(target.label, "Selection label");
    if (command.investigationId)
      requireThat(investigation, "Investigation no longer exists.");
    if (!investigation) {
      requireThat(
        !target.proposalId,
        "Proposal annotations must belong to their investigation.",
      );
      const scope = (command.scope as string[]) ?? ["web", "imports"];
      requireThat(
        Array.isArray(scope) &&
          scope.every((s) => next.collections.some((c) => c.id === s)),
        "Unknown source collection.",
      );
      investigation = {
        id: id(),
        title: command.question.slice(0, 150),
        createdAt: now,
        status: "draft",
        scope,
        annotations: [],
        checkpoints: [],
        proposals: [],
        events: [],
      };
      next.investigations.push(investigation);
    }
    if (target.proposalId)
      requireThat(
        investigation.proposals.some((p) => p.id === target.proposalId),
        "Proposal is not part of this investigation.",
      );
    investigation.annotations.push({
      id: id(),
      target,
      question: command.question,
      createdAt: now,
      ...(command.dispatch ? { dispatchedAt: now } : {}),
    });
    if (command.dispatch) {
      // A replacement pass gets the new context; fence any old worker immediately.
      delete investigation.lease;
      investigation.status = "queued";
      for (const p of investigation.proposals)
        if (p.status === "pending") p.status = "superseded";
    }
    investigation.events.push({
      at: now,
      message: command.dispatch
        ? "Annotation sent for investigation."
        : "Annotation saved to the queue.",
    });
    result = { investigationId: investigation.id };
  } else if (command.type === "claim") {
    nonempty(command.worker, "Worker name");
    investigation = command.investigationId
      ? investigation
      : next.investigations.find((i) => i.status === "queued");
    if (!investigation) return { state, result: null };
    requireThat(
      investigation.status === "queued",
      "Investigation is not queued. Resume it to replace the worker.",
    );
    investigation.lease = {
      token: id(),
      worker: command.worker,
      at: now,
      annotationIds: investigation.annotations
        .filter((a) => a.dispatchedAt)
        .map((a) => a.id),
      dataset: structuredClone(next.dataset),
    };
    investigation.status = "running";
    investigation.events.push({
      at: now,
      message: `Research claimed by ${command.worker}.`,
    });
    result = {
      investigation,
      collections: next.collections.filter((c) =>
        investigation!.scope.includes(c.id),
      ),
      documents: next.documents.filter((d) =>
        investigation!.scope.includes(d.collectionId),
      ),
    };
  } else {
    requireThat(investigation, "Unknown investigation.");
    if (["checkpoint", "propose"].includes(command.type))
      requireThat(
        investigation.status === "running" &&
          investigation.lease &&
          investigation.lease.token === command.token,
        "Worker lease is no longer current. Read the saved handoff before claiming work again.",
      );
    if (command.type === "dispatch" || command.type === "resume") {
      investigation.annotations.forEach((a) => {
        a.dispatchedAt ??= now;
      });
      investigation.status = "queued";
      delete investigation.lease;
      investigation.proposals.forEach((p) => {
        if (p.status === "pending") p.status = "superseded";
      });
      investigation.events.push({
        at: now,
        message:
          command.type === "resume"
            ? "Queued for a replacement worker; saved findings retained."
            : "Queued annotations dispatched together.",
      });
    } else if (command.type === "pause") {
      investigation.status = "paused";
      delete investigation.lease;
      investigation.events.push({
        at: now,
        message: "Investigation paused; saved findings retained.",
      });
    } else if (command.type === "checkpoint") {
      nonempty(command.summary, "Checkpoint summary");
      nonempty(command.findings, "Findings, including unsuccessful searches");
      nonempty(command.nextSteps, "Remaining work");
      investigation.checkpoints.push({
        id: id(),
        at: now,
        worker: investigation.lease!.worker,
        summary: command.summary,
        findings: command.findings,
        nextSteps: command.nextSteps,
      });
    } else if (command.type === "propose") {
      const p = command.proposal as Proposal;
      requireThat(p && typeof p === "object", "Proposal is required.");
      nonempty(p.title, "Proposal title");
      nonempty(p.summary, "Proposal summary");
      requireThat(
        typeof p.ambiguity === "string",
        "Describe remaining ambiguity, or explicitly state none.",
      );
      requireThat(
        Array.isArray(p.evidence) && Array.isArray(p.changes),
        "Evidence and changes must be lists.",
      );
      requireThat(
        p.changes.length > 0 || p.ambiguity.trim().length > 0,
        "An investigation without changes must record its unresolved outcome.",
      );
      const candidate = applyChanges(investigation.lease!.dataset, p.changes);
      // Also verify against current accepted research. Never publish a misleading stale preview.
      applyChanges(next.dataset, p.changes);
      const evidenceIds = new Set<string>();
      for (const e of p.evidence) {
        nonempty(e.id, "Evidence identifier");
        requireThat(!evidenceIds.has(e.id), "Duplicate evidence identifier.");
        evidenceIds.add(e.id);
        requireThat(
          candidate.sources?.some((s) => s.id === e.sourceId),
          "Evidence must reference a source record.",
        );
        nonempty(e.quote, "Evidence passage");
        nonempty(e.context, "Source context");
        nonempty(e.locator, "Source locator");
        nonempty(e.interpretation, "Interpretation");
        requireThat(
          ["supports", "challenges", "context"].includes(e.stance),
          "Unknown evidence stance.",
        );
        if (e.documentId) {
          const document = next.documents.find((d) => d.id === e.documentId);
          requireThat(document, "Evidence document does not exist.");
          requireThat(
            e.sourceId === document.id,
            "Preserved evidence must cite that document's source record.",
          );
          requireThat(
            investigation.scope.includes(document.collectionId),
            "Evidence document is outside the investigation scope.",
          );
          if (document.text !== undefined)
            requireThat(
              document.text.includes(e.quote),
              "Quoted passage was not found in the preserved document.",
            );
        }
      }
      for (const change of p.changes)
        requireThat(
          Array.isArray(change.evidenceIds) &&
            change.evidenceIds.length > 0 &&
            change.evidenceIds.every((e) => evidenceIds.has(e)),
          "Each change needs identified evidence.",
        );
      const proposal: Proposal = {
        id: id(),
        revision: investigation.proposals.length + 1,
        title: p.title,
        summary: p.summary,
        ambiguity: p.ambiguity,
        evidence: p.evidence,
        changes: p.changes,
        addressedAnnotationIds: [...investigation.lease!.annotationIds],
        createdAt: now,
        status: "pending",
      };
      investigation.proposals.forEach((old) => {
        if (old.status === "pending") old.status = "superseded";
      });
      investigation.proposals.push(proposal);
      investigation.status = "review";
      delete investigation.lease;
      investigation.events.push({
        at: now,
        message: `Proposal revision ${proposal.revision} is ready to review.`,
      });
      result = { proposalId: proposal.id };
    } else if (command.type === "accept" || command.type === "reject") {
      const p = investigation.proposals.find(
        (proposal) => proposal.id === command.proposalId,
      );
      requireThat(
        p && p.status === "pending",
        "This proposal revision is no longer awaiting a decision.",
      );
      requireThat(
        investigation.status === "review",
        "Finish or resume the investigation before deciding on this proposal.",
      );
      requireThat(
        investigation.annotations.every((a) =>
          p.addressedAnnotationIds.includes(a.id),
        ),
        "There is newer feedback on this investigation. Dispatch it and review a revised proposal first.",
      );
      if (command.type === "accept") {
        next.dataset = applyChanges(next.dataset, p.changes);
        if (p.changes.length) next.datasetRevision++;
      }
      p.status = command.type === "accept" ? "accepted" : "rejected";
      p.decidedAt = now;
      investigation.status = "closed";
      investigation.events.push({
        at: now,
        message:
          command.type === "accept"
            ? `Accepted revision ${p.revision}${p.changes.length ? "; research updated" : "; unresolved outcome preserved"}.`
            : `Rejected revision ${p.revision}; research unchanged.`,
      });
    } else throw new Error("Unknown research command.");
  }
  next.revision++;
  return { state: next, result };
}
