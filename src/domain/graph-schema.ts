// The project's own vocabulary: its types of node, the facts each type records,
// and how its relationships arrange the graph.
//
// Types and rules are defined once per project, by the graph builder. Anything a
// project has not defined still works: an unknown type looks like the default, an
// unlisted relationship is free and reads the same from both ends.
import type { FieldDefinition, GraphDataset, GraphNode, LookColor, LookShape, NodeType, ParentageType, RelationshipRule, ResearchClaim } from "./types";

// Edge and field names are compared ignoring case, spaces, hyphens and underscores.
export const normalizeName = (name: string) => name.trim().toLocaleLowerCase().replace(/[\s_-]+/g, "_");

// "operated_as" as a person reads it: "Operated as".
export function readable(name: string): string {
  const words = name.trim().replace(/_+/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export const PARENT_EDGE = "parent_of";
export const COUPLE_EDGE = "married_to";

// A new project starts knowing how families are drawn.
export function defaultRelationships(): RelationshipRule[] {
  return [
    { name: PARENT_EDGE, reverse: "child of", arrangement: "ranked" },
    { name: "father_of", reverse: "child of", arrangement: "ranked" },
    { name: "mother_of", reverse: "child of", arrangement: "ranked" },
    { name: COUPLE_EDGE, arrangement: "paired" },
    { name: "spouse_of", reverse: "married to", arrangement: "paired" },
    { name: "wife_of", reverse: "married to", arrangement: "paired" },
    { name: "husband_of", reverse: "married to", arrangement: "paired" },
  ];
}

// A new project's graph: nothing in it yet, knowing only how families are drawn.
export function emptyGraph(title = "Research workspace"): GraphDataset {
  return { version: 3, title, initialFocusId: null, nodes: [], types: [], relationships: defaultRelationships(), claims: [], evidence: [], sources: [] };
}

export const DEFAULT_LOOK: { color: LookColor; shape: LookShape } = { color: "slate", shape: "rounded" };

const parentKinds: ParentageType[] = ["biological", "adoptive", "step", "foster", "guardianship"];

export class GraphSchema {
  private readonly types: Map<string, NodeType>;
  private readonly rules: Map<string, RelationshipRule>;

  constructor(dataset: Pick<GraphDataset, "types" | "relationships">) {
    this.types = new Map((dataset.types || []).map((t) => [normalizeName(t.name), t]));
    this.rules = new Map((dataset.relationships || []).map((r) => [normalizeName(r.name), r]));
  }

  // A node's type as defined, or a bare one with the default look.
  typeOf(node: Pick<GraphNode, "type">): NodeType {
    return this.types.get(normalizeName(node.type)) || { name: node.type, fields: [] };
  }

  look(node: Pick<GraphNode, "type">): { color: LookColor; shape: LookShape } {
    const type = this.typeOf(node);
    return { color: type.color || DEFAULT_LOOK.color, shape: type.shape || DEFAULT_LOOK.shape };
  }

  // The field an edge from this node is filed under, if its type defines one.
  field(node: Pick<GraphNode, "type">, edgeName: string): FieldDefinition | undefined {
    const name = normalizeName(edgeName);
    return this.typeOf(node).fields.find((f) => normalizeName(f.name) === name);
  }

  // The rule for an edge name. A ranked rule also covers qualified forms of its
  // name, so "parent_of" covers "adoptive_parent_of".
  rule(edgeName: string): RelationshipRule | undefined {
    const name = normalizeName(edgeName);
    const exact = this.rules.get(name);
    if (exact) return exact;
    for (const [key, rule] of this.rules) if (rule.arrangement === "ranked" && name.endsWith(`_${key}`)) return rule;
    return undefined;
  }

  arrangement(claim: ResearchClaim): "ranked" | "paired" | "free" {
    if (!("entityId" in claim.object)) return "free";
    return this.rule(claim.predicate)?.arrangement || "free";
  }

  // How an edge reads from one of its ends: "Established" from its source, and from
  // its target the rule's reverse, such as "Founded by". A paired relationship reads the
  // same both ways; any other without a reverse reads "Established this", so the
  // direction is never lost.
  reading(edgeName: string, from: "source" | "target"): string {
    const rule = this.rule(edgeName);
    if (from === "source") return readable(edgeName);
    if (rule?.reverse) return readable(rule.reverse);
    return rule?.arrangement === "paired" ? readable(edgeName) : `${readable(edgeName)} this`;
  }

  // For a ranked edge, the kind of parentage its qualified name gives, if any.
  parentage(edgeName: string): ParentageType {
    const name = normalizeName(edgeName);
    const rule = this.rule(edgeName);
    if (rule?.arrangement !== "ranked") return "unknown";
    const prefix = name === normalizeName(rule.name) ? "" : name.slice(0, -normalizeName(rule.name).length - 1);
    if (!prefix) return "biological";
    return (parentKinds as string[]).includes(prefix) ? (prefix as ParentageType) : "unknown";
  }
}
