import { organize } from "./organization.mjs";
import { flowCommand, autoReview } from "./review-flow.mjs";
import { randomUUID } from "node:crypto";
import { transition } from "../src/domain/research.ts";
import {
  coordinatorConversationCommands,
  unassignedAnnotations,
} from "../src/domain/conversation.ts";
import {
  projectIndex,
  investigationIndex,
  inspectContext,
  searchContext,
} from "./research-context.mjs";

// Durable research state belongs to the store; session liveness belongs to this server.
export class Coordinator {
  // Ownership of the project and being live are separate: a coordinator busy
  // writing for ten minutes still owns its project, but is not listening.
  constructor(store, { now = Date.now, ttl = 120_000, ownership = 1_800_000 } = {}) {
    this.store = store;
    this.now = now;
    this.ttl = ttl;
    this.ownership = ownership;
    this.session = null;
  }
  owner() {
    return this.session && this.session.owned > this.now() ? this.session : null;
  }
  live() {
    const owner = this.owner();
    return owner && owner.seen + this.ttl > this.now() ? owner : null;
  }
  get enabled() {
    return Boolean(this.store.state.coordination?.enabled);
  }
  status() {
    const owner = this.owner();
    const live = this.live();
    return {
      enabled: this.enabled,
      connected: Boolean(live),
      attached: Boolean(owner),
      name: owner ? owner.name : null,
      lastSeenSecondsAgo: owner ? Math.round((this.now() - owner.seen) / 1000) : null,
      handoff: (this.store.state.coordination?.handoff || "").slice(0, 6000),
      handoffTruncated:
        (this.store.state.coordination?.handoff?.length || 0) > 6000,
      awaitingSynthesis: this.candidates().map((c) => c.investigationId),
    };
  }
  candidates() {
    return (this.store.state.coordination?.candidates || []).filter((c) =>
      this.store.state.investigations.some(
        (i) =>
          i.id === c.investigationId &&
          i.status === "running" &&
          i.lease?.token === c.token,
      ),
    );
  }
  attach(name, secret) {
    if (
      typeof name !== "string" ||
      !name.trim() ||
      name.length > 200 ||
      typeof secret !== "string" ||
      secret.length < 32
    )
      throw new Error(
        "Coordinator name and a private session key are required.",
      );
    const live = this.live();
    if (live && live.secret !== secret)
      throw new Error(
        `Another coordinator is connected: ${live.name}. Close or detach that session before taking over.`,
      );
    const recovering = !this.session || this.session.secret !== secret;
    this.session = { name, secret, seen: this.now(), owned: this.now() + this.ownership };
    if (recovering) {
      for (const i of [...this.store.state.investigations]) {
        if (
          i.status === "running" &&
          i.lease?.worker.startsWith("Coordinator:")
        )
          this.requeue(
            i.id,
            "Coordinator session recovered; saved findings retained and old worker lease fenced.",
          );
      }
    }
    if (!this.enabled)
      this.store.update((next) => {
        next.coordination = {
          enabled: true,
          handoff: "",
          assignments: {},
          candidates: [],
        };
      });
    return this.snapshot(secret);
  }
  requeue(id, message) {
    this.store.update((next) => {
      const i = next.investigations.find((i) => i.id === id);
      i.status = "queued";
      delete i.lease;
      if (next.coordination?.assignments)
        delete next.coordination.assignments[id];
      i.events.push({ at: new Date().toISOString(), message });
    });
  }
  require(secret) {
    if (!this.owner() || this.session.secret !== secret)
      throw new Error(
        "Coordinator session expired or was replaced. Attach and recover before continuing.",
      );
    this.session.seen = this.now();
    this.session.owned = this.now() + this.ownership;
  }
  // A waking coordinator needs what changed, not the whole project index again.
  delta(secret, since) {
    this.require(secret);
    const changed = this.store.since(since);
    // A cursor older than the kept fingerprints cannot be compared; send the index.
    if (!changed) return this.snapshot(secret);
    const state = this.store.state;
    // Its own replies are not news to the coordinator.
    const messages = (state.conversation || [])
      .slice(changed.conversationFrom)
      .filter((m) => m.author !== "coordinator");
    // A wake says which batches moved and how; their findings stay one inspect away.
    const investigations = state.investigations
      .filter((i) => changed.investigationIds.includes(i.id))
      .map((i) => {
        const { findings, ...rest } = investigationIndex(i);
        return { ...rest, findingCount: findings.length };
      });
    if (
      !messages.length &&
      !investigations.length &&
      !changed.removedInvestigationIds.length &&
      !changed.decisionsChanged &&
      !changed.candidatesChanged
    )
      return { revision: state.revision, unchanged: true };
    const conversation = conversationIndex(state);
    return {
      revision: state.revision,
      changed: {
        messages: messages.map(messageIndex),
        investigations,
        ...(changed.removedInvestigationIds.length
          ? { removedInvestigationIds: changed.removedInvestigationIds }
          : {}),
        unassignedAnnotations: conversation.unassignedAnnotations,
        pendingDecisions: conversation.pendingDecisions,
        ...(changed.decisionsChanged ? { decisions: conversation.recentDecisions } : {}),
        ...(changed.candidatesChanged
          ? { candidates: this.candidates().map((c) => ({ id: c.id, investigationId: c.investigationId, title: c.proposal.title })) }
          : {}),
      },
    };
  }
  snapshot(secret) {
    this.require(secret);
    const state = this.store.state;
    return {
      revision: state.revision,
      project: projectIndex(state),
      investigations: [
        ...state.investigations.filter((i) => i.status !== "closed").slice(-50),
        ...state.investigations.filter((i) => i.status === "closed").slice(-10),
      ].map(investigationIndex),
      investigationCount: state.investigations.length,
      indexHint:
        "Index shows up to 50 active and 10 recently closed investigations. Inspect investigations with an offset to browse all work.",
      candidates: this.candidates().map((c) => ({
        id: c.id,
        investigationId: c.investigationId,
        title: c.proposal.title,
        summary: c.proposal.summary.slice(0, 600),
      })),
      preferredEngine: state.engine || "manual",
      coordinator: this.status(),
      conversation: conversationIndex(state),
    };
  }
  assignment(id) {
    return this.store.state.coordination?.assignments?.[id];
  }
  ready(i) {
    const a = this.assignment(i.id);
    return (
      a &&
      a.phase === (i.phase || "research") &&
      a.graphRequestedAt === i.graphRequest?.at &&
      JSON.stringify(a.annotationIds) ===
        JSON.stringify(
          i.annotations.filter((a) => a.dispatchedAt).map((a) => a.id),
        )
    );
  }
  command(data) {
    this.require(data.session);
    if (["publish-walkthrough", "inspect-flow", "assign-graph", "graph-update", "request-graph-resume", "publish-graph-review"].includes(data.action)) return flowCommand(this.store, data);
    if (data.action?.startsWith("organization-"))
      return organize(this.store, data);
    if (coordinatorConversationCommands.has(data.action)) {
      const { action, session, ...command } = data;
      const result = this.store.command({ ...command, type: action });
      if (action === "batch-ready") autoReview(this.store, data.investigationId);
      return result;
    }
    const id = data.investigationId;
    const i = this.store.state.investigations.find((i) => i.id === id);
    if (data.action === "detach") {
      this.session = null;
      return { detached: true };
    }
    if (data.action === "snapshot") return this.snapshot(data.session);
    if (data.action === "inspect")
      return inspectContext(this.store.state, data, this.candidates());
    if (data.action === "search")
      return searchContext(this.store.state, data.query, data.offset);
    if (data.action === "map") {
      if (typeof data.notes !== "string" || data.notes.length > 50_000)
        throw new Error("Research map must be text, up to 50,000 characters.");
      this.store.update((next) => {
        next.coordination.researchMap = data.notes;
      });
      return { saved: true };
    }
    if (data.action === "handoff") {
      if (typeof data.notes !== "string" || data.notes.length > 50_000)
        throw new Error("Handoff notes must be text, up to 50,000 characters.");
      this.store.update((next) => {
        next.coordination.handoff = data.notes;
      });
      return { saved: true };
    }
    if (!i) throw new Error("Unknown investigation.");
    if (data.action === "request-resume") {
      if (i.status !== "paused")
        throw new Error("Only paused investigations need resume approval.");
      if (
        typeof data.reason !== "string" ||
        !data.reason.trim() ||
        data.reason.length > 5000
      )
        throw new Error(
          "Explain why research should resume in up to 5,000 characters.",
        );
      if (i.resumeRequest?.status === "pending")
        return { awaitingApproval: true, requestId: i.resumeRequest.id };
      const requestId = randomUUID();
      this.store.update((next) => {
        const investigation = next.investigations.find(
          (item) => item.id === id,
        );
        const at = new Date().toISOString();
        investigation.resumeRequest = {
          id: requestId,
          reason: data.reason.trim(),
          at,
          status: "pending",
        };
        investigation.events.push({
          at,
          message: `Coordinator requested permission to resume: ${data.reason.trim()}`,
        });
      });
      return { awaitingApproval: true, requestId };
    }
    if (data.action === "assign" || data.action === "claim") {
      if (i.status !== "queued")
        throw new Error(
          "Only dispatched, queued investigations can be assigned.",
        );
      if (
        typeof data.brief !== "string" ||
        !data.brief.trim() ||
        data.brief.length > 50_000
      )
        throw new Error("A bounded research brief is required.");
      if (data.action === "claim") {
        const result = this.store.command({
          type: "claim",
          investigationId: id,
          worker: `Coordinator: ${this.session.name}`,
          provider: data.provider || "coordinator/native",
          model: data.model,
        });
        return { ...structuredClone(result), coordinatorBrief: data.brief };
      }
      data.engine ||= this.store.state.engine;
      if (!["codex", "claude"].includes(data.engine))
        throw new Error("Choose codex or claude for a managed researcher.");
      this.store.update((next) => {
        next.coordination.assignments[id] = {
          engine: data.engine,
          phase: i.phase || "research",
          graphRequestedAt: i.graphRequest?.at,
          brief: data.brief,
          annotationIds: i.annotations
            .filter((a) => a.dispatchedAt)
            .map((a) => a.id),
        };
        next.investigations
          .find((i) => i.id === id)
          .events.push({
            at: new Date().toISOString(),
            message: "Coordinator prepared a research assignment.",
          });
      });
      return { assigned: true };
    }
    if (data.action === "checkpoint") {
      if (!i.lease || !i.lease.worker.startsWith("Coordinator:"))
        throw new Error("This investigation belongs to a managed researcher.");
      return this.store.command({
        type: "checkpoint",
        investigationId: id,
        token: i.lease.token,
        summary: data.summary,
        findings: data.findings,
        nextSteps: data.nextSteps,
        accessRequest: data.accessRequest,
      });
    }
    if (data.action === "publish") {
      const candidate = this.candidates().find(
        (c) => c.id === data.candidateId && c.investigationId === id,
      );
      if (
        !candidate &&
        (!i.lease?.worker.startsWith("Coordinator:") || data.candidateId)
      )
        throw new Error(
          "A current researcher result or coordinator-owned investigation is required.",
        );
      const result = this.store.command({
        type: "propose",
        investigationId: id,
        token: candidate?.token || i.lease.token,
        proposal: data.proposal || candidate?.proposal,
      });
      return result;
    }
    if (data.action === "revise") {
      if (!this.candidates().some((c) => c.investigationId === id))
        throw new Error("No current researcher result to revise.");
      if (typeof data.notes !== "string" || !data.notes.trim())
        throw new Error("Record why another pass is needed.");
      this.store.command({
        type: "checkpoint",
        investigationId: id,
        token: i.lease.token,
        summary: "Coordinator requested another pass",
        findings: data.notes,
        nextSteps: data.notes,
      });
      this.requeue(
        id,
        "Coordinator requested another bounded research pass; unsent feedback remains queued.",
      );
      return { queued: true };
    }
    throw new Error(
      "Unknown coordinator action. Coordinators cannot accept research changes.",
    );
  }
  receive(task, proposal) {
    // Validate exactly as a proposal, but retain the result for coordinating judgment first.
    transition(this.store.state, {
      type: "propose",
      investigationId: task.id,
      token: task.token,
      proposal,
    });
    this.store.update((next) => {
      next.coordination.candidates.push({
        id: randomUUID(),
        investigationId: task.id,
        token: task.token,
        proposal,
        receivedAt: new Date().toISOString(),
      });
      next.investigations
        .find((i) => i.id === task.id)
        .events.push({
          at: new Date().toISOString(),
          message:
            "Research findings returned; coordinator synthesis is pending.",
        });
    });
  }
}

function messageIndex(m) {
  return {
    id: m.id,
    at: m.at,
    author: m.author,
    text: m.text?.slice(0, 1500),
    annotations: (m.annotations || []).map((a) => ({ id: a.id, question: a.question })),
    readyBatchId: m.readyBatchId,
    decision: m.decision && { title: m.decision.title, status: m.decision.status },
  };
}

// What the coordinator must act on in the shared conversation.
function conversationIndex(state) {
  const messages = state.conversation || [];
  return {
    unassignedAnnotations: unassignedAnnotations(state).map((a) => ({
      id: a.id,
      question: a.question,
      references: (a.references || []).map((r) => r.label),
      sentAt: a.dispatchedAt,
    })),
    pendingDecisions: messages
      .filter((m) => m.decision?.status === "pending")
      .map((m) => ({ messageId: m.id, title: m.decision.title })),
    recentDecisions: messages
      .filter((m) => m.decision && m.decision.status !== "pending")
      .slice(-10)
      .map((m) => ({ messageId: m.id, title: m.decision.title, status: m.decision.status })),
    recentMessages: messages.slice(-12).map(messageIndex),
    openBatches: state.investigations
      .filter((i) => i.number && !i.closedAt)
      .map((i) => ({
        id: i.id,
        number: i.number,
        title: i.title,
        status: i.status,
        ready: Boolean(i.readyAt),
        walkthroughRequested: Boolean(i.walkthroughRequestedAt),
        questions: (i.questions || []).map((q) => ({ id: q.id, title: q.title, origin: q.origin })),
      })),
  };
}
