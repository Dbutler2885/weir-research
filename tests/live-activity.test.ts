// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import dataset from "./fixtures/workshop.json";
import { WorkspaceStore } from "../server/store.mjs";
import { ResearcherPool } from "../server/researchers.mjs";
import { Coordinator } from "../server/coordinator.mjs";
import {
  LiveActivity,
  builderFiles,
  fileDescriber,
  streamActions,
  streamReader,
} from "../server/live-activity.mjs";

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).reverse().forEach((clean) => clean()));
function store() {
  const directory = mkdtempSync(join(tmpdir(), "live-activity-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  return { directory, store: new WorkspaceStore(directory, dataset) };
}
const tool = (name: string, input: object) => ({ type: "assistant", message: { content: [{ type: "tool_use", name, input }] } });

describe("reading what a worker is doing from its output", () => {
  const builder = fileDescriber(builderFiles);
  it("names a builder's Claude tool calls in plain words", () => {
    expect(streamActions(tool("Read", { file_path: "/x/work/packet.json" }), builder)).toEqual(["Reading the research for this batch"]);
    expect(streamActions(tool("Edit", { file_path: "/x/work/edges.csv" }), builder)).toEqual(["Editing the edges table"]);
    expect(streamActions(tool("Grep", { pattern: "Wolff & Ressing" }), builder)).toEqual(["Searching for “Wolff & Ressing”"]);
    // Its own status file and its thinking are not actions to report.
    expect(streamActions(tool("Write", { file_path: "status.txt" }), builder)).toEqual([]);
    expect(streamActions({ type: "assistant", message: { content: [{ type: "text", text: "Thinking" }] } }, builder)).toEqual([]);
  });
  it("names Codex's commands, file changes, and searches", () => {
    expect(streamActions({ type: "item.started", item: { type: "command_execution", command: "bash -lc 'cat nodes.csv'" } }, builder)).toEqual(["Reading the nodes table"]);
    expect(streamActions({ type: "item.completed", item: { type: "file_change", changes: [{ path: "questions.csv", kind: "update" }] } }, builder)).toEqual(["Writing down open questions"]);
    expect(streamActions({ type: "item.started", item: { type: "web_search", query: "Lubec cannery 1880" } }, builder)).toEqual(["Searching the web for “Lubec cannery 1880”"]);
  });
  it("names a source by its title and a page by its site", () => {
    const researcher = fileDescriber({}, { "doc-1.pdf": "The fictional register" });
    expect(streamActions(tool("Read", { file_path: "documents/doc-1.pdf" }), researcher)).toEqual(["Reading The fictional register"]);
    expect(streamActions(tool("WebFetch", { url: "https://www.example.org/a" }), researcher)).toEqual(["Reading a page on example.org"]);
  });
  it("reads lines split across chunks", () => {
    const seen: string[] = [];
    const follow = streamReader(builder, (text: string) => seen.push(text));
    const line = JSON.stringify(tool("Read", { file_path: "nodes.csv" }));
    follow(Buffer.from(line.slice(0, 20)));
    follow(Buffer.from(`${line.slice(20)}\nnot json\n`));
    expect(seen).toEqual(["Reading the nodes table"]);
  });
});

describe("live activity", () => {
  it("reports a researcher's latest action while it runs, and forgets it when it stops", () => {
    const { directory, store: s } = store();
    const live = new LiveActivity();
    let child: any;
    const launch = () => (child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, kill() {},
    }));
    const pool = new ResearcherPool(s, directory, resolve("."), { launch: launch as any, findExecutable: (n: string) => `/test/${n}`, live });
    cleanups.push(() => pool.stop());
    const { investigationId } = s.command({ type: "annotate", question: "Investigate", target: { label: "Record" }, dispatch: true }) as any;
    pool.choose("claude");
    expect(live.list()).toMatchObject([{ role: "researcher", name: "Claude researcher", investigationId, latest: null }]);
    child.stdout.write(`${JSON.stringify(tool("Write", { file_path: "checkpoint.json" }))}\n`);
    expect(live.list()[0]!.latest!.text).toBe("Saving its progress");
    child.emit("close", 1);
    expect(live.list()).toEqual([]);
  });

  it("says whether the app's coordinator is listening or working, and what it last did", () => {
    const { store: s } = store();
    const coordinator = new Coordinator(s);
    const secret = randomUUID();
    // The app's coordinator host reports whether its agent is mid-turn.
    const host = { secret, busy: false, status() { return { connected: true, listening: !this.busy }; } };
    coordinator.host = host as any;
    coordinator.attach("Coordinator", secret);
    expect(coordinator.status()).toMatchObject({ connected: true, listening: true, latest: null });
    host.busy = true;
    coordinator.noteText("Reading its instructions");
    expect(coordinator.status()).toMatchObject({ listening: false, latest: { text: "Reading its instructions" } });
    coordinator.command({ action: "search", query: "founder", session: secret });
    expect(coordinator.status().latest!.text).toBe("Searching the project for “founder”");
    host.busy = false;
    expect(coordinator.status()).toMatchObject({ listening: true, latest: { text: "Searching the project for “founder”" } });
  });

  it("shows an outside coordinator as working, never as listening", () => {
    const { store: s } = store();
    const coordinator = new Coordinator(s);
    const secret = randomUUID();
    coordinator.attach("Outside", secret);
    expect(coordinator.status()).toMatchObject({ connected: true, listening: false });
  });
});
