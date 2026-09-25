// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  initialState,
  transition,
  type ResearchState,
} from "../src/domain/research";
import empty from "../src/data/empty.json";
import { mountResearchWorkspace } from "../src/research-workspace";
import { flowCommand } from "../server/review-flow.mjs";
vi.mock("../src/vendor/lavish/artifact-sdk.js", () => ({
  createArtifactSdk: vi.fn(),
  deriveLavishQueueKey: vi.fn(),
}));
vi.mock("../src/ui/organization-panel", () => ({
  mountOrganizationPanel: vi.fn(),
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
beforeEach(() => {
  localStorage.clear();
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
    questions: [
      {
        title: "Who founded the workshop?",
        annotationIds: [state.conversation![0]!.annotations![0]!.id],
      },
    ],
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
      if (path === "/api/review-settings") {
        state.reviewSettings = JSON.parse(options.body);
        return { ok: true, json: async () => state.reviewSettings };
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
    click("[data-add-instruction]");
    expect(document.querySelector('[data-tab="conversation"]')!.getAttribute("aria-current")).toBe("page");
    // Opening the drawer is the switch: the page is annotatable while it is open.
    expect(document.body.classList.contains("research-annotating")).toBe(true);
    click('[data-tab="queue"]');
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
    expect(document.body.classList.contains("research-annotating")).toBe(false);
    click("[data-add-instruction]");
    expect(document.querySelector<HTMLTextAreaElement>("[data-note]")!.value).toBe("Compare these records");
    click('[data-submit="queue"]');
    await vi.waitFor(() => expect(state.queue).toHaveLength(1));
    expect(state.queue![0]!.references![0]!.label).toBe("Fictional register entry");
    expect(state.investigations).toHaveLength(investigations);
    await vi.waitFor(() => expect(document.querySelector(".queue-item")!.textContent).toContain("Compare these records"));
    expect(document.querySelector<HTMLTextAreaElement>("[data-note]")!.value).toBe("");
    expect(document.querySelector(".app-shell")!.getAttribute("data-workspace-view")).toBe("work");
  });
  it("sends the queue as one message and shows coordinator replies and decisions", async () => {
    for (const question of ["Check the workshop register", "Check another workshop"])
      state = transition(state, { type: "queue-annotation", question, references: [] }).state;
    mount();
    expect(document.querySelector('[data-count="queue"]')!.textContent).toBe("");
    click("[data-add-instruction]");
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
    const badge = document.querySelector('[data-count="queue"]')!;
    expect(badge.textContent).toBe("2");
    expect(badge.classList.contains("alert")).toBe(true);
    click("[data-add-instruction]");
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
    expect(document.querySelector('[data-count="queue"]')!.textContent).toBe("1");
  });
  it("says in the conversation whether a coordinator is listening", async () => {
    state.coordinator = { enabled: true, connected: false, name: null, handoff: "", awaitingSynthesis: [] };
    mount();
    click("[data-add-instruction]");
    expect(document.querySelector(".coordinator-presence")!.textContent).toContain("No coordinator is attached");
    state.coordinator = { enabled: true, connected: true, name: "Research coordinator", handoff: "", awaitingSynthesis: [] };
    await poll();
    await vi.waitFor(() =>
      expect(document.querySelector(".coordinator-presence")!.textContent).toContain("Research coordinator is listening"),
    );
  });
  it("shows research running now from every tab", async () => {
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
    expect(indicator.textContent).toBe("1 graph update building");
    // The line opens a panel saying who is working and what each is doing.
    expect(indicator.getAttribute("popovertarget")).toBe("live-panel");
    const panel = document.getElementById("live-panel")!;
    panel.dispatchEvent(Object.assign(new Event("beforetoggle"), { newState: "open" }));
    const [researcher, builder] = panel.querySelectorAll(".live-now li");
    expect(researcher!.textContent).toBe("ResearcherBatch 1Paused. Investigation paused; saved findings retained.");
    expect(builder!.querySelector(".live-who")!.textContent).toBe("Claude graph builderBatch 14 min");
    expect(builder!.querySelector(".live-stage")!.textContent).toBe("Building a connected graph.");
    expect(builder!.querySelector(".live-latest")!.textContent).toBe("Editing the edges table");
    expect(panel.querySelector(".live-recent")!.textContent).toContain("Investigation paused");
    // jsdom has no popover support; the panel only needs to close.
    HTMLElement.prototype.hidePopover = vi.fn();
    panel.querySelector<HTMLElement>("[data-live-all]")!.click();
    expect(document.querySelector(".app-shell")!.getAttribute("data-workspace-view")).toBe("work");
    expect(document.querySelector('[data-investigation-section="activity"]')!.getAttribute("aria-current")).toBe("page");
  });
  it("says the service is unreachable and keeps the typed message", async () => {
    click("[data-add-instruction]");
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
  it("distinguishes a coordinator that is working from one that is listening", async () => {
    state.coordinator = {
      enabled: true,
      connected: false,
      attached: true,
      lastSeenSecondsAgo: 240,
      name: "Research coordinator",
      handoff: "",
      awaitingSynthesis: [],
    };
    mount();
    click("[data-add-instruction]");
    expect(document.querySelector(".coordinator-presence")!.textContent).toContain(
      "Research coordinator is working, last seen 4 minutes ago",
    );
  });
  it("returns to the previous place after following a reference from a message", async () => {
    state = transition(state, {
      type: "reply",
      text: "See the workshop record.",
      references: [{ label: "The workshop", table: "contextEntities", recordId: "fictional-workshop" }],
    }).state;
    mount();
    click('[data-view="work"]');
    click("[data-add-instruction]");
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
    click("[data-add-instruction]");
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
    click('[data-view="work"]');
    click("[data-open-settings]");
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
  it("shows project-wide findings by batch and question, with reports and activity", () => {
    const batch = state.investigations[0]!;
    batch.executions = [{ at: "2026-01-01T00:00:00.000Z", worker: "Claude Code researcher", provider: "claude", model: "" }];
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
      addressedAnnotationIds: batch.annotations.map((a) => a.id),
      createdAt: "2026-01-02T00:00:00.000Z",
      status: "pending",
    });
    mount();
    click('[data-view="work"]');
    expect(document.querySelector(".investigation-picker")).toBeNull();
    expect(document.querySelector(".batch-label")!.textContent).toBe("Batch 1 · paused");
    expect(document.querySelector(".batch-card h2")!.textContent).toBe("The workshop's founder");
    expect(document.querySelector(".findings-toc")!.textContent).toContain("Who founded the workshop?");
    const question = document.querySelector(".batch-question")!;
    expect(question.querySelector("h3")!.textContent).toBe("Who founded the workshop?");
    expect(question.querySelector(".asked")!.textContent).toContain('On "Fictional register entry" you wrote:');
    expect(question.querySelector("blockquote")!.textContent).toBe("This is the question");
    expect(question.querySelector(".report summary")!.textContent).toBe("The founder of the fictional workshop");
    expect(question.querySelector(".report-by")!.textContent).toContain("Returned by Claude Code researcher");
    expect(question.querySelector(".report-summary")!.textContent).toBe(
      "The register names the founder; the tax roll agrees.",
    );
    expect(question.querySelectorAll(".finding-list article")).toHaveLength(3);
    click("[data-more-findings]");
    expect(document.querySelectorAll(".batch-question .finding-list article")).toHaveLength(5);
    click('[data-investigation-section="activity"]');
    expect(document.querySelector(".activity-list")!.textContent).toContain("paused");
    expect(document.querySelector(".activity-list")!.textContent).toContain("Batch 1");
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
    await vi.waitFor(() => expect(row().textContent).toContain("Waiting for the coordinator to assign a graph builder."));
    expect(document.querySelector('[data-review-request="graph"]')).toBeNull();
    const toggle = document.querySelector<HTMLInputElement>('[data-auto="autoWalkthrough"]')!;
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => expect(state.reviewSettings).toEqual({ autoWalkthrough: true, autoGraph: false }));
  });
  it("keeps repeated feedback saves out of research and remembers the choice", async () => {
    const annotations = state.investigations[0]!.annotations.length;
    click("[data-add-instruction]");
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
    click("[data-add-instruction]");
    click('[data-tab="queue"]');
    expect(document.querySelector<HTMLInputElement>("[data-feedback]")!.checked).toBe(true);
  });
});
