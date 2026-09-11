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
  it("routes every relationship deterministically with parents above children", async () => {
    const p = projectAround(model, "alex");
    const l = await layoutFamily(model, p);
    expect(l.nodes).toHaveLength(10);
    expect(l.edges).toHaveLength(10);
    expect(l.edges.every((e) => e.points.length >= 2)).toBe(true);
    expect(l.nodes.find((n) => n.id === "casey")!.y).toBeLessThan(
      l.nodes.find((n) => n.id === "alex")!.y,
    );
    expect(l.nodes.find((n) => n.id === "workshop")?.emphasis).toBe(
      "immediate",
    );
    expect(await layoutFamily(model, p)).toEqual(l);
    expect(await layoutFamily(model, projectAround(model, "fran"))).not.toEqual(
      l,
    );
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
