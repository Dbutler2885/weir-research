import { describe, expect, it } from "vitest";
import { researchText } from "../src/ui/research-text";

describe("research text", () => {
  it("renders a pipe table with a header row and escaped cells", () => {
    const out = researchText(
      "Before the table.\n\n| Firm | Where |\n|---|---|\n| Example & Sons | **North** <b>Bay</b> |\n| Fictional Works | Village |\n\nAfter.",
    );
    expect(out).toBe(
      '<p class="preserve-lines">Before the table.</p>' +
        '<div class="research-table"><table><thead><tr><th>Firm</th><th>Where</th></tr></thead>' +
        "<tbody><tr><td>Example &amp; Sons</td><td><strong>North</strong> &lt;b&gt;Bay&lt;/b&gt;</td></tr>" +
        "<tr><td>Fictional Works</td><td>Village</td></tr></tbody></table></div>" +
        '<p class="preserve-lines">After.</p>',
    );
  });

  it("keeps pipe text without a separator row as a paragraph", () => {
    expect(researchText("| not | a table |")).toBe('<p class="preserve-lines">| not | a table |</p>');
  });
});
