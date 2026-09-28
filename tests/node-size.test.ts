// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { nodeSize, NODE_WIDTH } from "../src/layout/node-size";

describe("node card size", () => {
  it("keeps short names at the standard two-line card", () => {
    expect(nodeSize("Example Bay")).toEqual({ width: NODE_WIDTH, height: 83 });
  });

  it("grows for a longer name and stops at four lines", () => {
    const long = nodeSize("Example sardine cannery built at Example Bay, fall 1880 (federal survey; firm unnamed)");
    const longer = nodeSize("Example sardine cannery built at Example Bay, fall 1880 (federal survey; firm unnamed), as described in the fictional county history of 1914");
    expect(long.height).toBeGreaterThan(83);
    expect(long.height).toBeLessThanOrEqual(112);
    // Four lines is the ceiling; the record holds the untruncated name.
    expect(longer.height).toBe(112);
  });
});
