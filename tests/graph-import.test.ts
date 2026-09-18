import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WorkspaceStore } from "../server/store.mjs";
import { graphImport } from "../server/graph-import.mjs";
import { organize } from "../server/organization.mjs";
import { GenealogyModel } from "../src/domain/model";
import { renderContextDetailsPanel } from "../src/ui/details-panel";

function example() {
  const packet = { baseGraphRevision: 0, researchRevision: "fictional-1", updates: [], existingGraph: { nodes: [] }, sources: [{ id: "source", title: "Fictional register" }], evidence: { passage: { id: "original-id", sourceId: "source", quote: "About twenty hands worked at Example Works.", context: "Fictional fixture.", locator: "Page 1", interpretation: "Approximate workforce." } }, findings: { finding: {} } };
  const graph = { schemaVersion: 1, baseGraphRevision: 0, researchRevision: "fictional-1", consumedUpdateSequence: 0, title: "Example Works", summary: "A fictional factory and location.", nodes: [{ id: "works", label: "Example Works", kind: "facility", existingId: null, evidenceRefs: ["passage"] }, { id: "town", label: "Example Town", kind: "place", existingId: null, evidenceRefs: ["passage"] }], claims: [
    { id: "location", subjectId: "works", predicate: "located_in", object: { entityId: "town" }, qualification: "inferred", time: null, reasoning: "A tentative fictional location.", evidence: [{ ref: "passage", role: "context" }] },
    { id: "workers", subjectId: "works", predicate: "workers", object: { value: "about twenty" }, qualification: "reported", time: "1880", reasoning: "The source is approximate.", evidence: [{ ref: "passage", role: "supports" }] },
  ], groups: [{ id: "group", title: "Example", nodeIds: ["works", "town"], claimIds: ["location", "workers"], dependsOn: [] }], identityDecisions: [], issues: [], representationNotes: [], coverage: [{ findingRef: "finding", nodeIds: ["works"], claimIds: ["workers", "location"], omissionReason: "" }] };
  return { packet, graph, focusId: "town" };
}

describe("saved graph import", () => {
  it("previews, applies, displays evidence, persists and undoes without erasing annotations", () => {
    const directory = mkdtempSync(join(tmpdir(), "fictional-graph-import-"));
    try {
      const empty = { version: 1, title: "Fictional project", initialFocusId: null, people: [], unions: [] };
      const store = new WorkspaceStore(directory, empty);
      store.command({ type: "annotate", question: "Inspect the fictional factory", target: { label: "Example Works" } });
      const before = structuredClone(store.state.investigations);
      const preview = graphImport(store, { action: "preview", ...example() });
      if (!("previewId" in preview)) throw new Error("Expected import preview");
      expect(store.state.dataset.contextEntities).toBeUndefined();
      expect(preview).toMatchObject({ nodes: 2, claims: 2, relationships: 1, removes: 0 });
      const applied = graphImport(store, { action: "apply", previewId: preview.previewId });
      if (!("undoId" in applied)) throw new Error("Expected applied import");
      const reloaded = new WorkspaceStore(directory, empty);
      expect(reloaded.state.dataset.claims).toHaveLength(2);
      expect(reloaded.state.dataset.contextConnections[0].qualification).toBe("inferred");
      expect(reloaded.state.investigations).toEqual(before);
      const panel = document.createElement("aside");
      renderContextDetailsPanel(panel, new GenealogyModel(reloaded.state.dataset), "works", { onClose() {}, onNavigate() {}, onOpenContextEntity() {} });
      expect(panel.textContent).toContain("about twenty");
      expect(panel.textContent).toContain("reported · 1880");
      expect(panel.textContent).toContain("About twenty hands worked at Example Works.");
      expect(panel.querySelector('[data-inspect-source="source"]')).not.toBeNull();
      organize(store, { action: "organization-undo", undoId: applied.undoId });
      expect(store.state.dataset.claims).toBeUndefined();
      expect(store.state.dataset.people).toHaveLength(0);
      expect(store.state.investigations).toEqual(before);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("rejects stale previews and missing provenance before changing the live dataset", () => {
    const directory = mkdtempSync(join(tmpdir(), "fictional-stale-import-"));
    try {
      const store = new WorkspaceStore(directory, { version: 1, title: "Fictional", initialFocusId: null, people: [], unions: [] });
      const input = example();
      const preview = graphImport(store, { action: "preview", ...input });
      if (!("previewId" in preview)) throw new Error("Expected import preview");
      store.update(() => {});
      expect(() => graphImport(store, { action: "apply", previewId: preview.previewId })).toThrow(/changed since preview/);
      input.packet.sources = [];
      expect(() => graphImport(store, { action: "preview", ...input })).toThrow(/missing from the supplied registry/);
      expect(store.state.dataset.claims).toBeUndefined();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
