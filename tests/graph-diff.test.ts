import { describe, expect, it } from "vitest";
import { diffGraphs, describeDiff } from "../src/domain/graph-diff.ts";
import { graphFromTables, graphToTables } from "../src/domain/graph-csv.ts";
import type { GraphDataset, ResearchClaim } from "../src/domain/types";

// Explicitly fictional: an invented bay and three made-up works.
const edge = (id: string, from: string, name: string, object: ResearchClaim["object"], qualification: ResearchClaim["qualification"] = "supported"): ResearchClaim => ({
  id, subjectId: from, predicate: name, object, qualification, time: null, reasoning: "From the invented ledger.", evidence: [],
});

function graph(): GraphDataset {
  return {
    version: 3,
    title: "Example Bay",
    initialFocusId: "works-north",
    nodes: [
      { id: "place-bay", name: "Example Bay", type: "place", summary: "An invented bay." },
      { id: "street-water", name: "Water Street", type: "place", summary: "An invented street." },
      { id: "works-north", name: "North Works", type: "facility", summary: "An invented works." },
      { id: "works-south", name: "South Works", type: "facility", summary: "Another invented works." },
      { id: "works-old", name: "The Old Works", type: "facility", summary: "An old invented works." },
    ],
    types: [
      { name: "place", color: "moss", fields: [] },
      { name: "facility", fields: [{ name: "built", value: "number" }] },
    ],
    relationships: [{ name: "located_in", reverse: "site of", arrangement: "free" }],
    sources: [{ id: "src-ledger", title: "Invented ledger" }],
    evidence: [{ id: "ev-1", sourceId: "src-ledger", quote: "", context: "", locator: "p. 1", interpretation: "" }],
    claims: [
      edge("c-north-in-bay", "works-north", "located_in", { entityId: "place-bay" }),
      edge("c-old-in-bay", "works-old", "located_in", { entityId: "place-bay" }),
      edge("c-old-built", "works-old", "built", { value: 1880 }),
      edge("c-old-same", "works-old", "same_site_as", { entityId: "works-north" }),
    ],
  };
}

// The old works turns out to be North Works: its row goes and its edges move.
function merged(): GraphDataset {
  const after = graph();
  after.nodes = after.nodes.filter((n) => n.id !== "works-old");
  after.claims = after.claims!
    .filter((c) => c.id !== "c-old-same")
    .map((c) => (c.subjectId === "works-old" ? { ...c, subjectId: "works-north" } : c));
  return after;
}

describe("what a draft changes", () => {
  it("reports an untouched copy, and a round trip through the tables, as unchanged", () => {
    expect(describeDiff(diffGraphs(graph(), graph()))).toBe("No changes.");
    expect(diffGraphs(graph(), graphFromTables(graphToTables(graph()), graph())).unchanged).toBe(true);
  });

  it("reads a vanished node whose edges all moved to one node as a merge", () => {
    const diff = diffGraphs(graph(), merged());
    expect(diff.merges).toEqual([{ into: { id: "works-north", kind: "facility", name: "North Works" }, gone: [{ id: "works-old", kind: "facility", name: "The Old Works" }] }]);
    expect(diff.removedNodes).toEqual([]);
    expect(diff.movedEdges.map((e) => [e.id, e.wasFrom, e.from])).toEqual([
      ["c-old-in-bay", "works-old", "works-north"],
      ["c-old-built", "works-old", "works-north"],
    ]);
    expect(diff.rewordedEdges).toEqual([]);
    expect(diff.removedEdges.map((e) => e.id)).toEqual(["c-old-same"]);
    expect(describeDiff(diff)).toBe("2 nodes merged into one, 2 edges moved, 1 edge removed.");
  });

  it("reports a node whose edges went to two places once, as a removal naming both", () => {
    const after = graph();
    after.nodes = after.nodes.filter((n) => n.id !== "works-old");
    after.claims = [
      edge("c-north-in-bay", "works-north", "located_in", { entityId: "place-bay" }),
      edge("c-old-in-bay", "works-south", "located_in", { entityId: "place-bay" }),
      edge("c-old-built", "works-north", "built", { value: 1880 }),
    ];
    const diff = diffGraphs(graph(), after);
    expect(diff.merges).toEqual([]);
    expect(diff.removedNodes).toEqual([
      { id: "works-old", kind: "facility", name: "The Old Works", edgesMovedTo: [{ id: "works-south", kind: "facility", name: "South Works" }, { id: "works-north", kind: "facility", name: "North Works" }] },
    ]);
    expect(describeDiff(diff)).toBe("1 node removed, 2 edges moved, 1 edge removed.");
  });

  it("reports a genuine deletion as a removal with nowhere to go", () => {
    const after = graph();
    after.nodes = after.nodes.filter((n) => n.id !== "works-old");
    after.claims = after.claims!.filter((c) => c.subjectId !== "works-old");
    const diff = diffGraphs(graph(), after);
    expect(diff.removedNodes).toEqual([{ id: "works-old", kind: "facility", name: "The Old Works", edgesMovedTo: [] }]);
    expect(diff.removedEdges.map((e) => e.id)).toEqual(["c-old-in-bay", "c-old-built", "c-old-same"]);
  });

  it("separates renames, node edits, rewordings, requalifications and citation changes", () => {
    const after = graph();
    after.nodes[2]!.name = "North Works, Example Bay";
    after.nodes[3]!.summary = "A cannery";
    after.claims![0]!.reasoning = "Reworded after a second reading.";
    after.claims![1]!.qualification = "reported";
    after.claims![2]!.evidence = [{ ref: "ev-1", role: "supports" }];
    const diff = diffGraphs(graph(), after);
    expect(diff.renamedNodes.map((n) => [n.id, n.wasName])).toEqual([["works-north", "North Works"]]);
    expect(diff.editedNodes.map((n) => [n.id, n.fields])).toEqual([["works-south", ["summary"]]]);
    expect(diff.rewordedEdges.map((e) => e.id)).toEqual(["c-north-in-bay"]);
    expect(diff.requalifiedEdges.map((e) => [e.id, e.wasQualification])).toEqual([["c-old-in-bay", "supported"]]);
    expect(diff.recitedEdges.map((e) => e.id)).toEqual(["c-old-built"]);
  });

  it("lists evidence a draft cites that accepting will copy in", () => {
    const after = graph();
    after.claims!.push({ ...edge("c-new", "works-south", "built", { value: 1890 }), evidence: [{ ref: "report-1/ev-2", role: "supports" }] });
    const diff = diffGraphs(graph(), after);
    expect(diff.evidenceToCopy).toEqual(["report-1/ev-2"]);
    expect(describeDiff(diff)).toBe("1 new edge, 1 evidence record added from the research.");
  });

  it("never calls a draft unchanged when any editable cell changed", () => {
    const base = graphToTables(graph());
    // One edit per editable column: a node's type, name, dates, summary, notes and
    // sources, and every column of an edge after its id.
    const node = base["nodes.csv"].split("\n")[3]!.split(",");
    const nodeEdits: Record<number, string> = { 1: "place", 2: "Renamed", 3: "1880-1900", 4: "A summary", 5: "A note", 6: "src-ledger" };
    const edgeRow = base["edges.csv"].split("\n")[1]!.split(",");
    const edgeEdits: Record<number, string> = { 1: "works-south", 2: "renamed", 4: "street-water", 5: "reported", 6: "1890", 7: "Other reasoning.", 8: "ev-1", 9: "ev-1", 10: "ev-1", 11: "src-ledger" };
    const drafts = [
      ...Object.entries(nodeEdits).map(([column, value]) => ({ ...base, "nodes.csv": base["nodes.csv"].replace(node.join(","), node.map((cell, i) => (i === Number(column) ? value : cell)).join(",")) })),
      ...Object.entries(edgeEdits).map(([column, value]) => ({ ...base, "edges.csv": base["edges.csv"].replace(edgeRow.join(","), edgeRow.map((cell, i) => (i === Number(column) ? value : cell)).join(",")) })),
    ];
    for (const files of drafts) expect(diffGraphs(graph(), graphFromTables(files, graph())).unchanged).toBe(false);
  });

  it("says in words how the project's types and relationships changed", () => {
    const after = graph();
    after.types.push({ name: "ship", fields: [{ name: "tonnage", value: "number" }, { name: "home_port", value: "text" }] });
    after.types[1]!.fields = [{ name: "built", value: "date" }, { name: "workers", value: "number" }];
    after.types[0]!.color = "sky";
    after.relationships = [{ name: "located_in", reverse: "site of", arrangement: "ranked" }, { name: "owned", arrangement: "free" }];
    const diff = diffGraphs(graph(), after);
    expect(diff.vocabulary).toEqual([
      "The place type looks different.",
      "The facility type records built as a date, not a number.",
      "The facility type records workers.",
      "New type: ship, recording tonnage, home port.",
      'Changed relationship: Located in (read back as "site of") is drawn in rows.',
      "New relationship: Owned is drawn freely.",
    ]);
    expect(describeDiff(diff)).toBe("6 changes to types and relationships.");
    const removed = graph();
    removed.types = removed.types.slice(0, 1);
    removed.relationships = [];
    expect(diffGraphs(graph(), removed).vocabulary).toEqual(["The facility type is gone.", "Located in has no rule any more."]);
  });
});
