// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { GraphModel } from "../src/domain/model";
import { nodeView, statementView } from "../src/domain/node-view";
import { renderNodePanel, renderStatementPanel } from "../src/ui/details-panel";
import type { GraphDataset, ResearchClaim } from "../src/domain/types";

// Explicitly fictional: an invented cannery in an imaginary cove, and its founder.
const fact = (id: string, predicate: string, value: string, time: string | null, qualification: ResearchClaim["qualification"] = "supported", refs: string[] = []): ResearchClaim => ({
  id, subjectId: "cannery", predicate, object: { value }, qualification, time, reasoning: `Why ${id}.`, evidence: refs.map((ref) => ({ ref, role: "supports" as const })),
});
const graph: GraphDataset = {
  version: 3,
  title: "Example Cove",
  initialFocusId: "cannery",
  nodes: [
    { id: "cannery", name: "Example Cove cannery", type: "cannery", dates: "1880 to 1893", summary: "The first cannery at Example Cove.\n\nIt traded under three names.", sourceIds: ["survey"] },
    { id: "founder", name: "Ada Example", type: "person" },
    { id: "cove", name: "Example Cove", type: "place" },
  ],
  types: [
    { name: "cannery", color: "clay", shape: "square", fields: [{ name: "built", value: "date" }, { name: "trading_name", value: "text" }, { name: "workers", value: "text" }, { name: "closed", value: "date" }] },
    { name: "person", fields: [] },
    { name: "place", fields: [] },
  ],
  relationships: [{ name: "established", reverse: "founded by", arrangement: "free" }],
  claims: [
    fact("name-late", "trading_name", "Cove Packing Co.", "1887 to 1893"),
    fact("built", "built", "Fall 1880", "fall 1880", "supported", ["survey-passage"]),
    fact("name-early", "trading_name", "Example Packing Company", "1880"),
    fact("name-middle", "Trading Name", "Example & Example", "1882 to 1885", "inferred"),
    fact("workers", "workers", "About 200", "May 1882", "reported"),
    fact("season", "season_start", "Before the other plants", "May 1882", "reported"),
    { id: "founded", subjectId: "founder", predicate: "established", object: { entityId: "cannery" }, qualification: "reported", time: "1880", reasoning: "Two later accounts name her.\n\nA deed would settle it.", evidence: [{ ref: "survey-passage", role: "supports" }, { ref: "history-passage", role: "context" }], sourceIds: ["directory"] },
    { id: "located", subjectId: "cannery", predicate: "located_in", object: { entityId: "cove" }, qualification: "supported", time: null, reasoning: "", evidence: [] },
  ],
  evidence: [
    { id: "survey-passage", sourceId: "survey", quote: "A cannery was built at Example Cove in the fall of 1880.", context: "The town's paragraph on fishing.", locator: "Page 34", interpretation: "" },
    { id: "history-passage", sourceId: "history", quote: "The Example family were involved.", context: "", locator: "Chapter 2", interpretation: "" },
  ],
  sources: [
    { id: "survey", title: "Fictional fisheries survey" },
    { id: "history", title: "Fictional town history" },
    { id: "directory", title: "Fictional directory" },
  ],
};
const model = new GraphModel(graph);

describe("a node's view", () => {
  const view = nodeView(model, "cannery");

  it("files facts under their fields in date order, marking only what is not fully supported", () => {
    expect(view.fields.map((f) => [f.label, f.rows.map((r) => [r.value, r.when, r.qualification])])).toEqual([
      ["Built", [["Fall 1880", "fall 1880", undefined]]],
      ["Trading name", [["Example Packing Company", "1880", undefined], ["Example & Example", "1882 to 1885", "inferred"], ["Cove Packing Co.", "1887 to 1893", undefined]]],
      ["Workers", [["About 200", "May 1882", "reported"]]],
      ["Closed", []],
    ]);
  });

  it("keeps facts no field defines, and connections read from this node", () => {
    expect(view.other.map((r) => [r.label, r.value])).toEqual([["Season start", "Before the other plants"]]);
    expect(view.connections.map((r) => [r.label, r.value, r.nodeId])).toEqual([
      ["Founded by", "Ada Example", "founder"],
      ["Located in", "Example Cove", "cove"],
    ]);
    expect(nodeView(model, "founder").connections.map((r) => r.label)).toEqual(["Established"]);
  });

  it("gathers every source the node and its statements cite", () => {
    expect(view.sources.map((s) => s.id).sort()).toEqual(["directory", "history", "survey"]);
    expect(view).toMatchObject({ type: "cannery", look: { color: "clay", shape: "square" }, dates: "1880 to 1893" });
  });
});

describe("a statement's view", () => {
  it("names both ends of a connection and brings its evidence and reasoning", () => {
    const view = statementView(model, "founded");
    expect(view).toMatchObject({
      kind: "connection",
      heading: "Connection",
      subject: { id: "founder", name: "Ada Example" },
      verb: "established",
      object: { id: "cannery", name: "Example Cove cannery" },
      when: "1880",
      qualification: "reported",
    });
    expect(view.evidence.map((e) => [e.role, e.source?.title, e.locator])).toEqual([
      ["Supports", "Fictional fisheries survey", "Page 34"],
      ["Background", "Fictional town history", "Chapter 2"],
    ]);
    expect(view.sources.map((s) => s.id)).toEqual(["directory"]);
  });

  it("heads a fact with its field", () => {
    expect(statementView(model, "name-middle")).toMatchObject({ kind: "fact", heading: "Trading name", object: { value: "Example & Example" } });
    expect(statementView(model, "season")).toMatchObject({ heading: "Season start" });
  });
});

describe("the panels", () => {
  const handlers = () => ({ onClose: vi.fn(), onOpenNode: vi.fn(), onOpenStatement: vi.fn() });

  it("shows a node's summary, fields with gaps, connections and sources, each row opening its statement", () => {
    const panel = document.createElement("aside");
    const on = handlers();
    renderNodePanel(panel, nodeView(model, "cannery"), on);
    const kickers = [...panel.querySelectorAll(".detail-kicker")].map((k) => k.textContent);
    expect(kickers).toEqual(["Details", "Connections", "Also recorded", "Sources · 3"]);
    expect([...panel.querySelectorAll(".detail-summary p")].map((p) => p.textContent)).toEqual(["The first cannery at Example Cove.", "It traded under three names."]);
    const gap = panel.querySelector<HTMLButtonElement>(".is-gap")!;
    expect(gap.textContent).toContain("Closed");
    const asked = vi.fn();
    window.addEventListener("research:ask", (event) => asked((event as CustomEvent).detail));
    gap.click();
    expect(asked).toHaveBeenCalledWith(expect.objectContaining({ table: "nodes", recordId: "cannery", label: "Example Cove cannery: closed" }));
    panel.querySelector<HTMLButtonElement>('[data-claim-id="workers"]')!.click();
    expect(on.onOpenStatement).toHaveBeenCalledWith("workers");
    // A repeated field's later rows do not repeat its label.
    expect(panel.querySelectorAll(".statement-row.is-continued")).toHaveLength(2);
  });

  it("asks for a summary where a node has none", () => {
    const panel = document.createElement("aside");
    renderNodePanel(panel, nodeView(model, "cove"), handlers());
    expect(panel.querySelector(".detail-summary .is-gap")?.textContent).toContain("Summary");
  });

  it("shows a statement as a sentence with its reasoning and evidence, and goes back to the node it came from", () => {
    const panel = document.createElement("aside");
    const on = handlers();
    renderStatementPanel(panel, statementView(model, "founded"), on, { id: "cannery", name: "Example Cove cannery" });
    expect(panel.querySelector(".statement-title")?.textContent).toBe("Ada Example established Example Cove cannery");
    expect(panel.querySelector(".statement-why")?.textContent).toBe("Why reported. Two later accounts name her.A deed would settle it.");
    expect([...panel.querySelectorAll(".evidence-role")].map((e) => e.textContent)).toEqual(["Supports", "Background"]);
    const open = panel.querySelector<HTMLButtonElement>("[data-inspect-source]")!;
    expect(open.dataset).toMatchObject({ inspectSource: "survey", inspectQuote: "A cannery was built at Example Cove in the fall of 1880." });
    panel.querySelector<HTMLButtonElement>(".detail-back")!.click();
    expect(on.onOpenNode).toHaveBeenCalledWith("cannery");
    const context = panel.querySelector<HTMLElement>(".evidence-context")!;
    expect(context.hidden).toBe(true);
    [...panel.querySelectorAll<HTMLButtonElement>(".evidence-link")].find((b) => b.textContent === "Context")!.click();
    expect(context.hidden).toBe(false);
  });
});
