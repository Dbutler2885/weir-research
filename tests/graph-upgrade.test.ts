import { describe, expect, it } from "vitest";
import { upgradeDataset, upgradeGraphState } from "../src/domain/graph-upgrade.ts";
import { GraphModel } from "../src/domain/model.ts";
import type { LegacyDataset, NodesEdgesDataset } from "../src/domain/legacy-types";

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
    expect(graph.version).toBe(3);
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
    const model = new GraphModel(upgradeDataset(legacy()));
    expect(model.getUnion("union-ann-bo")).toMatchObject({ partnerIds: ["ann", "bo"], childIds: ["cy", "di"], date: "1841", confidence: "probable" });
    expect(model.parentsOf("cy").map((p) => [p.parentId, p.unionId ?? null, p.type])).toEqual([
      ["ann", "union-ann-bo", "biological"],
      ["bo", "union-ann-bo", "biological"],
      ["ed", null, "adoptive"],
    ]);
    expect(model.connectionsFor("bo").filter((c) => c.arrangement === "free").map((c) => [c.id, c.claim.predicate])).toEqual([["worked", "Worked_for_many_years"]]);
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
    expect(state.organization!.history![0]!.before!.version).toBe(3);
    expect(state.dataset.claims!.some((c) => c.id === "union-ann-bo")).toBe(true);
  });
});

// Explicitly fictional: an invented packer, his firm and its town.
function nodesAndEdges(): NodesEdgesDataset {
  return {
    version: 2,
    title: "Example Harbor",
    initialFocusId: "ned",
    people: [
      {
        id: "ned",
        name: "Ned Example",
        lifespan: "1840-1901",
        born: "1840",
        died: "1901",
        alternateNames: ["N. Example", "Edward Example"],
        descriptor: "Packer",
        biography: "An invented packer who ran the harbor works.",
        researchNotes: ["Check the 1880 directory."],
        sourceIds: ["src-directory"],
      },
      { id: "sal", name: "Sal Example", descriptor: "An invented partner." },
    ],
    contextEntities: [
      { id: "firm", name: "Example Packing Co.", kind: "organization", activeDates: "1880-1893", descriptor: "A firm", biography: "A firm that packed herring." },
      { id: "town", name: "Example Harbor", kind: "place" },
    ],
    sources: [{ id: "src-directory", title: "Invented directory" }],
    claims: [{ id: "ran", subjectId: "ned", predicate: "ran", object: { entityId: "firm" }, qualification: "supported", time: null, reasoning: "", evidence: [] }],
  };
}

describe("giving every node a type the project defines", () => {
  it("makes people and other things one list of nodes, keeping their summaries, dates and notes", () => {
    const graph = upgradeDataset(nodesAndEdges());
    expect(graph.version).toBe(3);
    expect(graph.nodes).toEqual([
      { id: "ned", name: "Ned Example", type: "person", summary: "Packer.\n\nAn invented packer who ran the harbor works.", dates: "1840-1901", notes: ["Check the 1880 directory."], sourceIds: ["src-directory"] },
      { id: "sal", name: "Sal Example", type: "person", summary: "An invented partner." },
      { id: "firm", name: "Example Packing Co.", type: "organization", summary: "A firm that packed herring.", dates: "1880-1893" },
      { id: "town", name: "Example Harbor", type: "place" },
    ]);
  });

  it("turns a person's dates and other names into facts, saying they carry no evidence", () => {
    const facts = upgradeDataset(nodesAndEdges()).claims!.filter((c) => "value" in c.object);
    expect(facts.map((c) => [c.id, c.predicate, "value" in c.object && c.object.value])).toEqual([
      ["ned-born", "born", "1840"],
      ["ned-died", "died", "1901"],
      ["ned-also_known_as", "also_known_as", "N. Example"],
      ["ned-also_known_as-2", "also_known_as", "Edward Example"],
    ]);
    expect(facts.every((c) => c.evidence.length === 0 && c.qualification === "reported" && /without evidence/.test(c.reasoning))).toBe(true);
  });

  it("defines a type for each kind in use, with a look, and knows how families are drawn", () => {
    const graph = upgradeDataset(nodesAndEdges());
    expect(graph.types).toEqual([
      { name: "person", color: "sea", shape: "rounded", fields: [{ name: "born", value: "date" }, { name: "died", value: "date" }, { name: "also_known_as", value: "text" }] },
      { name: "organization", color: "rust", shape: "square", fields: [] },
      { name: "place", color: "moss", shape: "round", fields: [] },
    ]);
    expect(graph.relationships.find((r) => r.name === "parent_of")).toEqual({ name: "parent_of", reverse: "child of", arrangement: "ranked" });
    expect(new GraphModel(graph).nodesById.size).toBe(4);
  });

  it("points annotations and proposals at nodes, and converts every stored graph", () => {
    const state = upgradeGraphState({
      dataset: nodesAndEdges(),
      organization: { history: [{ before: nodesAndEdges() }] },
      queue: [{ target: { table: "people", recordId: "ned", label: "Ned" } }],
      investigations: [
        {
          reviewFlow: { jobs: [{ baseDataset: nodesAndEdges() }], graphReviews: [] },
          proposals: [{ changes: [{ table: "contextEntities", recordId: "town", before: null, after: { id: "town", name: "Example Harbor", kind: "place" } }] }],
        },
      ],
    } as never) as any;
    expect(state.dataset.version).toBe(3);
    expect(state.organization.history[0].before.version).toBe(3);
    expect(state.investigations[0].reviewFlow.jobs[0].baseDataset.version).toBe(3);
    expect(state.queue[0].target).toEqual({ table: "nodes", recordId: "ned", label: "Ned" });
    expect(state.investigations[0].proposals[0].changes[0]).toMatchObject({ table: "nodes", after: { id: "town", name: "Example Harbor", type: "place" } });
  });
});

describe("opening a project stored in the old shape", () => {
  it("converts it once and keeps the original beside it, even after an earlier conversion", async () => {
    const { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const { WorkspaceStore } = await import("../server/store.mjs");
    const { initialState } = await import("../src/domain/research");
    const directory = mkdtempSync(join(tmpdir(), "fictional-typed-upgrade-"));
    try {
      const stored = { ...initialState(upgradeDataset(nodesAndEdges())), dataset: nodesAndEdges() };
      writeFileSync(join(directory, "workspace.json"), JSON.stringify(stored));
      // A backup from the earlier conversion is already there and stays untouched.
      writeFileSync(join(directory, "workspace.before-nodes-edges.json"), "earlier");
      const store = new WorkspaceStore(directory, upgradeDataset(nodesAndEdges()));
      expect(store.state.dataset.version).toBe(3);
      expect(JSON.parse(readFileSync(join(directory, "workspace.before-types.json"), "utf8")).dataset.version).toBe(2);
      expect(readFileSync(join(directory, "workspace.before-nodes-edges.json"), "utf8")).toBe("earlier");
      expect(existsSync(join(directory, "workspace.json"))).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
