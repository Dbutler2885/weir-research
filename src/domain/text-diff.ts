// What changed between two versions of a passage, in pieces a reader can follow:
// whole paragraphs kept, added or removed, and inside a reworded paragraph the words.

export type Words = { kind: "same" | "removed" | "added"; text: string }[];
export type Paragraph =
  | { kind: "same" | "removed" | "added"; text: string }
  | { kind: "changed"; words: Words };
// A step through two lists: an item kept or changed (both sides), removed, or added.
export type Aligned = { before?: number; after?: number };

// Words and marks, each with the space after it, so spaces alone never count as kept.
const tokens = (text: string) => text.match(/^\s+|[\p{L}\p{N}’'-]+\s*|[^\s\p{L}\p{N}’'-]\s*/gu) || [];
const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}’'-]+/gu) || [];

// How much two texts share, from 0 to 1, by their words.
export function similarity(a: string, b: string): number {
  const x = words(a), y = words(b);
  if (!x.length && !y.length) return 1;
  const left = new Map<string, number>();
  for (const w of x) left.set(w, (left.get(w) || 0) + 1);
  let shared = 0;
  for (const w of y) if (left.get(w)) { shared++; left.set(w, left.get(w)! - 1); }
  return (2 * shared) / (x.length + y.length);
}

// Lines two lists up in order: identical items first, then items similar enough to be
// the same one reworded. Everything else was removed or added.
export function align(before: string[], after: string[], similarEnough = 0.4): Aligned[] {
  const score = (i: number, j: number) => {
    const a = before[i]!.trim(), b = after[j]!.trim();
    if (a === b) return 2;
    const s = similarity(a, b);
    return s >= similarEnough ? s : -1;
  };
  const n = before.length, m = after.length;
  const best = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) {
      const pair = score(i, j);
      best[i]![j] = Math.max(best[i + 1]![j]!, best[i]![j + 1]!, pair < 0 ? 0 : pair + best[i + 1]![j + 1]!);
    }
  const steps: Aligned[] = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m) {
      const pair = score(i, j);
      if (pair >= 0 && best[i]![j] === pair + best[i + 1]![j + 1]!) { steps.push({ before: i++, after: j++ }); continue; }
    }
    // Within a gap, what went comes before what came.
    if (i < n && (j === m || best[i]![j] === best[i + 1]![j])) steps.push({ before: i++ });
    else steps.push({ after: j++ });
  }
  return steps;
}

// The words that changed between two versions of a sentence or paragraph. A word or
// two kept between changes is folded into them, so a rewrite reads as one change.
export function wordDiff(before: string, after: string): Words {
  const a = tokens(before), b = tokens(after);
  // A word is the same one whatever space follows it; kept text reads as it now does.
  const x = a.map((t) => t.trim()), y = b.map((t) => t.trim());
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--) lcs[i]![j] = x[i] === y[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  // Runs of kept text, and changes as what was removed and what was added.
  type Run = { same: string } | { removed: string; added: string };
  const runs: Run[] = [];
  const kept = (text: string) => {
    const last = runs.at(-1);
    if (last && "same" in last) last.same += text;
    else runs.push({ same: text });
  };
  const changed = (kind: "removed" | "added", text: string) => {
    let last = runs.at(-1);
    if (!last || "same" in last) runs.push((last = { removed: "", added: "" }));
    (last as { removed: string; added: string })[kind] += text;
  };
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && x[i] === y[j]) { kept(b[j]!); i++; j++; }
    else if (i < a.length && (j === b.length || lcs[i + 1]![j]! >= lcs[i]![j + 1]!)) changed("removed", a[i++]!);
    else changed("added", b[j++]!);
  }
  // Fold short kept stretches, such as a space or "the", into the changes around them.
  for (let k = 1; k < runs.length - 1; k++) {
    const [prev, run, next] = [runs[k - 1]!, runs[k]!, runs[k + 1]!];
    if ("same" in run && !("same" in prev) && !("same" in next) && words(run.same).length <= 1) {
      prev.removed += run.same + next.removed;
      prev.added += run.same + next.added;
      runs.splice(k, 2);
      k--;
    }
  }
  const out: Words = [];
  const push = (kind: Words[number]["kind"], text: string) => {
    if (!text) return;
    const last = out.at(-1);
    if (last && last.kind === kind) last.text += text;
    else out.push({ kind, text });
  };
  for (const run of runs) {
    if ("same" in run) { push("same", run.same); continue; }
    // Spaces at a change's edges, on both sides of it, stay outside the marks.
    const edge = (pattern: RegExp) => {
      const x = run.removed.match(pattern)![0], y = run.added.match(pattern)![0];
      return !run.removed ? y : !run.added ? x : x.length <= y.length ? x : y;
    };
    const lead = edge(/^\s*/), trail = edge(/\s*$/);
    const inner = (s: string) => (s ? s.slice(lead.length, s.length - trail.length) : "");
    push("same", lead);
    push("removed", inner(run.removed));
    push("added", inner(run.added));
    push("same", trail);
  }
  return out;
}

// A passage's paragraphs, each kept, removed, added, or changed word by word.
export function passageDiff(before: string, after: string): Paragraph[] {
  const split = (text: string) => text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const a = split(before), b = split(after);
  return align(a, b).map(({ before: i, after: j }): Paragraph => {
    if (i === undefined) return { kind: "added", text: b[j!]! };
    if (j === undefined) return { kind: "removed", text: a[i]! };
    return a[i] === b[j] ? { kind: "same", text: a[i]! } : { kind: "changed", words: wordDiff(a[i]!, b[j]!) };
  });
}
