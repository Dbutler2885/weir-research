import { forceCollide, forceLink, forceManyBody, forceRadial, forceSimulation, type SimulationNodeDatum } from "d3";
import type { GraphLayout, LayoutEdge, LayoutNode } from "./layout";

interface Particle extends SimulationNodeDatum {
  id: string;
  x: number;
  y: number;
  radius: number;
  distance: number;
}

type Point = {x: number; y: number};

// For a connection that cannot clear the cards with a single bend, find a
// short path through the free space between their corners.
function routeAroundCards(start: Point, end: Point, cards: LayoutNode[]): Point[] | undefined {
  const boxes = cards.map(card => ({left: card.x - 16, right: card.x + card.width + 16, top: card.y - 16, bottom: card.y + card.height + 16}));
  const points = [start, end, ...boxes.flatMap(box => [
    {x: box.left - 1, y: box.top - 1}, {x: box.right + 1, y: box.top - 1},
    {x: box.left - 1, y: box.bottom + 1}, {x: box.right + 1, y: box.bottom + 1},
  ])];
  const clear = (a: Point, b: Point) => !boxes.some(box => {
    let lower = 0, upper = 1;
    for (const [origin, delta, min, max] of [[a.x, b.x - a.x, box.left, box.right], [a.y, b.y - a.y, box.top, box.bottom]]) {
      if (Math.abs(delta!) < 1e-8) {
        if (origin! <= min! || origin! >= max!) return false;
      } else {
        const t1 = (min! - origin!) / delta!, t2 = (max! - origin!) / delta!;
        lower = Math.max(lower, Math.min(t1, t2));
        upper = Math.min(upper, Math.max(t1, t2));
        if (lower >= upper) return false;
      }
    }
    return lower < upper;
  });
  const costs = points.map(() => Infinity), previous = points.map(() => -1);
  const visited = new Set<number>();
  costs[0] = 0;
  while (visited.size < points.length) {
    let index = -1;
    for (let i = 0; i < points.length; i++) if (!visited.has(i) && (index < 0 || costs[i]! < costs[index]!)) index = i;
    if (index < 0 || !Number.isFinite(costs[index]!)) return undefined;
    if (index === 1) {
      const path: Point[] = [];
      for (let cursor = 1; cursor >= 0; cursor = previous[cursor]!) path.unshift(points[cursor]!);
      return path;
    }
    visited.add(index);
    for (let i = 0; i < points.length; i++) {
      if (visited.has(i) || !clear(points[index]!, points[i]!)) continue;
      const cost = costs[index]! + Math.hypot(points[i]!.x - points[index]!.x, points[i]!.y - points[index]!.y);
      if (cost < costs[i]!) { costs[i] = cost; previous[i] = index; }
    }
  }
  return undefined;
}

function cardBoundary(node: LayoutNode, center: Point, toward: Point): Point {
  const vx = toward.x - center.x, vy = toward.y - center.y;
  const scale = 1 / Math.max(Math.abs(vx) / (node.width / 2 + 4), Math.abs(vy) / (node.height / 2 + 4), 0.001);
  return {x: center.x + vx * scale, y: center.y + vy * scale};
}

// The distance between the rows of a ranked relationship, such as parents and children.
export const ROW = 250;

// Ranked and paired relationships: the target sits a row below its source, or beside it.
export interface StructureLink {
  source: string;
  target: string;
  arrangement: "ranked" | "paired";
}

// Pulls each ranked pair a row apart and each paired pair level, as the simulation runs.
function rowForce(links: StructureLink[], strength: number) {
  let byId = new Map<string, Particle>();
  const force = (alpha: number) => {
    for (const link of links) {
      const source = byId.get(link.source), target = byId.get(link.target);
      if (!source || !target) continue;
      const wanted = link.arrangement === "ranked" ? ROW : 0;
      const error = (target.y - source.y - wanted) * strength * alpha;
      source.vy = (source.vy ?? 0) + error / 2;
      target.vy = (target.vy ?? 0) - error / 2;
    }
  };
  force.initialize = (particles: Particle[]) => { byId = new Map(particles.map(p => [p.id, p])); };
  return force;
}

// Nodes joined by ranked or paired relationships, grouped, with each one's row.
function rowGroups(nodeIds: string[], rows: Map<string, number>, links: StructureLink[]): string[][] {
  const parent = new Map(nodeIds.map(id => [id, id]));
  const find = (id: string): string => (parent.get(id) === id ? id : find(parent.get(id)!));
  for (const link of links) parent.set(find(link.source), find(link.target));
  const groups = new Map<string, string[]>();
  for (const id of nodeIds) if (rows.has(id)) groups.set(find(id), [...(groups.get(find(id)) ?? []), id]);
  return [...groups.values()];
}

// A stable starting order and a stopped simulation keep the graph reproducible.
// Free relationships have no direction on screen; ranked ones put their target in the
// row below, so a family reads as a family tree inside the same network.
export function layoutNetwork(
  focusId: string,
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  structure: { rows: Map<string, number>; links: StructureLink[] } = { rows: new Map(), links: [] },
): GraphLayout {
  const neighbors = new Map(nodes.map(node => [node.id, new Set<string>()]));
  for (const link of [...edges.map(edge => ({ source: edge.sourceId, target: edge.targetId })), ...structure.links]) {
    neighbors.get(link.source)!.add(link.target);
    neighbors.get(link.target)!.add(link.source);
  }
  const distance = new Map([[focusId, 0]]);
  const queue = [focusId];
  for (const id of queue) {
    for (const other of [...neighbors.get(id)!].sort()) {
      if (!distance.has(other)) {
        distance.set(other, distance.get(id)! + 1);
        queue.push(other);
      }
    }
  }
  const outerDistance = Math.max(...distance.values()) + 1;
  const rings = new Map<number, LayoutNode[]>();
  for (const node of [...nodes].sort((a, b) => a.id.localeCompare(b.id))) {
    const hop = distance.get(node.id) ?? outerDistance;
    const ring = rings.get(hop) ?? [];
    ring.push(node);
    rings.set(hop, ring);
    node.emphasis = hop === 0 ? "focus" : hop === 1 ? "immediate" : hop === 2 ? "near" : "remote";
  }
  const radii = new Map<number, number>([[0, 0]]);
  for (const hop of [...rings.keys()].sort((a, b) => a - b)) {
    if (hop === 0) continue;
    radii.set(hop, Math.max((radii.get(hop - 1) ?? 0) + 300, rings.get(hop)!.length * 270 / (2 * Math.PI)));
  }
  const focusRow = structure.rows.get(focusId);
  const particles: Particle[] = [];
  for (const [hop, ring] of rings) {
    ring.forEach((node, index) => {
      const angle = index * 2 * Math.PI / ring.length - Math.PI / 2;
      const radius = radii.get(hop)!;
      const row = structure.rows.get(node.id);
      particles.push({
        id: node.id, distance: hop,
        x: Math.cos(angle) * radius,
        // A node in the focus's family starts in its row.
        y: row !== undefined && focusRow !== undefined ? (row - focusRow) * ROW : Math.sin(angle) * radius,
        radius: Math.hypot(node.width, node.height) / 2 + 28,
        ...(node.id === focusId ? { fx: 0, fy: 0 } : {}),
      });
    });
  }
  // Multiple assertions between the same pair should not multiply its attraction.
  const pairs = new Map<string, { source: string; target: string; length: number }>();
  for (const edge of edges) pairs.set([edge.sourceId, edge.targetId].sort().join("\0"), { source: edge.sourceId, target: edge.targetId, length: 320 });
  for (const link of structure.links)
    pairs.set([link.source, link.target].sort().join("\0"), { source: link.source, target: link.target, length: link.arrangement === "ranked" ? ROW : 290 });
  const forces = () => forceSimulation(particles).stop()
    .force("link", forceLink<Particle, { source: string; target: string; length: number }>([...pairs.values()]).id(node => node.id).distance(link => link.length).strength(0.12))
    .force("charge", forceManyBody<Particle>().strength(-650))
    .force("radial", forceRadial<Particle>(node => radii.get(node.distance)!, 0, 0).strength(0.45))
    .force("collision", forceCollide<Particle>(node => node.radius).strength(1).iterations(4));
  forces().force("rows", rowForce(structure.links, 0.6)).tick(400);

  // Rows are exact: each group of related nodes is set on its rows, spread so no two
  // cards in a row overlap, and held there while everything else settles around it.
  const positions = new Map(particles.map(node => [node.id, node]));
  const sizes = new Map(nodes.map(node => [node.id, node]));
  const held = rowGroups(nodes.map(node => node.id), structure.rows, structure.links);
  for (const group of held) {
    const members = group.map(id => positions.get(id)!);
    const anchor = members.reduce((sum, p) => sum + p.y - structure.rows.get(p.id)! * ROW, 0) / members.length;
    for (const p of members) p.y = anchor + structure.rows.get(p.id)! * ROW;
  }
  // A couple is one unit in its row, partners side by side, so no one lands between them.
  const placed = held.flat().map(id => positions.get(id)!);
  const partner = new Map(placed.map(p => [p.id, p.id]));
  const root = (id: string): string => (partner.get(id) === id ? id : root(partner.get(id)!));
  for (const link of structure.links)
    if (link.arrangement === "paired" && partner.has(link.source) && partner.has(link.target) && positions.get(link.source)!.y === positions.get(link.target)!.y)
      partner.set(root(link.source), root(link.target));
  const unitsById = new Map<string, Particle[]>();
  for (const p of placed) unitsById.set(root(p.id), [...(unitsById.get(root(p.id)) ?? []), p]);
  const GAP = 48;
  const units = [...unitsById.values()].map(members => {
    members.sort((a, b) => a.x - b.x || a.id.localeCompare(b.id));
    const width = members.reduce((sum, p) => sum + sizes.get(p.id)!.width, 0) + GAP * (members.length - 1);
    const center = members.reduce((sum, p) => sum + p.x, 0) / members.length;
    const height = Math.max(...members.map(p => sizes.get(p.id)!.height));
    return { members, width, height, x: center, y: members[0]!.y };
  });
  for (let pass = 0; pass < 60; pass++) {
    let moved = false;
    units.sort((a, b) => a.x - b.x);
    for (let i = 0; i < units.length; i++) for (let j = i + 1; j < units.length; j++) {
      const a = units[i]!, b = units[j]!;
      if (Math.abs(a.y - b.y) >= (a.height + b.height) / 2 + 24) continue;
      const gap = (a.width + b.width) / 2 + GAP - (b.x - a.x);
      if (gap <= 0) continue;
      a.x -= gap / 2;
      b.x += gap / 2;
      moved = true;
    }
    if (!moved) break;
  }
  for (const unit of units) {
    let left = unit.x - unit.width / 2;
    for (const p of unit.members) {
      const width = sizes.get(p.id)!.width;
      p.x = left + width / 2;
      left += width + GAP;
    }
  }
  if (placed.length) {
    for (const p of particles) { p.vx = 0; p.vy = 0; }
    for (const p of placed) { p.fx = p.x; p.fy = p.y; }
    forces().alpha(0.5).tick(200);
  }

  for (const node of nodes) {
    const particle = positions.get(node.id)!;
    node.x = particle.x - node.width / 2;
    node.y = particle.y - node.height / 2;
  }
  const minX = Math.min(...nodes.map(node => node.x)) - 64;
  const minY = Math.min(...nodes.map(node => node.y)) - 64;
  for (const node of nodes) { node.x -= minX; node.y -= minY; }
  const byId = new Map(nodes.map(node => [node.id, node]));
  const parallel = new Map<string, LayoutEdge[]>();
  for (const edge of edges) {
    const key = [edge.sourceId, edge.targetId].sort().join("\0");
    const group = parallel.get(key) ?? [];
    group.push(edge);
    parallel.set(key, group);
  }
  for (const group of parallel.values()) {
    group.sort((a, b) => a.id.localeCompare(b.id));
    group.forEach((edge, index) => {
      const source = byId.get(edge.sourceId)!;
      const target = byId.get(edge.targetId)!;
      const a = {x: source.x + source.width / 2, y: source.y + source.height / 2};
      const b = {x: target.x + target.width / 2, y: target.y + target.height / 2};
      const dx = b.x - a.x, dy = b.y - a.y;
      const length = Math.hypot(dx, dy) || 1;
      const direction = edge.sourceId < edge.targetId ? 1 : -1;
      const offset = (index - (group.length - 1) / 2) * 72 * direction;
      const route = (bend: number) => {
        const control = {x: (a.x + b.x) / 2 - dy / length * bend, y: (a.y + b.y) / 2 + dx / length * bend};
        return [cardBoundary(source, a, control), control, cardBoundary(target, b, control)];
      };
      edge.curved = true;
      if (source.id === target.id) {
        edge.points = [
          {x: a.x, y: source.y - 4},
          {x: source.x + source.width + 140, y: source.y - 140},
          {x: source.x + source.width + 4, y: a.y},
        ];
      } else {
        // Bend around unrelated cards instead of drawing through them.
        const obstacles = nodes.filter(node => node.id !== source.id && node.id !== target.id);
        let bestScore = Infinity;
        const steps = [0, ...Array.from({length: 12}, (_, i) => [(i + 1) * 80, -(i + 1) * 80]).flat()];
        for (const step of steps) {
          const points = route(offset + step);
          const [start, control, end] = points;
          let score = 0;
          for (let sample = 1; sample < 60; sample++) {
            const t = sample / 60, u = 1 - t;
            const x = u * u * start!.x + 2 * u * t * control!.x + t * t * end!.x;
            const y = u * u * start!.y + 2 * u * t * control!.y + t * t * end!.y;
            if (obstacles.some(node => x > node.x - 12 && x < node.x + node.width + 12 && y > node.y - 12 && y < node.y + node.height + 12)) score++;
          }
          if (score < bestScore) { bestScore = score; edge.points = points; }
          if (score === 0) break;
        }
        if (bestScore > 0) {
          const path = routeAroundCards(a, b, obstacles);
          if (path) {
            path[0] = cardBoundary(source, a, path[1]!);
            path[path.length - 1] = cardBoundary(target, b, path[path.length - 2]!);
            edge.points = path;
            edge.curved = false;
          }
        }
      }
    });
  }
  const routeMinX = Math.min(0, ...edges.flatMap(edge => edge.points.map(point => point.x - 32)));
  const routeMinY = Math.min(0, ...edges.flatMap(edge => edge.points.map(point => point.y - 32)));
  for (const node of nodes) { node.x -= routeMinX; node.y -= routeMinY; }
  for (const edge of edges) for (const point of edge.points) { point.x -= routeMinX; point.y -= routeMinY; }
  return {
    focusId, nodes, edges,
    width: Math.max(...nodes.map(node => node.x + node.width), ...edges.flatMap(edge => edge.points.map(point => point.x))) + 64,
    height: Math.max(...nodes.map(node => node.y + node.height), ...edges.flatMap(edge => edge.points.map(point => point.y))) + 64,
  };
}
