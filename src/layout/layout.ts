// Where every node and line of the graph goes.
//
// There is one layout for every graph. Relationships the project ranks, such as a
// parent above a child, put their nodes in rows; paired ones, such as a couple, set
// them side by side; everything else arranges itself freely around them. Ranked and
// paired relationships are drawn as family-tree lines: a bar joining a couple, and a
// line dropping from it to their children.
import { GraphModel } from "../domain/model";
import type { Confidence, Emphasis, FocusProjection } from "../domain/types";
import { layoutNetwork, type StructureLink } from "./network";
import { nodeSize } from "./node-size";

export interface LayoutNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  emphasis: Emphasis;
}

export interface LayoutPoint {
  x: number;
  y: number;
}

export interface LayoutEdge {
  // The edge the line draws, so selecting it opens that statement.
  id: string;
  sourceId: string;
  targetId: string;
  confidence: Confidence;
  kind: "family" | "connection";
  label?: string;
  points: LayoutPoint[];
  curved?: boolean;
}

export interface GraphLayout {
  focusId: string;
  width: number;
  height: number;
  nodes: LayoutNode[];
  edges: LayoutEdge[];
}

// Each node's row, for nodes joined by ranked or paired relationships. A node takes
// the first row it is reached at, so a contradiction, such as a disputed parent, never
// puts one node in two rows. Each group's top row is row zero.
export function rowsOf(model: GraphModel): Map<string, number> {
  const steps = new Map<string, { to: string; step: number }[]>();
  const add = (from: string, to: string, step: number) => steps.set(from, [...(steps.get(from) ?? []), { to, step }]);
  for (const c of model.connections) {
    if (c.arrangement === "free") continue;
    const step = c.arrangement === "ranked" ? 1 : 0;
    add(c.fromId, c.toId, step);
    add(c.toId, c.fromId, -step);
  }
  const rows = new Map<string, number>();
  for (const start of [...steps.keys()].sort()) {
    if (rows.has(start)) continue;
    const group = [start];
    rows.set(start, 0);
    for (let i = 0; i < group.length; i++) {
      const id = group[i]!;
      for (const { to, step } of steps.get(id)!) {
        if (rows.has(to)) continue;
        rows.set(to, rows.get(id)! + step);
        group.push(to);
      }
    }
    const top = Math.min(...group.map((id) => rows.get(id)!));
    for (const id of group) rows.set(id, rows.get(id)! - top);
  }
  return rows;
}

const center = (node: LayoutNode) => ({ x: node.x + node.width / 2, y: node.y + node.height / 2 });

type Child = { node: LayoutNode; edgeId: string; confidence: Confidence; parentId: string };

// Lines from a point above a row of children down to each child. The first line
// carries the trunk; the rest share the bar between the children without overlapping,
// so no stretch of line is drawn twice.
function drops(from: LayoutPoint, children: Child[]): LayoutEdge[] {
  if (!children.length) return [];
  const barY = Math.min(...children.map((c) => c.node.y)) - 28;
  const sorted = [...children].sort((a, b) => center(a.node).x - center(b.node).x);
  const left = sorted.filter((c) => center(c.node).x < from.x).reverse();
  const right = sorted.filter((c) => center(c.node).x >= from.x);
  const edges: LayoutEdge[] = [];
  for (const side of [right, left]) {
    let start = from.x;
    for (const child of side) {
      const x = center(child.node).x;
      const trunk = edges.length ? [] : [{ x: from.x, y: from.y }];
      edges.push({
        id: child.edgeId,
        sourceId: child.parentId,
        targetId: child.node.id,
        confidence: child.confidence,
        kind: "family",
        points: [...trunk, { x: start, y: barY }, { x, y: barY }, { x, y: child.node.y }],
      });
      start = x;
    }
  }
  return edges;
}

function familyLines(model: GraphModel, byId: Map<string, LayoutNode>): LayoutEdge[] {
  const edges: LayoutEdge[] = [];
  for (const union of model.unionsById.values()) {
    const [a, b] = union.partnerIds.map((id) => byId.get(id)!).sort((p, q) => p.x - q.x);
    if (!a || !b) continue;
    const ya = center(a).y;
    const yb = center(b).y;
    const start = { x: a.x + a.width, y: ya };
    const end = { x: b.x, y: yb };
    const middle = (start.x + end.x) / 2;
    edges.push({
      id: union.id,
      sourceId: a.id,
      targetId: b.id,
      confidence: union.confidence ?? "established",
      kind: "family",
      points: ya === yb ? [start, end] : [start, { x: middle, y: ya }, { x: middle, y: yb }, end],
    });
    const children = (union.childIds ?? []).flatMap((childId): Child[] => {
      const link = model.parentsOf(childId).find((l) => l.unionId === union.id);
      const node = byId.get(childId);
      return link && node ? [{ node, edgeId: link.id, confidence: link.confidence, parentId: link.parentId }] : [];
    });
    edges.push(...drops({ x: middle, y: (ya + yb) / 2 }, children));
  }
  const byParent = new Map<string, (typeof model.parentLinks)[number][]>();
  for (const link of model.directParentLinks) byParent.set(link.parentId, [...(byParent.get(link.parentId) ?? []), link]);
  for (const [parentId, links] of byParent) {
    const parent = byId.get(parentId)!;
    const children = links.map((link) => ({ node: byId.get(link.childId)!, edgeId: link.id, confidence: link.confidence, parentId }));
    edges.push(...drops({ x: center(parent).x, y: parent.y + parent.height }, children));
  }
  return edges;
}

export function layoutGraph(model: GraphModel, projection: FocusProjection): GraphLayout {
  const nodes: LayoutNode[] = model.dataset.nodes.map((node) => ({
    id: node.id,
    x: 0,
    y: 0,
    ...nodeSize(node.name),
    emphasis: projection.nodes.get(node.id)?.emphasis ?? "remote",
  }));
  const free: LayoutEdge[] = model.connections
    .filter((c) => c.arrangement === "free")
    .map((c) => ({
      id: c.id,
      sourceId: c.fromId,
      targetId: c.toId,
      confidence: c.confidence,
      kind: "connection",
      label: c.claim.predicate.replaceAll("_", " "),
      points: [],
    }));
  const links: StructureLink[] = model.connections
    .filter((c) => c.arrangement !== "free")
    .map((c) => ({ source: c.fromId, target: c.toId, arrangement: c.arrangement as StructureLink["arrangement"] }));
  const layout = layoutNetwork(projection.focusId, nodes, free, { rows: rowsOf(model), links });
  const lines = familyLines(model, new Map(layout.nodes.map((node) => [node.id, node])));
  const edges = [...lines, ...layout.edges];
  // Family lines stay among the cards they join, but a contradiction can send one outside.
  const points = edges.flatMap((edge) => edge.points);
  const shiftX = Math.max(0, 32 - Math.min(Infinity, ...points.map((p) => p.x)));
  const shiftY = Math.max(0, 32 - Math.min(Infinity, ...points.map((p) => p.y)));
  for (const node of layout.nodes) { node.x += shiftX; node.y += shiftY; }
  for (const point of points) { point.x += shiftX; point.y += shiftY; }
  return {
    ...layout,
    edges,
    width: Math.max(layout.width + shiftX, ...points.map((p) => p.x + 32)),
    height: Math.max(layout.height + shiftY, ...points.map((p) => p.y + 32)),
  };
}
