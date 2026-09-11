// @vitest-environment node
import { afterEach, describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GenealogyModel } from "../src/domain/model";
import { projectAround } from "../src/domain/projection";
import { layoutFamily } from "../src/layout/layout";
import { initialState, transition } from "../src/domain/research";
import { WorkspaceStore } from "../server/store.mjs";
import { organize } from "../server/organization.mjs";
import type { FamilyDataset } from "../src/domain/types";
const empty = (): FamilyDataset => ({
  version: 1,
  title: "Industrial history",
  initialFocusId: null,
  people: [],
  unions: [],
  contextEntities: [],
  contextConnections: [],
  sources: [],
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
function add(store: any, name: string, kind: string) {
  const p = organize(store, {
    action: "organization-preview",
    seed: { name, kind },
  }) as any;
  organize(store, { action: "organization-apply", previewId: p.id });
  return p.added[0].id;
}
describe("topic-first research projects", () => {
  it("allows a truly empty project and its first topic annotation", () => {
    const s = initialState(empty());
    expect(new GenealogyModel(s.dataset).initialFocus).toBeUndefined();
    const result = transition(s, {
      type: "annotate",
      target: { label: s.dataset.title },
      question: "Which sources should we consult?",
      dispatch: true,
    });
    expect(result.state.investigations[0]!.status).toBe("queued");
    expect(result.state.dataset.people).toHaveLength(0);
  });
  it("focuses a place in an organization graph without inserting a person", async () => {
    const d = empty();
    d.initialFocusId = "lubec";
    d.contextEntities = [
      { id: "lubec", name: "Lubec, Maine", kind: "place" },
      { id: "mill", name: "Mill", kind: "organization" },
    ];
    d.contextConnections = [
      {
        id: "location",
        fromId: "mill",
        toId: "lubec",
        type: "association",
        label: "Location under investigation",
        confidence: "unknown",
      },
    ];
    const m = new GenealogyModel(d);
    const projection = projectAround(m, "lubec");
    const layout = await layoutFamily(m, projection);
    expect(m.initialFocus?.id).toBe("lubec");
    expect(projection.people.size).toBe(0);
    expect(layout.nodes).toHaveLength(2);
    expect(layout.nodes.find((n) => n.id === "lubec")!.emphasis).toBe("focus");
    expect(layout.edges).toHaveLength(1);
  });
  it("renders people connected to a place without claiming family relationships to the place", async () => {
    const d = empty();
    d.people = [{ id: "person", name: "A person" }];
    d.contextEntities = [{ id: "place", name: "A place", kind: "place" }];
    d.contextConnections = [
      {
        id: "c",
        fromId: "person",
        toId: "place",
        type: "association",
        label: "Research connection",
      },
    ];
    d.initialFocusId = "place";
    const m = new GenealogyModel(d);
    const projection = projectAround(m, "place");
    expect(projection.people.get("person")!.distance).toBe(1);
    const layout = await layoutFamily(m, projection);
    expect(layout.nodes).toHaveLength(2);
  });
  it("previews before changing, preserves history and sources, and fences running research", () => {
    const store = storeFor();
    const place = add(store, "Lubec, Maine", "place");
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
    expect(store.state.dataset.people).toHaveLength(0);
    expect(store.state.dataset.contextEntities).toHaveLength(1);
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
    add(store, "Lubec", "place");
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
    d.people = [{ id: "p", name: "Person" }];
    d.contextEntities = [{ id: "l", name: "Lubec", kind: "place" }];
    d.contextConnections = [
      {
        id: "c",
        fromId: "p",
        toId: "l",
        type: "association",
        label: "Connection",
      },
    ];
    d.initialFocusId = "p";
    const store = storeFor(d);
    const preview = organize(store, {
      action: "organization-preview",
      keepIds: ["l"],
    }) as any;
    organize(store, { action: "organization-apply", previewId: preview.id });
    expect(store.state.dataset.contextConnections).toHaveLength(0);
    const blank = organize(store, {
      action: "organization-preview",
      keepIds: [],
    }) as any;
    organize(store, { action: "organization-apply", previewId: blank.id });
    expect(
      new GenealogyModel(store.state.dataset).initialFocus,
    ).toBeUndefined();
  });
});
