import { describe, expect, it } from "vitest";
import { upgradeDataset, upgradeGraphState } from "../src/domain/graph-upgrade.ts";
import { GenealogyModel } from "../src/domain/model.ts";
import type { LegacyDataset } from "../src/domain/types";

// Explicitly fictional: an invented family and an imaginary mill.
function legacy(): LegacyDataset {
  return {
    version: 1,
    title: "Example family",
    initialFocusId: "ann",
    people: ["ann", "bo", "cy", "di", "ed"].map((id) => ({ id, name: `${id} Example` })),
    contextEntities: [{ id: "mill", name: "Example Mill", kind: "facility" }],
    sources: [{ id: "src-register", title: "Invented register" }],
    unions: [
      {
        id: "union-ann-bo",
        partnerIds: ["ann", "bo"],
        childIds: ["cy", "di"],
        type: "marriage",
        label: "Married 3 Apr 1841",
        date: "1841",
        place: "Example Chapel",
        confidence: "probable",
        sourceIds: ["src-register"],
        notes: ["Banns read twice."],
      },
    ],
    directParentage: [
      { id: "parent-ed-cy", parentId: "ed", childId: "cy", type: "adoptive", confidence: "disputed", label: "Raised by an uncle" },
    ],
    contextConnections: [
      { id: "worked", fromId: "bo", toId: "mill", type: "employment", label: "Worked for many years", date: "1850", confidence: "established", sourceIds: ["src-register"], notes: ["From the register."] },
    ],
  };
}

describe("reducing a stored graph to nodes and edges", () => {
  it("turns a marriage into one edge that keeps its identifier, date, place, notes and sources", () => {
    const graph = upgradeDataset(legacy());
    expect(graph.version).toBe(2);
    expect(graph).not.toHaveProperty("unions");
    expect(graph.claims!.find((c) => c.id === "union-ann-bo")).toEqual({
      id: "union-ann-bo",
      subjectId: "ann",
      predicate: "married_to",
      object: { entityId: "bo" },
      qualification: "inferred",
      time: "1841",
      reasoning: "Married 3 Apr 1841\nPlace: Example Chapel\nBanns read twice.",
      evidence: [],
      sourceIds: ["src-register"],
    });
  });

  it("turns each child of a couple into an edge from each parent", () => {
    const parents = upgradeDataset(legacy()).claims!.filter((c) => c.predicate === "parent_of");
    expect(parents.map((c) => `${c.subjectId}>${"entityId" in c.object ? c.object.entityId : ""}`)).toEqual(["ann>cy", "bo>cy", "ann>di", "bo>di"]);
  });

  it("keeps direct parentage and stored relationships as named edges", () => {
    const claims = upgradeDataset(legacy()).claims!;
    expect(claims.find((c) => c.id === "parent-ed-cy")).toMatchObject({ predicate: "adoptive_parent_of", qualification: "disputed", reasoning: "Raised by an uncle" });
    expect(claims.find((c) => c.id === "worked")).toMatchObject({ predicate: "Worked_for_many_years", time: "1850", reasoning: "From the register.", sourceIds: ["src-register"] });
  });

  it("gives the family layout the same couples, children and parents as before", () => {
    const model = new GenealogyModel(upgradeDataset(legacy()));
    expect(model.getUnion("union-ann-bo")).toMatchObject({ partnerIds: ["ann", "bo"], childIds: ["cy", "di"], date: "1841", confidence: "probable" });
    expect(model.parentsOf("cy").map((p) => [p.parentId, p.unionId ?? null, p.type])).toEqual([
      ["ann", "union-ann-bo", "biological"],
      ["bo", "union-ann-bo", "biological"],
      ["ed", null, "adoptive"],
    ]);
    expect(model.contextConnectionsForPerson("bo").map((c) => [c.id, c.label])).toEqual([["worked", "Worked for many years"]]);
  });

  it("leaves an upgraded graph alone", () => {
    const graph = upgradeDataset(legacy());
    expect(upgradeDataset(graph)).toBe(graph);
  });

  it("points annotations and undo snapshots at the edges", () => {
    const state = upgradeGraphState({
      dataset: legacy(),
      organization: { history: [{ before: legacy() }] },
      queue: [{ target: { table: "unions", recordId: "union-ann-bo", label: "Marriage" } }],
    });
    expect(state.queue[0]!.target).toEqual({ table: "claims", recordId: "union-ann-bo", label: "Marriage" });
    expect(state.organization!.history![0]!.before!.version).toBe(2);
    expect(state.dataset.claims!.some((c) => c.id === "union-ann-bo")).toBe(true);
  });
});
