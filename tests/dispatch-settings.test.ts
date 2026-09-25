import { describe, expect, it } from "vitest";
import { changeDispatch, defaultDispatch, type Catalog } from "../src/domain/dispatch";
import { dispatchSettings, rowChoice } from "../src/ui/dispatch-settings";

// A fictional catalog: both CLIs installed, with a small model list each.
const catalog: Catalog = {
  agents: [
    { id: "claude", label: "Claude Code", installed: true, efforts: ["low", "high"], models: [{ id: "opus", label: "Opus", efforts: ["low", "high"] }, { id: "haiku", label: "Haiku", efforts: ["low", "high"] }] },
    { id: "codex", label: "Codex", installed: true, efforts: ["low", "medium"], models: [{ id: "gpt-6-sol", label: "GPT-6-Sol", efforts: ["low", "medium"] }] },
  ],
};
const render = (doc = defaultDispatch("claude")) => {
  document.body.innerHTML = dispatchSettings(doc, catalog);
  return document.body;
};
const values = (row: Element) => [...row.querySelectorAll("select")].map((s) => (s as HTMLSelectElement).value);

describe("who does which job, in settings", () => {
  it("shows every role, following the default until the human chooses otherwise", () => {
    const page = render();
    expect([...page.querySelectorAll(".dispatch-job span")].map((s) => s.textContent)).toEqual([
      "Default",
      "Coordinator",
      "Researcher",
      "Graph builder",
      "Walkthrough writer",
      "Helper",
    ]);
    expect(values(page.querySelector('[data-dispatch-role="default"]')!)).toEqual(["claude", "", ""]);
    const helper = page.querySelector('[data-dispatch-role="helper"]')!;
    expect(values(helper)).toEqual(["", "", ""]);
    // A role following the default has no model or effort of its own to choose.
    expect((helper.querySelector('[data-field="model"]') as HTMLSelectElement).disabled).toBe(true);
    expect(helper.textContent).toContain("Small tasks the coordinator hands off");
    expect(page.textContent).toContain("ask the coordinator in the conversation");
  });

  it("shows the entries and rules the coordinator added", () => {
    const now = "2026-09-25T12:00:00.000Z";
    let doc = changeDispatch(defaultDispatch("claude"), { action: "set-role", role: "researcher", agent: "codex", model: "gpt-6-sol", effort: "medium" }, catalog, "coordinator", () => "r1", now);
    doc = changeDispatch(doc, { action: "add-rule", role: "helper", when: "a quick lookup", agent: "claude", model: "haiku", reason: "The human wants lookups cheap." }, catalog, "coordinator", () => "r2", now);
    const page = render(doc);
    expect(values(page.querySelector('[data-dispatch-role="researcher"]')!)).toEqual(["codex", "gpt-6-sol", "medium"]);
    const rule = page.querySelector(".dispatch-rules li")!;
    expect(rule.textContent).toContain("Helper, when a quick lookup: Claude Code, Haiku, its default effort.");
    expect(rule.textContent).toContain("Added by the coordinator.");
    expect(rule.querySelector("[data-remove-rule]")!.getAttribute("data-remove-rule")).toBe("r2");
  });

  it("lists only the models and efforts the chosen agent offers", () => {
    const page = render();
    const row = page.querySelector('[data-dispatch-role="default"]')!;
    const options = (field: string) => [...row.querySelectorAll(`[data-field="${field}"] option`)].map((o) => (o as HTMLOptionElement).value);
    expect(options("model")).toEqual(["", "opus", "haiku"]);
    expect(options("effort")).toEqual(["", "low", "high"]);
    // Switching agent starts from that agent's own defaults.
    (row.querySelector('[data-field="agent"]') as HTMLSelectElement).value = "codex";
    expect(rowChoice(row, catalog, "agent")).toEqual({ agent: "codex", model: null, effort: null });
  });

  it("marks an agent that is not installed and does not offer it", () => {
    document.body.innerHTML = dispatchSettings(defaultDispatch("claude"), {
      agents: [catalog.agents[0]!, { ...catalog.agents[1]!, installed: false, models: [], efforts: [] }],
    });
    const codex = document.querySelector('[data-dispatch-role="default"] [data-field="agent"] option[value="codex"]') as HTMLOptionElement;
    expect(codex.textContent).toBe("Codex (not installed)");
    expect(codex.disabled).toBe(true);
  });
});
