// @vitest-environment node
import { emptyGraph } from "../src/domain/graph-schema";
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
    const state: any = new WorkspaceStore(directory, emptyGraph("")).state;
    const batch = state.investigations[0];
    expect(state.sample).toBe(true);
    expect(batch.number).toBe(1);
    expect(batch.readyAt).toBeTruthy();
    expect(state.conversation.map((m: any) => m.author)).toEqual(["human", "coordinator", "coordinator"]);
    expect(batch.proposals[0].sources).toHaveLength(3);
    expect(batch.proposals[0].findings.map((f: any) => f.qualification)).toEqual(["supported", "supported", "reported", "disputed"]);
    expect(batch.reviewFlow.walkthroughs).toHaveLength(1);
    expect(state.dataset.nodes).toHaveLength(7);
    expect(state.dataset.claims).toHaveLength(14);
    expect(state.dataset.evidence).toHaveLength(6);
    expect(state.dataset.sources).toHaveLength(4);
    const review = batch.reviewFlow.graphReviews[0];
    expect(review.status).toBe("pending");
    expect(review.summary).toBe("3 new nodes, 8 new edges, 2 changes to types and relationships, 4 evidence records added from the research.");
    // It shows what the graph can hold: summaries, vocabulary, and facts under fields.
    expect(review.draft.nodes.every((n: any) => n.summary)).toBe(true);
    expect(review.diff.vocabulary).toContain("The person type records also known as.");
    expect(review.draft.claims.find((c: any) => c.id === "thomas-trade")).toMatchObject({ predicate: "occupation", object: { value: "Net maker" } });
    expect(review.tour.steps).toHaveLength(2);
  });
  it("is explicitly fictional", () => {
    const state: any = buildSample(folder()).state;
    expect(state.dataset.title).toMatch(/fictional/);
    for (const source of state.dataset.sources) expect(source.title).toMatch(/\(fictional\)$/);
    for (const source of state.investigations[0].proposals[0].sources) expect(source.title).toMatch(/\(fictional\)$/);
    expect(state.investigations[0].reviewFlow.walkthroughs[0].caveats[0]).toBe("Every record here is invented for the sample.");
  });
  it("is offered on the welcome screen, apart from the human's own projects", () => {
    // With projects, the page leads with them; the first visit asks for a topic instead.
    const page = welcomePage({ projects: [{ id: "harbour", name: "The harbour families", updated: "2026-09-26T12:00:00Z" }] });
    expect(page).toContain("Your projects");
    expect(page).toContain('data-open="harbour"');
    expect(page).toContain("Last worked on September 26");
    expect(page).toContain("Start a new project");
    expect(page).toContain("It uses nothing from your account until you write to it.");
    const first = welcomePage({ projects: [] });
    expect(first).not.toContain("Your projects");
    expect(first).toContain("What would you like to research?");
  });
});
