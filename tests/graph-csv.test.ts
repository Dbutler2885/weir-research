import { describe, expect, it } from "vitest";
import { graphToCsv, graphFromCsv, parseCsv } from "../src/domain/graph-csv.ts";
import type { FamilyDataset } from "../src/domain/types";

// Explicitly fictional: an invented bay, a made-up works, and an imaginary town.
function dataset(): FamilyDataset {
  return {
    version: 1,
    title: "Example Works of Example Bay",
    initialFocusId: "person-anna",
    people: [{ id: "person-anna", name: 'Anna "Nan" Example', sourceIds: ["src-ledger"] }],
    unions: [],
    directParentage: [],
    contextEntities: [
      { id: "place-bay", name: "Example Bay", kind: "place", sourceIds: ["src-ledger"] },
      { id: "works-north", name: "North Works, Example Bay", kind: "facility", sourceIds: ["src-ledger"] },
      { id: "works-south", name: "South Works", kind: "facility", sourceIds: ["src-ledger"] },
    ],
    contextConnections: [],
    sources: [{ id: "src-ledger", title: "Example Ledger, 1881", repository: "Invented Archive", access: "full-text" }],
    claims: [
      {
        id: "c-north-in-bay",
        subjectId: "works-north",
        predicate: "located_in",
        object: { entityId: "place-bay" },
        qualification: "supported",
        time: "1881",
        reasoning: "The ledger enters the works under the bay heading.",
        evidence: [{ ref: "ev-heading", role: "supports" }],
      },
      {
        id: "c-anna-operated",
        subjectId: "person-anna",
        predicate: "operated",
        object: { entityId: "works-north" },
        qualification: "reported",
        time: null,
        reasoning: 'A later recollection, with a comma, a "quote", and\na second line.',
        evidence: [{ ref: "ev-heading", role: "context" }],
      },
      {
        id: "c-pack-count",
        subjectId: "works-north",
        predicate: "packed_cases",
        object: { value: "4,000" },
        qualification: "inferred",
        time: null,
        reasoning: "Derived from the ledger totals.",
        evidence: [],
      },
    ],
    evidence: [
      {
        id: "ev-heading",
        sourceId: "src-ledger",
        locator: "Example Ledger, page 4",
        quote: 'North Works, Example Bay, 1881: "in full operation".',
        context: "The page lists works by bay.",
        interpretation: "Places the works on the bay in 1881.",
      },
    ],
  } as FamilyDataset;
}

describe("the graph as editable tables", () => {
  it("survives a round trip unchanged", () => {
    const before = dataset();
    const after = graphFromCsv(graphToCsv(before));
    expect(after.people).toEqual(before.people);
    expect(after.contextEntities).toEqual(before.contextEntities);
    expect(after.claims).toEqual(before.claims);
    expect(after.evidence).toEqual(before.evidence);
    expect(after.sources).toEqual(before.sources);
    expect(after.title).toBe(before.title);
    expect(after.initialFocusId).toBe(before.initialFocusId);
  });

  it("keeps commas, quotes and newlines intact", () => {
    const after = graphFromCsv(graphToCsv(dataset()));
    expect(after.people[0]!.name).toBe('Anna "Nan" Example');
    expect(after.claims!.find((c) => c.id === "c-anna-operated")!.reasoning).toContain("\na second line.");
    expect(after.claims!.find((c) => c.id === "c-pack-count")!.object).toEqual({ value: "4,000" });
  });

  it("rebuilds relationships from the claims rather than storing them", () => {
    const files = graphToCsv(dataset());
    expect(Object.keys(files)).not.toContain("connections.csv");
    const after = graphFromCsv(files);
    expect(after.contextConnections!.map((c) => c.id)).toEqual(["c-north-in-bay", "c-anna-operated"]);
    const located = after.contextConnections!.find((c) => c.id === "c-north-in-bay")!;
    expect(located).toBeDefined();
    expect(located).toMatchObject({ fromId: "works-north", toId: "place-bay", type: "location", date: "1881" });
    expect(located.sourceIds).toEqual(["src-ledger"]);
  });

  it("merges two nodes into one by editing rows, with no deletion vocabulary", () => {
    const files = graphToCsv(dataset());
    // The two works turn out to be one building: drop the South row and repoint its claims.
    files["nodes.csv"] = files["nodes.csv"].split("\n").filter((line) => !line.startsWith("works-south,")).join("\n");
    files["node-sources.csv"] = files["node-sources.csv"].split("\n").filter((line) => !line.startsWith("works-south,")).join("\n");
    const after = graphFromCsv(files);
    expect(after.contextEntities!.map((e) => e.id)).toEqual(["place-bay", "works-north"]);
    expect(after.claims).toHaveLength(3);
  });

  it("removes a claim by leaving out its row", () => {
    const files = graphToCsv(dataset());
    files["claims.csv"] = files["claims.csv"].split("\n").filter((line) => !line.startsWith("c-pack-count,")).join("\n");
    const after = graphFromCsv(files);
    expect(after.claims!.map((c) => c.id)).toEqual(["c-north-in-bay", "c-anna-operated"]);
  });

  it("refuses a graph that does not hold together", () => {
    const orphanSubject = graphToCsv(dataset());
    orphanSubject["claims.csv"] += 'c-stray,works-missing,located_in,entity,place-bay,supported,,Nothing defines the subject.\n';
    expect(() => graphFromCsv(orphanSubject)).toThrow("unknown subject");

    const orphanObject = graphToCsv(dataset());
    orphanObject["claims.csv"] += 'c-stray,works-north,located_in,entity,place-missing,supported,,Nothing defines the object.\n';
    expect(() => graphFromCsv(orphanObject)).toThrow("unknown node");

    const duplicate = graphToCsv(dataset());
    duplicate["nodes.csv"] += "place-bay,place,Example Bay\n";
    expect(() => graphFromCsv(duplicate)).toThrow("Duplicate node");

    const orphanEvidence = graphToCsv(dataset());
    orphanEvidence["evidence.csv"] += "ev-stray,src-missing,page 9,A quote.,Context.,Reading.,\n";
    expect(() => graphFromCsv(orphanEvidence)).toThrow("source that is not there");

    const wrongHeader = graphToCsv(dataset());
    wrongHeader["nodes.csv"] = "id,kind\nplace-bay,place\n";
    expect(() => graphFromCsv(wrongHeader)).toThrow("expected header");
  });

  it("reads quoted fields the way a spreadsheet writes them", () => {
    expect(parseCsv('a,b\n"one, two","say ""hi"""\n')).toEqual([
      ["a", "b"],
      ["one, two", 'say "hi"'],
    ]);
    expect(parseCsv('a\n"line\nbreak"\n')).toEqual([["a"], ["line\nbreak"]]);
    expect(() => parseCsv('a\n"unterminated\n')).toThrow("Unterminated");
  });
});
