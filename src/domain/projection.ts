import { GenealogyModel } from "./model";
import type {
  Emphasis,
  FocusProjection,
  FocusRole,
  ProjectedPerson,
  RelationshipNeighbor,
} from "./types";

interface QueueEntry {
  personId: string;
  distance: number;
  generation: number;
}

function generationDelta(kind: RelationshipNeighbor["kind"]): number {
  if (kind === "parent") {
    return -1;
  }
  if (kind === "child") {
    return 1;
  }
  return 0;
}

function getEmphasis(distance: number): Emphasis {
  if (distance === 0) {
    return "focus";
  }
  if (distance === 1) {
    return "immediate";
  }
  if (distance <= 3) {
    return "near";
  }
  return "remote";
}

function getRole(
  personId: string,
  focusId: string,
  distance: number,
  generation: number,
  directKinds: ReadonlyMap<string, RelationshipNeighbor["kind"]>,
  ancestors: ReadonlySet<string>,
  descendants: ReadonlySet<string>,
): FocusRole {
  if (personId === focusId) {
    return "focus";
  }

  const directKind = directKinds.get(personId);
  if (distance === 1 && directKind) {
    return directKind;
  }

  if (ancestors.has(personId)) {
    return "ancestor";
  }
  if (descendants.has(personId)) {
    return "descendant";
  }
  if (!Number.isFinite(distance)) {
    return "disconnected";
  }
  if (generation === 0) {
    return "collateral";
  }
  return "remote";
}

function collectDirectionalRelatives(
  model: GenealogyModel,
  focusId: string,
  direction: "parent" | "child",
): Set<string> {
  const relatives = new Set<string>();
  const queue = [focusId];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    for (const neighbor of model.neighborsOf(current)) {
      if (neighbor.kind === direction && !relatives.has(neighbor.personId)) {
        relatives.add(neighbor.personId);
        queue.push(neighbor.personId);
      }
    }
  }

  return relatives;
}

export function projectAround(
  model: GenealogyModel,
  focusId: string,
): FocusProjection {
  if (!model.hasNode(focusId))
    throw new Error(`Unknown focus node: ${focusId}`);
  if (!model.peopleById.has(focusId)) {
    const distances = new Map<string, number>([[focusId, 0]]);
    const queue = [focusId];
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const id = queue[cursor]!;
      const neighbors = model
        .contextConnectionsFor(id)
        .map((c) => (c.fromId === id ? c.toId : c.fromId));
      if (model.peopleById.has(id))
        neighbors.push(...model.neighborsOf(id).map((n) => n.personId));
      for (const neighbor of neighbors)
        if (!distances.has(neighbor)) {
          distances.set(neighbor, distances.get(id)! + 1);
          queue.push(neighbor);
        }
    }
    return {
      focusId,
      people: new Map(
        [...model.dataset.people]
          .sort(
            (a, b) =>
              (distances.get(a.id) ?? Infinity) -
                (distances.get(b.id) ?? Infinity) ||
              a.name.localeCompare(b.name),
          )
          .map((person, order) => {
            const distance = distances.get(person.id) ?? Infinity;
            return [
              person.id,
              {
                personId: person.id,
                distance,
                generation: 0,
                role: Number.isFinite(distance) ? "remote" : "disconnected",
                emphasis: getEmphasis(distance),
                order,
              },
            ];
          }),
      ),
    };
  }

  const distances = new Map<string, number>();
  const generations = new Map<string, number>();
  const directKinds = new Map<string, RelationshipNeighbor["kind"]>();
  const queue: QueueEntry[] = [
    { personId: focusId, distance: 0, generation: 0 },
  ];
  distances.set(focusId, 0);
  generations.set(focusId, 0);

  for (const neighbor of model.neighborsOf(focusId)) {
    directKinds.set(neighbor.personId, neighbor.kind);
  }

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    for (const neighbor of model.neighborsOf(current.personId)) {
      const distance = current.distance + 1;
      const generation = current.generation + generationDelta(neighbor.kind);
      const knownDistance = distances.get(neighbor.personId);

      if (knownDistance === undefined || distance < knownDistance) {
        distances.set(neighbor.personId, distance);
        generations.set(neighbor.personId, generation);
        queue.push({ personId: neighbor.personId, distance, generation });
      } else if (
        distance === knownDistance &&
        Math.abs(generation) < Math.abs(generations.get(neighbor.personId) ?? 0)
      ) {
        generations.set(neighbor.personId, generation);
      }
    }
  }

  const ancestors = collectDirectionalRelatives(model, focusId, "parent");
  const descendants = collectDirectionalRelatives(model, focusId, "child");
  const orderedPeople = [...model.dataset.people].sort((a, b) => {
    const distanceA = distances.get(a.id) ?? Number.POSITIVE_INFINITY;
    const distanceB = distances.get(b.id) ?? Number.POSITIVE_INFINITY;
    if (distanceA !== distanceB) {
      return distanceA - distanceB;
    }
    const generationA = generations.get(a.id) ?? 0;
    const generationB = generations.get(b.id) ?? 0;
    if (generationA !== generationB) {
      return generationA - generationB;
    }
    return a.name.localeCompare(b.name);
  });

  const people = new Map<string, ProjectedPerson>();
  orderedPeople.forEach((person, order) => {
    const distance = distances.get(person.id) ?? Number.POSITIVE_INFINITY;
    const generation = generations.get(person.id) ?? 0;
    people.set(person.id, {
      personId: person.id,
      distance,
      generation,
      role: getRole(
        person.id,
        focusId,
        distance,
        generation,
        directKinds,
        ancestors,
        descendants,
      ),
      emphasis: getEmphasis(distance),
      order,
    });
  });

  return { focusId, people };
}
