import { assert, validateReferences } from "./findings.ts";
import { newAssignment } from "./assignments.ts";
import type { Choice } from "./assignments.ts";
import type {
  Annotation,
  AnnotationTarget,
  Investigation,
  ResearchCommand,
  ResearchState,
} from "./research.ts";

// What a batch is for, kept current by the coordinator so a fresh one can pick it up.
export interface Brief {
  purpose: string;
  // What belongs in this batch and what does not.
  scope: string;
  // Where the work is heading now; changes when the human redirects it.
  direction: string;
  updatedAt: string;
}

export interface Decision {
  title: string;
  body: string;
  status: "pending" | "approved" | "declined";
  investigationId?: string;
  decidedAt?: string;
}

export interface Message {
  id: string;
  at: string;
  author: "human" | "coordinator";
  text?: string;
  // Immutable record of what the human sent; batches hold the working copies.
  annotations?: Annotation[];
  references?: AnnotationTarget[];
  readyBatchId?: string;
  decision?: Decision;
}

export const humanConversationCommands = new Set([
  "queue-annotation",
  "edit-queued",
  "remove-queued",
  "send",
  "decide",
]);
export const coordinatorConversationCommands = new Set([
  "reply",
  "open-batch",
  "batch-ready",
  "request-approval",
  "retitle",
  "set-brief",
]);

const text = (value: unknown, label: string, max = 50_000): string => {
  assert(
    typeof value === "string" && value.trim().length > 0 && value.length <= max,
    `${label} is required (maximum ${max.toLocaleString("en-US")} characters).`,
  );
  return (value as string).trim();
};

export function batchStatus(
  i: Investigation,
): "in progress" | "ready" | "closed" {
  if (i.closedAt) return "closed";
  return i.readyAt ? "ready" : "in progress";
}

// Batches closed before closing also set their status still read as active work.
export function repairClosedBatches(state: ResearchState): number {
  const stale = state.investigations.filter(
    (i) => i.closedAt && i.status !== "closed",
  );
  for (const i of stale) i.status = "closed";
  return stale.length;
}

function briefFrom(input: unknown, now: string, prior?: Brief): Brief {
  const raw = (input || {}) as Record<string, unknown>;
  assert(
    typeof input === "object" && input !== null,
    "A brief needs purpose, scope and direction.",
  );
  const field = (key: "purpose" | "scope" | "direction", label: string) =>
    raw[key] === undefined && prior ? prior[key] : text(raw[key], label, 2000);
  return {
    purpose: field("purpose", "Brief purpose"),
    scope: field("scope", "Brief scope"),
    direction: field("direction", "Brief direction"),
    updatedAt: now,
  };
}

function annotationFrom(
  state: ResearchState,
  input: Record<string, unknown>,
  id: string,
  now: string,
): Annotation {
  const references = (input.references || []) as AnnotationTarget[];
  validateReferences(state, references);
  return {
    id,
    target: references[0] || { label: state.dataset.title },
    references,
    question: text(input.question, "Annotation"),
    createdAt: now,
  };
}

// The researchers' parts of a new batch, each with the coordinator's title and brief.
function assignmentsFrom(batch: Investigation, input: unknown, now: string, id: () => string): void {
  if (input === undefined) return;
  assert(Array.isArray(input), "Assignments must be a list.");
  for (const raw of input as Record<string, unknown>[])
    (batch.assignments ||= []).push(newAssignment(raw, raw.choice as Choice | undefined, now, id()));
}

export function conversationTransition(
  next: ResearchState,
  command: ResearchCommand,
  now: string,
  id: () => string,
): unknown {
  const conversation = (next.conversation ||= []);
  const queue = (next.queue ||= []);
  switch (command.type) {
    case "queue-annotation": {
      const annotation = annotationFrom(next, command, id(), now);
      queue.push(annotation);
      return { annotationId: annotation.id };
    }
    case "edit-queued": {
      const annotation = queue.find((a) => a.id === command.annotationId);
      assert(annotation, "This annotation has already been sent or removed.");
      const edited = annotationFrom(next, command, annotation.id, now);
      Object.assign(annotation, {
        ...edited,
        createdAt: annotation.createdAt,
      });
      return { saved: true };
    }
    case "remove-queued": {
      assert(
        queue.some((a) => a.id === command.annotationId),
        "This annotation has already been sent or removed.",
      );
      next.queue = queue.filter((a) => a.id !== command.annotationId);
      return { removed: true };
    }
    case "send": {
      // A chat message carries only its text; Send now carries one inline annotation;
      // Send queue carries the queue, or the queued annotations it names.
      const ids = command.annotationIds as string[] | undefined;
      const chosen = ids ? queue.filter((a) => ids.includes(a.id)) : command.queue === true ? queue : [];
      if (ids)
        assert(
          chosen.length === ids.length,
          "Some annotations were already sent or removed.",
        );
      const inline = command.annotation
        ? [
            annotationFrom(
              next,
              command.annotation as Record<string, unknown>,
              id(),
              now,
            ),
          ]
        : [];
      const annotations = [...chosen, ...inline].map((a) => ({
        ...a,
        dispatchedAt: now,
      }));
      const message =
        typeof command.text === "string" && command.text.trim()
          ? text(command.text, "Message")
          : undefined;
      assert(
        annotations.length || message,
        "Write a message or queue an annotation first.",
      );
      next.queue = queue.filter((a) => !chosen.includes(a));
      const sent: Message = {
        id: id(),
        at: now,
        author: "human",
        ...(message ? { text: message } : {}),
        ...(annotations.length ? { annotations } : {}),
      };
      conversation.push(sent);
      return { messageId: sent.id };
    }
    case "decide": {
      const message = conversation.find((m) => m.id === command.messageId);
      assert(
        message?.decision?.status === "pending",
        "This request is no longer waiting for a decision.",
      );
      assert(
        command.decision === "approve" || command.decision === "decline",
        "Choose approve or decline.",
      );
      message.decision.status =
        command.decision === "approve" ? "approved" : "declined";
      message.decision.decidedAt = now;
      return { decided: message.decision.status };
    }
    case "reply": {
      const references = (command.references || []) as AnnotationTarget[];
      validateReferences(next, references);
      const reply: Message = {
        id: id(),
        at: now,
        author: "coordinator",
        text: text(command.text, "Reply"),
        ...(references.length ? { references } : {}),
      };
      conversation.push(reply);
      return { messageId: reply.id };
    }
    case "request-approval": {
      const investigationId = command.investigationId as string | undefined;
      if (investigationId)
        assert(
          next.investigations.some((i) => i.id === investigationId),
          "Unknown batch.",
        );
      const request: Message = {
        id: id(),
        at: now,
        author: "coordinator",
        decision: {
          title: text(command.title, "Request title", 300),
          body: text(command.body, "Request explanation", 5000),
          status: "pending",
          ...(investigationId ? { investigationId } : {}),
        },
      };
      conversation.push(request);
      return { messageId: request.id };
    }
    case "open-batch": {
      const scope = (command.scope as string[]) ?? ["web", "imports"];
      assert(
        Array.isArray(scope) &&
          scope.length > 0 &&
          scope.every((s) => next.collections.some((c) => c.id === s)),
        "Unknown source collection.",
      );
      const batch: Investigation = {
        id: id(),
        number:
          Math.max(0, ...next.investigations.map((i) => i.number || 0)) + 1,
        title: text(command.title, "Batch title", 300),
        brief: briefFrom(command.brief, now),
        createdAt: now,
        status: "queued",
        scope,
        annotations: [],
        assignments: [],
        proposals: [],
        events: [],
      };
      assert(command.questions === undefined, "Batches no longer take questions; give each researcher's part as an assignment with a title and a brief.");
      assignmentsFrom(batch, command.assignments, now, id);
      batch.events.push({ at: now, message: "Coordinator opened this batch." });
      next.investigations.push(batch);
      return { investigationId: batch.id };
    }
    case "retitle": {
      const batch = next.investigations.find(
        (i) => i.id === command.investigationId,
      );
      assert(batch, "Unknown batch.");
      if (command.title !== undefined)
        batch.title = text(command.title, "Batch title", 300);
      for (const raw of (command.assignments || []) as Record<string, unknown>[]) {
        const assignment = batch.assignments?.find((a) => a.id === raw.assignmentId);
        assert(assignment, "Assignment is not part of this batch.");
        assignment.title = text(raw.title, "Assignment title", 300);
      }
      return { investigationId: batch.id };
    }
    case "set-brief": {
      const batch = next.investigations.find(
        (i) => i.id === command.investigationId,
      );
      assert(batch, "Unknown batch.");
      assert(!batch.closedAt, "This batch is closed.");
      batch.brief = briefFrom(command.brief, now, batch.brief);
      batch.events.push({
        at: now,
        message: `Coordinator updated the brief. Direction: ${batch.brief.direction}`,
      });
      return { investigationId: batch.id };
    }
    case "batch-ready": {
      const batch = next.investigations.find(
        (i) => i.id === command.investigationId,
      );
      assert(batch && !batch.closedAt, "Unknown or closed batch.");
      batch.readyAt = now;
      batch.events.push({ at: now, message: "Coordinator marked this batch ready for review." });
      const notice: Message = {
        id: id(),
        at: now,
        author: "coordinator",
        text: text(command.text, "Ready message"),
        readyBatchId: batch.id,
      };
      conversation.push(notice);
      return { messageId: notice.id };
    }
  }
  throw new Error("Unknown conversation command.");
}
