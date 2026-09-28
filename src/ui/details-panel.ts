// The side panel: a node, or one statement with its evidence.
//
// Both are drawn from views that have already organized the research, so this only
// lays them out. Every row opens its statement; an empty field is a gap that can be
// selected to ask for research on it.
import type { NodeView, StatementRow, StatementView } from "../domain/node-view";
import type { SourceRecord } from "../domain/types";

export interface DetailsPanelHandlers {
  onClose: () => void;
  // Show a node: focus it and open its panel.
  onOpenNode: (nodeId: string) => void;
  onOpenStatement: (claimId: string) => void;
}

function element<K extends keyof HTMLElementTagNameMap>(tagName: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const created = document.createElement(tagName);
  if (className) created.className = className;
  if (text) created.textContent = text;
  return created;
}

const target = (value: object) => JSON.stringify(value);

function header(kicker: string, onClose: () => void, back?: { name: string; open: () => void }): HTMLElement {
  const head = element("header", "detail-header");
  if (back) {
    const link = element("button", "detail-back", `‹ ${back.name}`);
    link.type = "button";
    link.addEventListener("click", back.open);
    head.append(link);
  }
  head.append(element("span", "eyebrow", kicker));
  const close = element("button", "icon-button detail-close", "×");
  close.type = "button";
  close.ariaLabel = "Close details";
  close.dataset.lavishAction = "true";
  close.addEventListener("click", onClose);
  head.append(close);
  return head;
}

function section(kicker: string): HTMLElement {
  const block = element("section", "detail-section");
  block.append(element("h3", "detail-kicker", kicker));
  return block;
}

// A row: its label, its value with date and any qualification, opening its statement.
function statementRow(row: StatementRow, continued: boolean, handlers: DetailsPanelHandlers): HTMLElement {
  const button = element("button", `statement-row${continued ? " is-continued" : ""}`);
  button.type = "button";
  button.dataset.claimId = row.claimId;
  button.dataset.researchTarget = target({ table: "claims", recordId: row.claimId, label: `${row.label}: ${row.value}` });
  button.append(element("span", "statement-label", row.label));
  const value = element("span", "statement-value", row.value);
  if (row.when) value.append(" ", element("span", "statement-when", row.when));
  if (row.qualification) value.append(" ", element("span", "statement-qualification", row.qualification));
  button.append(value, element("span", "statement-go", "›"));
  button.addEventListener("click", () => handlers.onOpenStatement(row.claimId));
  return button;
}

function rows(list: StatementRow[], handlers: DetailsPanelHandlers): HTMLElement {
  const container = element("div", "statement-rows");
  list.forEach((row, index) => container.append(statementRow(row, index > 0 && list[index - 1]!.label === row.label, handlers)));
  return container;
}

// Something not yet known about a node, which the human can ask to have researched.
function gap(label: string, nodeId: string, nodeName: string, what: string): HTMLElement {
  const button = element("button", "statement-row is-gap");
  button.type = "button";
  const reference = { table: "nodes", recordId: nodeId, label: `${nodeName}: ${what}`, text: `${what} is not yet found` };
  button.dataset.researchTarget = target(reference);
  button.append(element("span", "statement-label", label), element("span", "statement-value", "Not yet found"), element("span", "statement-go", "›"));
  button.title = "Ask for research on this";
  button.addEventListener("click", () => window.dispatchEvent(new CustomEvent("research:ask", { detail: reference })));
  return button;
}

function sourceList(sources: SourceRecord[]): HTMLElement {
  const details = element("details", "detail-section detail-sources");
  details.append(element("summary", "detail-kicker", `Sources · ${sources.length}`));
  const list = element("ol", "detail-source-list");
  for (const source of sources) {
    const item = element("li");
    const button = element("button", "detail-source", source.title);
    button.type = "button";
    button.dataset.inspectSource = source.id;
    button.dataset.researchTarget = target({ table: "sources", recordId: source.id, label: source.title });
    item.append(button);
    list.append(item);
  }
  details.append(list);
  return details;
}

export function renderNodePanel(container: HTMLElement, view: NodeView, handlers: DetailsPanelHandlers): void {
  container.replaceChildren();
  container.dataset.nodeId = view.id;
  delete container.dataset.claimId;
  const head = header(view.type, handlers.onClose);
  head.classList.add(`look-${view.look.color}`);
  const title = element("h2", "detail-title", view.name);
  title.dataset.researchTarget = target({ table: "nodes", recordId: view.id, label: view.name });
  head.append(title);
  if (view.dates) head.append(element("p", "detail-lifespan", view.dates));
  container.append(head);

  if (view.summary) {
    const summary = element("div", "detail-summary");
    for (const paragraph of view.summary.split(/\n\s*\n/)) summary.append(element("p", "", paragraph.trim()));
    container.append(summary);
  } else {
    const missing = element("div", "detail-summary");
    missing.append(gap("Summary", view.id, view.name, "a summary"));
    container.append(missing);
  }

  if (view.fields.length) {
    const block = section("Details");
    const list = element("div", "statement-rows");
    for (const field of view.fields) {
      if (!field.rows.length) list.append(gap(field.label, view.id, view.name, field.label.toLocaleLowerCase()));
      else field.rows.forEach((row, index) => list.append(statementRow(row, index > 0, handlers)));
    }
    block.append(list);
    container.append(block);
  }

  if (view.connections.length) {
    const block = section("Connections");
    block.append(rows(view.connections, handlers));
    container.append(block);
  }

  if (view.other.length) {
    const block = section(view.fields.length ? "Also recorded" : "Details");
    block.append(rows(view.other, handlers));
    container.append(block);
  }

  if (view.notes.length) {
    const block = section("Research notes");
    const list = element("ul", "detail-notes");
    for (const note of view.notes) list.append(element("li", "", note));
    block.append(list);
    container.append(block);
  }

  if (view.sources.length) container.append(sourceList(view.sources));
}

const qualificationNames: Record<string, string> = {
  supported: "Supported",
  reported: "Reported",
  inferred: "Inferred",
  disputed: "Disputed",
  unresolved: "Unresolved",
};

export function renderStatementPanel(
  container: HTMLElement,
  view: StatementView,
  handlers: DetailsPanelHandlers,
  from?: { id: string; name: string },
): void {
  container.replaceChildren();
  container.dataset.claimId = view.claimId;
  delete container.dataset.nodeId;
  const back = from ?? view.subject;
  const head = header(view.heading, handlers.onClose, { name: back.name, open: () => handlers.onOpenNode(back.id) });
  const title = element("h2", "detail-title statement-title");
  title.dataset.researchTarget = target({ table: "claims", recordId: view.claimId, label: view.heading });
  const link = (node: { id: string; name: string }) => {
    const button = element("button", "statement-node", node.name);
    button.type = "button";
    button.addEventListener("click", () => handlers.onOpenNode(node.id));
    return button;
  };
  if ("id" in view.object) title.append(link(view.subject), ` ${view.verb} `, link(view.object));
  else title.append(link(view.subject), ` ${view.verb}: `, view.object.value);
  head.append(title);
  head.append(element("p", "detail-lifespan", [view.when, qualificationNames[view.qualification]].filter(Boolean).join(" · ")));
  container.append(head);

  if (view.reasoning.trim()) {
    const why = element("div", "statement-why");
    const lead = view.qualification === "supported" ? "" : `Why ${view.qualification}. `;
    view.reasoning
      .trim()
      .split(/\n\s*\n/)
      .forEach((paragraph, index) => {
        const p = element("p");
        if (index === 0 && lead) p.append(element("strong", "", lead));
        p.append(paragraph.trim());
        why.append(p);
      });
    container.append(why);
  }

  for (const evidence of view.evidence) {
    const item = element("section", "statement-evidence");
    item.dataset.researchTarget = target({ table: "claims", recordId: view.claimId, label: evidence.source?.title || evidence.role, text: evidence.quote });
    item.append(element("p", "evidence-role", evidence.role));
    if (evidence.source) item.append(element("p", "evidence-source", evidence.source.title));
    item.append(element("blockquote", "", evidence.quote));
    const meta = element("p", "evidence-meta");
    if (evidence.locator) meta.append(evidence.locator);
    const context = element("p", "evidence-context", evidence.context);
    context.hidden = true;
    if (evidence.context) {
      const toggle = element("button", "evidence-link", "Context");
      toggle.type = "button";
      toggle.ariaExpanded = "false";
      toggle.addEventListener("click", () => {
        context.hidden = !context.hidden;
        toggle.ariaExpanded = String(!context.hidden);
      });
      if (meta.childNodes.length) meta.append(" · ");
      meta.append(toggle);
    }
    if (evidence.source) {
      const open = element("button", "evidence-link", "Open source");
      open.type = "button";
      open.dataset.inspectSource = evidence.source.id;
      open.dataset.inspectQuote = evidence.quote;
      if (meta.childNodes.length) meta.append(" · ");
      meta.append(open);
    }
    item.append(meta, context);
    container.append(item);
  }

  if (view.sources.length) {
    const block = section(view.evidence.length ? "Also cited" : "Cited");
    const list = element("ol", "detail-source-list");
    for (const source of view.sources) {
      const button = element("button", "detail-source", source.title);
      button.type = "button";
      button.dataset.inspectSource = source.id;
      const item = element("li");
      item.append(button);
      list.append(item);
    }
    block.append(list);
    container.append(block);
  }
}
