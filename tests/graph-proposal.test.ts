import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectDelivery, freezeDelivery } from "../skills/prepare-research-graph/scripts/csv-delivery.mjs";
import { validateProposal } from "../skills/prepare-research-graph/scripts/validate-proposal.mjs";
import { validateTour } from "../skills/prepare-research-graph/scripts/validate-tour.mjs";

function fixture() {
  const packet = {
    baseGraphRevision: 4,
    researchRevision: "fictional-research-2",
    updates: [{ sequence: 2 }],
    existingGraph: { nodes: [] },
    evidence: { "capture:passage": { quote: "The fictional works stood in Example Bay." } },
    findings: { "return:finding": {} },
  };
  const proposal = {
    schemaVersion: 1, baseGraphRevision: 4, researchRevision: "fictional-research-2",
    consumedUpdateSequence: 2, title: "Fictional works", summary: "A reported location.",
    nodes: [
      { id: "bay", kind: "place", label: "Example Bay", existingId: null, evidenceRefs: ["capture:passage"] },
      { id: "works", kind: "facility", label: "Fictional Works", existingId: null, evidenceRefs: ["capture:passage"] },
    ],
    claims: [{ id: "location", subjectId: "works", predicate: "located_in", object: { entityId: "bay" }, qualification: "reported", time: null, reasoning: "Attributed to the fictional source.", evidence: [{ ref: "capture:passage", role: "supports" }] }],
    groups: [
      { id: "place", title: "Place", nodeIds: ["bay"], claimIds: [], dependsOn: [] },
      { id: "factory", title: "Factory", nodeIds: ["works"], claimIds: ["location"], dependsOn: ["place"] },
    ],
    identityDecisions: [], issues: [],
    representationNotes: [{ id: "location-note", nodeIds: ["works", "bay"], claimIds: ["location"], issueIds: [], decision: "Represent the reported location", alternatives: [], reason: "The source identifies the place." }],
    coverage: [{ findingRef: "return:finding", nodeIds: ["works"], claimIds: ["location"], omissionReason: "" }],
  };
  return { packet, proposal };
}

describe("experimental graph proposal contract", () => {
  it("accepts a qualified relationship across explicitly dependent groups", () => {
    const { packet, proposal } = fixture();
    expect(validateProposal(proposal, packet)).toMatchObject({ valid: true, counts: { nodes: 2, relationships: 1 } });
  });

  it("rejects a change whose group could be applied without its referenced new place", () => {
    const { packet, proposal } = fixture();
    proposal.groups[1]!.dependsOn = [];
    expect(validateProposal(proposal, packet).errors).toContain("Group factory needs dependency on place for location");
  });

  it("rejects missing evidence and cyclic group dependencies", () => {
    const { packet, proposal } = fixture();
    proposal.claims[0]!.evidence[0]!.ref = "missing";
    proposal.groups[0]!.dependsOn = ["factory"];
    const result = validateProposal(proposal, packet);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Unknown evidence missing");
    expect(result.errors.some((e: string) => e.includes("dependency cycle"))).toBe(true);
  });

  it("requires coverage and refuses stale graph or unconsumed updates", () => {
    const { packet, proposal } = fixture();
    proposal.coverage = [];
    proposal.baseGraphRevision = 3;
    proposal.consumedUpdateSequence = 1;
    expect(validateProposal(proposal, packet).errors).toEqual(expect.arrayContaining([
      "Unaccounted finding return:finding", "Stale graph revision", "Updates not fully incorporated",
    ]));
  });

  it("surfaces missing source records in the input without discarding a reviewable graph", () => {
    const { packet, proposal } = fixture();
    const incompletePacket = { ...packet, sources: [], evidence: { "capture:passage": { sourceId: "missing-source", quote: "A fictional account." } } };
    const result = validateProposal(proposal, incompletePacket);
    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual(["Evidence capture:passage references a source missing from the supplied registry: missing-source"]);
  });

  it("binds the coordinator's tour to the graph revision and actual focus targets", () => {
    const { proposal } = fixture();
    const tour = { graphSha256: "revision-a", introduction: "Explore the fictional works.", steps: [{ id: "first", title: "A reported location", explanation: "The source places the works here.", transition: "Review the proposal.", focusNodeIds: ["works"], focusClaimIds: ["location"], issueIds: [] }] };
    expect(validateTour(tour, proposal, "revision-a").valid).toBe(true);
    expect(validateTour(tour, proposal, "revision-b").valid).toBe(false);
    tour.steps[0]!.focusNodeIds = ["missing"];
    expect(validateTour(tour, proposal, "revision-a").valid).toBe(false);
  });
});

function csvFixture(directory: string) {
  const { packet } = fixture();
  const table = (name: string, header: string, rows: string[][] = []) => {
    const csv = [header, ...rows.map(row => row.map(value => `"${value.replaceAll('"', '""')}"`).join(","))].join("\r\n") + "\r\n";
    writeFileSync(join(directory, `${name}.csv`), csv);
  };
  table("proposal", "schemaVersion,baseGraphRevision,researchRevision,consumedUpdateSequence,title,summary", [["1", "4", "fictional-research-2", "2", "Example Works", "A reported location."]]);
  table("nodes", "id,kind,label,existingId", [["works", "facility", 'Example, "Works"', ""], ["bay", "place", "Example Bay", ""]]);
  table("node-evidence", "nodeId,evidenceRef", [["works", "capture:passage"], ["bay", "capture:passage"]]);
  table("claims", "id,subjectId,predicate,objectType,objectValue,qualification,time,reasoning", [["location", "works", "located_in", "entity", "bay", "reported", "", "First paragraph.\nSecond paragraph, with a quotation: \"Example\"."]]);
  table("claim-evidence", "claimId,evidenceRef,role", [["location", "capture:passage", "supports"]]);
  table("groups", "id,title,nodeIds,claimIds,dependsOn", [["site", "The site", "works|bay", "location", ""]]);
  table("identities", "nodeIds,decision,reason,evidenceRefs");
  table("coverage", "findingRef,nodeIds,claimIds,omissionReason", [["return:finding", "works|bay", "location", ""]]);
  table("issues", "id,kind,question,nodeIds,claimIds,evidenceRefs,provisionalTreatment,requestedResearch,blocksGroupIds");
  table("representation-notes", "id,nodeIds,claimIds,issueIds,decision,alternatives,reason", [["site-note", "works|bay", "location", "", "Keep location attributed", "Record as certain\nOmit the location", "The source is an account."]]);
  return packet;
}

describe("CSV graph delivery", () => {
  it("preserves quoted and multiline research text and produces a validated relationship", () => {
    const directory = mkdtempSync(join(tmpdir(), "fictional-graph-"));
    try {
      const packet = csvFixture(directory);
      const { graph, validation } = inspectDelivery(directory, packet);
      expect(validation).toMatchObject({ valid: true, counts: { nodes: 2, relationships: 1 } });
      expect(graph.nodes[0].label).toBe('Example, "Works"');
      expect(graph.claims[0].reasoning).toBe('First paragraph.\nSecond paragraph, with a quotation: "Example".');
      expect(graph.representationNotes[0].alternatives).toEqual(["Record as certain", "Omit the location"]);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("requires explicit completion and preserves submitted files when working files change", () => {
    const directory = mkdtempSync(join(tmpdir(), "fictional-delivery-"));
    try {
      const work = join(directory, "work"); mkdirSync(work);
      const packet = csvFixture(work);
      const frozen = join(directory, "submitted");
      expect(() => freezeDelivery(work, frozen, packet)).toThrow();
      writeFileSync(join(work, "submission.txt"), "done\n");
      expect(freezeDelivery(work, frozen, packet).validation.valid).toBe(true);
      const snapshot = readFileSync(join(frozen, "claims.csv"), "utf8");
      writeFileSync(join(work, "claims.csv"), "Interrupted next revision");
      expect(readFileSync(join(frozen, "claims.csv"), "utf8")).toBe(snapshot);
      expect(inspectDelivery(work, packet).validation.valid).toBe(false);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("rejects orphan evidence rows rather than silently losing them during conversion", () => {
    const directory = mkdtempSync(join(tmpdir(), "fictional-orphan-"));
    try {
      const packet = csvFixture(directory);
      writeFileSync(join(directory, "claim-evidence.csv"), "claimId,evidenceRef,role\nmissing,capture:passage,supports\n");
      expect(inspectDelivery(directory, packet).validation).toMatchObject({ valid: false, errors: ["claim-evidence.csv: unknown claimId missing"] });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
