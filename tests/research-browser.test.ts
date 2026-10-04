import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ResearchBrowser } from "../server/research-browser.mjs";

describe("the research browser", () => {
  it("says why when its browser is no longer there, and the app carries on", async () => {
    const home = mkdtempSync(join(tmpdir(), "weir-browser-"));
    try {
      const gone = join(home, "removed-browser");
      const browser = new ResearchBrowser(home, { browser: { path: gone, name: "A removed browser", engine: "chromium", isDefault: false } });
      await expect(browser.open()).rejects.toThrow(`The research browser did not start: ${gone} is not there`);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
