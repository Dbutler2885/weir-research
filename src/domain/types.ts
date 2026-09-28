export type Confidence = "established" | "probable" | "disputed" | "unknown";

export type ParentageType =
  | "biological"
  | "adoptive"
  | "step"
  | "foster"
  | "guardianship"
  | "unknown";

export interface SourceRecord {
  id: string;
  title: string;
  repository?: string;
  date?: string;
  url?: string;
  note?: string;
  access?: "discovered" | "metadata" | "abstract" | "full-text";
  accessedAt?: string;
  originalSourceId?: string;
}

// A node is anything the research is about. Its type is the project's own word for
// what kind of thing it is; everything known beyond its summary is an edge.
export interface GraphNode {
  id: string;
  name: string;
  type: string;
  // What is known about it and why it is on the graph.
  summary?: string;
  // A lifespan or active dates, shown on its card.
  dates?: string;
  // What to look into next.
  notes?: string[];
  sourceIds?: string[];
}

export const LOOK_COLORS = ["slate", "rust", "sea", "gold", "moss", "plum", "sky", "clay"] as const;
export type LookColor = (typeof LOOK_COLORS)[number];
export const LOOK_SHAPES = ["rounded", "square", "round"] as const;
export type LookShape = (typeof LOOK_SHAPES)[number];

export const VALUE_KINDS = ["text", "date", "number"] as const;
export type ValueKind = (typeof VALUE_KINDS)[number];

// A fact a node of some type is expected to have, recorded as edges of this name.
export interface FieldDefinition {
  name: string;
  value: ValueKind;
}

// A kind of node, defined once for the project.
export interface NodeType {
  name: string;
  color?: LookColor;
  shape?: LookShape;
  fields: FieldDefinition[];
}

// Ranked relationships put their target a row below their source, such as a parent
// above a child; paired ones place both ends side by side; free ones neither.
export const ARRANGEMENTS = ["ranked", "paired", "free"] as const;
export type Arrangement = (typeof ARRANGEMENTS)[number];

export interface RelationshipRule {
  name: string;
  // How the relationship reads from its target, such as "founded by" for "established".
  reverse?: string;
  arrangement: Arrangement;
}

// Couples and parents are ordinary edges named by ranked and paired rules. The model
// groups them into these shapes for the family-tree lines; they are never stored.
export interface UnionRecord {
  id: string;
  partnerIds: string[];
  childIds?: string[];
  type?: "marriage" | "partnership" | "parental" | "unknown";
  label?: string;
  date?: string;
  place?: string;
  confidence?: Confidence;
  sourceIds?: string[];
  notes?: string[];
}

export interface ResearchEvidence {
  id: string;
  sourceId: string;
  quote: string;
  context: string;
  locator: string;
  interpretation: string;
}

export interface ResearchClaim {
  id: string;
  subjectId: string;
  predicate: string;
  object: { entityId: string } | { value: string | number };
  qualification: "supported" | "reported" | "inferred" | "disputed" | "unresolved";
  time: string | null;
  reasoning: string;
  evidence: { ref: string; role: "supports" | "challenges" | "context" }[];
  // Sources cited without a specific passage.
  sourceIds?: string[];
}

// The graph is nodes and edges, with the project's types and relationship rules.
// Claims are the edges, from a node to another node or to a value.
export interface GraphDataset {
  version: 3;
  title: string;
  initialFocusId: string | null;
  nodes: GraphNode[];
  types: NodeType[];
  relationships: RelationshipRule[];
  claims?: ResearchClaim[];
  evidence?: ResearchEvidence[];
  sources?: SourceRecord[];
}

export interface ParentLink {
  // The edge this link was read from.
  id: string;
  parentId: string;
  childId: string;
  unionId?: string;
  type: ParentageType;
  confidence: Confidence;
  label?: string;
  sourceIds: string[];
}

export type Emphasis = "focus" | "immediate" | "near" | "remote";

export interface ProjectedNode {
  nodeId: string;
  distance: number;
  emphasis: Emphasis;
  order: number;
}

export interface FocusProjection {
  focusId: string;
  nodes: Map<string, ProjectedNode>;
}
