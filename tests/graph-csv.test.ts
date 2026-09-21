import { describe, expect, it } from "vitest";
import { DraftError, graphFromTables, graphToTables, parseCsv } from "../src/domain/graph-csv.ts";
import type { FamilyDataset } from "../src/domain/types";

// Explicitly fictional: an invented bay, a made-up works, and an imaginary family.
function dataset(): FamilyDataset {
  return {
    version: 2,
    title: "Example Works of Example Bay",
    initialFocusId: "person-anna",
    people: [
      {
        id: "person-anna",
        name: 'Anna "Nan" Example',
        lifespan: "1850-1920",
        descriptor: "Works owner, of Example Bay",
        biography: "Ran the works for thirty years.\nA second paragraph.",
        alternateNames: ["Nan Example", "A. Example"],
        researchNotes: ["Check the 1880 ledger.", "Spelling varies, sometimes Exampel."],
        sourceIds: ["src-ledger"],
      },
      { id: "person-ben", name: "Ben Example", born: "1848", died: "1901" },
    ],
    contextEntities: [
      { id: "place-bay", name: "Example Bay", kind: "place", sourceIds: ["src-ledger"] },
      { id: "works-north", name: "North Works, Example Bay", kind: "facility", activeDates: "1875-1910", descriptor: "Brick works" },
      { id: "works-south", name: "South Works", kind: "facility" },
    ],
    sources: [
      { id: "src-ledger", title: "Example Ledger, 1881", repository: "Invented Archive", access: "full-text" },
      { id: "src-letter", title: "Invented letter" },
    ],
    claims: [
      {
        id: "c-north-in-bay",
        subjectId: "works-north",
        predicate: "located_in",
        object: { entityId: "place-bay" },
        qualification: "supported",
        time: "1881",
        reasoning: "The ledger enters the works under the bay heading.",
        evidence: [
          { ref: "ev-heading", role: "supports" },
          { ref: "ev-margin", role: "challenges" },
        ],
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
        sourceIds: ["src-letter"],
      },
      {
        id: "c-pack-count",
        subjectId: "works-north",
        predicate: "packed_cases",
        object: { value: 4000 },
        qualification: "inferred",
        time: null,
        reasoning: "Derived from the ledger totals.",
        evidence: [],
      },
      {
        id: "c-lot-number",
        subjectId: "works-south",
        predicate: "lot_number",
        object: { value: "0042" },
        qualification: "supported",
        time: null,
        reasoning: "A lot number that looks like a number but is text.",
        evidence: [],
      },
      {
        id: "c-married",
        subjectId: "person-anna",
        predicate: "married_to",
        object: { entityId: "person-ben" },
        qualification: "supported",
        time: "1870",
        reasoning: "",
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
      {
        id: "ev-margin",
        sourceId: "src-ledger",
        locator: "Example Ledger, page 4 margin",
        quote: "Moved?",
        context: "A pencilled note.",
        interpretation: "Someone doubted the location.",
      },
    ],
  };
}

const lines = (text: string) => text.split("\n");
const without = (text: string, id: string) => lines(text).filter((line) => !line.startsWith(`${id},`)).join("\n");
const problems = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    if (error instanceof DraftError) return error.problems.join("\n");
    throw error;
  }
  throw new Error("The draft was accepted.");
};

describe("the graph as two editable tables", () => {
  it("writes nodes and edges and nothing else", () => {
    const files = graphToTables(dataset());
    expect(Object.keys(files)).toEqual(["nodes.csv", "edges.csv"]);
    expect(lines(files["edges.csv"])[0]).toBe("id,from,name,targetType,target,qualification,time,reasoning,supports,challenges,context,sources");
  });

  it("survives a round trip unchanged", () => {
    const before = dataset();
    const after = graphFromTables(graphToTables(before), before);
    expect(after).toEqual(before);
  });

  it("keeps commas, quotes, newlines, numbers and numeric-looking text intact", () => {
    const after = graphFromTables(graphToTables(dataset()), dataset());
    expect(after.people[0]!.name).toBe('Anna "Nan" Example');
    expect(after.people[0]!.biography).toContain("\nA second paragraph.");
    expect(after.people[0]!.researchNotes).toEqual(["Check the 1880 ledger.", "Spelling varies, sometimes Exampel."]);
    expect(after.claims!.find((c) => c.id === "c-anna-operated")!.reasoning).toContain("\na second line.");
    expect(after.claims!.find((c) => c.id === "c-pack-count")!.object).toEqual({ value: 4000 });
    expect(after.claims!.find((c) => c.id === "c-lot-number")!.object).toEqual({ value: "0042" });
  });

  it("merges two nodes by deleting a row and repointing its edges", () => {
    const files = graphToTables(dataset());
    files["nodes.csv"] = without(files["nodes.csv"], "works-south");
    files["edges.csv"] = files["edges.csv"].replace("c-lot-number,works-south,", "c-lot-number,works-north,");
    const after = graphFromTables(files, dataset());
    expect(after.contextEntities!.map((e) => e.id)).toEqual(["place-bay", "works-north"]);
    expect(after.claims!.find((c) => c.id === "c-lot-number")!.subjectId).toBe("works-north");
  });

  it("removes an edge by leaving out its row", () => {
    const files = graphToTables(dataset());
    files["edges.csv"] = without(files["edges.csv"], "c-pack-count");
    expect(graphFromTables(files, dataset()).claims!.map((c) => c.id)).not.toContain("c-pack-count");
  });

  it("lets a draft cite research the graph does not hold yet", () => {
    const files = graphToTables(dataset());
    files["edges.csv"] += "c-new,works-north,built,number,1875,supported,,From the registry.,report-1/ev-9,,,\n";
    expect(() => graphFromTables(files, dataset())).toThrow("report-1/ev-9");
    const after = graphFromTables(files, dataset(), { evidenceIds: ["report-1/ev-9"] });
    expect(after.claims!.at(-1)!.evidence).toEqual([{ ref: "report-1/ev-9", role: "supports" }]);
    // Evidence records come from the accepted graph, never from the builder.
    expect(after.evidence).toEqual(dataset().evidence);
  });

  it("names every problem in a draft that does not hold together", () => {
    const files = graphToTables(dataset());
    files["nodes.csv"] += "person-anna,person,Duplicate Anna,,,,,,,,src-invented\n";
    files["nodes.csv"] += "ship-1,boat,The Invented,,,,,,,,\n";
    files["edges.csv"] += "e-1,works-missing,located_in,node,place-bay,supported,,,,,,\n";
    files["edges.csv"] += "e-2,works-north,located_in,node,place-missing,supported,,,,,,\n";
    files["edges.csv"] += "e-3,works-north,same_as,node,works-north,supported,,,,,,\n";
    files["edges.csv"] += "e-4,works-north,built,number,eighteen-eighty,supported,,,,,,\n";
    files["edges.csv"] += "e-5,works-north,built,date,1880,supported,,,,,,\n";
    files["edges.csv"] += "e-6,works-north,built,text,1880,certain,,,ev-invented,,,\n";
    const found = problems(() => graphFromTables(files, dataset()));
    for (const text of [
      "repeats the node id person-anna",
      "cites a source that does not exist: src-invented",
      'kind "boat"',
      "not in nodes.csv: works-missing",
      "not in nodes.csv: place-missing",
      "its own starting node",
      "not one: eighteen-eighty",
      'targetType "date"',
      'qualification "certain"',
      "cites evidence that does not exist: ev-invented",
    ])
      expect(found).toContain(text);
  });

  it("refuses a row whose columns shifted because free text was not quoted", () => {
    const files = graphToTables(dataset());
    files["edges.csv"] += "e-7,works-north,located_in,node,place-bay,supported,,Near the bay, by the pier.,,,,\n";
    expect(problems(() => graphFromTables(files, dataset()))).toContain("row 7 has 13 columns, not 12");
  });

  it("refuses a node field that only applies to people", () => {
    const files = graphToTables(dataset());
    files["nodes.csv"] = files["nodes.csv"].replace("works-south,facility,South Works,,,,,", "works-south,facility,South Works,,,,1880,");
    expect(problems(() => graphFromTables(files, dataset()))).toContain("fills born");
  });

  it("drops the starting focus when the draft removes that node", () => {
    const draft = dataset();
    draft.people = draft.people.filter((p) => p.id !== "person-anna");
    draft.claims = draft.claims!.filter((c) => c.subjectId !== "person-anna");
    expect(graphFromTables(graphToTables(draft), dataset()).initialFocusId).toBeNull();
  });

  it("parses quoted cells", () => {
    expect(parseCsv('a,"b, c","d ""e""\nf"\n')).toEqual([["a", "b, c", 'd "e"\nf']]);
    expect(() => parseCsv('a,"b\n')).toThrow("never closed");
  });
});
