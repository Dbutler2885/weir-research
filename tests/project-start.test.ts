// @vitest-environment node
import { afterEach, describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GraphModel } from "../src/domain/model";
import { projectAround } from "../src/domain/projection";
import { layoutGraph } from "../src/layout/layout";
import { initialState, transition } from "../src/domain/research";
import { WorkspaceStore } from "../server/store.mjs";
import { organize } from "../server/organization.mjs";
import type { GraphDataset, ResearchClaim } from "../src/domain/types";
// Explicitly fictional: an invented harbor town and its industries.
const empty = (): GraphDataset => ({
  version: 3,
  title: "Industrial history",
  initialFocusId: null,
  nodes: [],
  types: [],
  relationships: [],
  claims: [],
  sources: [],
});
const edge = (id: string, from: string, name: string, to: string, qualification: ResearchClaim["qualification"] = "supported"): ResearchClaim => ({
  id, subjectId: from, predicate: name, object: { entityId: to }, qualification, time: null, reasoning: "", evidence: [],
});
const directories: string[] = [];
afterEach(() =>
  directories
    .splice(0)
    .forEach((d) => rmSync(d, { recursive: true, force: true })),
);
function storeFor(data = empty()) {
  const path = mkdtempSync(join(tmpdir(), "research-organize-"));
  directories.push(path);
  return new WorkspaceStore(path, data);
}
function add(store: any, name: string, type: string) {
  const p = organize(store, {
    action: "organization-preview",
    seed: { name, type },
  }) as any;
  organize(store, { action: "organization-apply", previewId: p.id });
  return p.added[0].id;
}
describe("topic-first research projects", () => {
  it("allows a truly empty project and its first topic annotation", () => {
    const s = initialState(empty());
    expect(new GraphModel(s.dataset).initialFocus).toBeUndefined();
    const result = transition(s, {
      type: "annotate",
      target: { label: s.dataset.title },
      question: "Which sources should we consult?",
      dispatch: true,
    });
    expect(result.state.investigations[0]!.status).toBe("queued");
    expect(result.state.dataset.nodes).toHaveLength(0);
  });
  it("focuses a place in an organization graph without inserting a person", async () => {
    const d = empty();
    d.initialFocusId = "harbor";
    d.nodes = [
      { id: "harbor", name: "Example Harbor", type: "place" },
      { id: "mill", name: "Mill", type: "organization" },
    ];
    d.claims = [edge("location", "mill", "location_under_investigation", "harbor", "unresolved")];
    const m = new GraphModel(d);
    const projection = projectAround(m, "harbor");
    const layout = layoutGraph(m, projection);
    expect(m.initialFocus?.id).toBe("harbor");
    expect(layout.nodes).toHaveLength(2);
    expect(layout.nodes.find((n) => n.id === "harbor")!.emphasis).toBe("focus");
    expect(layout.edges).toHaveLength(1);
  });
  it("renders people connected to a place without claiming family relationships to the place", async () => {
    const d = empty();
    d.nodes = [
      { id: "person", name: "A person", type: "person" },
      { id: "place", name: "A place", type: "place" },
    ];
    d.claims = [edge("c", "person", "research_connection", "place")];
    d.initialFocusId = "place";
    const m = new GraphModel(d);
    const projection = projectAround(m, "place");
    expect(projection.nodes.get("person")!.distance).toBe(1);
    const layout = layoutGraph(m, projection);
    expect(layout.nodes).toHaveLength(2);
    expect(layout.edges.map((e) => e.kind)).toEqual(["connection"]);
  });
  it("adds a starting point of any type, using the project's own spelling of a type it has", () => {
    const store = storeFor();
    add(store, "The Invented", "Schooner");
    add(store, "The Other", "schooner");
    expect(store.state.dataset.types).toEqual([{ name: "Schooner", fields: [] }]);
    expect(store.state.dataset.nodes.map((n: any) => n.type)).toEqual(["Schooner", "Schooner"]);
    expect(() => organize(store, { action: "organization-preview", seed: { name: "Unnamed type", type: " " } })).toThrow("needs a name and a type");
  });
  it("previews before changing, preserves history and sources, and fences running research", () => {
    const store = storeFor();
    const place = add(store, "Example Harbor", "place");
    add(store, "Unwanted scaffold", "organization");
    store.update((s: any) => {
      s.dataset.sources.push({ id: "original", title: "Preserved source" });
      s.coordination = {
        enabled: true,
        handoff: "Keep this handoff",
        researchMap: "Keep this map",
        assignments: {},
        candidates: [],
      };
    });
    const { investigationId } = store.command({
      type: "annotate",
      target: { label: "Industrial history" },
      question: "Inspect sources",
      dispatch: true,
    }) as any;
    const brief = structuredClone(
      store.command({ type: "claim", investigationId, worker: "Test worker" }),
    ) as any;
    const before = structuredClone(store.state.dataset);
    const preview = organize(store, {
      action: "organization-preview",
      keepIds: [place],
    }) as any;
    expect(store.state.dataset).toEqual(before);
    const applied = organize(store, {
      action: "organization-apply",
      previewId: preview.id,
    }) as any;
    expect(store.state.dataset.nodes.map((n: any) => n.type)).toEqual(["place"]);
    expect(store.state.dataset.initialFocusId).toBe(place);
    expect(store.state.dataset.sources).toHaveLength(1);
    expect(store.state.investigations[0]!.annotations).toHaveLength(1);
    expect(store.state.investigations[0]!.status).toBe("paused");
    expect((store.state as any).coordination.handoff).toBe("Keep this handoff");
    expect(() =>
      store.command({
        type: "checkpoint",
        investigationId,
        token: brief.investigation.lease.token,
        summary: "late",
        findings: "late",
        nextSteps: "late",
      }),
    ).toThrow("lease");
    organize(store, { action: "organization-undo", undoId: applied.undoId });
    expect(store.state.dataset).toEqual(before);
    const reopened = new WorkspaceStore(
      store.path.replace("/workspace.json", ""),
      empty(),
    );
    expect(reopened.state.dataset).toEqual(before);
  });
  it("rejects stale previews and keeps private undo datasets out of browser payloads", () => {
    const store = storeFor();
    add(store, "Example Harbor", "place");
    const preview = organize(store, {
      action: "organization-preview",
      keepIds: [],
    }) as any;
    store.update((s: any) => {
      s.dataset.sources.push({ id: "new", title: "New source" });
    });
    expect(() =>
      organize(store, { action: "organization-apply", previewId: preview.id }),
    ).toThrow("changed since preview");
    const publicState = store.publicState() as any;
    expect(publicState.organization.preview).toBeUndefined();
    expect(publicState.organization.history[0].before).toBeUndefined();
  });
  it("trims dangling relationships and permits an empty result", () => {
    const d = empty();
    d.nodes = [
      { id: "p", name: "Person", type: "person" },
      { id: "l", name: "Example Harbor", type: "place" },
    ];
    d.claims = [edge("c", "p", "connection", "l")];
    d.initialFocusId = "p";
    const store = storeFor(d);
    const preview = organize(store, {
      action: "organization-preview",
      keepIds: ["l"],
    }) as any;
    organize(store, { action: "organization-apply", previewId: preview.id });
    expect(store.state.dataset.claims).toHaveLength(0);
    const blank = organize(store, {
      action: "organization-preview",
      keepIds: [],
    }) as any;
    organize(store, { action: "organization-apply", previewId: blank.id });
    expect(
      new GraphModel(store.state.dataset).initialFocus,
    ).toBeUndefined();
  });
});
