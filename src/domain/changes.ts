import { GraphModel } from "./model.ts";
import type { GraphDataset } from "./types.ts";
import type { Change, Table } from "./research.ts";

function requireThat(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function nonempty(value: unknown, label: string): asserts value is string {
  requireThat(
    typeof value === "string" &&
      value.trim().length > 0 &&
      value.length <= 50_000,
    `${label} is required (maximum 50,000 characters).`,
  );
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export function applyChanges(
  dataset: GraphDataset,
  changes: Change[],
): GraphDataset {
  const next = structuredClone(dataset);
  const touched = new Set<string>();
  const tables: Table[] = ["nodes", "claims", "sources"];
  requireThat(Array.isArray(changes), "Changes must be a list.");
  for (const change of changes) {
    requireThat(tables.includes(change.table), "Unknown record collection.");
    nonempty(change.recordId, "Record identifier");
    nonempty(change.reason, "Change reason");
    const key = `${change.table}:${change.recordId}`;
    requireThat(
      !touched.has(key),
      "A proposal cannot change the same record twice.",
    );
    touched.add(key);
    const records = (next[change.table] ??= [] as never) as unknown as Record<
      string,
      unknown
    >[];
    const index = records.findIndex((r) => r.id === change.recordId);
    const current = index < 0 ? null : records[index];
    requireThat(
      canonical(current) === canonical(change.before),
      `Research changed since this proposal was prepared: ${change.recordId}. Request a revised proposal.`,
    );
    requireThat(
      change.before !== null || change.after !== null,
      "Empty change.",
    );
    if (change.after === null) records.splice(index, 1);
    else {
      requireThat(
        typeof change.after === "object" && change.after.id === change.recordId,
        "Replacement must preserve the record identifier.",
      );
      if (index < 0) records.push(structuredClone(change.after));
      else records[index] = structuredClone(change.after);
    }
  }
  if (
    next.initialFocusId &&
    !next.nodes.some((n) => n.id === next.initialFocusId)
  )
    next.initialFocusId = null;
  new GraphModel(next);
  return next;
}
