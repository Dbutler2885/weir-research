// Graph shapes stored by earlier versions of the app, read only to convert them.
import type { Confidence, ParentageType, ResearchClaim, ResearchEvidence, SourceRecord, UnionRecord } from "./types";

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

export interface ContextEntityRecord {
  id: string;
  name: string;
  kind: string;
  descriptor?: string;
  biography?: string;
  activeDates?: string;
  sourceIds?: string[];
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

export interface ContextConnectionRecord {
  id: string;
  fromId: string;
  toId: string;
  type?: string;
  label: string;
  date?: string;
  confidence?: Confidence;
  sourceIds?: string[];
  notes?: string[];
  qualification?: ResearchClaim["qualification"];
}

// Version 2: people and context entities as separate lists, joined by edges.
export interface NodesEdgesDataset {
  version: 2;
  title: string;
  initialFocusId: string | null;
  people: PersonRecord[];
  contextEntities?: ContextEntityRecord[];
  claims?: ResearchClaim[];
  evidence?: ResearchEvidence[];
  sources?: SourceRecord[];
}

// Version 1: family structure and relationships stored as their own records.
export interface LegacyDataset extends Omit<NodesEdgesDataset, "version"> {
  version: number;
  unions?: UnionRecord[];
  directParentage?: DirectParentageRecord[];
  contextConnections?: ContextConnectionRecord[];
}
