import { GraphModel } from "./model.ts";
import type { Emphasis, FocusProjection, ProjectedNode } from "./types";

function emphasisAt(distance: number): Emphasis {
  if (distance === 0) return "focus";
  if (distance === 1) return "immediate";
  if (distance <= 3) return "near";
  return "remote";
}

// Every node, by how many edges separate it from the focus.
export function projectAround(model: GraphModel, focusId: string): FocusProjection {
  if (!model.hasNode(focusId)) throw new Error(`Unknown focus node: ${focusId}`);
  const distances = new Map<string, number>([[focusId, 0]]);
  const queue = [focusId];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const id = queue[cursor]!;
    for (const connection of model.connectionsFor(id)) {
      const other = connection.fromId === id ? connection.toId : connection.fromId;
      if (distances.has(other)) continue;
      distances.set(other, distances.get(id)! + 1);
      queue.push(other);
    }
  }
  const ordered = [...model.dataset.nodes].sort(
    (a, b) => (distances.get(a.id) ?? Infinity) - (distances.get(b.id) ?? Infinity) || a.name.localeCompare(b.name),
  );
  const nodes = new Map<string, ProjectedNode>();
  ordered.forEach((node, order) => {
    const distance = distances.get(node.id) ?? Infinity;
    nodes.set(node.id, { nodeId: node.id, distance, emphasis: emphasisAt(distance), order });
  });
  return { focusId, nodes };
}
