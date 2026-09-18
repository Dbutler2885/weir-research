import { forceCollide, forceLink, forceManyBody, forceRadial, forceSimulation, type SimulationNodeDatum } from "d3";
import type { FamilyLayout, LayoutEdge, LayoutNode } from "./layout";

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

// A stable starting order and a stopped simulation keep the graph reproducible.
// Direction belongs to the relationship, not to a generation or a screen axis.
export function layoutNetwork(focusId: string, nodes: LayoutNode[], edges: LayoutEdge[]): FamilyLayout {
  const neighbors = new Map(nodes.map(node => [node.id, new Set<string>()]));
  for (const edge of edges) {
    neighbors.get(edge.sourceId)!.add(edge.targetId);
    neighbors.get(edge.targetId)!.add(edge.sourceId);
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
  const particles: Particle[] = [];
  for (const [hop, ring] of rings) {
    ring.forEach((node, index) => {
      const angle = index * 2 * Math.PI / ring.length - Math.PI / 2;
      const radius = radii.get(hop)!;
      particles.push({
        id: node.id, distance: hop,
        x: Math.cos(angle) * radius, y: Math.sin(angle) * radius,
        radius: Math.hypot(node.width, node.height) / 2 + 28,
        ...(node.id === focusId ? { fx: 0, fy: 0 } : {}),
      });
    });
  }
  // Multiple assertions between the same pair should not multiply its attraction.
  const pairs = new Map<string, { source: string; target: string }>();
  for (const edge of edges) {
    pairs.set([edge.sourceId, edge.targetId].sort().join("\0"), {source: edge.sourceId, target: edge.targetId});
  }
  const simulation = forceSimulation(particles).stop()
    .force("link", forceLink<Particle, {source: string; target: string}>([...pairs.values()]).id(node => node.id).distance(320).strength(0.12))
    .force("charge", forceManyBody<Particle>().strength(-650))
    .force("radial", forceRadial<Particle>(node => radii.get(node.distance)!, 0, 0).strength(0.45))
    .force("collision", forceCollide<Particle>(node => node.radius).strength(1).iterations(4));
  simulation.tick(400);
  const positions = new Map(particles.map(node => [node.id, node]));
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
    focusId, mode: "network", nodes, edges,
    width: Math.max(...nodes.map(node => node.x + node.width), ...edges.flatMap(edge => edge.points.map(point => point.x))) + 64,
    height: Math.max(...nodes.map(node => node.y + node.height), ...edges.flatMap(edge => edge.points.map(point => point.y))) + 64,
  };
}
