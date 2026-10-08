import React, { useState } from 'react';
import { Sidebar } from './Sidebar';
import { Stepper } from './Stepper';
import { DiscoveryPage } from '../pages/DiscoveryPage';
import { CompositionPage } from '../pages/CompositionPage';
import { ExecutionPage } from '../pages/ExecutionPage';
import { PublicationPage } from '../pages/PublicationPage';
import { mockWorkflowGraph } from '../mockData';
import { makeId, fetchCatalogueRecordMetadata } from '../lifecycle';
import { computeMissingFields } from '../fieldSchemas';
import {
  CatalogueHit,
  DetectedRepoAsset,
  DraftFdoAsset,
  ItemKind,
  LifecycleItem,
  Phase
} from '../types';

export interface FdoStudioProps {
  catalogueBaseUrl: string;
}

// Maps a Discovery search result's loose classification onto the
// lifecycle item kinds. 'Record' (the common case right now, since
// /search doesn't classify yet) defaults to 'dataset' — revisit once the
// backend can tell datasets/models/workflows apart.
function catalogueTypeToItemKind(type: CatalogueHit['type']): ItemKind {
  if (type === 'Model') return 'model';
  if (type === 'Workflow') return 'workflow';
  return 'dataset';
}

export function FdoStudio(props: FdoStudioProps): JSX.Element {
  const [phase, setPhase] = useState<Phase>('discovery');
  const [graph] = useState(mockWorkflowGraph);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>('flm');
  const [store, setStore] = useState<LifecycleItem[]>([]);

  // Publication-tab state lives here (not inside PublicationPage) so it
  // survives switching to another phase and back.
  const [draftAssets, setDraftAssets] = useState<DraftFdoAsset[]>([]);
  const [detectedRepoAssets, setDetectedRepoAssets] = useState<DetectedRepoAsset[]>([]);

  function addItem(item: LifecycleItem) {
    setStore(prev => (prev.some(i => i.id === item.id) ? prev : [...prev, item]));
  }

  function updateStatus(id: string, status: LifecycleItem['status']) {
    setStore(prev => prev.map(i => (i.id === id ? { ...i, status } : i)));
  }

  // Patches metadata onto an existing store item in place. The store never
  // copies items between phase baskets (see the note at the top of
  // types.ts) — it just changes fields on the one shared object — so a
  // patch applied here is what actually "rides along" through Composition,
  // Execution, and into the Publication draft, without anything downstream
  // having to know where the metadata came from.
  function updateItemMetadata(id: string, patch: Record<string, unknown>) {
    setStore(prev =>
      prev.map(i => (i.id === id ? { ...i, metadata: { ...i.metadata, ...patch } } : i))
    );
  }

  // ---- Discovery -> Composition ----
  function handleSendToComposition(hit: CatalogueHit) {
    addItem({
      id: hit.uuid,
      type: catalogueTypeToItemKind(hit.type),
      title: hit.title,
      sourcePhase: 'discovery',
      targetPhase: 'composition',
      status: 'selected',
      metadata: { description: hit.description, organisation: hit.organisation },
      link: hit.link,
      relations: []
    });

    // The item is already added and visible immediately (thin metadata for
    // now); the full catalogue record loads in the background and patches
    // in once it arrives, rather than blocking the "Add to Composition"
    // click on a network round trip.
    void fetchCatalogueRecordMetadata(props.catalogueBaseUrl, hit.uuid).then(full => {
      if (full) updateItemMetadata(hit.uuid, full);
    });
  }

  // ---- Composition ----
  function handleUseDiscoveryItem(id: string) {
    updateStatus(id, 'used');
  }

  function handleSendComponentToExecution(componentId: string) {
    const component = graph.components.find(c => c.id === componentId);
    if (!component) return;
    addItem({
      id: makeId('component'),
      type: 'component',
      title: component.label,
      sourcePhase: 'composition',
      targetPhase: 'execution',
      status: 'selected',
      metadata: { sourceNodeId: componentId },
      relations: [
        {
          id: `rel-${crypto.randomUUID()}`,
          predicate: 'composedFrom' as any,
          objectId: componentId,
          objectTitle: componentId,
          discoveryMethod: 'workflow',
          confidence: 1,
          validationStatus: 'accepted'
        }
      ]
    });
  }

  function handleSendWorkflowToExecution() {
    addItem({
      id: makeId('workflow'),
      type: 'workflow',
      title: graph.name,
      sourcePhase: 'composition',
      targetPhase: 'execution',
      status: 'selected',
      metadata: { sourceNodeId: graph.id },
      relations: []
    });
    setPhase('execution');
  }

  // ---- Execution -> Publication ----
  function handleSendOutputToPublication(outputId: string, label: string) {
    addItem({
      id: makeId('output'),
      type: 'output',
      title: label,
      sourcePhase: 'execution',
      targetPhase: 'publication',
      status: 'selected',
      metadata: { sourceNodeId: outputId },
      relations: [
        {
          id: `rel-${crypto.randomUUID()}`,
          predicate: 'producedBy',
          objectId: outputId,
          objectTitle: outputId,
          discoveryMethod: 'workflow',
          confidence: 1,
          validationStatus: 'accepted'
        }
      ]
    });
  }

  function handleSendExecutionRecordToPublication() {
    addItem({
      id: makeId('execution'),
      type: 'execution',
      title: `Execution record — ${graph.name}`,
      sourcePhase: 'execution',
      targetPhase: 'publication',
      status: 'selected',
      metadata: { sourceNodeId: graph.id },
      relations: []
    });
    setPhase('publication');
  }

  // ---- Publication ----
  function handleAddDraftAssets(assets: DraftFdoAsset[]) {
    setDraftAssets(prev => {
      const existingIds = new Set(prev.map(d => d.id));
      const toAdd = assets.filter(a => !existingIds.has(a.id));
      return toAdd.length > 0 ? [...prev, ...toAdd] : prev;
    });
  }

  function handleUpdateDraftMetadata(id: string, patch: Record<string, unknown>) {
    setDraftAssets(prev =>
      prev.map(d => {
        if (d.id !== id) return d;
        const metadata = { ...d.metadata, ...patch };
        return { ...d, metadata, missingFields: computeMissingFields(d.type, metadata) };
      })
    );
  }

  function handleSetDraftStatus(id: string, status: DraftFdoAsset['status']) {
    setDraftAssets(prev => prev.map(d => (d.id === id ? { ...d, status } : d)));
  }

  function handleSetDraftRelations(id: string, relations: DraftFdoAsset['relations']) {
    setDraftAssets(prev => prev.map(d => (d.id === id ? { ...d, relations } : d)));
  }

  // Client-side PID reservation — deliberately not a backend call. Matches
  // the two-phase PID strategy: a local urn:uuid at this stage, with real
  // DOI minting deferred to an eventual catalogue-registration step.
  function handleReservePid(id: string) {
    setDraftAssets(prev => prev.map(d => (d.id === id && !d.pid ? { ...d, pid: makeId('urn:uuid') } : d)));
  }

  function handlePublishResults(results: { id: string; pid: string }[]) {
    const pidMap = new Map(results.map(r => [r.id, r.pid]));
    setDraftAssets(prev =>
      prev.map(d => (pidMap.has(d.id) ? { ...d, status: 'published', pid: pidMap.get(d.id) } : d))
    );
    setStore(prev =>
      prev.map(i =>
        pidMap.has(i.id)
          ? { ...i, status: 'published', targetPhase: 'registry', pid: pidMap.get(i.id) }
          : i
      )
    );
  }

  // ---- Selectors (filtered views over the one store — nothing is copied) ----
  const compositionInbox = store.filter(i => i.targetPhase === 'composition');
  const executionInbox = store.filter(i => i.targetPhase === 'execution');
  const executionOutboxFromComposition = store.filter(
    i => i.targetPhase === 'execution' && i.sourcePhase === 'composition'
  );
  const publicationInbox = store.filter(i => i.targetPhase === 'publication');
  const publicationOutboxFromExecution = store.filter(
    i => i.targetPhase === 'publication' && i.sourcePhase === 'execution'
  );

  let page: JSX.Element;
  switch (phase) {
    case 'discovery':
      page = (
        <DiscoveryPage
          catalogueBaseUrl={props.catalogueBaseUrl}
          compositionInbox={compositionInbox}
          onSendToComposition={handleSendToComposition}
        />
      );
      break;
    case 'composition':
      page = (
        <CompositionPage
          graph={graph}
          selectedId={selectedNodeId}
          onSelect={setSelectedNodeId}
          discoveryInbox={compositionInbox}
          executionOutbox={executionOutboxFromComposition}
          onUseItem={handleUseDiscoveryItem}
          onSendComponentToExecution={handleSendComponentToExecution}
          onSendWorkflowToExecution={handleSendWorkflowToExecution}
        />
      );
      break;
    case 'execution':
      page = (
        <ExecutionPage
          graph={graph}
          compositionInbox={executionInbox}
          publicationOutbox={publicationOutboxFromExecution}
          onSendOutputToPublication={handleSendOutputToPublication}
          onSendExecutionRecordToPublication={handleSendExecutionRecordToPublication}
        />
      );
      break;
    case 'publication':
    default:
      page = (
        <PublicationPage
          catalogueBaseUrl={props.catalogueBaseUrl}
          graph={graph}
          publicationInbox={publicationInbox}
          draftAssets={draftAssets}
          detectedRepoAssets={detectedRepoAssets}
          onSetDetectedRepoAssets={setDetectedRepoAssets}
          onAddDraftAssets={handleAddDraftAssets}
          onUpdateDraftMetadata={handleUpdateDraftMetadata}
          onSetDraftStatus={handleSetDraftStatus}
          onSetDraftRelations={handleSetDraftRelations}
          onReservePid={handleReservePid}
          onPublishResults={handlePublishResults}
        />
      );
  }

  return (
    <div className="fdo-studio">
      <Sidebar phase={phase} onNavigate={setPhase} />
      <div className="fdo-studio__main">
        <Stepper phase={phase} onJump={setPhase} />
        {page}
      </div>
    </div>
  );
}
