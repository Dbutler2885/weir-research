import { describe, expect, it } from "vitest";
import { DraftError, graphFromTables, graphToTables, parseCsv } from "../src/domain/graph-csv.ts";
import type { GraphDataset } from "../src/domain/types";

// Explicitly fictional: an invented bay, a made-up works, and an imaginary family.
function dataset(): GraphDataset {
  return {
    version: 3,
    title: "Example Works of Example Bay",
    initialFocusId: "person-anna",
    nodes: [
      {
        id: "person-anna",
        name: 'Anna "Nan" Example',
        type: "person",
        dates: "1850-1920",
        summary: "Ran the works for thirty years.\n\nA second paragraph, with a comma.",
        notes: ["Check the 1880 ledger.", "Spelling varies, sometimes Exampel."],
        sourceIds: ["src-ledger"],
      },
      { id: "person-ben", name: "Ben Example", type: "person", summary: "Anna's husband." },
      { id: "place-bay", name: "Example Bay", type: "place", summary: "An invented bay.", sourceIds: ["src-ledger"] },
      { id: "works-north", name: "North Works, Example Bay", type: "works", dates: "1875-1910", summary: "A brick works." },
      { id: "works-south", name: "South Works", type: "works", summary: "A second works." },
    ],
    types: [
      { name: "person", color: "sea", shape: "rounded", fields: [{ name: "born", value: "date" }] },
      { name: "place", color: "moss", shape: "round", fields: [] },
      { name: "works", fields: [{ name: "packed_cases", value: "number" }, { name: "lot_number", value: "text" }] },
    ],
    relationships: [
      { name: "married_to", arrangement: "paired" },
      { name: "operated", reverse: "operated by", arrangement: "free" },
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

describe("the graph as editable tables", () => {
  it("writes nodes, edges and the project's vocabulary", () => {
    const files = graphToTables(dataset());
    expect(Object.keys(files)).toEqual(["nodes.csv", "edges.csv", "types.csv", "fields.csv", "relationships.csv"]);
    expect(lines(files["nodes.csv"])[0]).toBe("id,type,name,dates,summary,notes,sources");
    expect(lines(files["edges.csv"])[0]).toBe("id,from,name,targetType,target,qualification,time,reasoning,supports,challenges,context,sources");
    expect(lines(files["types.csv"])).toEqual(["type,color,shape", "person,sea,rounded", "place,moss,round", "works,,", ""]);
    expect(lines(files["fields.csv"])).toEqual(["type,field,value", "person,born,date", "works,packed_cases,number", "works,lot_number,text", ""]);
    expect(lines(files["relationships.csv"])).toEqual(["name,reverse,arrangement", "married_to,,paired", "operated,operated by,free", ""]);
  });

  it("survives a round trip unchanged", () => {
    const before = dataset();
    const after = graphFromTables(graphToTables(before), before);
    expect(after).toEqual(before);
  });

  it("keeps commas, quotes, newlines, numbers and numeric-looking text intact", () => {
    const after = graphFromTables(graphToTables(dataset()), dataset());
    expect(after.nodes[0]!.name).toBe('Anna "Nan" Example');
    expect(after.nodes[0]!.summary).toContain("\n\nA second paragraph, with a comma.");
    expect(after.nodes[0]!.notes).toEqual(["Check the 1880 ledger.", "Spelling varies, sometimes Exampel."]);
    expect(after.claims!.find((c) => c.id === "c-anna-operated")!.reasoning).toContain("\na second line.");
    expect(after.claims!.find((c) => c.id === "c-pack-count")!.object).toEqual({ value: 4000 });
    expect(after.claims!.find((c) => c.id === "c-lot-number")!.object).toEqual({ value: "0042" });
  });

  it("merges two nodes by deleting a row and repointing its edges", () => {
    const files = graphToTables(dataset());
    files["nodes.csv"] = without(files["nodes.csv"], "works-south");
    files["edges.csv"] = files["edges.csv"].replace("c-lot-number,works-south,", "c-lot-number,works-north,");
    const after = graphFromTables(files, dataset());
    expect(after.nodes.map((n) => n.id)).toEqual(["person-anna", "person-ben", "place-bay", "works-north"]);
    expect(after.claims!.find((c) => c.id === "c-lot-number")!.subjectId).toBe("works-north");
  });

  it("removes an edge by leaving out its row", () => {
    const files = graphToTables(dataset());
    files["edges.csv"] = without(files["edges.csv"], "c-pack-count");
    expect(graphFromTables(files, dataset()).claims!.map((c) => c.id)).not.toContain("c-pack-count");
  });

  it("adds a type with its fields, look and relationships", () => {
    const files = graphToTables(dataset());
    files["types.csv"] += "ship,sky,rounded\n";
    files["fields.csv"] += "ship,tonnage,number\nship,home_port,text\n";
    files["relationships.csv"] += "sailed_from,port of,free\n";
    files["nodes.csv"] += "ship-1,ship,The Invented,1880-1899,An invented schooner.,,\n";
    files["edges.csv"] += "e-tons,ship-1,tonnage,number,212,supported,,From the register.,,,,\n";
    const after = graphFromTables(files, dataset());
    expect(after.types.at(-1)).toEqual({ name: "ship", color: "sky", shape: "rounded", fields: [{ name: "tonnage", value: "number" }, { name: "home_port", value: "text" }] });
    expect(after.relationships.at(-1)).toEqual({ name: "sailed_from", reverse: "port of", arrangement: "free" });
    expect(after.nodes.at(-1)).toEqual({ id: "ship-1", name: "The Invented", type: "ship", dates: "1880-1899", summary: "An invented schooner." });
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
    files["nodes.csv"] += "person-anna,person,Duplicate Anna,,A duplicate.,,src-invented\n";
    files["nodes.csv"] += "ship-1,boat,The Invented,,An invented boat.,,\n";
    files["nodes.csv"] += "ship-2,,The Other,,An untyped boat.,,\n";
    files["nodes.csv"] += "ship-3,place,The Unsummarized,,,,\n";
    files["types.csv"] += "person,red,wavy\n";
    files["fields.csv"] += "boat,tonnage,number\nworks,output,weight\n";
    files["relationships.csv"] += "married_to,,sideways\n";
    files["edges.csv"] += "e-1,works-missing,located_in,node,place-bay,supported,,,,,,\n";
    files["edges.csv"] += "e-2,works-north,located_in,node,place-missing,supported,,,,,,\n";
    files["edges.csv"] += "e-3,works-north,same_as,node,works-north,supported,,,,,,\n";
    files["edges.csv"] += "e-4,works-north,built,number,eighteen-eighty,supported,,,,,,\n";
    files["edges.csv"] += "e-5,works-north,built,date,1880,supported,,,,,,\n";
    files["edges.csv"] += "e-6,works-north,built,text,1880,certain,,,ev-invented,,,\n";
    files["edges.csv"] += "e-7,works-north,packed_cases,text,many,supported,,,,,,\n";
    const found = problems(() => graphFromTables(files, dataset()));
    for (const text of [
      "repeats the node id person-anna",
      "cites a source that does not exist: src-invented",
      'type "boat", which is not in types.csv',
      "ship-2) has no type",
      "ship-3) has no summary",
      "repeats the type person",
      'color "red"',
      'shape "wavy"',
      "names a type that is not in types.csv: boat",
      'value "weight"',
      'arrangement "sideways"',
      "repeats the relationship married_to",
      "not in nodes.csv: works-missing",
      "not in nodes.csv: place-missing",
      "its own starting node",
      "not one: eighteen-eighty",
      'targetType "date"',
      'qualification "certain"',
      "cites evidence that does not exist: ev-invented",
      "fills the number field packed_cases",
    ])
      expect(found).toContain(text);
  });

  it("lets a node the graph already held without a summary keep going without one", () => {
    const base = dataset();
    delete base.nodes[4]!.summary;
    expect(graphFromTables(graphToTables(base), base).nodes[4]!.summary).toBeUndefined();
  });

  it("refuses a row whose columns shifted because free text was not quoted", () => {
    const files = graphToTables(dataset());
    files["edges.csv"] += "e-7,works-north,located_in,node,place-bay,supported,,Near the bay, by the pier.,,,,\n";
    expect(problems(() => graphFromTables(files, dataset()))).toContain("row 7 has 13 columns, not 12");
  });

  it("drops the starting focus when the draft removes that node", () => {
    const draft = dataset();
    draft.nodes = draft.nodes.filter((n) => n.id !== "person-anna");
    draft.claims = draft.claims!.filter((c) => c.subjectId !== "person-anna");
    expect(graphFromTables(graphToTables(draft), dataset()).initialFocusId).toBeNull();
  });

  it("parses quoted cells", () => {
    expect(parseCsv('a,"b, c","d ""e""\nf"\n')).toEqual([["a", "b, c", 'd "e"\nf']]);
    expect(() => parseCsv('a,"b\n')).toThrow("never closed");
  });
});
