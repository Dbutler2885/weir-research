import { describe, expect, it } from "vitest";
import { align, passageDiff, wordDiff, type Words } from "../src/domain/text-diff";

const show = (words: Words) => words.map((w) => (w.kind === "same" ? w.text : w.kind === "removed" ? `[-${w.text}-]` : `{+${w.text}+}`)).join("");

describe("what changed in a passage", () => {
  it("keeps unchanged paragraphs whole and marks only the words that changed", () => {
    const before = "The register lists Thomas Marrow as a net maker.\n\nHis birthplace remains unknown, and the family links still need confirmation.";
    const after = "The register lists Thomas Marrow as a net maker.\n\nThe same register lists Edith in his household. His birthplace remains unknown.";
    const [kept, changed] = passageDiff(before, after);
    expect(kept).toEqual({ kind: "same", text: "The register lists Thomas Marrow as a net maker." });
    expect(changed!.kind).toBe("changed");
    expect(show((changed as { words: Words }).words)).toBe(
      "{+The same register lists Edith in his household.+} His birthplace remains unknown[-, and the family links still need confirmation-].",
    );
  });

  it("reads a reworded phrase as one change, not a scatter of words", () => {
    expect(show(wordDiff("The cat sat on the mat.", "The dog sat on the red mat."))).toBe("The [-cat-]{+dog+} sat on the {+red+} mat.");
    expect(show(wordDiff("It was built in the spring of 1880.", "It was built by the new firm in 1881."))).toBe("It was built [-in the spring of 1880-]{+by the new firm in 1881+}.");
  });

  it("shows added and removed paragraphs as wholes", () => {
    expect(passageDiff("One.\n\nTwo.", "One.\n\nThree is new.").map((p) => p.kind)).toEqual(["same", "removed", "added"]);
    expect(passageDiff("One.", "One.\n\nTwo.")).toEqual([{ kind: "same", text: "One." }, { kind: "added", text: "Two." }]);
  });
});

describe("lining up two lists", () => {
  it("matches items by what they say, so one removed does not shift the rest", () => {
    expect(align(["a first caveat", "a second caveat about Lubec", "a third caveat about Pike"], ["a first caveat", "a third caveat about Pike, reworded"])).toEqual([
      { before: 0, after: 0 },
      { before: 1 },
      { before: 2, after: 1 },
    ]);
  });
});
