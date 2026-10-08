import {
  CatalogueRecordType,
  DraftAssetType,
  DraftFdoAsset,
  ItemKind,
  LifecycleItem,
  RelationType,
  SuggestedRelation,
  WorkflowGraph
} from './types';
import { computeMissingFields } from './fieldSchemas';

let counter = 0;

// crypto.randomUUID() isn't guaranteed in every embedding context (older
// webviews), so fall back to a simple counter-based id.
export function makeId(prefix: string): string {
  counter += 1;
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${counter}`;
}

export const CATALOGUE_BADGE_CLASS: Record<CatalogueRecordType, string> = {
  Dataset: 'fdo-badge fdo-badge--dataset',
  Model: 'fdo-badge fdo-badge--model',
  Workflow: 'fdo-badge fdo-badge--workflow',
  Record: 'fdo-badge fdo-badge--output'
};

export const ITEM_BADGE_CLASS: Record<ItemKind, string> = {
  dataset: 'fdo-badge fdo-badge--dataset',
  model: 'fdo-badge fdo-badge--model',
  workflow: 'fdo-badge fdo-badge--workflow',
  component: 'fdo-badge fdo-badge--model',
  output: 'fdo-badge fdo-badge--output',
  execution: 'fdo-badge fdo-badge--workflow',
  repository: 'fdo-badge fdo-badge--output'
};

export function itemKindLabel(kind: ItemKind): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

export const DRAFT_TYPE_BADGE_CLASS: Record<DraftAssetType, string> = {
  dataset: 'fdo-badge fdo-badge--dataset',
  workflow: 'fdo-badge fdo-badge--workflow',
  component: 'fdo-badge fdo-badge--model'
};

export function draftTypeLabel(type: DraftAssetType): string {
  if (type === 'dataset') return 'Dataset / Output';
  if (type === 'workflow') return 'Workflow';
  return 'Component';
}

// Items handed off from Execution use the looser ItemKind vocabulary
// ('output', 'execution', etc.) — the Publication tab's metadata editor
// needs the narrower dataset/workflow/component vocabulary the field
// schemas are organized around. 'execution' (a run record) doesn't have
// a dedicated schema in the spec, so it's treated as a workflow-shaped
// asset for editing purposes — revisit if execution records end up
// needing their own field set.
function toDraftType(kind: ItemKind): DraftAssetType {
  if (kind === 'workflow' || kind === 'execution') return 'workflow';
  if (kind === 'component') return 'component';
  return 'dataset';
}

export function lifecycleItemToDraft(item: LifecycleItem): DraftFdoAsset {
  const type = toDraftType(item.type);
  return {
    id: item.id,
    source: 'execution',
    type,
    title: item.title,
    metadata: item.metadata,
    missingFields: computeMissingFields(type, item.metadata),
    status: item.status === 'published' ? 'published' : 'draft',
    pid: item.pid,
    relations: item.relations
  };
}

// Fetches the FULL catalogue record (GET /catalogue/record/{uuid}), already
// mapped onto the Dataset FDO field keys fieldSchemas.ts expects. Shared by
// FdoStudio's Discovery -> Composition handoff and PublicationPage's
// "Assets from Catalogue" flow, so both go through the same lookup.
export async function fetchCatalogueRecordMetadata(
  catalogueBaseUrl: string,
  uuid: string
): Promise<Record<string, unknown> | null> {
  const base = catalogueBaseUrl.replace(/\/$/, '');
  if (!base) return null;
  try {
    const resp = await fetch(`${base}/catalogue/record/${uuid}`);
    if (!resp.ok) return null;
    const data = await resp.json();
    return (data?.metadata as Record<string, unknown>) ?? null;
  } catch {
    return null;
  }
}

export const RELATION_LABEL: Record<RelationType, string> = {
  partOf: 'PART OF',
  producedBy: 'PRODUCED BY',
  uses: 'USES',
  derivedFrom: 'DERIVED FROM',
  produces: 'PRODUCES',
  relatedTo: 'RELATED TO'
};

export const RELATION_SOURCE_LABEL: Record<string, string> = {
  repository: 'Current Repository',
  workflow: 'Current Workflow',
  catalogue: 'Catalogue',
  registry: 'Existing FDO Registry'
};

// Client-side equivalent of the backend's compute_workflow_relations, for
// execution-sourced assets (the mock run, not a real repo) — same
// PART OF / PRODUCED BY / USES / DERIVED FROM logic, walked over the
// simpler node-level mock graph instead of a real .naavrewf's port-level
// chart.
export function discoverMockGraphRelations(graph: WorkflowGraph, sourceNodeId: string | undefined): SuggestedRelation[] {
  if (!sourceNodeId) return [];

  const seen = new Set<string>();
  const relations: SuggestedRelation[] = [];
  const add = (type: RelationType, targetTitle: string) => {
    const key = `${type}::${targetTitle}`;
    if (!seen.has(key)) {
      seen.add(key);
      relations.push({ type, targetTitle, source: 'workflow' });
    }
  };

  add('partOf', graph.name);

  const node = graph.components.find(c => c.id === sourceNodeId);
  if (!node) return relations;

  if (node.type === 'Output') {
    const producerEdge = graph.edges.find(e => e.to === sourceNodeId);
    const producer = producerEdge ? graph.components.find(c => c.id === producerEdge.from) : undefined;
    if (producer) {
      add('producedBy', producer.label);
      const upstreamEdges = graph.edges.filter(e => e.to === producer.id);
      upstreamEdges.forEach(e => {
        const upstream = graph.components.find(c => c.id === e.from);
        if (upstream) add('uses', upstream.label);
      });
      // Walk back further for root sources (no incoming edges).
      const visited = new Set<string>();
      const walk = (nodeId: string) => {
        if (visited.has(nodeId)) return;
        visited.add(nodeId);
        const incoming = graph.edges.filter(e => e.to === nodeId);
        if (incoming.length === 0) {
          const root = graph.components.find(c => c.id === nodeId);
          if (root && root.id !== producer.id) add('derivedFrom', root.label);
          return;
        }
        incoming.forEach(e => walk(e.from));
      };
      upstreamEdges.forEach(e => walk(e.from));
    }
  } else if (node.type === 'Component') {
    graph.edges.filter(e => e.to === sourceNodeId).forEach(e => {
      const upstream = graph.components.find(c => c.id === e.from);
      if (upstream) add('uses', upstream.label);
    });
    graph.edges.filter(e => e.from === sourceNodeId).forEach(e => {
      const downstream = graph.components.find(c => c.id === e.to);
      if (downstream) add('produces', downstream.label);
    });
  }

  return relations;
}
