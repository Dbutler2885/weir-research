// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CallCache } from "../server/call-cache.mjs";

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((clean) => clean()));
function cache() {
  const folder = mkdtempSync(join(tmpdir(), "weir-cache-"));
  cleanups.push(() => rmSync(folder, { recursive: true, force: true }));
  return { folder, cache: new CallCache(folder) };
}
const call = { kind: "reader", model: "codex/gpt-6-luna/high", question: "Who sold the mill?", input: "Ada Example sold the mill." };

describe("the project's cache of calls", () => {
  it("misses a call never made, and returns the answer of one that was", () => {
    const { cache: c } = cache();
    expect(c.get(call)).toBeUndefined();
    c.set(call, { relevant: true, answer: "Ada Example." });
    expect(c.get(call)).toEqual({ relevant: true, answer: "Ada Example." });
    expect(c.get({ ...call })).toEqual({ relevant: true, answer: "Ada Example." });
  });
  it("keeps a different answer for a different kind, model, question or input", () => {
    const { cache: c } = cache();
    c.set(call, "first");
    for (const other of [{ kind: "jev" }, { model: "claude/haiku/default" }, { question: "Who bought the mill?" }, { input: "Ada Example sold the mill. " }]) {
      expect(c.key({ ...call, ...other })).not.toBe(c.key(call));
      expect(c.get({ ...call, ...other })).toBeUndefined();
    }
    c.set({ ...call, model: "claude/haiku/default" }, "second");
    expect([c.get(call), c.get({ ...call, model: "claude/haiku/default" })]).toEqual(["first", "second"]);
    // The parts are kept apart: words moved from the question to the input are another call.
    expect(c.key({ kind: "reader", model: "m", question: "ab", input: "c" })).not.toBe(c.key({ kind: "reader", model: "m", question: "a", input: "bc" }));
  });
  it("is on disk, so everyone opening the project's cache shares it", () => {
    const { folder, cache: c } = cache();
    c.set(call, "kept");
    expect(new CallCache(folder).get(call)).toBe("kept");
  });
});
