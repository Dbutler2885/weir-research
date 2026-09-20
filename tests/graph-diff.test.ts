import { describe, expect, it } from "vitest";
import { diffGraphs, describeDiff } from "../src/domain/graph-diff.ts";
import type { FamilyDataset } from "../src/domain/types";

// Explicitly fictional: an invented bay and two made-up works.
const claim = (id: string, subjectId: string, predicate: string, object: object, qualification = "supported") =>
  ({ id, subjectId, predicate, object, qualification, time: null, reasoning: "From the invented ledger.", evidence: [] }) as never;

function graph(): FamilyDataset {
  return {
    version: 1,
    title: "Example Bay",
    initialFocusId: "works-north",
    people: [],
    unions: [],
    directParentage: [],
    contextEntities: [
      { id: "place-bay", name: "Example Bay", kind: "place", sourceIds: [] },
      { id: "works-north", name: "North Works", kind: "facility", sourceIds: [] },
      { id: "works-old", name: "The Old Works", kind: "facility", sourceIds: [] },
    ],
    contextConnections: [],
    sources: [],
    claims: [
      claim("c-north-in-bay", "works-north", "located_in", { entityId: "place-bay" }),
      claim("c-old-in-bay", "works-old", "located_in", { entityId: "place-bay" }),
      claim("c-old-built", "works-old", "built", { value: 1880 }),
    ],
    evidence: [],
  } as FamilyDataset;
}

describe("what a draft changes", () => {
  it("reports an untouched copy as unchanged", () => {
    const diff = diffGraphs(graph(), graph());
    expect(diff.unchanged).toBe(true);
    expect(describeDiff(diff)).toBe("No changes.");
  });

  it("sees an added node and an added claim", () => {
    const after = graph();
    after.contextEntities!.push({ id: "works-south", name: "South Works", kind: "facility", sourceIds: [] });
    after.claims!.push(claim("c-south-in-bay", "works-south", "located_in", { entityId: "place-bay" }));
    const diff = diffGraphs(graph(), after);
    expect(diff.addedNodes.map((n) => n.id)).toEqual(["works-south"]);
    expect(diff.addedClaims.map((c) => c.id)).toEqual(["c-south-in-bay"]);
    expect(describeDiff(diff)).toBe("1 new node, 1 new claim.");
  });

  it("reads a vanished node whose claims moved as a merge, not a deletion", () => {
    const after = graph();
    after.contextEntities = after.contextEntities!.filter((e) => e.id !== "works-old");
    after.claims = after.claims!
      .map((c) => (c.subjectId === "works-old" ? { ...c, subjectId: "works-north" } : c))
      .filter((c) => !("entityId" in c.object && c.object.entityId === c.subjectId));
    const diff = diffGraphs(graph(), after);
    expect(diff.merges).toHaveLength(1);
    expect(diff.merges[0]!.gone.map((n) => n.id)).toEqual(["works-old"]);
    expect(diff.merges[0]!.into.id).toBe("works-north");
    // The merge accounts for it, so it is not also listed as a removal.
    expect(diff.removedNodes).toEqual([]);
    expect(describeDiff(diff)).toContain("2 nodes merged into one");
  });

  it("reports a genuine deletion as a removal", () => {
    const after = graph();
    after.contextEntities = after.contextEntities!.filter((e) => e.id !== "works-old");
    after.claims = after.claims!.filter((c) => c.subjectId !== "works-old");
    const diff = diffGraphs(graph(), after);
    expect(diff.merges).toEqual([]);
    expect(diff.removedNodes.map((n) => n.id)).toEqual(["works-old"]);
    expect(diff.removedClaims.map((c) => c.id)).toEqual(["c-old-in-bay", "c-old-built"]);
  });

  it("separates a rename, a rewording and a requalification", () => {
    const after = graph();
    after.contextEntities![1]!.name = "North Works, Example Bay";
    after.claims![0]!.reasoning = "Reworded after a second reading.";
    (after.claims![1] as { qualification: string }).qualification = "reported";
    const diff = diffGraphs(graph(), after);
    expect(diff.renamedNodes.map((n) => [n.id, n.wasName])).toEqual([["works-north", "North Works"]]);
    expect(diff.changedClaims.map((c) => c.id)).toEqual(["c-north-in-bay"]);
    expect(diff.requalifiedClaims.map((c) => [c.id, c.wasQualification])).toEqual([["c-old-in-bay", "supported"]]);
  });
});
