import { describe, expect, it } from "vitest";
import { defaultRelationships, GraphSchema, readable } from "../src/domain/graph-schema";
import type { ResearchClaim } from "../src/domain/types";

// Explicitly fictional: a project about invented ships and their owners.
const schema = new GraphSchema({
  types: [
    { name: "ship", color: "sky", shape: "rounded", fields: [{ name: "tonnage", value: "number" }, { name: "home_port", value: "text" }] },
    { name: "person", fields: [] },
  ],
  relationships: [
    ...defaultRelationships(),
    { name: "owned", reverse: "owned by", arrangement: "free" },
    { name: "parent_company_of", reverse: "subsidiary of", arrangement: "ranked" },
  ],
});
const edge = (predicate: string, to?: string): ResearchClaim => ({
  id: "e", subjectId: "a", predicate, object: to ? { entityId: to } : { value: "x" }, qualification: "supported", time: null, reasoning: "", evidence: [],
});

describe("a project's types", () => {
  it("files an edge under its type's field, however the name is written", () => {
    expect(schema.field({ type: "Ship" }, "Home port")?.name).toBe("home_port");
    expect(schema.field({ type: "ship" }, "built_by")).toBeUndefined();
  });

  it("gives an undefined type no fields and the default look", () => {
    expect(schema.typeOf({ type: "lighthouse" })).toEqual({ name: "lighthouse", fields: [] });
    expect(schema.look({ type: "lighthouse" })).toEqual({ color: "slate", shape: "rounded" });
    expect(schema.look({ type: "ship" })).toEqual({ color: "sky", shape: "rounded" });
  });
});

describe("a project's relationships", () => {
  it("reads a relationship from either end", () => {
    expect(schema.reading("owned", "source")).toBe("Owned");
    expect(schema.reading("owned", "target")).toBe("Owned by");
    expect(schema.reading("married_to", "target")).toBe("Married to");
    // Without a reverse, the direction still shows.
    expect(schema.reading("sailed_with", "target")).toBe("Sailed with this");
  });

  it("arranges ranked and paired relationships, and leaves the rest free", () => {
    expect(schema.arrangement(edge("parent_of", "b"))).toBe("ranked");
    expect(schema.arrangement(edge("Parent company of", "b"))).toBe("ranked");
    expect(schema.arrangement(edge("married_to", "b"))).toBe("paired");
    expect(schema.arrangement(edge("owned", "b"))).toBe("free");
    // A value is never arranged, whatever it is called.
    expect(schema.arrangement(edge("parent_of"))).toBe("free");
  });

  it("covers a qualified form of a ranked relationship, and says what it qualifies", () => {
    expect(schema.arrangement(edge("adoptive_parent_of", "b"))).toBe("ranked");
    expect(schema.parentage("adoptive_parent_of")).toBe("adoptive");
    expect(schema.parentage("parent_of")).toBe("biological");
    expect(schema.parentage("owned")).toBe("unknown");
  });
});

describe("names as people read them", () => {
  it("turns an edge name into words", () => {
    expect(readable("operated_as")).toBe("Operated as");
    expect(readable("Located_in")).toBe("Located in");
  });
});
