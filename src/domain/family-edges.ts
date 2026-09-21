// Family relationships are ordinary edges. Nothing restricts what an edge may be
// called; these names only tell the family layout which edges to draw as couples
// and as parents above children.
import type { ParentageType, ResearchClaim } from "./types";

export const COUPLE_EDGE = "married_to";
export const PARENT_EDGE = "parent_of";

const normalize = (name: string) => name.trim().toLocaleLowerCase().replace(/[\s_-]+/g, "_");

const couples = new Set([COUPLE_EDGE, "spouse_of", "wife_of", "husband_of"]);
const parentTypes: ParentageType[] = ["biological", "adoptive", "step", "foster", "guardianship"];

export function isCoupleEdge(name: string): boolean {
  return couples.has(normalize(name));
}

// "parent_of", or a qualified form such as "adoptive_parent_of".
export function parentEdgeType(name: string): ParentageType | null {
  const normal = normalize(name);
  if (normal === PARENT_EDGE || normal === "father_of" || normal === "mother_of") return "biological";
  const prefix = normal.endsWith(`_${PARENT_EDGE}`) ? normal.slice(0, -PARENT_EDGE.length - 1) : "";
  return (parentTypes as string[]).includes(prefix) ? (prefix as ParentageType) : prefix ? "unknown" : null;
}

export function parentEdgeName(type: ParentageType | undefined): string {
  return !type || type === "biological" || type === "unknown" ? PARENT_EDGE : `${type}_${PARENT_EDGE}`;
}

export function isFamilyEdge(claim: ResearchClaim): boolean {
  return "entityId" in claim.object && (isCoupleEdge(claim.predicate) || parentEdgeType(claim.predicate) !== null);
}
