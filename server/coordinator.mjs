import { organize } from "./organization.mjs";
import { flowCommand, autoReview } from "./review-flow.mjs";
import { randomUUID } from "node:crypto";
import { transition } from "../src/domain/research.ts";
import { coordinatorConversationCommands } from "../src/domain/conversation.ts";
import {
  projectIndex,
  investigationIndex,
  inspectContext,
  searchContext,
} from "./research-context.mjs";
import { coordinatorAction, step } from "./live-activity.mjs";
import { buildCoordinatorContext } from "../src/domain/coordinator-context.ts";

// Durable research state belongs to the store; session liveness belongs to this server.
export class Coordinator {
  // Ownership of the project and being live are separate: a coordinator busy
  // writing for ten minutes still owns its project, but is not listening.
  constructor(store, { now = Date.now, ttl = 120_000, ownership = 1_800_000, workers = () => [], skills = [] } = {}) {
    this.store = store;
    this.workers = workers;
    this.skills = skills;
    this.now = now;
    this.ttl = ttl;
    this.ownership = ownership;
    this.session = null;
    this.latest = null;
    this.trail = [];
    // The app's own coordinator, when it runs one; it says whether it is working.
    this.host = null;
    this.problem = null;
    // The researcher pool, set once both exist, for steering and stopping researchers.
    this.researchers = null;
    // The walkthrough writers, set once both exist, for sending a writer instructions.
    this.writers = null;
    // The project's dispatch rules, which say which agent does each job.
    this.dispatch = null;
    // Helpers for small tasks, whose answers come back to the coordinator.
    this.helpers = null;
  }
  // What the coordinator is doing, read from the command it just sent.
  noteAction(data) {
    this.noteText(coordinatorAction(data, this.store.state));
  }
  // What the coordinator is doing, read from its output stream.
  noteText(text) {
    Object.assign(this, step(this, text, this.now()));
  }
  // The app's coordinator owns the project for as long as it runs.
  hosted() {
    return Boolean(this.host && this.session && this.session.secret === this.host.secret);
  }
  owner() {
    if (this.hosted()) return this.session;
    return this.session && this.session.owned > this.now() ? this.session : null;
  }
  live() {
    const owner = this.owner();
    if (this.hosted()) return this.host.status().connected ? owner : null;
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
      // An attached coordinator from outside the app reports no turns; it is shown as working.
      listening: Boolean(live) && this.hosted() && this.host.status().listening,
      latest: live ? this.latest : null,
      trail: live ? this.trail : [],
      // When its current turn began, while it is working.
      since: live && this.hosted() ? this.host.status().since : null,
      // When the usage limit holds it, and until when.
      paused: live && this.hosted() ? this.host.status().paused ?? null : null,
      problem: live ? null : this.problem,
      waiting: !live && Boolean(this.waiting),
      // How full the app's coordinator's context is, and where it compacts.
      context: this.hosted() ? this.host.status().context ?? null : null,
      // The agent, model and effort it runs on, and one it switches to after its turn.
      choice: live && this.hosted() ? this.host.status().choice ?? null : null,
      switching: live && this.hosted() ? this.host.status().switching ?? null : null,
      name: owner ? owner.name : null,
      lastSeenSecondsAgo: owner ? Math.round((this.now() - owner.seen) / 1000) : null,
      awaitingSynthesis: this.candidates().map((c) => c.investigationId),
    };
  }
  // Researcher results not yet judged, whose assignment is still waiting on them;
  // while the human has a batch paused, its results wait too.
  candidates() {
    return (this.store.state.coordination?.candidates || []).filter((c) =>
      this.store.state.investigations.some(
        (i) =>
          i.id === c.investigationId &&
          i.status !== "paused" &&
          (i.assignments || []).some((a) => a.status === "returned" && a.lease?.token === c.token),
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
    this.session = { name, secret, seen: this.now(), owned: this.now() + this.ownership };
    if (!this.enabled)
      this.store.update((next) => {
        next.coordination = {
          enabled: true,
          candidates: [],
        };
      });
    return this.snapshot(secret);
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
    const boardPosts = state.investigations.flatMap((i) =>
      // Its own posts are not news to the coordinator.
      (i.board || []).slice(changed.boardFrom?.get(i.id) ?? 0).filter((p) => p.author !== "coordinator").map((p) => ({
        investigationId: i.id,
        assignmentId: p.assignmentId,
        from: i.assignments?.find((a) => a.id === p.assignmentId)?.title,
        text: p.text,
      })),
    );
    if (
      !messages.length &&
      !boardPosts.length &&
      !investigations.length &&
      !changed.removedInvestigationIds.length &&
      !changed.decisionsChanged &&
      !changed.candidatesChanged &&
      !changed.dispatchChanged
    )
      return { revision: state.revision, unchanged: true };
    const conversation = conversationIndex(state);
    return {
      revision: state.revision,
      changed: {
        // The human's own messages, as sent; the inbox shapes them for the coordinator.
        messages,
        investigations,
        ...(boardPosts.length ? { boardPosts } : {}),
        ...(changed.removedInvestigationIds.length
          ? { removedInvestigationIds: changed.removedInvestigationIds }
          : {}),
        pendingDecisions: conversation.pendingDecisions,
        ...(changed.decisionsChanged ? { decisions: conversation.recentDecisions } : {}),
        // Who does which job, when the human changed it in settings.
        ...(changed.dispatchChanged ? { dispatch: state.dispatch } : {}),
        ...(changed.candidatesChanged
          ? { candidates: this.candidates().map((c) => ({ id: c.id, investigationId: c.investigationId, assignmentId: c.assignmentId, title: c.proposal.title })) }
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
        assignmentId: c.assignmentId,
        title: c.proposal.title,
        summary: c.proposal.summary.slice(0, 600),
      })),
      preferredEngine: state.engine || "manual",
      coordinator: this.status(),
      conversation: conversationIndex(state),
      context: buildCoordinatorContext(state, { workers: this.workers(), skills: this.skills }),
    };
  }
  // Who does an assignment: what the coordinator names wins; otherwise the project's
  // dispatch rules decide.
  choose(data) {
    const choice = this.dispatch?.choose("researcher", data.engine ? { agent: data.engine, model: data.model, effort: data.effort } : null)
      ?? (data.engine || this.store.state.engine ? { agent: data.engine || this.store.state.engine } : null);
    if (!["codex", "claude"].includes(choice?.agent))
      throw new Error("Choose codex or claude for a managed researcher.");
    return { engine: choice.agent, model: choice.model ?? null, effort: choice.effort ?? null };
  }
  command(data) {
    this.require(data.session);
    this.noteAction(data);
    if (data.action === "walkthrough-update") return this.writers.steer(data.investigationId, data.message);
    if (data.action === "ask-helper") {
      if (!this.helpers) throw new Error("Helpers are unavailable.");
      return this.helpers.ask(data);
    }
    // The human's stated preference becomes a dispatch rule they can see in settings.
    if (["set-role", "add-rule", "remove-rule"].includes(data.action)) {
      if (!this.dispatch) throw new Error("Dispatch rules are unavailable.");
      const { session, ...change } = data;
      return { dispatch: this.dispatch.change(change, "coordinator") };
    }
    if (["assign-walkthrough", "publish-walkthrough", "inspect-flow", "request-graph", "assign-graph", "graph-update", "request-graph-resume", "publish-graph-review", "answer-draft-feedback", "reorganize-graph"].includes(data.action)) return flowCommand(this.store, data);
    if (data.action?.startsWith("organization-"))
      return organize(this.store, data);
    if (coordinatorConversationCommands.has(data.action)) {
      const { action, session, ...command } = data;
      // Each assignment of a new batch is given to an agent as it is made.
      if (action === "open-batch" && Array.isArray(command.assignments))
        command.assignments = command.assignments.map((a) => ({ ...a, choice: this.choose(a || {}) }));
      const result = this.store.command({ ...command, type: action });
      if (action === "batch-ready") autoReview(this.store, data.investigationId);
      return result;
    }
    const id = data.investigationId;
    const i = this.store.state.investigations.find((i) => i.id === id);
    if (data.action === "detach") {
      this.session = null;
      this.latest = null;
      this.trail = [];
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
    // An assignment is named by its ID; inspect the batch to list them.
    if (["steer", "stop-researcher", "revise"].includes(data.action) && typeof data.assignmentId !== "string")
      throw new Error("Name the assignment with assignmentId; inspecting the batch lists its assignments.");
    if (data.action === "steer") return this.researchers.steer(data.assignmentId, data.message);
    if (data.action === "stop-researcher") return this.researchers.halt(data.assignmentId, data.reason);
    if (data.action === "revise") {
      const candidate = this.candidates().find((c) => c.assignmentId === data.assignmentId);
      if (candidate)
        this.store.command({
          type: "checkpoint",
          investigationId: candidate.investigationId,
          token: candidate.token,
          summary: "Coordinator requested another pass",
          findings: String(data.notes || ""),
          nextSteps: String(data.notes || ""),
        });
      const result = this.store.command({ type: "revise-assignment", assignmentId: data.assignmentId, notes: data.notes });
      // Sent back with another agent, when the coordinator names one.
      if (data.engine) {
        const choice = this.choose(data);
        this.store.update((next) => {
          for (const i of next.investigations) for (const a of i.assignments || []) if (a.id === data.assignmentId) a.choice = choice;
        });
      }
      return result;
    }
    if (data.action === "publish") {
      const candidate = this.candidates().find((c) => c.id === data.candidateId);
      // Only a researcher's current result is published; the coordinator reconciles it first.
      if (!candidate) throw new Error("Publish a current researcher result, named by its candidateId.");
      return this.store.command({
        type: "propose",
        investigationId: candidate.investigationId,
        token: candidate.token,
        proposal: data.proposal || candidate.proposal,
      });
    }
    if (!i) throw new Error("Unknown investigation.");
    if (data.action === "post") return this.researchers.announce(id, data.text);
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
    if (data.action === "assign") {
      if (i.closedAt) throw new Error("This batch is closed. Open a new batch for further work.");
      return this.store.command({
        type: "assign",
        investigationId: id,
        title: data.title,
        brief: data.brief,
        choice: this.choose(data),
      });
    }
    throw new Error(
      "Unknown coordinator action. Coordinators cannot accept research changes.",
    );
  }
  receive(task, proposal) {
    // Validate exactly as a proposal, but retain the result for coordinating judgment first.
    transition(this.store.state, {
      type: "propose",
      investigationId: task.batchId,
      token: task.token,
      proposal,
    });
    this.store.update((next) => {
      next.coordination.candidates.push({
        id: randomUUID(),
        investigationId: task.batchId,
        assignmentId: task.id,
        token: task.token,
        proposal,
        receivedAt: new Date().toISOString(),
      });
    });
    this.store.command({ type: "assignment-returned", assignmentId: task.id, token: task.token });
  }
}

function messageIndex(m) {
  return {
    at: m.at,
    author: m.author,
    text: m.text?.slice(0, 1500),
    annotations: (m.annotations || []).map((a) => a.question),
    readyBatchId: m.readyBatchId,
    decision: m.decision && { title: m.decision.title, status: m.decision.status },
  };
}

// What the coordinator must act on in the shared conversation.
function conversationIndex(state) {
  const messages = state.conversation || [];
  return {
    pendingDecisions: messages
      .filter((m) => m.decision?.status === "pending")
      .map((m) => ({ title: m.decision.title })),
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
        assignments: (i.assignments || []).map((a) => ({ id: a.id, title: a.title, status: a.status })),
      })),
  };
}
