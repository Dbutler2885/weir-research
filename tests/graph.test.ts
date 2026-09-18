import { describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/workshop.json";
import { GenealogyModel } from "../src/domain/model";
import { projectAround } from "../src/domain/projection";
import { layoutFamily } from "../src/layout/layout";
import {
  renderDetailsPanel,
  renderContextDetailsPanel,
} from "../src/ui/details-panel";
import type { FamilyDataset } from "../src/domain/types";
const dataset = () => structuredClone(fixture) as FamilyDataset;
const model = new GenealogyModel(dataset());
describe("fictional graph", () => {
  it("indexes family, aliases and independent historical connections", () => {
    expect(model.initialFocus?.name).toBe("Alex Example");
    expect(model.search("Lex").some((p) => p.id === "alex")).toBe(true);
    expect(model.search("tool maker").map((p) => p.id)).toEqual(["alex"]);
    expect(model.parentsOf("alex").map((p) => p.parentId)).toEqual([
      "casey",
      "drew",
    ]);
    expect(model.spousesOf("alex").map((p) => p.id)).toEqual(["blair"]);
    expect(model.parentsOf("blair")[0]?.confidence).toBe("disputed");
    expect(model.contextConnectionsForPerson("alex").map((e) => e.id)).toEqual([
      "employment",
    ]);
  });
  it("rejects duplicates and dangling endpoints", () => {
    const d = dataset();
    d.people.push({ ...d.people[0]! });
    expect(() => new GenealogyModel(d)).toThrow("Duplicate person");
    const u = dataset();
    u.unions[0]!.childIds = ["missing"];
    expect(() => new GenealogyModel(u)).toThrow("unknown person");
    const c = dataset();
    c.contextConnections![0]!.toId = "missing";
    expect(() => new GenealogyModel(c)).toThrow("unknown endpoint");
  });
  it("projects relative roles and changes them with focus", () => {
    const p = projectAround(model, "alex");
    expect(p.people.size).toBe(6);
    expect(p.people.get("alex")).toMatchObject({ role: "focus", distance: 0 });
    expect(p.people.get("erin")).toMatchObject({
      role: "sibling",
      distance: 1,
    });
    expect(p.people.get("fran")).toMatchObject({
      role: "child",
      generation: 1,
    });
    expect(projectAround(model, "fran").people.get("alex")?.role).toBe(
      "parent",
    );
  });
  it("routes mixed research relationships deterministically", async () => {
    const p = projectAround(model, "alex");
    const l = await layoutFamily(model, p);
    expect(l.nodes).toHaveLength(10);
    expect(l.edges).toHaveLength(10);
    expect(l.edges.every((e) => e.points.length >= 2)).toBe(true);
    expect(l.mode).toBe("network");
    expect(l.nodes.find((n) => n.id === "workshop")?.emphasis).toBe(
      "immediate",
    );
    expect(await layoutFamily(model, p)).toEqual(l);
    expect(await layoutFamily(model, projectAround(model, "fran"))).not.toEqual(
      l,
    );
  });
  it("retains generation order for a pure family tree", async () => {
    const data = dataset();
    data.contextConnections = [];
    data.contextEntities = [];
    const family = new GenealogyModel(data);
    const layout = await layoutFamily(family, projectAround(family, "alex"));
    expect(layout.mode).toBeUndefined();
    expect(layout.nodes.find(node => node.id === "casey")!.y).toBeLessThan(layout.nodes.find(node => node.id === "alex")!.y);
  });
  it("spreads a crowded research hub around the focus without overlapping cards", async () => {
    const data: FamilyDataset = {
      version: 1, title: "Fictional port", initialFocusId: "port", people: [], unions: [], sources: [],
      contextEntities: [
        {id: "port", name: "Example Port", kind: "place"},
        ...Array.from({length: 13}, (_, i) => ({id: `firm-${i}`, name: `Fictional firm ${i}`, kind: "organization" as const})),
      ],
      contextConnections: Array.from({length: 13}, (_, i) => ({id: `location-${i}`, fromId: `firm-${i}`, toId: "port", type: "location", label: "located in"})),
    };
    data.contextConnections!.push({id: "founding", fromId: "port", toId: "firm-0", type: "association", label: "established"});
    for (let i = 0; i < 6; i++) data.contextConnections!.push({id: `trade-${i}`, fromId: `firm-${i}`, toId: `firm-${i + 7}`, type: "association", label: "traded with"});
    const network = new GenealogyModel(data);
    const layout = await layoutFamily(network, projectAround(network, "port"));
    const focus = layout.nodes.find(node => node.id === "port")!;
    const quadrants = new Set(layout.nodes.filter(node => node !== focus).map(node => `${node.x > focus.x}:${node.y > focus.y}`));
    expect(quadrants.size).toBe(4);
    for (const node of layout.nodes) for (const other of layout.nodes) {
      if (node === other) continue;
      expect(node.x < other.x + other.width && node.x + node.width > other.x && node.y < other.y + other.height && node.y + node.height > other.y).toBe(false);
    }
    expect(layout.edges.find(edge => edge.id === "location-0")!.points[1]).not.toEqual(layout.edges.find(edge => edge.id === "founding")!.points[1]);
    expect(layout.edges.every(edge => edge.points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)))).toBe(true);
    for (const edge of layout.edges) {
      const samples = Array.from({length: 201}, (_, i) => {
        const t = i / 200;
        if (edge.curved) {
          const [a, c, b] = edge.points;
          return {x: (1 - t) ** 2 * a!.x + 2 * (1 - t) * t * c!.x + t ** 2 * b!.x, y: (1 - t) ** 2 * a!.y + 2 * (1 - t) * t * c!.y + t ** 2 * b!.y};
        }
        const segment = Math.min(edge.points.length - 2, Math.floor(t * (edge.points.length - 1)));
        const fraction = t * (edge.points.length - 1) - segment;
        const a = edge.points[segment]!, b = edge.points[segment + 1]!;
        return {x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction};
      });
      const unrelated = layout.nodes.filter(node => node.id !== edge.sourceId && node.id !== edge.targetId);
      expect(samples.some(point => unrelated.some(node => point.x > node.x && point.x < node.x + node.width && point.y > node.y && point.y < node.y + node.height))).toBe(false);
    }
    expect(await layoutFamily(network, projectAround(network, "port"))).toEqual(layout);
  });
  it("renders evidence and supports navigation from the inspector", () => {
    const el = document.createElement("aside");
    const onNavigate = vi.fn();
    const onOpenContextEntity = vi.fn();
    const options = { onClose: vi.fn(), onNavigate, onOpenContextEntity };
    renderDetailsPanel(el, model, "alex", options);
    expect(el.textContent).toContain("Fictional test record");
    expect(el.textContent).toContain("Fictional workshop register");
    [...el.querySelectorAll("button")]
      .find((b) => b.textContent?.includes("Casey Example"))
      ?.click();
    expect(onNavigate).toHaveBeenCalledWith("casey");
    [...el.querySelectorAll("button")]
      .find((b) => b.textContent?.includes("Example Workshop"))
      ?.click();
    expect(onOpenContextEntity).toHaveBeenCalledWith("workshop");
    renderDetailsPanel(el, model, "blair", options);
    expect(el.textContent).toContain("Disputed");
    renderContextDetailsPanel(el, model, "workshop", options);
    expect(el.textContent).toContain("Alex Example");
    expect(el.textContent).toContain("Example Town");
  });
});
