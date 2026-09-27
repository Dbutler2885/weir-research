import { canonical, applyChanges } from "./changes.ts";
export { applyChanges } from "./changes.ts";
import {
  sourceLibrary,
  registeredSources,
  validatePhase,
  validateReferences,
  getFinding,
  requireKept,
  graphSelection,
  assert,
} from "./findings.ts";
import type { Finding, FindingRef, GraphGroup } from "./findings.ts";
import type { SourceRecord } from "./types.ts";
import type { Catalog, Dispatch } from "./dispatch.ts";
import { holdInQueue, moveInQueue } from "./queue.ts";
import { GenealogyModel } from "./model.ts";
import type { FamilyDataset, LegacyDataset } from "./types.ts";
import { upgradeDataset } from "./graph-upgrade.ts";
import type { ReviewFlow } from "./review-flow";
import {
  conversationTransition,
  humanConversationCommands,
  coordinatorConversationCommands,
} from "./conversation.ts";
import type { Brief, Message, Question } from "./conversation.ts";

export type Table = "people" | "contextEntities" | "claims" | "sources";
export interface AnnotationTarget {
  walkthroughId?: string;
  stepId?: string;
  graphReviewId?: string;
  claimId?: string;
  table?: Table;
  recordId?: string;
  label: string;
  selector?: string;
  text?: string;
  anchor?: unknown;
  proposalId?: string;
  findingId?: string;
  groupId?: string;
  // A batch, or one of its questions, as a whole.
  investigationId?: string;
  questionId?: string;
  // The screen it was picked from; see describeScreen.
  screen?: { view: string; investigationId?: string; sourceId?: string; focusId?: string };
  // In developer mode, where on the page it was, for feedback about Weir itself:
  // the element, the headings above it, and the window's size. The coordinator never sees it.
  page?: { element: string; headings: string[]; viewport: string };
}
// What a reference is on, as the human and the coordinator read it: its name, and
// the words the human selected there when a selection is what they pointed at.
export function referenceText(r: AnnotationTarget): string {
  const selected = (r.anchor as { type?: string } | undefined)?.type === "text-range" ? r.text?.replace(/\s+/g, " ").trim() : "";
  if (!selected || r.label.includes(selected)) return r.label;
  return `“${selected.length > 300 ? `${selected.slice(0, 297)}...` : selected}” in ${r.label}`;
}
export interface Annotation {
  id: string;
  // Present when the coordinator raised this question after the human approved it.
  author?: "coordinator";
  target: AnnotationTarget;
  references?: AnnotationTarget[];
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
  kind?: "findings" | "graph";
  findings?: Finding[];
  groups?: GraphGroup[];
  sources?: SourceRecord[];
  omissions?: string;
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
// An investigation record is a batch: the coordinator's grouping of research
// that one walkthrough and one graph update explain.
export interface Investigation {
  number?: number;
  brief?: Brief;
  questions?: Question[];
  readyAt?: string;
  closedAt?: string;
  walkthroughRequestedAt?: string;
  // The batch's place in the queue, once the human has reordered it, and whether they hold it.
  queuePosition?: number;
  held?: boolean;
  reviewFlow?: ReviewFlow;
  resumeRequest?: {
    id: string;
    reason: string;
    at: string;
    status: "pending" | "approved" | "declined";
    decidedAt?: string;
  };
  phase?: "research" | "graph";
  graphRequest?: { refs: FindingRef[]; at: string };
  accessRequest?: { instruction: string; url?: string; resolvedAt?: string };
  executions?: {
    at: string;
    worker: string;
    provider: string;
    model: string;
  }[];
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
  extraction?: {
    processor: string;
    status: string;
    totalPages?: number;
    processedPages?: number[];
    bundle?: string;
  };
}
export interface ResearchState {
  version: 1;
  revision: number;
  datasetRevision: number;
  dataset: FamilyDataset;
  investigations: Investigation[];
  queue?: Annotation[];
  conversation?: Message[];
  collections: SourceCollection[];
  documents: ResearchDocument[];
  library?: SourceRecord[];
  interfaceFeedback?: {
    id: string;
    text: string;
    references: AnnotationTarget[];
    at: string;
    origin?: {
      investigationId: string;
      annotation: Annotation;
      movedAt: string;
    };
  }[];
  engine?: "manual" | "codex" | "claude";
  researchSettings?: { timeLimitMinutes: number | null; maxWorkers?: number; compactAt?: number };
  reviewSettings?: { autoWalkthrough: boolean; autoGraph: boolean };
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
    // Listening right now, as opposed to attached but busy elsewhere.
    connected: boolean;
    attached?: boolean;
    // Waiting for the next thing to do, rather than working on something.
    listening?: boolean;
    // What it last did, from its output stream or the command it sent.
    latest?: { at: string; text: string } | null;
    // The few steps before the latest, most recent first.
    trail?: { at: string; text: string }[];
    // When its current turn began, while it is working.
    since?: string | null;
    // When the usage limit holds it: messages wait until it resets.
    paused?: { until: string } | null;
    // Why the app's coordinator is not running, when it is not.
    problem?: string | null;
    // The sample's coordinator, which starts when the human first writes to it.
    waiting?: boolean;
    // How full its context is, and the size at which it compacts.
    context?: { tokens: number; threshold: number; compactions: number; compacting: boolean } | null;
    lastSeenSecondsAgo?: number | null;
    name: string | null;
    handoff: string;
    awaitingSynthesis: string[];
  };
  // What each running worker is doing right now; never saved.
  live?: LiveWorker[];
  // Which agent, model and effort does each job, and what the installed CLIs offer.
  dispatch?: Dispatch;
  catalog?: Catalog;
  // Whether the app shows the tools for feedback about Weir itself; set for the whole app.
  developerMode?: boolean;
  // Whether Google Chrome is installed for the research browser.
  researchBrowser?: { available: boolean; name?: string | null };
  // The latest usage each agent CLI reported, where it reports any.
  usage?: Partial<Record<"claude" | "codex", Usage>>;
}

export interface Usage {
  exhausted: boolean;
  resetsAt: number | null;
  windows: { name: string; used: number; resetsAt: number | null }[];
  at: number;
}

export interface LiveWorker {
  role: "researcher" | "builder" | "writer" | "helper";
  name: string;
  // Absent for a helper, whose task belongs to no batch.
  investigationId?: string;
  task?: string;
  jobId?: string;
  startedAt: string;
  latest: { at: string; text: string } | null;
  // The few steps before the latest, most recent first.
  trail?: { at: string; text: string }[];
}

export function initialState(source: FamilyDataset | LegacyDataset): ResearchState {
  const dataset = upgradeDataset(source);
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

export interface ResearchCommand {
  type:
    | "finding-decision"
    | "build-graph"
    | "apply-groups"
    | "edit-annotation"
    | "delete-annotation"
    | "interface-feedback"
    | "reclassify-annotation"
    | "resume-decision"
    | "resolve-access"
    | "annotate"
    | "dispatch"
    | "pause"
    | "resume"
    | "claim"
    | "checkpoint"
    | "propose"
    | "accept"
    | "reject"
    | "queue-annotation"
    | "edit-queued"
    | "remove-queued"
    | "send"
    | "decide"
    | "reply"
    | "open-batch"
    | "add-to-batch"
    | "batch-ready"
    | "request-approval"
    | "retitle"
    | "set-brief"
    | "queue-move"
    | "queue-hold";
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
  if (
    humanConversationCommands.has(command.type) ||
    coordinatorConversationCommands.has(command.type)
  ) {
    const result = conversationTransition(next, command, now, id);
    next.revision++;
    return { state: next, result };
  }
  let investigation = next.investigations.find(
    (i) => i.id === command.investigationId,
  );
  let result: unknown;
  // The human orders the queue and holds batches in it.
  if (command.type === "queue-move" || command.type === "queue-hold") {
    const result =
      command.type === "queue-move"
        ? moveInQueue(next, command.investigationId!, command.direction as "up" | "down", now)
        : holdInQueue(next, command.investigationId!, Boolean(command.held), now);
    next.revision++;
    return { state: next, result };
  }
  if (command.type === "resume-decision") {
    assert(investigation?.status === "paused", "Investigation is not paused.");
    const pending = investigation.resumeRequest;
    assert(
      pending?.status === "pending" && pending.id === command.requestId,
      "This resume request is no longer pending.",
    );
    assert(
      command.decision === "approve" || command.decision === "decline",
      "Choose approve or decline.",
    );
    pending.status = command.decision === "approve" ? "approved" : "declined";
    pending.decidedAt = now;
    investigation.events.push({
      at: now,
      message:
        command.decision === "approve"
          ? "Human approved the coordinator's request to resume."
          : "Human declined the coordinator's request; research remains paused.",
    });
    if (command.decision === "approve")
      return transition(
        next,
        { type: "resume", investigationId: investigation.id },
        now,
      );
    next.revision++;
    return { state: next, result: { paused: true } };
  }
  if (command.type === "reclassify-annotation") {
    assert(investigation, "Unknown investigation.");
    assert(
      investigation.status === "paused" && !investigation.lease,
      "Pause the investigation before reclassifying an annotation.",
    );
    const original = investigation.annotations.find(
      (a) => a.id === command.annotationId,
    );
    assert(original, "Unknown annotation.");
    assert(
      !investigation.proposals.some((p) =>
        p.addressedAnnotationIds.includes(original.id),
      ),
      "Annotations addressed by proposals must retain their research links.",
    );
    const feedback = next.interfaceFeedback?.find(
      (f) => f.id === command.feedbackId,
    );
    assert(
      feedback &&
        !feedback.origin &&
        feedback.text === original.question &&
        canonical(feedback.references) ===
          canonical(original.references || [original.target]),
      "Choose the matching interface feedback record without an existing origin.",
    );
    feedback.origin = {
      investigationId: investigation.id,
      annotation: original,
      movedAt: now,
    };
    investigation.annotations = investigation.annotations.filter(
      (a) => a.id !== original.id,
    );
    investigation.events.push({
      at: now,
      message: `Annotation ${original.id} moved to interface feedback ${feedback.id}; excluded from future research assignments.`,
    });
    next.revision++;
    return { state: next, result: { moved: true, feedbackId: feedback.id } };
  }
  if (command.type === "interface-feedback") {
    nonempty(command.question, "Interface feedback");
    const refs = (command.references || []) as AnnotationTarget[];
    validateReferences(next, refs);
    if (command.annotationId) {
      assert(investigation, "Unknown investigation.");
      const original = investigation.annotations.find(
        (a) => a.id === command.annotationId,
      );
      assert(
        original && !original.dispatchedAt,
        "Only unsent annotations can become interface feedback.",
      );
      investigation.annotations = investigation.annotations.filter(
        (a) => a.id !== original.id,
      );
      investigation.events.push({
        at: now,
        message: "Unsent annotation moved to interface feedback.",
      });
    }
    (next.interfaceFeedback ||= []).push({
      id: id(),
      text: command.question,
      references: refs,
      at: now,
    });
    next.revision++;
    return { state: next, result: { saved: true } };
  }
  if (
    [
      "finding-decision",
      "build-graph",
      "apply-groups",
      "edit-annotation",
      "delete-annotation",
      "resolve-access",
    ].includes(command.type)
  ) {
    requireThat(investigation, "Unknown investigation.");
    const i = investigation;
    if (command.type === "finding-decision") {
      const p = i.proposals.find((p) => p.id === command.proposalId);
      const f = p?.findings?.find((f) => f.id === command.findingId);
      assert(f && f.status !== "superseded", "Finding is unavailable.");
      assert(
        ["kept", "deferred"].includes(String(command.decision)),
        "Choose keep or set aside.",
      );
      assert(
        !i.annotations.some(
          (a) =>
            !p!.addressedAnnotationIds.includes(a.id) &&
            [a.target, ...(a.references || [])].some(
              (t) =>
                t.proposalId === p!.id &&
                (!t.findingId || t.findingId === f.id),
            ),
        ),
        "New feedback on this finding must be addressed first.",
      );
      f.status = command.decision as "kept" | "deferred";
      f.decidedAt = now;
      if (f.status === "kept" && f.replaces)
        getFinding(i, f.replaces)!.status = "superseded";
      for (const graph of i.proposals.filter(
        (p) => p.kind === "graph" && p.status === "pending",
      ))
        if (
          graph.groups?.some(
            (g) =>
              g.status === "pending" &&
              g.findingRefs.some((r) => getFinding(i, r)?.status !== "kept"),
          )
        )
          graph.status = "superseded";
      for (const revision of i.proposals.filter((p) => p.kind === "findings")) {
        revision.status = revision.findings!.some((f) => f.status === "pending")
          ? "pending"
          : "accepted";
      }
      if (!i.lease && i.status !== "queued")
        i.status = i.proposals.some((p) => p.status === "pending")
          ? "review"
          : "closed";
      i.events.push({
        at: now,
        message: `Finding ${f.id}: ${f.status}. Graph unchanged.`,
      });
    } else if (command.type === "build-graph") {
      assert(
        !i.lease,
        "Pause the current pass before requesting graph construction.",
      );
      const refs = command.refs as FindingRef[];
      requireKept(i, refs);
      i.phase = "graph";
      i.graphRequest = { refs, at: now };
      i.status = "queued";
      i.proposals
        .filter((p) => p.kind === "graph" && p.status === "pending")
        .forEach((p) => (p.status = "superseded"));
      i.events.push({
        at: now,
        message: `Graph construction requested from ${refs.length} kept findings.`,
      });
    } else if (command.type === "apply-groups") {
      const p = i.proposals.find((p) => p.id === command.proposalId);
      assert(p, "Proposal not found.");
      const ids = command.groupIds as string[];
      const changes = graphSelection(next, i, p, ids);
      if (changes.length) {
        next.dataset = applyChanges(
          { ...next.dataset, sources: registeredSources(next) },
          changes,
        );
        next.datasetRevision++;
      }
      p.groups!.filter((g) => ids.includes(g.id)).forEach(
        (g) => (g.status = "accepted"),
      );
      if (p.groups!.every((g) => g.status !== "pending")) {
        p.status = "accepted";
        p.decidedAt = now;
        if (!i.lease && i.status !== "queued")
          i.status = i.proposals.some((p) => p.status === "pending")
            ? "review"
            : "closed";
      }
      i.events.push({
        at: now,
        message: `Applied ${ids.length} graph groups; other findings and decisions preserved.`,
      });
    } else if (command.type === "resolve-access") {
      assert(
        i.accessRequest && !i.accessRequest.resolvedAt,
        "No access request is waiting.",
      );
      i.accessRequest.resolvedAt = now;
      i.status = "queued";
      delete i.lease;
      i.events.push({
        at: now,
        message: "Source access assistance completed; queued to resume.",
      });
    } else {
      const a = i.annotations.find((a) => a.id === command.annotationId);
      assert(
        a && !a.dispatchedAt,
        "Sent annotations are immutable. Send a new annotation instead.",
      );
      if (command.type === "delete-annotation")
        i.annotations = i.annotations.filter((x) => x.id !== a.id);
      else {
        nonempty(command.question, "Annotation");
        a.question = command.question;
        const refs = (command.references || []) as AnnotationTarget[];
        validateReferences(next, refs);
        a.references = refs;
        a.target = refs[0] || { label: i.title };
        if (
          command.destinationInvestigationId !== undefined &&
          command.destinationInvestigationId !== i.id
        ) {
          let destination = next.investigations.find(
            (x) => x.id === command.destinationInvestigationId,
          );
          if (command.destinationInvestigationId === null) {
            destination = {
              id: id(),
              title: command.question.slice(0, 150),
              createdAt: now,
              status: "draft",
              scope: [...i.scope],
              annotations: [],
              proposals: [],
              checkpoints: [],
              events: [],
            };
            next.investigations.push(destination);
          }
          assert(destination, "Destination investigation does not exist.");
          i.annotations = i.annotations.filter((x) => x.id !== a.id);
          destination.annotations.push(a);
          destination.events.push({
            at: now,
            message: "Unsent annotation moved here.",
          });
          result = { investigationId: destination.id };
        }
      }
      i.events.push({
        at: now,
        message:
          command.type === "delete-annotation"
            ? "Unsent annotation removed."
            : "Unsent annotation updated.",
      });
    }
    next.revision++;
    return {
      state: next,
      result: result || { saved: true, investigationId: i.id },
    };
  }
  if (command.type === "annotate") {
    nonempty(command.question, "Research question");
    const target = (command.target || {
      label: next.dataset.title,
    }) as AnnotationTarget;
    const references = (command.references || []) as AnnotationTarget[];
    validateReferences(next, [target, ...references]);
    requireThat(
      target && typeof target === "object",
      "An annotation target is required.",
    );
    nonempty(target.label, "Selection label");
    if (command.investigationId)
      requireThat(investigation, "Investigation no longer exists.");
    if (!investigation) {
      requireThat(
        ![target, ...references].some(t => t.proposalId || t.walkthroughId || t.graphReviewId),
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
    for (const ref of [target, ...references]) {
      requireThat(!ref.proposalId || investigation.proposals.some(p => p.id === ref.proposalId), "Proposal is not part of this investigation.");
      requireThat(!ref.walkthroughId || !!investigation.reviewFlow?.walkthroughs.some(w => w.id === ref.walkthroughId), "Walkthrough is not part of this investigation.");
      requireThat(!ref.graphReviewId || !!investigation.reviewFlow?.graphReviews.some(r => r.id === ref.graphReviewId), "Graph review is not part of this investigation.");
    }
    investigation.annotations.push({
      id: id(),
      target,
      question: command.question,
      references,
      createdAt: now,
      ...(command.dispatch ? { dispatchedAt: now } : {}),
    });
    if (command.dispatch) {
      investigation.phase = [target, ...references].some(
        (t) =>
          t.proposalId &&
          investigation!.proposals.find((p) => p.id === t.proposalId)?.kind ===
            "graph",
      )
        ? "graph"
        : "research";
      // A replacement pass gets the new context; fence any old worker immediately.
      delete investigation.lease;
      investigation.status = "queued";
      for (const p of investigation.proposals)
        if (p.status === "pending" && p.kind !== "findings")
          p.status = "superseded";
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
    (investigation.executions ||= []).push({
      at: now,
      worker: command.worker,
      provider: String(command.provider || "coordinator/native"),
      model: String(command.model || "Runtime configured; not reported"),
    });
    investigation.status = "running";
    investigation.events.push({
      at: now,
      message: `Research claimed by ${command.worker}.`,
    });
    result = {
      investigation,
      sources: registeredSources(next),
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
      if (investigation.resumeRequest?.status === "pending") {
        investigation.resumeRequest.status = "approved";
        investigation.resumeRequest.decidedAt = now;
      }
      const unsent = investigation.annotations.filter((a) => !a.dispatchedAt);
      if (unsent.length)
        investigation.phase = unsent.every((a) =>
          [a.target, ...(a.references || [])].some(
            (t) =>
              t.proposalId &&
              investigation!.proposals.find((p) => p.id === t.proposalId)
                ?.kind === "graph",
          ),
        )
          ? "graph"
          : "research";
      investigation.annotations.forEach((a) => {
        a.dispatchedAt ??= now;
      });
      investigation.status = "queued";
      delete investigation.lease;
      investigation.proposals.forEach((p) => {
        if (p.status === "pending" && p.kind !== "findings")
          p.status = "superseded";
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
      if (investigation.resumeRequest?.status === "pending") {
        investigation.resumeRequest.status = "declined";
        investigation.resumeRequest.decidedAt = now;
      }
      delete investigation.lease;
      investigation.events.push({
        at: now,
        message: "Investigation paused; saved findings retained.",
      });
    } else if (command.type === "checkpoint") {
      nonempty(command.summary, "Checkpoint summary");
      nonempty(command.findings, "Findings, including unsuccessful searches");
      nonempty(command.nextSteps, "Remaining work");
      if (command.accessRequest) {
        const access = command.accessRequest as {
          instruction: string;
          url?: string;
        };
        nonempty(access.instruction, "Access help instruction");
        if (access.url)
          assert(
            /^https?:\/\//.test(access.url),
            "Access URL must use HTTP or HTTPS.",
          );
        investigation.accessRequest = access;
      }
      investigation.checkpoints.push({
        id: id(),
        at: now,
        worker: investigation.lease!.worker,
        summary: command.summary,
        findings: command.findings,
        nextSteps: command.nextSteps,
      });
      if (command.accessRequest) {
        investigation.status = "paused";
        delete investigation.lease;
        investigation.events.push({
          at: now,
          message:
            "Waiting for source access assistance. Saved research is preserved.",
        });
      }
    } else if (command.type === "propose") {
      const p = structuredClone(command.proposal) as Proposal;
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
        Boolean(p.kind) ||
          p.changes.length > 0 ||
          p.ambiguity.trim().length > 0,
        "An investigation without changes must record its unresolved outcome.",
      );
      validatePhase(investigation, p);
      for (const source of p.sources || []) {
        nonempty(source.id, "Source ID");
        nonempty(source.title, "Source title");
        const prior = sourceLibrary(next).find((s) => s.id === source.id);
        assert(
          !prior || canonical(prior) === canonical(source),
          "Source already exists with different metadata. Use a new capture ID.",
        );
        if (!prior) (next.library ||= []).push(source);
      }
      const candidate = applyChanges(
        { ...investigation.lease!.dataset, sources: registeredSources(next) },
        p.changes,
      );
      // Also verify against current accepted research. Never publish a misleading stale preview.
      applyChanges(
        { ...next.dataset, sources: registeredSources(next) },
        p.changes,
      );
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
        ...(p.kind
          ? {
              kind: p.kind,
              findings: p.findings,
              groups: p.groups,
              sources: p.sources,
              omissions: p.omissions,
            }
          : {}),
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
        if (old.status === "pending" && old.kind !== "findings")
          old.status = "superseded";
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
        !p?.kind,
        "Review findings individually or select graph groups.",
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
