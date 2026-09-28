import { describe, expect, it } from "vitest";
import fixture from "./fixtures/workshop.json";
import { GraphModel } from "../src/domain/model";
import { projectAround } from "../src/domain/projection";
import { layoutGraph, rowsOf, type GraphLayout } from "../src/layout/layout";
import type { GraphDataset, ResearchClaim } from "../src/domain/types";

const edge = (id: string, from: string, name: string, to: string): ResearchClaim => ({
  id, subjectId: from, predicate: name, object: { entityId: to }, qualification: "supported", time: null, reasoning: "", evidence: [],
});
const dataset = () => structuredClone(fixture) as GraphDataset;
const model = new GraphModel(dataset());
const node = (layout: GraphLayout, id: string) => layout.nodes.find((n) => n.id === id)!;
const overlaps = (a: GraphLayout["nodes"][number], b: GraphLayout["nodes"][number]) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

describe("the fictional workshop graph", () => {
  it("indexes families, facts and connections from its edges", () => {
    expect(model.initialFocus?.name).toBe("Alex Example");
    expect(model.search("Lex").map((n) => n.id)).toEqual(["alex"]);
    expect(model.search("tool maker").map((n) => n.id)).toEqual(["alex"]);
    expect(model.parentsOf("alex").map((p) => p.parentId)).toEqual(["casey", "drew"]);
    expect(model.unionsFor("alex").map((u) => u.partnerIds)).toEqual([["alex", "blair"]]);
    expect(model.parentsOf("blair")[0]?.confidence).toBe("disputed");
    expect(model.connectionsFor("workshop").map((c) => c.id)).toEqual(["employment", "location"]);
    expect(model.factsAbout("alex").map((c) => c.predicate)).toEqual(["also_known_as"]);
  });

  it("rejects duplicates, dangling endpoints and untyped nodes", () => {
    const d = dataset();
    d.nodes.push({ ...d.nodes[0]! });
    expect(() => new GraphModel(d)).toThrow("Duplicate graph node");
    const c = dataset();
    c.claims!.push(edge("dangling", "alex", "parent_of", "missing"));
    expect(() => new GraphModel(c)).toThrow("unknown node");
    const loop = dataset();
    loop.claims!.push(edge("loop", "alex", "worked_with", "alex"));
    expect(() => new GraphModel(loop)).toThrow("its own subject");
    const untyped = dataset();
    untyped.nodes[0]!.type = " ";
    expect(() => new GraphModel(untyped)).toThrow("has no type");
  });

  it("measures every node's distance from the focus", () => {
    const p = projectAround(model, "alex");
    expect(p.nodes.size).toBe(8);
    expect(p.nodes.get("alex")).toMatchObject({ distance: 0, emphasis: "focus" });
    expect(p.nodes.get("workshop")).toMatchObject({ distance: 1, emphasis: "immediate" });
    expect(p.nodes.get("town")).toMatchObject({ distance: 2, emphasis: "near" });
  });
});

describe("laying out the graph", () => {
  it("puts ranked relationships in rows and paired ones side by side", () => {
    const rows = rowsOf(model);
    expect(rows.get("casey")).toBe(rows.get("drew"));
    expect(rows.get("alex")).toBe(rows.get("casey")! + 1);
    expect(rows.get("blair")).toBe(rows.get("alex"));
    expect(rows.get("fran")).toBe(rows.get("alex")! + 1);
    expect(rows.has("workshop")).toBe(false);
  });

  it("keeps a family a family tree while other connections are present", () => {
    const layout = layoutGraph(model, projectAround(model, "alex"));
    expect(node(layout, "casey").y).toBe(node(layout, "drew").y);
    expect(node(layout, "casey").y).toBeLessThan(node(layout, "alex").y);
    expect(node(layout, "alex").y).toBe(node(layout, "blair").y);
    expect(node(layout, "alex").y).toBeLessThan(node(layout, "fran").y);
    for (const a of layout.nodes) for (const b of layout.nodes) if (a !== b) expect(overlaps(a, b)).toBe(false);
  });

  it("draws a bar between a couple and a line from it down to each child", () => {
    const layout = layoutGraph(model, projectAround(model, "alex"));
    const alex = node(layout, "alex"), blair = node(layout, "blair"), fran = node(layout, "fran");
    const bar = layout.edges.find((e) => e.id === "couple")!;
    const [left, right] = [alex, blair].sort((a, b) => a.x - b.x);
    expect(bar.kind).toBe("family");
    expect(bar.points[0]).toEqual({ x: left!.x + left!.width, y: left!.y + left!.height / 2 });
    expect(bar.points.at(-1)).toEqual({ x: right!.x, y: right!.y + right!.height / 2 });
    const drop = layout.edges.find((e) => e.targetId === "fran")!;
    expect(drop.kind).toBe("family");
    expect(drop.points.at(-1)).toEqual({ x: fran.x + fran.width / 2, y: fran.y });
    // Every family line runs straight across or straight down.
    for (const e of layout.edges.filter((e) => e.kind === "family"))
      for (let i = 1; i < e.points.length; i++) expect(e.points[i]!.x === e.points[i - 1]!.x || e.points[i]!.y === e.points[i - 1]!.y).toBe(true);
    // The free connections are drawn as curves labelled with their names.
    expect(layout.edges.find((e) => e.id === "employment")).toMatchObject({ kind: "connection", label: "Worked at" });
  });

  it("is reproducible, and changes with the focus", () => {
    const layout = layoutGraph(model, projectAround(model, "alex"));
    expect(layoutGraph(model, projectAround(model, "alex"))).toEqual(layout);
    expect(layoutGraph(model, projectAround(model, "fran"))).not.toEqual(layout);
  });

  it("never puts a node in two rows when its relationships contradict each other", () => {
    const d = dataset();
    // Fran is also recorded as Casey's parent, which would put Fran above and below.
    d.claims!.push(edge("contradiction", "fran", "parent_of", "casey"));
    const contradictory = new GraphModel(d);
    const rows = rowsOf(contradictory);
    expect(new Set(rows.values()).size).toBeGreaterThan(1);
    const layout = layoutGraph(contradictory, projectAround(contradictory, "alex"));
    expect(layout.edges.every((e) => e.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)))).toBe(true);
  });

  it("spreads a crowded hub around the focus without overlapping cards", () => {
    const data: GraphDataset = {
      version: 3, title: "Fictional port", initialFocusId: "port", sources: [], relationships: [],
      types: [{ name: "place", fields: [] }, { name: "organization", fields: [] }],
      nodes: [
        { id: "port", name: "Example Port", type: "place" },
        ...Array.from({ length: 13 }, (_, i) => ({ id: `firm-${i}`, name: `Fictional firm ${i}`, type: "organization" })),
      ],
      claims: Array.from({ length: 13 }, (_, i) => edge(`location-${i}`, `firm-${i}`, "located_in", "port")),
    };
    data.claims!.push(edge("founding", "port", "established", "firm-0"));
    for (let i = 0; i < 6; i++) data.claims!.push(edge(`trade-${i}`, `firm-${i}`, "traded_with", `firm-${i + 7}`));
    const network = new GraphModel(data);
    const layout = layoutGraph(network, projectAround(network, "port"));
    const focus = node(layout, "port");
    const quadrants = new Set(layout.nodes.filter((n) => n !== focus).map((n) => `${n.x > focus.x}:${n.y > focus.y}`));
    expect(quadrants.size).toBe(4);
    for (const a of layout.nodes) for (const b of layout.nodes) if (a !== b) expect(overlaps(a, b)).toBe(false);
    expect(layout.edges.find((e) => e.id === "location-0")!.points[1]).not.toEqual(layout.edges.find((e) => e.id === "founding")!.points[1]);
    for (const line of layout.edges) {
      const samples = Array.from({ length: 201 }, (_, i) => {
        const t = i / 200;
        if (line.curved) {
          const [a, c, b] = line.points;
          return { x: (1 - t) ** 2 * a!.x + 2 * (1 - t) * t * c!.x + t ** 2 * b!.x, y: (1 - t) ** 2 * a!.y + 2 * (1 - t) * t * c!.y + t ** 2 * b!.y };
        }
        const segment = Math.min(line.points.length - 2, Math.floor(t * (line.points.length - 1)));
        const fraction = t * (line.points.length - 1) - segment;
        const a = line.points[segment]!, b = line.points[segment + 1]!;
        return { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction };
      });
      const unrelated = layout.nodes.filter((n) => n.id !== line.sourceId && n.id !== line.targetId);
      expect(samples.some((p) => unrelated.some((n) => p.x > n.x && p.x < n.x + n.width && p.y > n.y && p.y < n.y + n.height))).toBe(false);
    }
    expect(layoutGraph(network, projectAround(network, "port"))).toEqual(layout);
  });
});
