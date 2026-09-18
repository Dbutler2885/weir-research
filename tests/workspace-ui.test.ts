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
  it("preserves a draft while browsing the queue and selecting references in one sidebar", async () => {
    click('[data-view="work"]');
    click("[data-add-instruction]");
    const textarea = document.querySelector<HTMLTextAreaElement>(
      "#annotation-question",
    )!;
    textarea.value = "Compare these records";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    click('[data-drawer-tab="queue"]');
    expect(
      document.querySelector<HTMLElement>("#annotation-form")!.hidden,
    ).toBe(true);
    click('[data-drawer-tab="compose"]');
    expect(textarea.value).toBe("Compare these records");
    click("#annotation-mode");
    expect(document.body.classList.contains("research-annotating")).toBe(true);
    (window as any).lavishUnifiedFeedback.selectReference({
      text: "Fictional register entry",
      selector: ".investigation-heading",
    });
    expect(textarea.value).toBe("Compare these records");
    expect(
      document.querySelector("#annotation-selection")!.textContent,
    ).toContain("Fictional register entry");
    click("[data-close]");
    expect(document.body.classList.contains("research-annotating")).toBe(false);
    click("[data-add-instruction]");
    expect(textarea.value).toBe("Compare these records");
    click('#annotation-form button[value="queue"]');
    await vi.waitFor(() =>
      expect(state.investigations[0]!.annotations).toHaveLength(2),
    );
    await vi.waitFor(() =>
      expect(
        document.querySelector<HTMLElement>(".sidebar-queue")!.hidden,
      ).toBe(false),
    );
    expect(
      document.querySelector<HTMLDialogElement>("#notes-sidebar")!.open,
    ).toBe(true);
    expect(
      document.querySelector(".app-shell")!.getAttribute("data-workspace-view"),
    ).toBe("work");
  });
  it("keeps the queue in the notes sidebar and dispatches only the selected investigation", async () => {
    expect(document.querySelector('[data-count="queue"]')!.textContent).toBe(
      "",
    );
    const first = state.investigations[0]!.id;
    state = transition(state, {
      type: "annotate",
      investigationId: first,
      question: "Check the workshop register",
      dispatch: false,
    }).state;
    const added = transition(state, {
      type: "annotate",
      question: "Check another workshop",
      dispatch: false,
    });
    state = added.state;
    const second = state.investigations[1]!.id;
    mount();
    const queue = document.querySelector<HTMLButtonElement>(
      "[data-add-instruction]",
    )!;
    expect(queue.hidden).toBe(false);
    expect(
      document.querySelector(".workspace-nav #annotation-mode"),
    ).toBeNull();
    expect(queue.textContent).toContain("2");
    click('[data-view="sources"]');
    click("[data-add-instruction]");
    click('[data-drawer-tab="queue"]');
    expect(
      document.querySelector(".app-shell")!.getAttribute("data-workspace-view"),
    ).toBe("sources");
    expect(document.querySelectorAll(".queue-group")).toHaveLength(2);
    click(`[data-investigation-id="${second}"] [data-command="dispatch"]`);
    await vi.waitFor(() =>
      expect(
        state.investigations[1]!.annotations[0]!.dispatchedAt,
      ).toBeTruthy(),
    );
    expect(state.investigations[0]!.status).toBe("paused");
    expect(
      state.investigations[0]!.annotations.at(-1)!.dispatchedAt,
    ).toBeUndefined();
    await vi.waitFor(() =>
      expect(document.querySelector('[data-count="queue"]')!.textContent).toBe(
        "1",
      ),
    );
    click(`[data-investigation-id="${first}"] [data-delete-note]`);
    await vi.waitFor(() =>
      expect(document.querySelector('[data-count="queue"]')!.textContent).toBe(
        "",
      ),
    );
    expect(queue.hidden).toBe(false);
    expect(document.querySelector(".sidebar-queue")!.textContent).toContain(
      "No annotations waiting",
    );
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
  it("keeps repeated feedback saves out of research and makes them directly accessible", async () => {
    const annotations = state.investigations[0]!.annotations.length;
    const write = async (text: string) => {
      click("[data-add-instruction]");
      expect(
        document.querySelector<HTMLSelectElement>("#annotation-destination")!
          .value,
      ).toBe("interface");
      const input = document.querySelector<HTMLTextAreaElement>(
        "#annotation-question",
      )!;
      input.value = text;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      click('.annotation-dialog button[value="now"]');
      await vi.waitFor(() => expect(input.value).toBe(""));
      expect(
        document.querySelector<HTMLDialogElement>(".annotation-dialog")!.open,
      ).toBe(true);
    };
    click("[data-add-instruction]");
    select("#annotation-destination", "interface");
    click(".annotation-dialog [data-close]");
    await write("Clarify the status");
    await write("Simplify the labels");
    expect(state.interfaceFeedback).toHaveLength(2);
    expect(state.investigations[0]!.annotations).toHaveLength(annotations);
    expect(state.investigations[0]!.status).toBe("paused");
    expect(document.querySelector('[data-count="feedback"]')!.textContent).toBe(
      "2",
    );
    click(".research-toast button");
    expect(document.querySelector(".feedback-page")!.textContent).toContain(
      "Simplify the labels",
    );
    mount();
    click("[data-add-instruction]");
    expect(
      document.querySelector<HTMLSelectElement>("#annotation-destination")!
        .value,
    ).toBe("interface");
  });
});
