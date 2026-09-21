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

export interface PersonRecord {
  id: string;
  name: string;
  alternateNames?: string[];
  lifespan?: string;
  born?: string;
  died?: string;
  descriptor?: string;
  biography?: string;
  researchNotes?: string[];
  sourceIds?: string[];
}

// Couples and parents are ordinary edges ("married_to", "parent_of"). The model
// groups them into these shapes for the family layout; they are never stored.
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

export interface DirectParentageRecord {
  id: string;
  parentId: string;
  childId: string;
  type?: ParentageType;
  confidence?: Confidence;
  label?: string;
  sourceIds?: string[];
}

export type ContextEntityKind =
  | "facility"
  | "observation"
  | "organization"
  | "family"
  | "place"
  | "vessel"
  | "event";

export interface ContextEntityRecord {
  id: string;
  name: string;
  kind: ContextEntityKind;
  descriptor?: string;
  biography?: string;
  activeDates?: string;
  sourceIds?: string[];
}

export type ContextConnectionType =
  | "ownership"
  | "management"
  | "employment"
  | "leadership"
  | "partnership"
  | "membership"
  | "founding"
  | "association"
  | "competition"
  | "location"
  | "leasing"
  | "succession";

export interface ContextConnectionRecord {
  id: string;
  fromId: string;
  toId: string;
  type: ContextConnectionType;
  label: string;
  date?: string;
  confidence?: Confidence;
  sourceIds?: string[];
  notes?: string[];
  qualification?: ResearchClaim["qualification"];
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

// The graph is nodes and edges. People and context entities are the nodes;
// claims are the edges, from a node to another node or to a value.
export interface FamilyDataset {
  version: 2;
  title: string;
  initialFocusId: string | null;
  people: PersonRecord[];
  contextEntities?: ContextEntityRecord[];
  claims?: ResearchClaim[];
  evidence?: ResearchEvidence[];
  sources?: SourceRecord[];
}

// The stored shape before the graph was reduced to nodes and edges.
export interface LegacyDataset extends Omit<FamilyDataset, "version"> {
  version: number;
  unions?: UnionRecord[];
  directParentage?: DirectParentageRecord[];
  contextConnections?: ContextConnectionRecord[];
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

export interface RelationshipNeighbor {
  personId: string;
  kind: "parent" | "child" | "spouse" | "sibling";
  confidence: Confidence;
  throughId?: string;
}

export type FocusRole =
  | "focus"
  | "parent"
  | "child"
  | "spouse"
  | "sibling"
  | "ancestor"
  | "descendant"
  | "collateral"
  | "remote"
  | "disconnected";

export type Emphasis = "focus" | "immediate" | "near" | "remote";

export interface ProjectedPerson {
  personId: string;
  distance: number;
  generation: number;
  role: FocusRole;
  emphasis: Emphasis;
  order: number;
}

export interface FocusProjection {
  focusId: string;
  people: Map<string, ProjectedPerson>;
}
