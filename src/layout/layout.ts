import ELK, {
  type ElkEdgeSection,
  type ElkExtendedEdge,
  type ElkNode,
  type ElkPoint,
} from "elkjs/lib/elk.bundled.js";
import { GenealogyModel } from "../domain/model";
import type { Confidence, Emphasis, FocusProjection } from "../domain/types";
import { layoutNetwork } from "./network";
import { CONTEXT_WIDTH, contextSize } from "./node-size";

const PERSON_WIDTH = 224;
const PERSON_HEIGHT = 104;
const UNION_SIZE = 20;

export interface LayoutNode {
  id: string;
  kind: "person" | "union" | "context";
  personId?: string;
  unionId?: string;
  contextEntityId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  emphasis: Emphasis;
}

export interface LayoutEdge {
  curved?: boolean;
  id: string;
  sourceId: string;
  targetId: string;
  confidence: Confidence;
  kind: "family" | "context";
  label?: string;
  points: ElkPoint[];
}

export interface FamilyLayout {
  mode?: "network";
  focusId: string;
  width: number;
  height: number;
  nodes: LayoutNode[];
  edges: LayoutEdge[];
}

interface EdgeMetadata {
  sourceId: string;
  targetId: string;
  confidence: Confidence;
  kind: "family" | "context";
  label?: string;
}

const elk = new ELK();

function unionEmphasis(
  model: GenealogyModel,
  projection: FocusProjection,
  unionId: string,
): Emphasis {
  const union = model.getUnion(unionId);
  const emphasisRank: Record<Emphasis, number> = {
    focus: 0,
    immediate: 1,
    near: 2,
    remote: 3,
  };
  let best: Emphasis = "remote";

  for (const personId of [...union.partnerIds, ...(union.childIds ?? [])]) {
    const emphasis = projection.people.get(personId)?.emphasis ?? "remote";
    if (emphasisRank[emphasis] < emphasisRank[best]) {
      best = emphasis;
    }
  }

  return best;
}

function edgePoints(
  section: ElkEdgeSection | undefined,
  source: LayoutNode,
  target: LayoutNode,
): ElkPoint[] {
  if (section) {
    return [
      section.startPoint,
      ...(section.bendPoints ?? []),
      section.endPoint,
    ];
  }

  return [
    { x: source.x + source.width / 2, y: source.y + source.height },
    { x: target.x + target.width / 2, y: target.y },
  ];
}

function unionPriority(
  model: GenealogyModel,
  projection: FocusProjection,
  unionId: string,
): number {
  const union = model.getUnion(unionId);
  return Math.min(
    ...[...union.partnerIds, ...(union.childIds ?? [])].map(
      (personId) =>
        projection.people.get(personId)?.order ?? Number.MAX_SAFE_INTEGER,
    ),
  );
}

function otherContextEndpoint(
  connection: { fromId: string; toId: string },
  nodeId: string,
): string {
  return connection.fromId === nodeId ? connection.toId : connection.fromId;
}

function contextDistanceToFocus(
  model: GenealogyModel,
  focusId: string,
  entityId: string,
): number {
  if (entityId === focusId) return 0;
  const queue: Array<{ id: string; distance: number }> = [
    { id: entityId, distance: 0 },
  ];
  const visited = new Set<string>([entityId]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const connection of model.contextConnectionsFor(current.id)) {
      const nextId = otherContextEndpoint(connection, current.id);
      if (nextId === focusId) {
        return current.distance + 1;
      }
      if (!visited.has(nextId) && model.contextEntitiesById.has(nextId)) {
        visited.add(nextId);
        queue.push({ id: nextId, distance: current.distance + 1 });
      }
    }
  }

  return Number.POSITIVE_INFINITY;
}

function contextEmphasis(
  model: GenealogyModel,
  projection: FocusProjection,
  entityId: string,
): Emphasis {
  const distance = contextDistanceToFocus(model, projection.focusId, entityId);
  if (distance === 0) return "focus";
  if (distance === 1) {
    return "immediate";
  }
  if (distance === 2) {
    return "near";
  }

  const connectedPersonEmphases = model
    .contextConnectionsForEntity(entityId)
    .flatMap((connection) => [connection.fromId, connection.toId])
    .filter((nodeId) => model.peopleById.has(nodeId))
    .map((personId) => projection.people.get(personId)?.emphasis ?? "remote");
  if (connectedPersonEmphases.includes("focus")) {
    return "immediate";
  }
  if (connectedPersonEmphases.includes("immediate")) {
    return "near";
  }
  return "remote";
}

function contextPriority(
  model: GenealogyModel,
  projection: FocusProjection,
  entityId: string,
): number {
  const focusDistance = contextDistanceToFocus(
    model,
    projection.focusId,
    entityId,
  );
  if (Number.isFinite(focusDistance)) {
    return focusDistance * 4;
  }

  return Math.min(
    ...model
      .contextConnectionsForEntity(entityId)
      .flatMap((connection) => [connection.fromId, connection.toId])
      .filter((nodeId) => model.peopleById.has(nodeId))
      .map(
        (personId) =>
          (projection.people.get(personId)?.order ?? Number.MAX_SAFE_INTEGER) +
          8,
      ),
    Number.MAX_SAFE_INTEGER,
  );
}

export async function layoutFamily(
  model: GenealogyModel,
  projection: FocusProjection,
): Promise<FamilyLayout> {
  const personNodes: ElkNode[] = [...projection.people.values()]
    .sort((a, b) => a.order - b.order)
    .map((projected) => ({
      id: projected.personId,
      width: PERSON_WIDTH,
      height: PERSON_HEIGHT,
      layoutOptions:
        projected.personId === projection.focusId
          ? { "elk.priority": "1000" }
          : { "elk.priority": String(Math.max(1, 100 - projected.order)) },
    }));

  const unionNodes: ElkNode[] = [...model.unionsById.values()]
    .sort(
      (a, b) =>
        unionPriority(model, projection, a.id) -
        unionPriority(model, projection, b.id),
    )
    .map((union) => ({
      id: union.id,
      width: UNION_SIZE,
      height: UNION_SIZE,
      layoutOptions: {
        "elk.priority": String(
          Math.max(1, 100 - unionPriority(model, projection, union.id)),
        ),
      },
    }));

  const contextNodes: ElkNode[] = [...model.contextEntitiesById.values()]
    .sort(
      (a, b) =>
        contextPriority(model, projection, a.id) -
        contextPriority(model, projection, b.id),
    )
    .map((entity) => ({
      id: entity.id,
      ...contextSize(entity.name),
      layoutOptions: {
        "elk.priority": String(
          Math.max(1, 96 - contextPriority(model, projection, entity.id)),
        ),
      },
    }));

  const edgeMetadata = new Map<string, EdgeMetadata>();
  const edges: ElkExtendedEdge[] = [];
  const addEdge = (
    id: string,
    sourceId: string,
    targetId: string,
    confidence: Confidence,
    kind: "family" | "context",
    label?: string,
  ): void => {
    edges.push({ id, sources: [sourceId], targets: [targetId] });
    edgeMetadata.set(id, { sourceId, targetId, confidence, kind, label });
  };

  for (const union of model.unionsById.values()) {
    const confidence = union.confidence ?? "established";
    for (const partnerId of union.partnerIds) {
      addEdge(
        `${union.id}:partner:${partnerId}`,
        partnerId,
        union.id,
        confidence,
        "family",
        union.label,
      );
    }
    for (const childId of union.childIds ?? []) {
      addEdge(
        `${union.id}:child:${childId}`,
        union.id,
        childId,
        confidence,
        "family",
      );
    }
  }

  for (const link of model.dataset.directParentage ?? []) {
    addEdge(
      link.id,
      link.parentId,
      link.childId,
      link.confidence ?? "established",
      "family",
      link.label,
    );
  }

  for (const connection of model.dataset.contextConnections ?? []) {
    addEdge(
      connection.id,
      connection.fromId,
      connection.toId,
      connection.confidence ?? "established",
      "context",
      connection.label,
    );
  }

  if ((model.dataset.contextConnections?.length ?? 0) > 0) {
    const nodes: LayoutNode[] = [...personNodes, ...unionNodes, ...contextNodes].map(node => ({
      id: node.id,
      kind: model.peopleById.has(node.id) ? "person" : model.unionsById.has(node.id) ? "union" : "context",
      personId: model.peopleById.has(node.id) ? node.id : undefined,
      unionId: model.unionsById.has(node.id) ? node.id : undefined,
      contextEntityId: model.contextEntitiesById.has(node.id) ? node.id : undefined,
      x: 0, y: 0, width: node.width!, height: node.height!, emphasis: "remote",
    }));
    return layoutNetwork(projection.focusId, nodes, [...edgeMetadata].map(([id, metadata]) => ({id, ...metadata, points: []})));
  }

  const graph: ElkNode = {
    id: "family",
    children: [...personNodes, ...unionNodes, ...contextNodes],
    edges,
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.spacing.nodeNode": "36",
      "elk.layered.spacing.nodeNodeBetweenLayers": "86",
      "elk.layered.spacing.edgeNodeBetweenLayers": "28",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.layered.crossingMinimization.forceNodeModelOrder": "true",
      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
      "elk.padding": "[top=56,left=56,bottom=56,right=56]",
    },
  };

  const result = await elk.layout(graph);
  const nodes: LayoutNode[] = (result.children ?? []).map((node) => {
    const isPerson = model.peopleById.has(node.id);
    const isUnion = model.unionsById.has(node.id);
    const isContext = model.contextEntitiesById.has(node.id);
    return {
      id: node.id,
      kind: isPerson ? "person" : isUnion ? "union" : "context",
      personId: isPerson ? node.id : undefined,
      unionId: isUnion ? node.id : undefined,
      contextEntityId: isContext ? node.id : undefined,
      x: node.x ?? 0,
      y: node.y ?? 0,
      width:
        node.width ??
        (isPerson ? PERSON_WIDTH : isUnion ? UNION_SIZE : CONTEXT_WIDTH),
      height:
        node.height ??
        (isPerson
          ? PERSON_HEIGHT
          : isUnion
            ? UNION_SIZE
            : contextSize(model.contextEntitiesById.get(node.id)!.name).height),
      emphasis: isPerson
        ? (projection.people.get(node.id)?.emphasis ?? "remote")
        : isUnion
          ? unionEmphasis(model, projection, node.id)
          : contextEmphasis(model, projection, node.id),
    };
  });
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const laidOutEdges: LayoutEdge[] = (result.edges ?? []).flatMap((edge) => {
    const metadata = edgeMetadata.get(edge.id);
    if (!metadata) {
      return [];
    }
    const source = nodesById.get(metadata.sourceId);
    const target = nodesById.get(metadata.targetId);
    if (!source || !target) {
      return [];
    }

    return [
      {
        id: edge.id,
        ...metadata,
        points: edgePoints(edge.sections?.[0], source, target),
      },
    ];
  });

  return {
    focusId: projection.focusId,
    width: result.width ?? 0,
    height: result.height ?? 0,
    nodes,
    edges: laidOutEdges,
  };
}
