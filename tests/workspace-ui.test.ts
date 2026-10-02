// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  initialState,
  transition,
  type ResearchState,
} from "../src/domain/research";
import { emptyGraph } from "../src/domain/graph-schema";
const empty = emptyGraph();
import { mountResearchWorkspace } from "../src/research-workspace";
import { flowCommand } from "../server/review-flow.mjs";
import { changeDispatch, defaultDispatch, type Catalog } from "../src/domain/dispatch";
vi.mock("../src/vendor/lavish/artifact-sdk.js", () => ({
  createArtifactSdk: vi.fn(),
  deriveLavishQueueKey: vi.fn(),
}));
let state: ResearchState;
const click = (selector: string) =>
  document.querySelector<HTMLButtonElement>(selector)!.click();
const select = (selector: string, value: string) => {
  const el = document.querySelector<HTMLSelectElement>(selector)!;
  el.value = value;
  el.dispatchEvent(new Event("change", { bubbles: true }));
};
function mount() {
  document.body.innerHTML =
    '<div class="app-shell"><header class="app-header"><div class="brand-block"><h1>Fictional workshop</h1></div></header><main class="workspace"><aside class="details-panel" aria-hidden="true"></aside></main></div>';
  mountResearchWorkspace(structuredClone(state), vi.fn());
}
// The unsent draft the project keeps, as the server's draft file would.
let projectDraft: unknown = null;
// What the human asked of running agents.
let agentRequests: any[] = [];
const catalog: Catalog = {
  agents: [
    { id: "claude", label: "Claude Code", installed: true, efforts: ["low", "high"], models: [{ id: "opus", label: "Opus", efforts: ["low", "high"] }, { id: "sonnet", label: "Sonnet", efforts: ["low", "high"] }] },
    { id: "codex", label: "Codex", installed: true, efforts: ["low", "medium"], models: [{ id: "gpt-6-sol", label: "GPT-6-Sol", efforts: ["low", "medium"] }] },
  ],
};
beforeEach(() => {
  localStorage.clear();
  projectDraft = null;
  agentRequests = [];
  state = initialState({
    ...empty,
    title: "Who founded the fictional workshop?",
  });
  state = transition(state, {
    type: "send",
    annotation: {
      question: "This is the question",
      references: [{ label: "Fictional register entry", text: "Fictional register entry" }],
    },
  }).state;
  state = transition(state, {
    type: "open-batch",
    brief: {
      purpose: "Identify the fictional workshop's founder.",
      scope: "The founding only.",
      direction: "Read the register entry.",
    },
    title: "The workshop's founder",
    assignments: [{ title: "Who founded the workshop?", brief: "Read the fictional register entry and name the founder." }],
  }).state;
  state = transition(state, {
    type: "pause",
    investigationId: state.investigations[0]!.id,
  }).state;
  vi.spyOn(window, "setInterval").mockReturnValue(
    0 as unknown as ReturnType<typeof window.setInterval>,
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path, options) => {
      if (path === "/api/draft") {
        if (options?.body) projectDraft = JSON.parse(options.body);
        return { ok: true, json: async () => (options?.body ? { saved: true } : projectDraft) };
      }
      if (path === "/api/app-settings") {
        Object.assign(state, JSON.parse(options.body));
        return { ok: true, json: async () => ({ developerMode: state.developerMode, annotationIntroSeen: state.annotationIntroSeen }) };
      }
      if (path === "/api/research-settings") {
        state.researchSettings = JSON.parse(options.body);
        return { ok: true, json: async () => state.researchSettings };
      }
      if (path === "/api/review-flow") {
        const store = {
          get state() {
            return state;
          },
          update(fn: (next: ResearchState) => void) {
            const next = structuredClone(state);
            fn(next);
            next.revision++;
            state = next;
          },
        };
        const result = flowCommand(store, JSON.parse(options.body), "human");
        return { ok: true, json: async () => result };
      }
      if (path === "/api/coordinator/fresh") {
        state.coordinator = { ...state.coordinator!, connected: true, listening: true, problem: null };
        return { ok: true, json: async () => ({ started: true }) };
      }
      if (path === "/api/review-settings") {
        state.reviewSettings = JSON.parse(options.body);
        return { ok: true, json: async () => state.reviewSettings };
      }
      if (path === "/api/agents") {
        agentRequests.push(JSON.parse(options.body));
        return { ok: true, json: async () => ({ switched: true }) };
      }
      if (path === "/api/dispatch") {
        state.dispatch = changeDispatch(state.dispatch!, JSON.parse(options.body), state.catalog!, "human", () => "r1", "2026-10-02T12:00:00.000Z");
        return { ok: true, json: async () => ({ dispatch: state.dispatch }) };
      }
      if (path === "/api/commands") {
        const result = transition(state, JSON.parse(options.body));
        state = result.state;
        return { ok: true, json: async () => ({ result: result.result }) };
      }
      return { ok: true, json: async () => structuredClone(state) };
    }),
  );
  HTMLDialogElement.prototype.show = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  mount();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
describe("investigation workspace", () => {
  const typeNote = (text: string) => {
    const note = document.querySelector<HTMLTextAreaElement>("[data-note]")!;
    note.value = text;
    note.dispatchEvent(new Event("input", { bubbles: true }));
  };
  it("keeps an annotation draft across tabs, page selections and closing the drawer", async () => {
    const investigations = state.investigations.length;
    click('[data-view="work"]');
    click("[data-open-coordinator]");
    expect(document.querySelector('[data-tab="conversation"]')!.getAttribute("aria-current")).toBe("page");
    // Opening the sidebar to talk leaves the page as it is; annotating is its own switch.
    expect(document.body.classList.contains("research-annotating")).toBe(false);
    click("[data-annotate]");
    expect(document.body.classList.contains("research-annotating")).toBe(true);
    expect(document.querySelector("[data-annotate]")!.getAttribute("aria-checked")).toBe("true");
    expect(document.querySelector('[data-tab="queue"]')!.getAttribute("aria-current")).toBe("page");
    typeNote("Compare these records");
    click('[data-tab="conversation"]');
    click('[data-tab="queue"]');
    expect(document.querySelector<HTMLTextAreaElement>("[data-note]")!.value).toBe("Compare these records");
    click('[data-tab="conversation"]');
    // A selection in the page opens the queue with the note being written.
    (window as any).lavishUnifiedFeedback.selectReference({
      text: "Fictional register entry",
      selector: ".investigation-heading",
    });
    expect(document.querySelector('[data-tab="queue"]')!.getAttribute("aria-current")).toBe("page");
    expect(document.querySelector(".note-references")!.textContent).toContain("Fictional register entry");
    expect(document.querySelector<HTMLTextAreaElement>("[data-note]")!.value).toBe("Compare these records");
    click("[data-close]");
    // Closing the sidebar leaves the switch as it was; turning it off ends annotating.
    expect(document.body.classList.contains("research-annotating")).toBe(true);
    click("[data-annotate]");
    expect(document.body.classList.contains("research-annotating")).toBe(false);
    expect(document.querySelector("#notes-sidebar[open]")).toBeNull();
    click("[data-open-coordinator]");
    click('[data-tab="queue"]');
    expect(document.querySelector<HTMLTextAreaElement>("[data-note]")!.value).toBe("Compare these records");
    click('[data-submit="queue"]');
    await vi.waitFor(() => expect(state.queue).toHaveLength(1));
    expect(state.queue![0]!.references![0]!.label).toBe("Fictional register entry");
    expect(state.investigations).toHaveLength(investigations);
    await vi.waitFor(() => expect(document.querySelector(".queue-item")!.textContent).toContain("Compare these records"));
    expect(document.querySelector<HTMLTextAreaElement>("[data-note]")!.value).toBe("");
    expect(document.querySelector(".app-shell")!.getAttribute("data-workspace-view")).toBe("work");
  });
  it("sends a chat message without the annotations waiting in the queue", async () => {
    state = transition(state, { type: "queue-annotation", question: "Check the workshop register", references: [] }).state;
    mount();
    click("[data-open-coordinator]");
    const box = document.querySelector<HTMLTextAreaElement>("[data-message]")!;
    box.value = "A quick question first.";
    box.dispatchEvent(new Event("input", { bubbles: true }));
    click('[data-message-form] button[type="submit"]');
    await vi.waitFor(() => expect(state.conversation!.at(-1)!.text).toBe("A quick question first."));
    expect(state.conversation!.at(-1)!.annotations).toBeUndefined();
    expect(state.queue!.map((a) => a.question)).toEqual(["Check the workshop register"]);
  });
  it("sends the queue as one message and shows coordinator replies and decisions", async () => {
    for (const question of ["Check the workshop register", "Check another workshop"])
      state = transition(state, { type: "queue-annotation", question, references: [] }).state;
    mount();
    expect(document.querySelector('[data-count="unread"]')!.textContent).toBe("");
    click("[data-open-coordinator]");
    click('[data-tab="queue"]');
    expect(document.querySelectorAll(".queue-item")).toHaveLength(2);
    click(".queue-item [data-remove-queued]");
    await vi.waitFor(() => expect(document.querySelectorAll(".queue-item")).toHaveLength(1));
    click("[data-send-queue]");
    await vi.waitFor(() => expect(state.conversation).toHaveLength(2));
    expect(state.conversation!.at(-1)!.annotations!.map((a) => a.question)).toEqual(["Check another workshop"]);
    expect(state.queue).toHaveLength(0);
    await vi.waitFor(() => expect([...document.querySelectorAll(".msg-you")].at(-1)!.textContent).toContain("You sent 1 annotation"));
    state = transition(state, { type: "reply", text: "I'll look at the register first." }).state;
    state = transition(state, {
      type: "request-approval",
      title: "Read the 1884 register?",
      body: "Two sources disagree about the closing year.",
    }).state;
    mount();
    const badge = document.querySelector('[data-count="unread"]')!;
    expect(badge.textContent).toBe("2");
    expect(badge.classList.contains("alert")).toBe(true);
    click("[data-open-coordinator]");
    expect(document.querySelector(".msg-decision")!.textContent).toContain("Read the 1884 register?");
    expect(badge.textContent).toBe("");
    click('[data-decide="approve"]');
    await vi.waitFor(() => expect(state.conversation!.at(-1)!.decision!.status).toBe("approved"));
    await vi.waitFor(() => expect(document.querySelector(".msg-outcome")!.textContent).toContain("You approved"));
  });
  const poll = async () => {
    const tick = vi.mocked(window.setInterval).mock.calls.at(-1)![0] as () => Promise<void>;
    await tick();
  };
  it("announces coordinator messages and opens the conversation at them", async () => {
    state = transition(state, { type: "reply", text: "The register is open." }).state;
    state = transition(state, {
      type: "request-approval",
      title: "Read the 1884 register?",
      body: "Two sources disagree about the closing year.",
    }).state;
    await poll();
    const notice = document.querySelector<HTMLElement>(".workspace-notice")!;
    await vi.waitFor(() => expect(notice.hidden).toBe(false));
    expect(notice.querySelector("strong")!.textContent).toBe("Your coordinator needs a decision");
    expect(notice.querySelector("span")!.textContent).toBe("Read the 1884 register?");
    click("[data-notice-open]");
    expect(notice.hidden).toBe(true);
    expect(document.querySelector('[data-tab="conversation"]')!.getAttribute("aria-current")).toBe("page");
    expect(document.querySelector(".msg-decision")!.classList.contains("is-focused")).toBe(true);
    click("[data-close]");
    state = transition(state, { type: "reply", text: "Both registers agree.\nDetails follow." }).state;
    await poll();
    await vi.waitFor(() => expect(notice.hidden).toBe(false));
    expect(notice.querySelector("strong")!.textContent).toBe("Your coordinator replied");
    expect(notice.querySelector("span")!.textContent).toBe("Both registers agree.");
    click("[data-notice-dismiss]");
    expect(notice.hidden).toBe(true);
    // Dismissing keeps the message unread.
    expect(document.querySelector('[data-count="unread"]')!.textContent).toBe("1");
  });
  it("says in the conversation whether a coordinator is listening", async () => {
    state.coordinator = { enabled: true, connected: false, name: null, awaitingSynthesis: [] };
    mount();
    click("[data-open-coordinator]");
    expect(document.querySelector(".coordinator-presence")!.textContent).toContain("No coordinator is attached");
    state.coordinator = { enabled: true, connected: true, listening: true, name: "Research coordinator", awaitingSynthesis: [] };
    await poll();
    await vi.waitFor(() =>
      expect(document.querySelector(".coordinator-presence")!.textContent).toContain("Research coordinator is listening"),
    );
  });
  it("shows the coordinator at work on the human's message, step by step, until it replies", async () => {
    state.coordinator = { enabled: true, connected: true, listening: true, name: "Coordinator", awaitingSynthesis: [] };
    mount();
    click("[data-open-coordinator]");
    const box = document.querySelector<HTMLTextAreaElement>("[data-message]")!;
    box.value = "Has it saved anything on Gillise yet?";
    click('[data-message-form] button[type="submit"]');
    await vi.waitFor(() => expect(state.conversation!.at(-1)!.author).toBe("human"));
    const since = new Date(Date.now() - 8_000).toISOString();
    state.coordinator = { ...state.coordinator!, listening: false, since, latest: { at: new Date().toISOString(), text: "Checking batch 6's checkpoints" }, trail: [{ at: since, text: "Reading the project's latest changes" }] };
    await poll();
    const working = () => document.querySelector(".coordinator-working");
    await vi.waitFor(() => expect(working()?.textContent).toContain("Checking batch 6's checkpoints"));
    expect(working()!.textContent).toContain("Coordinator is working");
    expect(working()!.textContent).toContain("Before that: reading the project's latest changes");
    expect(document.querySelector(".coordinator-presence")!.textContent).toBe("Coordinator is working on your message.");
    // The typed draft is untouched by the updates.
    box.value = "Also";
    state.conversation!.push({ id: "reply", author: "coordinator", text: "Not yet.", at: new Date().toISOString() } as never);
    state.revision++;
    state.coordinator = { ...state.coordinator!, listening: true, since: null };
    await poll();
    await vi.waitFor(() => expect(working()).toBeNull());
    expect(document.querySelector(".coordinator-presence")!.textContent).toBe("Coordinator is listening.");
  });
  it("says when the usage limit pauses the coordinator, and until when", async () => {
    // A weekly limit can be days away, so the date is given with the time.
    const reset = new Date();
    reset.setDate(reset.getDate() + 3);
    reset.setHours(23, 26, 0, 0);
    const until = reset.toISOString();
    const when = `11:26 PM on ${reset.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
    state.coordinator = { enabled: true, connected: true, listening: false, paused: { until }, since: null, name: "Coordinator", awaitingSynthesis: [] };
    state.conversation = [{ id: "m1", author: "human", text: "hello?", at: new Date().toISOString() } as never];
    mount();
    click("[data-open-coordinator]");
    expect(document.querySelector(".coordinator-presence")!.textContent).toBe(`Coordinator is paused until ${when}. Your messages still try to reach it, in case the limit lifts sooner.`);
    expect(document.querySelector(".coordinator-working")!.textContent).toMatch(new RegExp(`Coordinator is paused\\s*until ${when}\\s*The usage limit is reached`));
    expect(document.querySelector("[data-running]")!.textContent).toContain(`Coordinator paused until ${when}`);
  });
  it("lets a paused coordinator be replaced without stopping researchers", async () => {
    // A weekly limit can be days away, so the date is given with the time.
    const reset = new Date();
    reset.setDate(reset.getDate() + 3);
    reset.setHours(23, 26, 0, 0);
    const until = reset.toISOString();
    const when = `11:26 PM on ${reset.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
    state.coordinator = { enabled: true, connected: true, listening: false, paused: { until }, since: null, name: "Coordinator", awaitingSynthesis: [] };
    state.live = [{ role: "researcher", name: "Codex researcher", investigationId: state.investigations[0]!.id, startedAt: new Date().toISOString(), latest: null }];
    mount();
    click('[data-view="settings"]');
    const button = document.querySelector<HTMLButtonElement>("[data-coordinator-fresh]")!;
    expect(button.disabled).toBe(false);
    expect(button.parentElement!.nextElementSibling!.textContent).toContain("workers and queued work carry on");
    click("[data-coordinator-fresh]");
    await vi.waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([path]) => path === "/api/coordinator/fresh")).toBe(true));
    expect(state.live).toHaveLength(1);
  });
  it("says when the coordinator stopped, and starts it again", async () => {
    state.coordinator = { enabled: true, connected: false, name: null, awaitingSynthesis: [], problem: "The coordinator stopped at 4:18 AM when it lost contact with the app." };
    mount();
    click("[data-open-coordinator]");
    const presence = () => document.querySelector(".coordinator-presence")!.textContent;
    expect(presence()).toContain("The coordinator stopped at 4:18 AM when it lost contact with the app. Messages wait here until it starts.");
    click("[data-start-coordinator]");
    await vi.waitFor(() => expect(presence()).toContain("Your coordinator is listening"));
    expect(vi.mocked(fetch).mock.calls.some(([path]) => path === "/api/coordinator/fresh")).toBe(true);
  });
  it("shows research running now from every tab", async () => {
    // A message the coordinator has not answered is shown as waiting for it.
    expect(document.querySelector<HTMLElement>("[data-running]")!.textContent).toBe("1 message waiting for the coordinator");
    state = transition(state, { type: "reply", text: "I've opened batch 1 for this." }).state;
    mount();
    expect(document.querySelector<HTMLElement>("[data-running]")!.hidden).toBe(true);
    state.investigations[0]!.reviewFlow = {
      walkthroughs: [],
      graphReviews: [],
      jobs: [{ id: "j1", status: "running", progress: "Building a connected graph.", engine: "claude", updates: [], attempt: 0, createdAt: "2026-01-01T00:00:00.000Z", consumedUpdateSequence: 0 }],
    } as never;
    state.live = [{ role: "builder", name: "Claude graph builder", investigationId: state.investigations[0]!.id, jobId: "j1", startedAt: new Date(Date.now() - 4 * 60_000).toISOString(), latest: { at: new Date().toISOString(), text: "Editing the edges table" } }];
    mount();
    const indicator = document.querySelector<HTMLElement>("[data-running]")!;
    expect(indicator.hidden).toBe(false);
    // The line says who is working and the step it is on.
    expect(indicator.querySelector(".ticker-who")!.textContent).toBe("Batch 1 graph builder");
    expect(indicator.querySelector(".ticker-what")!.textContent).toBe("Editing the edges table");
    expect(indicator.querySelector(".ticker-more")).toBeNull();
    // It opens a panel: who is working now, what needs the human, and what waits.
    expect(indicator.getAttribute("popovertarget")).toBe("live-panel");
    const panel = document.getElementById("live-panel")!;
    panel.dispatchEvent(Object.assign(new Event("beforetoggle"), { newState: "open" }));
    expect([...panel.querySelectorAll("h2")].map((h) => h.textContent)).toEqual(["Working now", "Needs you"]);
    const builder = panel.querySelector(".live-working .live-agent")!;
    expect(builder.querySelector(".live-who")!.textContent).toBe("Claude graph builderBatch 14 min");
    expect(builder.querySelector(".live-now")!.textContent).toBe("Editing the edges table");
    expect(panel.querySelector(".live-attention")!.textContent).toBe("Batch 1: Paused: Who founded the workshop?Open batch 1Resume");
    // A running agent can be paused or switched; a paused one resumed.
    expect([...builder.querySelectorAll("[data-agent-action]")].map((b) => b.textContent)).toEqual(["Pause", "Switch model"]);
    // jsdom has no popover support; the panel only needs to close.
    HTMLElement.prototype.hidePopover = vi.fn();
    panel.querySelector<HTMLElement>("[data-live-all]")!.click();
    expect(document.querySelector(".app-shell")!.getAttribute("data-workspace-view")).toBe("work");
    expect(document.querySelector('[data-investigation-section="activity"]')!.getAttribute("aria-current")).toBe("page");
  });
  it("pauses, resumes and switches running agents, saying what a switch costs, and asks about them when their role changes", async () => {
    const batch = state.investigations[0]!;
    state = transition(state, { type: "resume", investigationId: batch.id }).state;
    state = transition(state, { type: "claim", investigationId: batch.id, worker: "Claude Code researcher" }).state;
    const assignmentId = state.investigations[0]!.assignments![0]!.id;
    state.catalog = catalog;
    state.dispatch = { ...defaultDispatch("claude"), roles: { researcher: { agent: "claude", model: "opus", effort: null } } };
    state.live = [{ role: "researcher", name: "Claude researcher", investigationId: batch.id, assignmentId, task: "Who founded the workshop?", choice: { agent: "claude", model: "opus", effort: null }, tokens: 84_000, startedAt: new Date().toISOString(), latest: { at: new Date().toISOString(), text: "Reading the register" } }];
    mount();
    HTMLElement.prototype.hidePopover = vi.fn();
    HTMLDialogElement.prototype.showModal = function () {
      this.open = true;
    };
    // The batch offers the same controls as the live panel.
    click('[data-view="work"]');
    const pass = document.querySelector(`#pass-${assignmentId} .pass-state`)!;
    expect([...pass.querySelectorAll("[data-agent-action]")].map((b) => b.textContent)).toEqual(["Pause", "Switch model"]);
    pass.querySelector<HTMLButtonElement>('[data-agent-action="pause"]')!.click();
    await vi.waitFor(() => expect(agentRequests).toEqual([{ action: "pause", ref: { kind: "researcher", assignmentId } }]));
    // Switching shows the cost of each choice before the human decides.
    document.querySelector<HTMLButtonElement>(`#pass-${assignmentId} [data-agent-action="switch"]`)!.click();
    const dialog = document.querySelector<HTMLDialogElement>(".agent-dialog")!;
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector("h2")!.textContent).toBe("Switch the Batch 1 researcher");
    expect(dialog.querySelector(".switch-cost")!.textContent).toBe("It already uses this.");
    select('.agent-dialog [data-field="model"]', "sonnet");
    expect(dialog.querySelector(".switch-cost")!.textContent).toBe("It keeps its conversation. Its next turn re-reads about 84k tokens of it without the cache.");
    select('.agent-dialog [data-field="agent"]', "codex");
    expect(dialog.querySelector(".switch-cost")!.textContent).toBe("Codex cannot take over Claude Code's conversation, so it starts again from its last checkpoint. Its saved files are kept.");
    dialog.querySelector<HTMLButtonElement>("[data-switch-confirm]")!.click();
    await vi.waitFor(() => expect(agentRequests.at(-1)).toEqual({ action: "switch", ref: { kind: "researcher", assignmentId }, choice: { agent: "codex", model: null, effort: null } }));
    expect(dialog.open).toBe(false);
    // Changing the researcher role asks about the researcher still on the old choice; leaving it is the default.
    click('[data-view="settings"]');
    select('[data-dispatch-role="researcher"] [data-field="model"]', "sonnet");
    await vi.waitFor(() => expect(dialog.open).toBe(true));
    expect(dialog.querySelector("h2")!.textContent).toBe("An agent is running on the old choice");
    expect(dialog.querySelector("legend")!.textContent).toBe("Batch 1 researcher");
    expect(dialog.querySelector<HTMLInputElement>('input[value="leave"]')!.checked).toBe(true);
    expect(dialog.querySelector(".switch-cost")!.textContent).toContain("re-reads about 84k tokens");
    dialog.querySelector<HTMLInputElement>('input[value="switch"]')!.checked = true;
    dialog.querySelector<HTMLButtonElement>("[data-follow-done]")!.click();
    await vi.waitFor(() => expect(agentRequests.at(-1)).toEqual({ action: "switch", ref: { kind: "researcher", assignmentId }, choice: { agent: "claude", model: "sonnet", effort: null } }));
  });
  it("says the service is unreachable and keeps the typed message", async () => {
    click("[data-open-coordinator]");
    const box = document.querySelector<HTMLTextAreaElement>("[data-message]")!;
    box.value = "Let us work inside this project";
    box.dispatchEvent(new Event("input", { bubbles: true }));
    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));
    click("[data-message-form] button[type=submit]");
    await vi.waitFor(() =>
      expect(document.querySelector(".form-error")!.textContent).toContain(
        "workspace service is not responding",
      ),
    );
    expect(document.querySelector(".coordinator-presence")!.textContent).toContain(
      "not responding",
    );
    // The message survives, so a reload does not lose what was typed.
    expect(document.querySelector<HTMLTextAreaElement>("[data-message]")!.value).toBe(
      "Let us work inside this project",
    );
    expect(JSON.parse(localStorage.getItem(`research-draft:${window.location.origin}`)!).message).toBe(
      "Let us work inside this project",
    );
  });
  it("keeps the unsent message with the project, so it comes back when the app opens at another address", async () => {
    click("[data-open-coordinator]");
    const box = document.querySelector<HTMLTextAreaElement>("[data-message]")!;
    box.value = "Check the 1871 directory";
    box.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => expect((projectDraft as any)?.message).toBe("Check the 1871 directory"));
    // At another address the browser has no copy; the project's comes back.
    localStorage.clear();
    document.body.replaceChildren();
    mount();
    click("[data-open-coordinator]");
    await vi.waitFor(() => expect(document.querySelector<HTMLTextAreaElement>("[data-message]")!.value).toBe("Check the 1871 directory"));
  });
  it("distinguishes a coordinator that is working from one that is listening", async () => {
    state.coordinator = {
      enabled: true,
      connected: false,
      attached: true,
      lastSeenSecondsAgo: 240,
      name: "Research coordinator",
      awaitingSynthesis: [],
    };
    mount();
    click("[data-open-coordinator]");
    expect(document.querySelector(".coordinator-presence")!.textContent).toContain(
      "Research coordinator is working, last seen 4 minutes ago",
    );
  });
  it("returns to the previous place after following a reference from a message", async () => {
    state = transition(state, {
      type: "reply",
      text: "See the workshop record.",
      references: [{ label: "The workshop", table: "nodes", recordId: "fictional-workshop" }],
    }).state;
    mount();
    click('[data-view="work"]');
    click("[data-open-coordinator]");
    click(".msg-links [data-reference]");
    expect(document.querySelector(".app-shell")!.getAttribute("data-workspace-view")).toBe("research");
    const back = document.querySelector<HTMLButtonElement>(".return-bar")!;
    expect(back.hidden).toBe(false);
    expect(back.textContent).toBe("← Back to Investigations");
    // A hash change on the way there does not count as returning.
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    expect(back.hidden).toBe(false);
    window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
    expect(document.querySelector(".app-shell")!.getAttribute("data-workspace-view")).toBe("research");
    history.back();
    await vi.waitFor(() => expect(document.querySelector(".app-shell")!.getAttribute("data-workspace-view")).toBe("work"));
    expect(back.hidden).toBe(true);
  });
  it("sends a single annotation immediately and keeps the rest of the queue", async () => {
    state = transition(state, { type: "queue-annotation", question: "Still thinking", references: [] }).state;
    mount();
    click("[data-open-coordinator]");
    click('[data-tab="queue"]');
    typeNote("Urgent question");
    click('[data-submit="now"]');
    await vi.waitFor(() => expect(state.conversation).toHaveLength(2));
    expect(state.conversation!.at(-1)!.annotations![0]!.question).toBe("Urgent question");
    expect(state.queue!.map((a) => a.question)).toEqual(["Still thinking"]);
    await vi.waitFor(() => expect(document.querySelector('[data-tab="conversation"]')!.getAttribute("aria-current")).toBe("page"));
  });
  it("keeps a coordinator restart request paused until the human chooses", async () => {
    const i = state.investigations[0]!;
    i.resumeRequest = {
      id: "resume-1",
      reason: "Compare the newly available source.",
      at: new Date().toISOString(),
      status: "pending",
    };
    mount();
    click('[data-view="work"]');
    expect(document.querySelector(".batch-request")!.textContent).toContain(i.resumeRequest.reason);
    expect(document.querySelector('[data-command="resume"]')).toBeNull();
    click('[data-resume-decision="decline"]');
    await vi.waitFor(() => expect(state.investigations[0]!.resumeRequest!.status).toBe("declined"));
    expect(state.investigations[0]!.status).toBe("paused");
    state.investigations[0]!.resumeRequest = { ...i.resumeRequest, id: "resume-2", status: "pending" };
    mount();
    click('[data-view="work"]');
    click('[data-resume-decision="approve"]');
    await vi.waitFor(() => expect(state.investigations[0]!.status).toBe("queued"));
  });
  it("saves an optional time limit and restores unlimited research", async () => {
    click('[data-view="settings"]');
    expect(
      document.querySelector<HTMLSelectElement>("#research-time-limit-mode")!
        .value,
    ).toBe("none");
    expect(
      document.querySelector<HTMLInputElement>("#research-time-limit")!
        .disabled,
    ).toBe(true);
    select("#research-time-limit-mode", "limited");
    const input = document.querySelector<HTMLInputElement>(
      "#research-time-limit",
    )!;
    expect(input.disabled).toBe(false);
    input.value = "25";
    click("#time-limit-form button");
    await vi.waitFor(() =>
      expect(state.researchSettings?.timeLimitMinutes).toBe(25),
    );
    await vi.waitFor(() =>
      expect(
        document.querySelector<HTMLSelectElement>("#research-time-limit-mode")!
          .value,
      ).toBe("limited"),
    );
    select("#research-time-limit-mode", "none");
    click("#time-limit-form button");
    await vi.waitFor(() =>
      expect(state.researchSettings?.timeLimitMinutes).toBeNull(),
    );
    expect(state.investigations[0]!.status).toBe("paused");
  });
  it("shows project-wide findings by batch and research pass, with the coordinator's direction, reports and activity", () => {
    const batch = state.investigations[0]!;
    const pass = batch.assignments![0]!;
    Object.assign(pass, { status: "done", worker: "Claude Code researcher", startedAt: "2026-01-01T00:00:00.000Z", endedAt: "2026-01-02T00:00:00.000Z" });
    pass.steering.push({ at: "2026-01-01T12:00:00.000Z", message: "Check the tax roll as well." });
    batch.status = "review";
    batch.proposals.push({
      id: "report-1",
      kind: "findings",
      revision: 1,
      title: "The founder of the fictional workshop",
      summary: "The register names the founder; the tax roll agrees.",
      ambiguity: "",
      evidence: [],
      changes: [],
      findings: ["one", "two", "three", "four", "five"].map((n) => ({
        id: `f-${n}`,
        statement: `Finding ${n}`,
        qualification: "reported" as const,
        explanation: `Explanation ${n}`,
        evidenceIds: [],
      })),
      addressedAnnotationIds: [],
      assignmentId: pass.id,
      createdAt: "2026-01-02T00:00:00.000Z",
      status: "pending",
    });
    // A second pass, waiting, with a brief too long to show whole.
    batch.assignments!.push({ id: "second", title: "Where was the workshop?", brief: `Find the address. ${"Read every directory. ".repeat(40)}`, status: "waiting", createdAt: "2026-01-03T00:00:00.000Z", checkpoints: [], steering: [] });
    batch.board = [{ id: "post", at: "2026-01-01T13:00:00.000Z", assignmentId: pass.id, text: "The tax roll for 1871 is missing." }];
    mount();
    click('[data-view="work"]');
    expect(document.querySelector(".investigation-picker")).toBeNull();
    expect(document.querySelector(".batch-label")!.textContent).toBe("Batch 1 · in progress");
    expect(document.querySelector(".batch-card h2")!.textContent).toBe("The workshop's founder");
    expect(document.querySelector(".findings-toc")!.textContent).toContain("Who founded the workshop?");
    expect(document.querySelector(".findings-toc")!.textContent).toContain("Where was the workshop? · waiting");
    // The newest pass comes first, in the contents as on the page.
    expect([...document.querySelectorAll(".batch-question h3")].map((h) => h.textContent)).toEqual(["Where was the workshop?", "Who founded the workshop?"]);
    const question = document.getElementById(`pass-${pass.id}`)!;
    expect(question.querySelector(".pass-state")!.textContent).toMatch(/^Claude Code researcher · returned /);
    expect(question.querySelector(".asked")!.textContent).toContain("The coordinator's brief");
    expect(question.querySelector(".asked blockquote")!.textContent).toBe("Read the fictional register entry and name the founder.");
    expect(question.querySelector(".steering")!.textContent).toContain("Check the tax roll as well.");
    expect(question.querySelector(".report summary")!.textContent).toBe("The founder of the fictional workshop");
    expect(question.querySelector(".report-summary")!.textContent).toBe(
      "The register names the founder; the tax roll agrees.",
    );
    expect(question.querySelectorAll(".finding-list article")).toHaveLength(3);
    click("[data-more-findings]");
    expect(document.querySelectorAll(".batch-question .finding-list article")).toHaveLength(5);
    // A long brief opens on request.
    const second = () => document.getElementById("pass-second")!;
    expect(second().querySelector(".pass-state")!.textContent).toBe("Waiting for a researcher.");
    expect(second().querySelector("blockquote.is-clipped")).not.toBeNull();
    click("[data-whole-brief]");
    expect(second().querySelector("blockquote.is-clipped")).toBeNull();
    expect(second().querySelector("[data-whole-brief]")).toBeNull();
    // What the researchers told each other closes the batch.
    expect(document.querySelector(".batch-board summary")!.textContent).toBe("What the researchers told each other · 1 post");
    expect(document.querySelector(".batch-board li")!.textContent).toContain("The tax roll for 1871 is missing.");
    click('[data-investigation-section="activity"]');
    expect(document.querySelector(".activity-list")!.textContent).toContain("Coordinator opened this batch.");
    expect(document.querySelector(".activity-list")!.textContent).toContain("Batch 1");
    // The Board tab gathers every batch's board, with who wrote each post.
    state.investigations[0]!.board!.push({ id: "c", at: "2026-01-01T14:00:00.000Z", author: "coordinator", text: "Use the 1871 census instead." });
    mount();
    click('[data-view="work"]');
    click('[data-investigation-section="board"]');
    expect(document.querySelector(".board-batch h2")!.textContent).toBe("Batch 1 The workshop's founder");
    expect([...document.querySelectorAll(".board-batch .board-who")].map((w) => w.textContent!.split(" · ")[0])).toEqual([
      'The researcher on "Who founded the workshop?"',
      "Your coordinator",
    ]);
  });
  it("lists batches in Review and requests a walkthrough and one graph update at a time", async () => {
    const batch = state.investigations[0]!;
    batch.status = "review";
    batch.readyAt = "2026-01-02T00:00:00.000Z";
    batch.proposals.push({
      id: "report-1",
      kind: "findings",
      revision: 1,
      title: "The founder",
      summary: "The register names the founder.",
      ambiguity: "",
      evidence: [],
      changes: [],
      findings: [{ id: "f", statement: "A founder is named.", qualification: "reported", explanation: "", evidenceIds: [] }],
      addressedAnnotationIds: batch.annotations.map((a) => a.id),
      createdAt: "2026-01-02T00:00:00.000Z",
      status: "pending",
    });
    mount();
    click('[data-view="review"]');
    const row = () => document.querySelector(".review-row")!;
    expect(row().textContent).toContain("Ready for review");
    expect(row().textContent).toContain("Batch 1 · The workshop's founder");
    click('[data-review-request="walkthrough"]');
    await vi.waitFor(() => expect(state.investigations[0]!.walkthroughRequestedAt).toBeTruthy());
    await vi.waitFor(() => expect(row().textContent).toContain("Waiting for your coordinator to assign a writer."));
    click('[data-review-request="graph"]');
    await vi.waitFor(() => expect(state.investigations[0]!.reviewFlow!.jobs).toHaveLength(1));
    await vi.waitFor(() => expect(row().textContent).toContain("Waiting for the coordinator to brief a graph builder."));
    expect(document.querySelector('[data-review-request="graph"]')).toBeNull();
    const toggle = document.querySelector<HTMLInputElement>('[data-auto="autoWalkthrough"]')!;
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => expect(state.reviewSettings).toEqual({ autoWalkthrough: true, autoGraph: false }));
  });
  it("offers feedback about Weir itself only in developer mode, and annotation only of research objects without it", async () => {
    mount();
    const feedbackButton = document.querySelector<HTMLElement>(".feedback-destination")!;
    const canAnnotate = (element: Element) => (window as any).lavishUnifiedFeedback.canAnnotate(element);
    expect(feedbackButton.hidden).toBe(true);
    expect(canAnnotate(document.querySelector(".app-header h1")!)).toBe(false);
    click('[data-view="work"]');
    expect(canAnnotate(document.querySelector(".batch-card h2")!)).toBe(true);
    click("[data-open-coordinator]");
    click('[data-tab="queue"]');
    expect(document.querySelector("[data-feedback]")).toBeNull();
    // Research settings turns it on for the whole app.
    click('[data-view="settings"]');
    const box = document.querySelector<HTMLInputElement>("#developer-mode")!;
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => expect(feedbackButton.hidden).toBe(false));
    expect(state.developerMode).toBe(true);
    expect(canAnnotate(document.querySelector(".app-header h1")!)).toBe(true);
  });
  it("introduces annotating once, beside the Annotate switch, and Try it turns it on", async () => {
    mount();
    const intro = document.querySelector<HTMLElement>(".annotate-intro")!;
    await vi.waitFor(() => expect(intro.hidden).toBe(false));
    expect(intro.textContent).toContain("Point at anything and ask about it");
    click("[data-intro-try]");
    expect(intro.hidden).toBe(true);
    expect(document.querySelector("[data-annotate]")!.getAttribute("aria-checked")).toBe("true");
    await vi.waitFor(() => expect(state.annotationIntroSeen).toBe(true));
    // Seen once, it stays away, in this project or any other.
    mount();
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(document.querySelector<HTMLElement>(".annotate-intro")!.hidden).toBe(true);
  });
  it("keeps repeated feedback saves out of research and remembers the choice", async () => {
    state.developerMode = true;
    mount();
    const annotations = state.investigations[0]!.annotations.length;
    click("[data-open-coordinator]");
    click('[data-tab="queue"]');
    click("[data-feedback]");
    for (const text of ["Clarify the status", "Simplify the labels"]) {
      typeNote(text);
      click('[data-submit="feedback"]');
      await vi.waitFor(() => expect(document.querySelector<HTMLTextAreaElement>("[data-note]")!.value).toBe(""));
    }
    expect(state.interfaceFeedback!.map((f) => f.text)).toEqual(["Clarify the status", "Simplify the labels"]);
    expect(state.queue || []).toHaveLength(0);
    expect(state.investigations[0]!.annotations).toHaveLength(annotations);
    expect(document.querySelector('[data-count="feedback"]')!.textContent).toBe("2");
    mount();
    click("[data-open-coordinator]");
    click('[data-tab="queue"]');
    expect(document.querySelector<HTMLInputElement>("[data-feedback]")!.checked).toBe(true);
  });
});
