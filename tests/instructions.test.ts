import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ResearcherPool, BROWSER_INSTRUCTIONS } from "../server/researchers.mjs";
import { Jobs } from "../server/jobs.mjs";
import { READER_INSTRUCTIONS } from "../src/domain/reader.ts";
import { buildCoordinatorContext } from "../src/domain/coordinator-context.ts";
import { projectSkills } from "../server/skills.mjs";
import { initialState } from "../src/domain/research.ts";
import { emptyGraph } from "../src/domain/graph-schema.ts";

// Every instruction the app gives the agents that research: what the pool and the jobs
// write for a researcher and a helper, the coordinator's instructions and skills, and
// the context a coordinator starts from.
const seats = [1, 2].map((n) => ({ id: `seat-${n}`, title: `Researcher ${n}`, status: "running", checkpoints: [] }));
const batch = { id: "batch-a", number: 1, title: "The fictional mill", goal: "Find who bought the fictional Example mill, and when.", scope: ["web"], assignments: seats, proposals: [], events: [], annotations: [], board: [], status: "running" };
const pool = { library: "/project/library" };
const researcher = (web: boolean) => (ResearcherPool.prototype as any).instructions.call(pool, batch, { title: "Researcher 1" }, web) as string;
const opening = (task: object, waiting: object[] = []) => (ResearcherPool.prototype as any).opening.call(pool, batch, { ...seats[0], unreachable: [{ url: "https://example.org/archive", instruction: "Sign in to the fictional archive." }] }, { title: "Researcher 1", ...task }, waiting) as string;
const waiting = [{ file: "001-post.json", kind: "post", from: "Researcher 2", text: "The fictional register is at the county office.", at: "2026-01-01T00:00:00Z" }];
const helper = (web: boolean) => (Jobs.prototype as any).instructions.call(pool, { seat: "seat-1" }, batch, web, web) as string;
const file = (path: string) => readFileSync(path, "utf8");
const state = { ...initialState(emptyGraph()), investigations: [batch] } as any;
const texts: Record<string, string> = {
  // As a researcher with the research browser is started: its instructions, then the browser's.
  "the researcher's instructions, with the web and the browser": `${researcher(true)}${BROWSER_INSTRUCTIONS}`,
  "the researcher's instructions, from the library": researcher(false),
  "the researcher's first message": opening({}),
  "the researcher's first message, in a seat held before": opening({}, waiting),
  "the researcher's message when its conversation is picked up": opening({ resuming: "session-1" }),
  "the researcher's message when it is picked up with posts waiting": opening({ resuming: "session-1" }, waiting),
  "the helper's instructions, with the web": helper(true),
  "the helper's instructions, from the library": helper(false),
  "the reader's instructions": READER_INSTRUCTIONS,
  "the coordinator's instructions": file("server/agents/coordinator/AGENTS.md"),
  "the coordinate-research skill": file("skills/coordinate-research/SKILL.md"),
  "the research-contract skill": file("skills/research-contract/SKILL.md"),
  "the coordinator's startup context": buildCoordinatorContext(state, { skills: projectSkills(".") as any }).text,
};

// What a limit on the research, a bounded pass or the old route's files would read like.
const count = "(\\d+|one|two|three|four|five|ten|twenty|a single|a few)";
const LIMITS = new RegExp(
  [
    "bounded", "retrieval limit", "time limit", "deadline", "budget", "out of scope", "result\\.json", "brief\\.md", "post\\.md",
    `\\b${count} distinct`,
    `\\b(at most|no more than|up to|a maximum of|limited to|only) ${count} (\\w+ )?(sources?|retrievals?|searches|pages|documents|minutes|hours|turns)`,
    `\\b(stop|finish|end|wrap up|return) (after|within|once you have read|when you have read) ${count}`,
    `\\bwithin ${count} (minutes|hours)`,
    "\\b(one|a single) pass\\b",
    "\\buntil time runs out",
  ].join("|"),
  "i",
);

describe("the instructions the research agents work from", () => {
  it("would be caught setting a limit, however it was put", () => {
    for (const limit of [
      "Stop after 10 sources.",
      "Spend no more than 30 minutes researching.",
      "Make one pass through the archive, then finish.",
      "Read at most twenty distinct sources.",
      "This is a bounded investigation.",
      "Finish within 2 hours.",
      "You have a budget of retrievals.",
      "Write result.json when you are done.",
      "Anything else is out of scope.",
      "Return after a single pass over the register.",
    ])
      expect(limit).toMatch(LIMITS);
    for (const fine of ["There is no limit on how many sources you read or how long you work: go on for as long as leads remain.", "Code running longer than a few minutes carries on.", "up to about 100,000 characters each"]) expect(fine).not.toMatch(LIMITS);
  });

  it.each(Object.keys(texts))("%s set no limit on retrievals or time and frame no bounded pass", (name) => {
    expect(texts[name]).toBeTruthy();
    expect(texts[name]).not.toMatch(LIMITS);
  });

  it("give the researcher the goal, the board, the library, the session and its package, and the done phrase", () => {
    const text = researcher(true);
    expect(opening({ resuming: "session-1" }, waiting)).toContain("The fictional register is at the county office.");
    for (const part of ["## The goal", "## The board", "## The research library", "## Your Python session", "## Findings", "RESEARCH DONE"]) expect(text).toContain(part);
    for (const call of ["weir.post", "weir.save", "weir.save_page", "weir.save_image", "weir.jev", "weir.reader", "weir.helper", "weir.publish", "weir.reconcile", "weir.library"]) expect(text).toContain(call);
    // Source text and sub-call answers stay in the session.
    expect(text).toContain("print only what you need to decide your next step");
    expect(text).toContain("when nothing you or the board offers is left to pursue".replace(/^w/, "W"));
    expect(text).toContain("go on for as long as leads remain");
    // The team checks with one another before publishing, so each thing is published once.
    expect(text).toContain('Before you publish a finding, post it on the board in a line beginning "About to publish:"');
    expect(text).toContain("When a teammate offered or published it before you, it is theirs");
    expect(text).toContain("ask on the board when you are unsure");
  });

  it("describe a helper's errand: do it, save every source read, and answer with exact quotes and document IDs", () => {
    const text = helper(true);
    expect(text).toContain("sent on one errand");
    expect(text).toContain("Save every source you read, with weir.save, weir.save_page or weir.save_image");
    expect(text).toContain('"quotes": [{"document": "<saved document\'s ID>", "page": <page number>, "quote": "<exact words from the saved text>"}]');
    expect(text).not.toMatch(/weir\.post|weir\.publish|weir\.helper/);
  });

  it("have the coordinator open batches with a goal it leaves whole, and do none of the researchers' work", () => {
    const text = `${texts["the coordinator's instructions"]}\n${texts["the coordinate-research skill"]}`;
    expect(text).toContain('{"action":"open-batch","title":"...","goal":"..."}');
    expect(text).toContain("restated plainly and whole");
    expect(text).toContain("leave the dividing to the team");
    expect(text).toContain("Keep to what the human said");
    expect(text).toContain("Address every post to the team as a whole.");
    expect(text).toContain("theirs to work out among themselves on the board");
    // The commands it lost: assigning, steering or stopping one researcher, sending work back, publishing results and marking a batch ready.
    expect(text).not.toMatch(/"action":"(assign|steer|stop-assignment|send-back|publish-findings|publish|ready|brief)"/);
    expect(text).not.toMatch(/\bbrief each researcher|write (a|each) researcher'?s? brief/i);
  });

  it("state the evidence contract for saved documents, transcriptions and one finding at a time", () => {
    const text = texts["the research-contract skill"]!;
    expect(text).toContain("Evidence comes from saved documents only.");
    expect(text).toContain("marked as transcribed");
    expect(text).toContain("Researchers publish findings one at a time");
    expect(projectSkills(".").find((s: any) => s.name === "research-contract")!.description).toContain("saved documents");
  });
});
