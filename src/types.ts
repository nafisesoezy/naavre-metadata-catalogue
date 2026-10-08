// Shared types for the FDO Studio panel.
//
// Data model: a single LifecycleItem store (see FdoStudio.tsx) is the
// source of truth. Each phase's "input basket" is a filtered view of that
// store (items whose targetPhase === this phase) — items are never copied
// between baskets, only their targetPhase/status changes as they move
// forward: Discovery -> Composition -> Execution -> Publication -> Registry.

export type CatalogueRecordType = 'Dataset' | 'Model' | 'Workflow' | 'Record';

export interface CatalogueHit {
  uuid: string;
  title: string;
  type: CatalogueRecordType;
  description: string;
  organisation?: string;
  link?: string;
  temporal?: string;
  spatial?: string;
  componentsCount?: number;
  outputsCount?: number;
}

export type ItemKind =
  | 'dataset'
  | 'model'
  | 'workflow'
  | 'component'
  | 'output'
  | 'execution'
  | 'repository';

export type Phase = 'discovery' | 'composition' | 'execution' | 'publication';
export type TargetPhase = Phase | 'registry';
export type ItemStatus = 'selected' | 'used' | 'enriched' | 'ready' | 'published';

export interface Relationship {
  id: string;
  internalPid?: string;

  subjectId?: string;
  subjectPid?: string;

  predicate: RelationType;

  objectId?: string;
  objectPid?: string;
  objectTitle: string;

  discoveryMethod?: RelationSourceKind | 'manual';
  evidence?: string;
  confidence?: number;
  validationStatus?: 'proposed' | 'accepted' | 'rejected';
}

export interface LifecycleItem {
  id: string;
  type: ItemKind;
  title: string;
  sourcePhase: Phase;
  targetPhase: TargetPhase;
  status: ItemStatus;
  metadata: Record<string, unknown>;
  internalPid?: string;
  pid?: string;
  // Not in the original spec, but practically useful: a direct link out
  // to the source record (GeoNetwork page, repo path, etc).
  link?: string;
  relations: Relationship[];
}

// ---- Workflow graph (Composition / Execution pages) ----

export type WorkflowNodeType = 'Dataset' | 'Component' | 'Output';
export type WorkflowNodeStatus = 'done' | 'pending';

export interface WorkflowComponent {
  id: string;
  label: string;
  type: WorkflowNodeType;
  status: WorkflowNodeStatus;
  description?: string;
  inputs?: string[];
  outputs?: string[];
  container?: string;
  sourceUrl?: string;
}

export interface WorkflowEdge {
  from: string;
  to: string;
}

export interface WorkflowGraph {
  id: string;
  name: string;
  components: WorkflowComponent[];
  edges: WorkflowEdge[];
}

// ---- Publication phase ----

// Matches the data model from the Publication redesign spec: everything
// selected for publishing — whether it came from Execution's handoff or
// from scanning a GitHub repo — gets converted into one of these, so the
// rest of the Publication tab (metadata editor, validation, publish) only
// ever has to deal with one shape.
export type DraftAssetType = 'dataset' | 'workflow' | 'component';
export type DraftAssetSource = 'execution' | 'repository' | 'catalogue';
export type DraftAssetStatus = 'draft' | 'ready' | 'published';

export interface DraftFdoAsset {
  id: string;

  internalPid?: string;
  pid?: string;

  source: DraftAssetSource;

  type: DraftAssetType;

  title: string;

  sourcePath?: string;
  repositoryUrl?: string;

  metadata: Record<string, unknown>;

  missingFields: string[];

  status: DraftAssetStatus;

  relations: Relationship[];
}

export type RelationType = 'partOf' | 'producedBy' | 'uses' | 'derivedFrom' | 'produces' | 'relatedTo';
export type RelationSourceKind = 'repository' | 'workflow' | 'catalogue' | 'registry';

export interface SuggestedRelation {
  type: RelationType;
  targetTitle: string;
  source: RelationSourceKind;
}

// One hit from POST /publication/scan-repository — a candidate file in the
// repo that hasn't been added as a draft yet.
export interface DetectedRepoAsset {
  id: string;
  internalPid?: string;
  pid?: string;
  title: string;
  type: DraftAssetType;
  path: string;
  size?: number;
}
