import type { AnnotationTarget, Investigation, ResearchState } from "./research.ts";
import type { GraphDataset } from "./types.ts";

// What the human pointed at, said in the research's own terms. The coordinator
// never sees the page, so a reference names the research object, where it lives,
// and the ids its tools look up; the page's structure stays with the app.
export interface ReferenceDescription {
  // A short heading for the human, such as "Graph · person" or "Batch 3 · finding".
  kind: string;
  // The object as a phrase: the person "Edith Marrow" on the graph.
  about: string;
  // The screen the human picked it from, when the app recorded it.
  seenOn?: string;
  // The ids the coordinator can inspect.
  ids: Record<string, string>;
}

// The screen a reference was picked from, as the app knew it at that moment.
export interface ReferenceScreen {
  view: string;
  investigationId?: string;
  sourceId?: string;
  focusId?: string;
}

const quoted = (text: string, limit = 160) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return `“${flat.length > limit ? `${flat.slice(0, limit - 3)}...` : flat}”`;
};

const batchName = (i: Investigation | undefined) => (i ? (i.number ? `batch ${i.number}` : `the batch ${quoted(i.title, 80)}`) : undefined);
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function batchOf(state: ResearchState, r: AnnotationTarget) {
  return state.investigations.find(
    (i) =>
      (r.proposalId && i.proposals.some((p) => p.id === r.proposalId)) ||
      (r.walkthroughId && i.reviewFlow?.walkthroughs.some((w) => w.id === r.walkthroughId)) ||
      (r.graphReviewId && i.reviewFlow?.graphReviews.some((g) => g.id === r.graphReviewId)) ||
      (r.investigationId && i.id === r.investigationId),
  );
}

function nodeName(dataset: GraphDataset, id: string) {
  return dataset.nodes.find((n) => n.id === id)?.name;
}

// A graph record in words: a node of the project's own type, or a connection.
function recordPhrase(dataset: GraphDataset, table: string, id: string, label: string) {
  if (table === "nodes") {
    const node = dataset.nodes.find((n) => n.id === id);
    const type = node?.type || "node";
    return { what: type, phrase: `the ${type} ${quoted(node?.name || label, 80)}` };
  }
  if (table === "claims") {
    const claim = dataset.claims?.find((c) => c.id === id);
    if (!claim) return { what: "connection", phrase: `the connection ${quoted(label, 120)}` };
    const object = "entityId" in claim.object ? nodeName(dataset, claim.object.entityId) || claim.object.entityId : String(claim.object.value);
    const words = `${nodeName(dataset, claim.subjectId) || claim.subjectId} ${claim.predicate.replace(/_/g, " ")} ${object}`;
    return { what: "connection", phrase: `the connection ${quoted(words, 120)}` };
  }
  return undefined;
}

export function describeReference(state: ResearchState, r: AnnotationTarget): ReferenceDescription {
  const batch = batchOf(state, r);
  const inBatch = batchName(batch);
  const ids: Record<string, string> = {};
  if (batch) ids.batch = batch.id;
  let kind = "Selection";
  let about = quoted(r.label, 120);

  const review = r.graphReviewId ? batch?.reviewFlow?.graphReviews.find((g) => g.id === r.graphReviewId) : undefined;
  const proposal = r.proposalId ? batch?.proposals.find((p) => p.id === r.proposalId) : undefined;
  const walkthrough = r.walkthroughId ? batch?.reviewFlow?.walkthroughs.find((w) => w.id === r.walkthroughId) : undefined;

  if (r.table === "sources" && r.recordId) {
    const source = state.library?.find((s) => s.id === r.recordId) || state.dataset.sources?.find((s) => s.id === r.recordId);
    const document = state.documents.find((d) => d.id === r.recordId);
    kind = "Source";
    about = `the source ${quoted(source?.title || document?.name || r.label, 120)}`;
    ids.source = r.recordId;
  } else if (r.table && r.recordId) {
    // A record in a batch's draft graph is not on the accepted graph yet.
    const record = recordPhrase(review?.draft || state.dataset, r.table, r.recordId, r.label);
    if (record) {
      kind = review ? `${capital(inBatch || "batch")} draft graph · ${record.what}` : `Graph · ${record.what}`;
      about = review ? `${record.phrase} in ${inBatch}'s draft graph` : `${record.phrase} on the graph`;
      ids.record = `${r.table}/${r.recordId}`;
    }
  } else if (r.findingId && proposal) {
    const finding = proposal.findings?.find((f) => f.id === r.findingId);
    kind = `${capital(inBatch || "batch")} · finding`;
    about = `the finding ${quoted(finding?.statement || r.label)}${inBatch ? ` in ${inBatch}` : ""}`;
    ids.proposal = proposal.id;
    ids.finding = r.findingId;
  } else if (r.groupId && proposal) {
    const group = proposal.groups?.find((g) => g.id === r.groupId);
    kind = `${capital(inBatch || "batch")} · graph change`;
    about = `the graph change ${quoted(group?.title || r.label, 120)}${inBatch ? ` in ${inBatch}` : ""}`;
    ids.proposal = proposal.id;
    ids.group = r.groupId;
  } else if (walkthrough) {
    const index = r.stepId ? walkthrough.steps.findIndex((s) => s.id === r.stepId) : -1;
    const step = index >= 0 ? walkthrough.steps[index] : undefined;
    // The opening and the closing frame the numbered steps.
    const part = r.stepId === "opening" || r.stepId === "closing" ? r.stepId : undefined;
    kind = `${capital(inBatch || "batch")} · walkthrough${step ? " step" : part ? ` ${part}` : ""}`;
    // A named section of a step, the opening or the closing leads with its name.
    const section = (place: string, name: string) => (r.label && r.label !== name ? `${quoted(r.label, 100)} in ${place}` : place);
    about = step
      ? section(`step ${index + 1}, ${quoted(step.title, 100)}, of ${inBatch}'s walkthrough`, step.title)
      : part
        ? section(`the ${part} of ${inBatch}'s walkthrough`, "")
        : `${inBatch}'s walkthrough, ${quoted(walkthrough.title, 120)}`;
    ids.walkthrough = walkthrough.id;
    if (step || part) ids.step = r.stepId!;
  } else if (proposal) {
    kind = `${capital(inBatch || "batch")} · report`;
    about = `the report ${quoted(proposal.title, 120)}${inBatch ? ` in ${inBatch}` : ""}`;
    ids.proposal = proposal.id;
  } else if (review) {
    kind = `${capital(inBatch || "batch")} draft graph`;
    about = `${quoted(r.label, 120)} in ${inBatch}'s draft graph`;
  } else if (r.assignmentId && batch) {
    const assignment = batch.assignments?.find((a) => a.id === r.assignmentId);
    kind = `${capital(inBatch!)} · research pass`;
    about = `the research pass ${quoted(assignment?.title || r.label, 160)} in ${inBatch}`;
    ids.assignment = r.assignmentId;
  } else if (r.investigationId && batch) {
    kind = capital(inBatch!);
    about = `${inBatch}, ${quoted(batch.title, 120)}`;
  }
  if (review) ids.graphReview = review.id;

  // Words the human selected, or the text of the element they picked, lead, with the object they sit in.
  const words = r.text?.replace(/\s+/g, " ").trim() || "";
  const range = (r.anchor as { type?: string } | undefined)?.type === "text-range";
  if (words && !r.label.includes(words)) about = `${range ? "the words" : "the text"} ${quoted(words, 300)} in ${about}`;

  const seenOn = r.screen ? describeScreen(state, r.screen) : undefined;
  return { kind, about, ...(seenOn ? { seenOn } : {}), ids };
}

const viewNames: Record<string, string> = {
  research: "the graph",
  work: "Investigations",
  review: "Review",
  sources: "Sources",
  feedback: "Feedback",
  settings: "Research settings",
};

// The screen as the human saw it: the graph and who it centred on, a batch's page,
// or a source.
export function describeScreen(state: ResearchState, screen: ReferenceScreen): string {
  const name = viewNames[screen.view] || screen.view;
  if (screen.view === "research" && screen.focusId) {
    const focus = nodeName(state.dataset, screen.focusId);
    if (focus) return `the graph, centred on ${quoted(focus, 80)}`;
  }
  if (screen.view === "sources" && screen.sourceId) {
    const source = state.library?.find((s) => s.id === screen.sourceId) || state.dataset.sources?.find((s) => s.id === screen.sourceId);
    const title = source?.title || state.documents.find((d) => d.id === screen.sourceId)?.name;
    if (title) return `Sources, reading ${quoted(title, 100)}`;
  }
  const batch = batchName(state.investigations.find((i) => i.id === screen.investigationId));
  if (batch && (screen.view === "review" || screen.view === "work")) return `${name}, on ${batch}`;
  return name;
}

// One line for the coordinator: the object, then where the human was.
export function referenceLine(state: ResearchState, r: AnnotationTarget): string {
  const d = describeReference(state, r);
  const ids = Object.entries(d.ids).map(([k, v]) => `${k} ${v}`).join(", ");
  return `${d.about}${ids ? ` (${ids})` : ""}${d.seenOn ? `, seen on ${d.seenOn}` : ""}`;
}
