// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSample } from "../server/sample-project.mjs";
import { WorkspaceStore } from "../server/store.mjs";
import { welcomePage } from "../server/setup-page.mjs";

const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((fn) => fn()));
const folder = () => {
  const directory = mkdtempSync(join(tmpdir(), "sample-project-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
};

describe("the sample project", () => {
  it("holds sources, findings, a walkthrough and a draft graph ready for review", () => {
    const directory = folder();
    buildSample(directory);
    // Read back as the app reads it on opening.
    const state: any = new WorkspaceStore(directory, { version: 2, title: "", initialFocusId: null, people: [] }).state;
    const batch = state.investigations[0];
    expect(state.sample).toBe(true);
    expect(batch.number).toBe(1);
    expect(batch.readyAt).toBeTruthy();
    expect(state.conversation.map((m: any) => m.author)).toEqual(["human", "coordinator", "coordinator"]);
    expect(batch.proposals[0].sources).toHaveLength(3);
    expect(batch.proposals[0].findings.map((f: any) => f.qualification)).toEqual(["supported", "supported", "reported", "disputed"]);
    expect(batch.reviewFlow.walkthroughs).toHaveLength(1);
    const review = batch.reviewFlow.graphReviews[0];
    expect(review.status).toBe("pending");
    expect(review.summary).toBe("4 new nodes, 6 new edges, 4 evidence records added from the research.");
    expect(review.tour.steps).toHaveLength(2);
  });
  it("is explicitly fictional", () => {
    const state: any = buildSample(folder()).state;
    expect(state.dataset.title).toMatch(/fictional/);
    for (const source of state.investigations[0].proposals[0].sources) expect(source.title).toMatch(/\(fictional\)$/);
    expect(state.investigations[0].reviewFlow.walkthroughs[0].caveats[0]).toBe("Every record here is invented for the sample.");
  });
  it("is offered on the welcome screen, apart from the human's own projects", () => {
    const page = welcomePage({ projects: [{ id: "harbour", name: "The harbour families" }] });
    expect(page).toContain("What would you like to research?");
    expect(page).toContain('data-open="harbour"');
    expect(page).toContain("It uses nothing from your account until you write to it.");
    expect(welcomePage({ projects: [] })).not.toContain("Your projects");
  });
});
