import type {
  Annotation,
  AnnotationTarget,
  ResearchCommand,
  ResearchState,
} from "../domain/research";
import { referenceText } from "../domain/research";
import { describeReference } from "../domain/references";
import type { Message } from "../domain/conversation";
import { html } from "./finding-review";
import { clock, running } from "./live-panel";

export type DrawerTab = "conversation" | "queue";

export interface DrawerHost {
  state(): ResearchState;
  command(data: ResearchCommand): Promise<unknown>;
  navigate(reference: AnnotationTarget): void;
  batchAction(batchId: string, action: "walkthrough" | "graph"): void;
  // Starts a coordinator again from the project's saved state, after one stopped.
  startCoordinator(): Promise<unknown>;
  // True when the workspace service cannot be reached right now.
  offline?(): boolean;
  changed(): void;
}

interface Draft {
  references: AnnotationTarget[];
  question: string;
  // An unsent message to the coordinator, kept if the page reloads.
  message?: string;
  editing?: string;
  feedback?: boolean;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

// The project-wide conversation with the coordinator and the unsent queue.
export class AnnotationsDrawer {
  private tab: DrawerTab = "conversation";
  private pinned?: string;
  // The reader's place in the conversation, kept across background updates.
  private following = true;
  private readingTop = 0;
  private resize?: ResizeObserver;
  private draft: Draft;
  private readonly draftKey = `research-draft:${window.location.origin}`;
  private readonly seenKey = `research-seen:${window.location.origin}`;
  private error = "";

  constructor(
    private readonly root: HTMLElement,
    private readonly host: DrawerHost,
  ) {
    this.draft = this.loadDraft();
    root.addEventListener("click", (event) => void this.click(event));
    root.addEventListener("input", (event) => this.input(event));
    root.addEventListener("keydown", (event) => this.keydown(event));
    root.addEventListener("submit", (event) => event.preventDefault());
    this.render();
  }

  get currentTab(): DrawerTab {
    return this.tab;
  }

  show(tab: DrawerTab): void {
    this.tab = tab;
    this.pinned = undefined;
    this.following = true;
    this.render();
    if (tab === "queue")
      this.root.querySelector<HTMLTextAreaElement>("[data-note]")?.focus();
  }

  // Opens the conversation at one message, e.g. from a notification.
  showMessage(id: string): void {
    this.tab = "conversation";
    this.pinned = id;
    this.render();
    const message = this.messageElement(id);
    message?.classList.add("is-focused");
    setTimeout(() => message?.classList.remove("is-focused"), 2400);
  }

  private messageElement(id: string): HTMLElement | undefined {
    return [...this.root.querySelectorAll<HTMLElement>("[data-message-id]")].find((m) => m.dataset.messageId === id);
  }

  // A selection in the page becomes a reference of the annotation being written.
  addReference(reference: AnnotationTarget): void {
    const key = JSON.stringify(reference);
    if (!this.draft.references.some((r) => JSON.stringify(r) === key))
      this.draft.references.push(reference);
    this.saveDraft();
    this.show("queue");
  }

  // Coordinator messages after the last message the human has seen.
  unread(): number {
    const messages = this.host.state().conversation || [];
    const seen = this.seen();
    if (seen === null) return 0;
    const from = messages.findIndex((m) => m.id === seen) + 1;
    return messages.slice(from).filter((m) => m.author === "coordinator").length;
  }

  markSeen(): void {
    const latest = (this.host.state().conversation || []).at(-1);
    const visible = !(this.root instanceof HTMLDialogElement) || this.root.open;
    if (latest && visible && this.tab === "conversation") this.remember(latest.id);
  }

  private seen(): string | null {
    try {
      const value = localStorage.getItem(this.seenKey);
      if (value !== null) return value;
      // A first visit starts with everything already seen.
      this.remember(this.host.state().conversation?.at(-1)?.id || "");
      return null;
    } catch {
      return null;
    }
  }

  private remember(id: string): void {
    try {
      localStorage.setItem(this.seenKey, id);
    } catch {
      /* Read markers are a convenience only. */
    }
  }

  render(): void {
    // Background updates must not disturb what the human is typing.
    const active = document.activeElement as HTMLTextAreaElement | null;
    const focused =
      active && this.root.contains(active) && active.matches("textarea")
        ? {
            key: active.hasAttribute("data-message") ? "[data-message]" : "[data-note]",
            start: active.selectionStart,
            end: active.selectionEnd,
          }
        : undefined;
    const state = this.host.state();
    const queue = state.queue || [];
    this.markSeen();
    const unread = this.unread();
    this.root.innerHTML = `<div class="drawer-head"><h2>Coordinator</h2><button type="button" class="drawer-close" data-close aria-label="Close the coordinator panel">×</button></div>
<nav class="drawer-tabs" aria-label="Coordinator"><button type="button" data-tab="conversation" ${this.tab === "conversation" ? 'aria-current="page"' : ""}>Conversation${unread ? '<span class="unread-dot" aria-label="Unread messages"></span>' : ""}</button><button type="button" data-tab="queue" ${this.tab === "queue" ? 'aria-current="page"' : ""}>Annotations${queue.length ? `<span class="tab-count">${queue.length}</span>` : ""}</button></nav>
${this.tab === "conversation" ? this.conversation(state) : this.queue(state)}`;
    const list = this.tab === "conversation" ? this.root.querySelector<HTMLElement>(".conversation") : null;
    const pinned = list && this.pinned ? this.messageElement(this.pinned) : undefined;
    this.pinned = undefined;
    if (pinned)
      list!.scrollTop += pinned.getBoundingClientRect().top - list!.getBoundingClientRect().top - (list!.clientHeight - pinned.offsetHeight) / 2;
    else if (list) list.scrollTop = this.following ? list.scrollHeight : this.readingTop;
    // Background updates keep the reader's place unless they were following the latest message.
    list?.addEventListener("scroll", () => {
      this.following = list.scrollHeight - list.scrollTop - list.clientHeight < 24;
      this.readingTop = list.scrollTop;
    });
    // The drawer changes height between views; stay on the latest message while following it.
    this.resize?.disconnect();
    if (list && typeof ResizeObserver !== "undefined") {
      this.resize = new ResizeObserver(() => {
        if (this.following) list.scrollTop = list.scrollHeight;
      });
      this.resize.observe(list);
    }
    if (focused) {
      const element = this.root.querySelector<HTMLTextAreaElement>(focused.key);
      element?.focus();
      element?.setSelectionRange(focused.start, focused.end);
    }
    this.host.changed();
  }

  private conversation(state: ResearchState): string {
    const messages = state.conversation || [];
    let lastDay = "";
    const items = messages
      .map((m) => {
        const d = day(m.at);
        const separator = d !== lastDay ? `<div class="conversation-day">${html(d)}</div>` : "";
        lastDay = d;
        return separator + this.message(state, m);
      })
      .join("");
    return `<div class="conversation" aria-label="Conversation with the coordinator">${items || '<p class="conversation-empty">Ask the coordinator anything, or queue annotations from the page and send them together.</p>'}<div data-coordinator-activity>${this.activity(state)}</div></div>
<div data-presence>${this.presence(state)}</div><form class="message-form" data-message-form><div class="message-box"><textarea data-message rows="2" placeholder="Message the coordinator…" aria-label="Message the coordinator">${html(this.draft.message || "")}</textarea><button type="submit" class="primary">Send</button></div>${this.error && this.tab === "conversation" ? `<p class="form-error" role="alert">${html(this.error)}</p>` : ""}</form>`;
  }

  // What the coordinator is doing about the human's message, and whether it is
  // listening, as it changes between renders; the rest of the drawer is untouched.
  updateActivity(): void {
    if (this.tab !== "conversation") return;
    const state = this.host.state();
    const activity = this.root.querySelector<HTMLElement>("[data-coordinator-activity]");
    const presence = this.root.querySelector<HTMLElement>("[data-presence]");
    const said = this.activity(state);
    if (activity && activity.dataset.shown !== said) {
      activity.innerHTML = said;
      activity.dataset.shown = said;
      const list = this.root.querySelector<HTMLElement>(".conversation");
      if (list && this.following) list.scrollTop = list.scrollHeight;
    }
    const line = this.presence(state);
    if (presence && presence.dataset.shown !== line) {
      presence.innerHTML = line;
      presence.dataset.shown = line;
    }
  }

  // The coordinator at work on the human's latest message: the step it is on now and
  // the one before, until its reply takes their place.
  private activity(state: ResearchState): string {
    const c = state.coordinator;
    const last = state.conversation?.at(-1);
    if (!c?.connected || c.listening || last?.author !== "human") return "";
    if (c.paused)
      return `<div class="coordinator-working is-paused" aria-live="polite"><div class="coordinator-working-head"><strong>${html(c.name || "Coordinator")} is paused</strong><time datetime="${html(c.paused.until)}">until ${html(clock(c.paused.until))}</time></div><p>The usage limit is reached. It reads your messages when the limit resets.</p></div>`;
    const since = c.since || last.at;
    const steps = [c.latest, ...(c.trail || [])].filter((s): s is { at: string; text: string } => Boolean(s && s.at >= since));
    const before = steps[1]?.text || (steps[0] ? "Read your message" : "");
    return `<div class="coordinator-working" aria-live="polite"><div class="coordinator-working-head"><strong>${html(c.name || "Coordinator")} is working</strong><time datetime="${html(since)}" data-elapsed>${html(running(since, Date.now()))}</time></div><p>${html(steps[0]?.text || "Reading your message")}</p>${before ? `<p class="coordinator-working-before">Before that: ${html(before.charAt(0).toLowerCase() + before.slice(1))}</p>` : ""}</div>`;
  }

  // Whether anyone is listening, said where the human types.
  private presence(state: ResearchState): string {
    if (this.host.offline?.())
      return '<p class="coordinator-presence is-away">The workspace service is not responding. Reload the page to reconnect.</p>';
    const c = state.coordinator;
    if (!c?.enabled) return "";
    const who = html(c.name || "Your coordinator");
    if (c.connected && c.paused)
      return `<p class="coordinator-presence is-paused"><span class="presence-dot"></span>${who} is paused until ${html(clock(c.paused.until))}. Messages you send wait until then.</p>`;
    if (c.connected && c.listening)
      return `<p class="coordinator-presence"><span class="presence-dot"></span>${who} is listening.</p>`;
    if (c.connected)
      return `<p class="coordinator-presence is-busy"><span class="presence-dot"></span>${
        state.conversation?.at(-1)?.author === "human" ? `${who} is working on your message.` : `${who} is working. A message you send reaches it at its next step.`
      }</p>`;
    if (c.attached)
      return `<p class="coordinator-presence is-busy"><span class="presence-dot"></span>${who} is working${
        c.lastSeenSecondsAgo == null ? "" : `, last seen ${elapsed(c.lastSeenSecondsAgo)} ago`
      }. Messages wait until it checks back.</p>`;
    if (c.waiting) return '<p class="coordinator-presence">Your coordinator starts when you write to it.</p>';
    if (c.problem)
      return `<p class="coordinator-presence is-away"><span>${html(c.problem)} Messages wait here until it starts.</span><button type="button" data-start-coordinator>Start it again</button></p>`;
    return '<p class="coordinator-presence is-away">No coordinator is attached. Messages wait here until one connects.</p>';
  }

  private message(state: ResearchState, m: Message): string {
    if (m.author === "human") {
      const notes = (m.annotations || [])
        .map((a) => `<li>${html(a.question)}${this.about(state, a)}</li>`)
        .join("");
      const label =
        m.annotations?.length && !m.text
          ? `You sent ${m.annotations.length} annotation${m.annotations.length === 1 ? "" : "s"}`
          : "You";
      return `<div class="msg msg-you" data-message-id="${html(m.id)}"><div class="msg-who">${label} · ${html(when(m.at))}</div>${m.text ? `<p>${html(m.text)}</p>` : ""}${notes ? `<ul>${notes}</ul>` : ""}</div>`;
    }
    if (m.decision) {
      const d = m.decision;
      const pending = d.status === "pending";
      return `<div class="msg msg-decision${pending ? " is-pending" : ""}" data-message-id="${html(m.id)}"><div class="msg-who">${pending ? "Coordinator needs a decision" : "Coordinator asked"} · ${html(when(m.at))}</div><strong>${html(d.title)}</strong><p>${html(d.body)}</p>${pending ? `<div class="msg-actions"><button type="button" class="primary" data-decide="approve">Approve</button><button type="button" data-decide="decline">Decline</button></div>` : `<p class="msg-outcome">You ${d.status === "approved" ? "approved" : "declined"} this${d.decidedAt ? ` on ${html(when(d.decidedAt))}` : ""}.</p>`}</div>`;
    }
    const batch = m.readyBatchId
      ? state.investigations.find((i) => i.id === m.readyBatchId)
      : undefined;
    const links = (m.references || [])
      .map(
        (r, n) =>
          `<button type="button" class="text-link" data-reference="${n}">${html(r.label)}</button>`,
      )
      .join(" · ");
    const actions =
      batch && !batch.closedAt
        ? `<div class="msg-actions msg-text-actions">${batch.reviewFlow?.walkthroughs.length ? "" : '<button type="button" class="text-link" data-batch-action="walkthrough">Create walkthrough</button>'}<button type="button" class="text-link" data-batch-action="graph">Update graph</button></div>`
        : "";
    return `<div class="msg msg-coordinator" data-message-id="${html(m.id)}"><div class="msg-who">Coordinator · ${html(when(m.at))}</div>${m.text ? `<p>${html(m.text)}</p>` : ""}${links ? `<p class="msg-links">${links}</p>` : ""}${actions}</div>`;
  }

  private about(state: ResearchState, a: Annotation): string {
    const ref = a.references?.[0];
    if (!ref || ref.label === state.dataset.title) return "";
    return `<span class="msg-about">on ${html(describeReference(state, ref).about)}</span>`;
  }

  private queue(state: ResearchState): string {
    const queue = state.queue || [];
    const d = this.draft;
    // Each reference says what kind of research object it is, as the coordinator will read it.
    const refs = d.references
      .map(
        (r, n) =>
          `<li><span class="reference-text"><span class="reference-kind">${html(describeReference(state, r).kind)}</span><span class="reference-label">${html(referenceText(r))}</span></span><button type="button" data-remove-reference="${n}" aria-label="Remove reference">✕</button></li>`,
      )
      .join("");
    const items = queue
      .map(
        (a) =>
          `<div class="queue-item${a.id === d.editing ? " is-editing" : ""}" data-annotation-id="${html(a.id)}"><div class="queue-item-row"><span>${html(a.question)}</span><span class="queue-item-actions"><button type="button" class="text-link" data-edit-queued>Edit</button><button type="button" class="text-link" data-remove-queued>Remove</button></span></div>${this.about(state, a)}</div>`,
      )
      .join("");
    return `<div class="queue-pane"><form class="new-note" data-note-form><p class="new-note-label">${d.editing ? "Editing queued annotation" : "New annotation"}${d.references.length ? " about" : ""}</p>${refs ? `<ul class="note-references">${refs}</ul>` : ""}${d.references.length ? "" : '<p class="new-note-hint">Select anything on the page to add it here.</p>'}<textarea data-note rows="3" aria-label="Annotation" placeholder="A question, a doubt, or a thought to follow up…">${html(d.question)}</textarea><div class="new-note-row"><label class="feedback-check"><input type="checkbox" data-feedback ${d.feedback ? "checked" : ""}> Interface feedback</label><span class="new-note-actions">${d.editing ? '<button type="button" data-cancel-edit>Cancel</button>' : ""}${d.feedback ? '<button type="submit" class="primary" data-submit="feedback">Save feedback</button>' : `<button type="submit" data-submit="queue">${d.editing ? "Save" : "Add to queue"}</button>${d.editing ? "" : '<button type="submit" class="primary" data-submit="now">Send now</button>'}`}</span></div>${this.error && this.tab === "queue" ? `<p class="form-error" role="alert">${html(this.error)}</p>` : ""}</form>${items ? `<div class="queue-list" aria-label="Queued annotations">${items}</div>` : '<p class="queue-empty">Nothing queued. Annotations you add wait here until you send them together.</p>'}</div>
<div class="queue-foot"><span>Your coordinator reads these together.</span><button type="button" class="primary" data-send-queue ${queue.length ? "" : "disabled"}>Send queue</button></div>`;
  }

  private input(event: Event): void {
    const element = event.target as HTMLElement;
    if (element.matches("[data-message]"))
      this.draft.message = (element as HTMLTextAreaElement).value;
      this.saveDraft();
    if (element.matches("[data-note]")) {
      this.draft.question = (element as HTMLTextAreaElement).value;
      this.saveDraft();
    }
    if (element.matches("[data-feedback]")) {
      this.draft.feedback = (element as HTMLInputElement).checked;
      this.saveDraft();
      this.render();
    }
  }

  private keydown(event: KeyboardEvent): void {
    const element = event.target as HTMLElement;
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      element.matches("[data-message]")
    ) {
      event.preventDefault();
      void this.sendMessage();
    }
  }

  private async run(action: () => Promise<unknown>): Promise<boolean> {
    try {
      await action();
      this.error = "";
      return true;
    } catch (error) {
      this.error = (error as Error).message;
      this.render();
      return false;
    }
  }

  private async sendMessage(): Promise<void> {
    const box = this.root.querySelector<HTMLTextAreaElement>("[data-message]");
    const text = box?.value.trim();
    if (!text) return;
    if (await this.run(() => this.host.command({ type: "send", text }))) {
      delete this.draft.message;
      this.saveDraft();
      this.render();
    }
  }

  private async submitNote(mode: string): Promise<void> {
    const d = this.draft;
    const note = { question: d.question, references: d.references };
    const ok = await this.run(() =>
      mode === "feedback"
        ? this.host.command({ type: "interface-feedback", ...note })
        : mode === "now"
          ? this.host.command({ type: "send", annotation: note })
          : d.editing
            ? this.host.command({ type: "edit-queued", annotationId: d.editing, ...note })
            : this.host.command({ type: "queue-annotation", ...note }),
    );
    if (!ok) return;
    this.draft = { references: [], question: "", feedback: d.feedback };
    this.saveDraft();
    this.show(mode === "now" ? "conversation" : "queue");
  }

  private async click(event: Event): Promise<void> {
    const target = event.target as HTMLElement;
    const button = target.closest<HTMLButtonElement>("button");
    if (!button) return;
    const messageId = button.closest<HTMLElement>("[data-message-id]")?.dataset.messageId;
    const annotationId = button.closest<HTMLElement>("[data-annotation-id]")?.dataset.annotationId;
    if (button.dataset.tab) this.show(button.dataset.tab as DrawerTab);
    else if (button.dataset.removeReference) {
      this.draft.references.splice(Number(button.dataset.removeReference), 1);
      this.saveDraft();
      this.render();
    } else if (button.dataset.submit) {
      event.preventDefault();
      await this.submitNote(button.dataset.submit);
    } else if (button.hasAttribute("data-cancel-edit")) {
      this.draft = { references: [], question: "" };
      this.saveDraft();
      this.render();
    } else if (button.hasAttribute("data-edit-queued") && annotationId) {
      const a = this.host.state().queue?.find((x) => x.id === annotationId);
      if (!a) return;
      this.draft = { references: [...(a.references || [])], question: a.question, editing: a.id };
      this.saveDraft();
      this.show("queue");
    } else if (button.hasAttribute("data-remove-queued") && annotationId) {
      if (await this.run(() => this.host.command({ type: "remove-queued", annotationId })))
        this.render();
    } else if (button.hasAttribute("data-send-queue")) {
      if (await this.run(() => this.host.command({ type: "send" })))
        this.show("conversation");
    } else if (button.closest("[data-message-form]") && button.type === "submit") {
      event.preventDefault();
      await this.sendMessage();
    } else if (button.hasAttribute("data-start-coordinator")) {
      button.disabled = true;
      if (await this.run(() => this.host.startCoordinator())) this.render();
      else button.disabled = false;
    } else if (button.dataset.decide && messageId) {
      if (
        await this.run(() =>
          this.host.command({ type: "decide", messageId, decision: button.dataset.decide }),
        )
      )
        this.render();
    } else if (button.dataset.reference && messageId) {
      const m = this.host.state().conversation?.find((x) => x.id === messageId);
      const reference = m?.references?.[Number(button.dataset.reference)];
      if (reference) this.host.navigate(reference);
    } else if (button.dataset.batchAction && messageId) {
      const m = this.host.state().conversation?.find((x) => x.id === messageId);
      if (m?.readyBatchId)
        this.host.batchAction(m.readyBatchId, button.dataset.batchAction as "walkthrough" | "graph");
    }
  }

  private loadDraft(): Draft {
    try {
      const saved = JSON.parse(localStorage.getItem(this.draftKey) || "null");
      if (saved && Array.isArray(saved.references) && typeof saved.question === "string")
        return saved;
    } catch {
      /* A damaged local draft never affects saved research. */
    }
    return { references: [], question: "" };
  }

  private saveDraft(): void {
    try {
      localStorage.setItem(this.draftKey, JSON.stringify(this.draft));
    } catch {
      /* Drafts are a convenience; research is saved on the server. */
    }
  }
}

function elapsed(seconds: number): string {
  if (seconds < 90) return `${Math.max(1, Math.round(seconds))} seconds`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} minutes` : `${Math.round(minutes / 60)} hours`;
}
