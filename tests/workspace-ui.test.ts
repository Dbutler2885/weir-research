// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  initialState,
  transition,
  type ResearchState,
} from "../src/domain/research";
import empty from "../src/data/empty.json";
import { mountResearchWorkspace } from "../src/research-workspace";
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
    type: "annotate",
    question: "This is the question",
    target: { label: state.dataset.title, text: state.dataset.title },
    references: [{ label: state.dataset.title, text: state.dataset.title }],
    dispatch: true,
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
    click('[data-tab="queue"]');
    typeNote("Compare these records");
    click('[data-tab="conversation"]');
    click('[data-tab="queue"]');
    expect(document.querySelector<HTMLTextAreaElement>("[data-note]")!.value).toBe("Compare these records");
    click("[data-select]");
    expect(document.body.classList.contains("research-annotating")).toBe(true);
    (window as any).lavishUnifiedFeedback.selectReference({
      text: "Fictional register entry",
      selector: ".investigation-heading",
    });
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
    await vi.waitFor(() => expect(state.conversation).toHaveLength(1));
    expect(state.conversation![0]!.annotations!.map((a) => a.question)).toEqual(["Check another workshop"]);
    expect(state.queue).toHaveLength(0);
    await vi.waitFor(() => expect(document.querySelector(".msg-you")!.textContent).toContain("You sent 1 annotation"));
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
  it("sends a single annotation immediately and keeps the rest of the queue", async () => {
    state = transition(state, { type: "queue-annotation", question: "Still thinking", references: [] }).state;
    mount();
    click("[data-add-instruction]");
    click('[data-tab="queue"]');
    typeNote("Urgent question");
    click('[data-submit="now"]');
    await vi.waitFor(() => expect(state.conversation).toHaveLength(1));
    expect(state.conversation![0]!.annotations![0]!.question).toBe("Urgent question");
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
    expect(document.querySelector(".resume-approval")!.textContent).toContain(
      i.resumeRequest.reason,
    );
    expect(document.querySelector('[data-command="resume"]')).toBeNull();
    expect(state.investigations[0]!.status).toBe("paused");
    click('[data-resume-decision="decline"]');
    await vi.waitFor(() =>
      expect(state.investigations[0]!.resumeRequest!.status).toBe("declined"),
    );
    expect(state.investigations[0]!.status).toBe("paused");
    state.investigations[0]!.resumeRequest = {
      ...i.resumeRequest,
      id: "resume-2",
      status: "pending",
    };
    mount();
    click('[data-view="work"]');
    click('[data-resume-decision="approve"]');
    await vi.waitFor(() =>
      expect(state.investigations[0]!.status).toBe("queued"),
    );
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
  it("separates the selected subject from annotation wording and gives notes and history explicit destinations", () => {
    click('[data-view="work"]');
    expect(
      document.querySelector(".investigation-heading h1")!.textContent,
    ).toBe(state.dataset.title);
    expect(document.querySelector(".investigation-list")).toBeNull();
    expect(document.querySelector("#engine-form")).toBeNull();
    expect(
      document.querySelector(".research-surface")!.textContent,
    ).not.toContain("This is the question");
    click('[data-investigation-section="annotations"]');
    expect(document.querySelectorAll(".annotation-entry")).toHaveLength(1);
    expect(document.querySelector(".annotation-text")!.textContent).toBe(
      "This is the question",
    );
    expect(document.querySelectorAll(".note-reference")).toHaveLength(1);
    click('[data-investigation-section="activity"]');
    expect(document.querySelector(".activity-list")!.textContent).toContain(
      "paused",
    );
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
