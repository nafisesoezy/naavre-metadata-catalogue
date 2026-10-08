import React, { useState } from 'react';
import { CatalogueHit, DetectedRepoAsset, DraftFdoAsset, Relationship, LifecycleItem, RelationType, SuggestedRelation, WorkflowGraph } from '../types';
import { FieldDef, FieldGroup, computeMissingFields, isFieldRequired, schemaFor } from '../fieldSchemas';
import {
  CATALOGUE_BADGE_CLASS,
  DRAFT_TYPE_BADGE_CLASS,
  RELATION_LABEL,
  RELATION_SOURCE_LABEL,
  discoverMockGraphRelations,
  draftTypeLabel,
  fetchCatalogueRecordMetadata,
  lifecycleItemToDraft
} from '../lifecycle';
import { hitToCatalogueHit } from './DiscoveryPage';

interface PublicationPageProps {
  catalogueBaseUrl: string;
  graph: WorkflowGraph;
  publicationInbox: LifecycleItem[];
  draftAssets: DraftFdoAsset[];
  detectedRepoAssets: DetectedRepoAsset[];
  onSetDetectedRepoAssets: (assets: DetectedRepoAsset[]) => void;
  onAddDraftAssets: (assets: DraftFdoAsset[]) => void;
  onUpdateDraftMetadata: (id: string, patch: Record<string, unknown>) => void;
  onSetDraftStatus: (id: string, status: DraftFdoAsset['status']) => void;
  onSetDraftRelations: (id: string, relations: Relationship[]) => void;
  onReservePid: (id: string) => void;
  onPublishResults: (results: { id: string; pid: string }[]) => void;
}

type TabId = 'metadata' | 'relationships' | 'fair' | 'preview';

const RELATION_SOURCES: { key: string; label: string }[] = [
  { key: 'workflow', label: 'Current Workflow' },
  { key: 'repository', label: 'Repository' },
  { key: 'catalogue', label: 'Catalogue' },
  { key: 'registry', label: 'Existing FDO Registry' }
];

const RELATION_TYPE_OPTIONS: RelationType[] = ['partOf', 'producedBy', 'uses', 'derivedFrom', 'produces', 'relatedTo'];

const MOCK_FAIR_SCORES: { label: string; pct: number }[] = [
  { label: 'Findable', pct: 85 },
  { label: 'Accessible', pct: 90 },
  { label: 'Interoperable', pct: 60 },
  { label: 'Reusable', pct: 75 }
];

function getAssetPid(asset: unknown): string | undefined {
  const a = asset as { internalPid?: unknown; pid?: unknown };
  if (typeof a.internalPid === 'string' && a.internalPid.trim()) return a.internalPid;
  if (typeof a.pid === 'string' && a.pid.trim()) return a.pid;
  return undefined;
}

function FieldInput(props: { field: FieldDef; value: unknown; onChange: (value: unknown) => void }): JSX.Element {
  const { field, value, onChange } = props;

  if (field.kind === 'textarea') {
    return (
      <textarea
        className="fdo-textarea"
        rows={3}
        value={(value as string) ?? ''}
        onChange={e => onChange(e.target.value)}
      />
    );
  }

  if (field.kind === 'date') {
    return (
      <input
        type="date"
        className="fdo-input"
        value={(value as string) ?? ''}
        onChange={e => onChange(e.target.value)}
      />
    );
  }

  if (field.kind === 'tags') {
    const list = Array.isArray(value) ? (value as string[]) : [];
    return (
      <input
        className="fdo-input"
        value={list.join(', ')}
        placeholder="Comma-separated"
        onChange={e =>
          onChange(
            e.target.value
              .split(',')
              .map(v => v.trim())
              .filter(Boolean)
          )
        }
      />
    );
  }

  return <input className="fdo-input" value={(value as string) ?? ''} onChange={e => onChange(e.target.value)} />;
}

export function PublicationPage(props: PublicationPageProps): JSX.Element {
  const {
    catalogueBaseUrl,
    graph,
    publicationInbox,
    draftAssets,
    detectedRepoAssets,
    onSetDetectedRepoAssets,
    onAddDraftAssets,
    onUpdateDraftMetadata,
    onSetDraftStatus,
    onSetDraftRelations,
    onReservePid,
    onPublishResults
  } = props;

  const [selectedExecutionIds, setSelectedExecutionIds] = useState<Set<string>>(new Set());
  const [selectedRepoIds, setSelectedRepoIds] = useState<Set<string>>(new Set());
  const [repoUrl, setRepoUrl] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState('');

  const [catalogueQuery, setCatalogueQuery] = useState('');
  const [catalogueHits, setCatalogueHits] = useState<CatalogueHit[]>([]);
  const [catalogueSearching, setCatalogueSearching] = useState(false);
  const [catalogueError, setCatalogueError] = useState('');
  const [selectedCatalogueIds, setSelectedCatalogueIds] = useState<Set<string>>(new Set());
  const [addingCatalogue, setAddingCatalogue] = useState(false);
  const [activeId, setActiveId] = useState('');
  const [tab, setTab] = useState<TabId>('metadata');
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState('');
  const [harvesting, setHarvesting] = useState('');
  const [aiEnrichNote, setAiEnrichNote] = useState(false);

  const [showDiscoverPanel, setShowDiscoverPanel] = useState(false);
  const [relationSources, setRelationSources] = useState<Set<string>>(
    new Set(['workflow', 'repository', 'catalogue', 'registry'])
  );
  const [discovering, setDiscovering] = useState(false);
  const [suggestions, setSuggestions] = useState<SuggestedRelation[]>([]);

  const [showAddRelationForm, setShowAddRelationForm] = useState(false);
  const [newRelationType, setNewRelationType] = useState<RelationType>('relatedTo');
  const [newRelationTarget, setNewRelationTarget] = useState('');
  const [relationsValidation, setRelationsValidation] = useState<'ok' | 'empty' | null>(null);

  const [previewCrate, setPreviewCrate] = useState<unknown>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');

  const base = catalogueBaseUrl.replace(/\/$/, '');
  const isDrafted = (id: string) => draftAssets.some(d => d.id === id);
  const activeAsset = draftAssets.find(d => d.id === activeId) ?? draftAssets[0];
  const publishedThisSession = draftAssets.filter(d => d.status === 'published');

  function toggleSet(set: Set<string>, id: string, setter: (s: Set<string>) => void) {
    const next = new Set(set);
    next.has(id) ? next.delete(id) : next.add(id);
    setter(next);
  }

  function selectAsset(id: string) {
    setActiveId(id);
    setTab('metadata');
    resetTabState();
  }

  function resetTabState() {
    setShowDiscoverPanel(false);
    setSuggestions([]);
    setShowAddRelationForm(false);
    setRelationsValidation(null);
    setPreviewCrate(null);
    setPreviewError('');
    setAiEnrichNote(false);
  }

  function handleAddExecutionSelected() {
    const chosen = publicationInbox.filter(item => selectedExecutionIds.has(item.id));
    const drafts = chosen.map(item => {
      const draft = lifecycleItemToDraft(item) as DraftFdoAsset & { internalPid?: string };
      const pid = getAssetPid(draft);
      return {
        ...draft,
        internalPid: pid,
        pid
      } as DraftFdoAsset;
    });
    onAddDraftAssets(drafts);
    setSelectedExecutionIds(new Set());
  }

  async function handleScan() {
    if (!repoUrl.trim()) {
      setScanError('Enter a GitHub repository URL first.');
      return;
    }

    setScanning(true);
    setScanError('');

    try {
      const resp = await fetch(`${base}/publication/scan-repository`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo_url: repoUrl })
      });

      if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}: ${await resp.text()}`);

      const data = await resp.json();
      onSetDetectedRepoAssets(data.assets ?? []);
    } catch (err: any) {
      setScanError(String(err?.message ?? err));
      onSetDetectedRepoAssets([]);
    } finally {
      setScanning(false);
    }
  }

  async function enrichOne(asset: DetectedRepoAsset): Promise<Record<string, unknown>> {
    try {
      const resp = await fetch(`${base}/publication/enrich`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: asset.type, repo_url: repoUrl, path: asset.path, title: asset.title })
      });

      if (resp.ok) {
        const data = await resp.json();
        return data.metadata ?? {};
      }
    } catch {
      // best-effort
    }

    return {};
  }

 async function handleAddRepoSelected() {
   const chosen = detectedRepoAssets.filter(a => selectedRepoIds.has(a.id));

   const drafts = await Promise.all(
     chosen.map(async asset => {
       const metadata = await enrichOne(asset);
       if (asset.type === 'workflow' && !metadata.persistentIdentifier) {
         metadata.persistentIdentifier = asset.internalPid ?? asset.pid ?? '';
       }

       const draft: DraftFdoAsset = {
         id: asset.id,
         internalPid: asset.internalPid,
         pid: asset.pid,
         source: 'repository',
         sourcePath: asset.path,
         repositoryUrl: repoUrl,
         type: asset.type,
         title:
           (metadata.title as string) ||
           (metadata.resourceTitle as string) ||
           asset.title,
         metadata: {
           ...metadata,
           repositoryUrl: repoUrl,
           sourcePath: asset.path
         },
         missingFields: computeMissingFields(asset.type, metadata),
         status: 'draft',
         relations: []
       };

       return draft;
     })
   );

   onAddDraftAssets(drafts);
   onSetDetectedRepoAssets(
     detectedRepoAssets.filter(a => !selectedRepoIds.has(a.id))
   );
   setSelectedRepoIds(new Set());
 }

  // ---- Assets from Catalogue (search directly here, skipping Composition
  // and Execution entirely — same catalogue search Discovery uses) ----

  async function handleCatalogueSearch() {
    if (!catalogueQuery.trim()) {
      setCatalogueError('Enter a search term.');
      return;
    }

    setCatalogueSearching(true);
    setCatalogueError('');

    try {
      const resp = await fetch(`${base}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: catalogueQuery, page: 1, size: 10 })
      });

      if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}: ${await resp.text()}`);

      const data = await resp.json();
      const rawHits = data?.hits?.hits ?? [];
      setCatalogueHits(rawHits.map(hitToCatalogueHit));
    } catch (err: any) {
      setCatalogueError(String(err?.message ?? err));
      setCatalogueHits([]);
    } finally {
      setCatalogueSearching(false);
    }
  }

  // Each selected hit gets its full metadata fetched (GET
  // /catalogue/record/{uuid}) and pre-filled into the draft immediately —
  // catalogue records are all treated as Dataset type for now (see
  // DiscoveryPage's classification TODO); this is the single place that
  // maps to a different DraftAssetType once the catalogue can tell
  // datasets/models/workflows apart.
  async function handleAddCatalogueSelected() {
    const chosen = catalogueHits.filter(h => selectedCatalogueIds.has(h.uuid));

    setAddingCatalogue(true);
    try {
      const drafts = await Promise.all(
        chosen.map(async hit => {
          const full = await fetchCatalogueRecordMetadata(catalogueBaseUrl, hit.uuid);
          const metadata: Record<string, unknown> = {
            description: hit.description,
            organisation: hit.organisation,
            ...(full ?? {})
          };

          const draft: DraftFdoAsset = {
            id: hit.uuid,
            internalPid: hit.uuid,
            source: 'catalogue',
            type: 'dataset',
            title: (metadata.resourceTitle as string) || hit.title,
            metadata,
            missingFields: computeMissingFields('dataset', metadata),
            status: 'draft',
            relations: []
          };

          return draft;
        })
      );

      onAddDraftAssets(drafts);
      setCatalogueHits(prev => prev.filter(h => !selectedCatalogueIds.has(h.uuid)));
      setSelectedCatalogueIds(new Set());
    } finally {
      setAddingCatalogue(false);
    }
  }

  async function handleHarvestMetadata() {
    if (!activeAsset || activeAsset.source !== 'repository' || !activeAsset.metadata.repositoryUrl) return;

    setHarvesting(activeAsset.id);

    try {
      const path = (activeAsset.metadata.workflowFile as string) || '';
      const resp = await fetch(`${base}/publication/enrich`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: activeAsset.type,
          repo_url: activeAsset.metadata.repositoryUrl,
          path,
          title: activeAsset.title
        })
      });

      if (resp.ok) {
        const data = await resp.json();
        onUpdateDraftMetadata(activeAsset.id, data.metadata ?? {});
      }
    } finally {
      setHarvesting('');
    }
  }

  async function handleDiscoverRelations() {
    if (!activeAsset) return;

    setDiscovering(true);
    setSuggestions([]);

    try {
      const sources = Array.from(relationSources);
      let backendSuggestions: SuggestedRelation[] = [];
      const activePid = getAssetPid(activeAsset);

      if (activeAsset.source === 'repository' && (sources.includes('repository') || sources.includes('workflow'))) {
        const resp = await fetch(`${base}/publication/discover-relations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            asset: {
              id: activeAsset.id,
              internalPid: activePid,
              pid: activePid,
              type: activeAsset.type,
              title: activeAsset.title,
              metadata: activeAsset.metadata
            },
            sources
          })
        });

        if (resp.ok) {
          const data = await resp.json();
          backendSuggestions = data.suggestions ?? [];
        }
      } else {
        const sourceNodeId = activeAsset.metadata.sourceNodeId as string | undefined;

        if (sources.includes('workflow')) {
          backendSuggestions = discoverMockGraphRelations(graph, sourceNodeId);
        }

        if (sources.includes('catalogue') || sources.includes('registry')) {
          const resp = await fetch(`${base}/publication/discover-relations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              asset: {
                id: activeAsset.id,
                internalPid: activePid,
                pid: activePid,
                type: activeAsset.type,
                title: activeAsset.title,
                metadata: {}
              },
              sources: sources.filter(s => s === 'catalogue' || s === 'registry')
            })
          });

          if (resp.ok) {
            const data = await resp.json();
            backendSuggestions = [...backendSuggestions, ...(data.suggestions ?? [])];
          }
        }
      }

     const already = new Set(
       activeAsset.relations.map(r => `${r.predicate}::${r.objectTitle}`)
     );
     setSuggestions(
       backendSuggestions.filter(
         s => !already.has(`${s.type}::${s.targetTitle}`)
       )
     );
    } finally {
      setDiscovering(false);
    }
  }

  function acceptSuggestion(s: SuggestedRelation) {
    if (!activeAsset) return;

    const relation: Relationship = {
      id: `rel-${crypto.randomUUID()}`,
      internalPid: `urn:uuid:${crypto.randomUUID()}`,
      subjectId: activeAsset.id,
      subjectPid: getAssetPid(activeAsset),
      predicate: s.type,
      objectTitle: s.targetTitle,
      discoveryMethod: s.source,
      evidence: s.source,
      confidence: 0.8,
      validationStatus: 'accepted'
    };

    onSetDraftRelations(activeAsset.id, [...activeAsset.relations, relation]);
    setSuggestions(prev => prev.filter(x => x !== s));
  }

  function rejectSuggestion(s: SuggestedRelation) {
    setSuggestions(prev => prev.filter(x => x !== s));
  }

  function removeRelation(idx: number) {
    if (!activeAsset) return;
    onSetDraftRelations(activeAsset.id, activeAsset.relations.filter((_, i) => i !== idx));
  }

  function handleAddRelationship() {
    if (!activeAsset || !newRelationTarget.trim()) return;

    const relation: Relationship = {
      id: `rel-${crypto.randomUUID()}`,
      internalPid: `urn:uuid:${crypto.randomUUID()}`,
      subjectId: activeAsset.id,
      subjectPid: getAssetPid(activeAsset),
      predicate: newRelationType,
      objectTitle: newRelationTarget.trim(),
      discoveryMethod: 'manual',
      evidence: 'manual entry',
      confidence: 1,
      validationStatus: 'accepted'
    };

    onSetDraftRelations(activeAsset.id, [...activeAsset.relations, relation]);

    setNewRelationTarget('');
    setShowAddRelationForm(false);
  }

  function handleValidateRelationships() {
    if (!activeAsset) return;
    setRelationsValidation(activeAsset.relations.length > 0 ? 'ok' : 'empty');
  }

  async function handlePreview() {
    if (!activeAsset) return;

    setPreviewLoading(true);
    setPreviewError('');
    setPreviewCrate(null);

    try {
      const activePid = getAssetPid(activeAsset);

      const resp = await fetch(`${base}/publication/preview-fdo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset: {
            id: activeAsset.id,
            internalPid: activePid,
            type: activeAsset.type,
            title: activeAsset.title,
            metadata: activeAsset.metadata,
            pid: activePid
          }
        })
      });

      if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}: ${await resp.text()}`);

      const data = await resp.json();
      setPreviewCrate(data.crate);
    } catch (err: any) {
      setPreviewError(String(err?.message ?? err));
    } finally {
      setPreviewLoading(false);
    }
  }

  function handleValidateOne(id: string) {
    const asset = draftAssets.find(d => d.id === id);
    if (!asset) return;
    onSetDraftStatus(id, asset.missingFields.length === 0 ? 'ready' : 'draft');
  }

  function handleValidateSelected() {
    draftAssets.forEach(d => onSetDraftStatus(d.id, d.missingFields.length === 0 ? 'ready' : 'draft'));
  }

  function handleReservePids() {
    draftAssets.filter(d => d.status === 'ready' && !getAssetPid(d)).forEach(d => onReservePid(d.id));
  }

  async function handlePublish() {
    const ready = draftAssets.filter(d => d.status === 'ready');
    if (ready.length === 0) return;

    setPublishing(true);
    setPublishError('');

    try {
      const resp = await fetch(`${base}/publication/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assets: ready.map(d => {
            const pid = getAssetPid(d);
            return {
              id: d.id,
              internalPid: pid,
              type: d.type,
              title: d.title,
              metadata: d.metadata,
              pid
            };
          })
        })
      });

      if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}: ${await resp.text()}`);

      const data = await resp.json();
      onPublishResults((data.published ?? []).map((p: any) => ({ id: p.id, pid: p.pid })));
    } catch (err: any) {
      setPublishError(String(err?.message ?? err));
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="fdo-page">
      <div className="fdo-page__card">
        <h3 className="fdo-page__heading">Publication</h3>
        <p className="fdo-page__lead">
          Create and publish FDOs from execution outputs or repository assets
        </p>

        <div className="fdo-pipeline-strip">
          {[
            'Asset Selection',
            'Metadata Enrichment',
            'Relationship Discovery',
            'Validation',
            'PID Assignment',
            'FDO Generation',
            'Publication'
          ].map((step, i, arr) => (
            <React.Fragment key={step}>
              <span className="fdo-pipeline-strip__step">{step}</span>
              {i < arr.length - 1 && (
                <span className="fdo-pipeline-strip__arrow">→</span>
              )}
            </React.Fragment>
          ))}
        </div>

        {publishedThisSession.length > 0 && (
          <div className="fdo-banner fdo-banner--success">
            <strong>
              Published {publishedThisSession.length} FDO
              {publishedThisSession.length === 1 ? '' : 's'} this session
            </strong>
            <ul className="fdo-published-list">
              {publishedThisSession.map(d => (
                <li key={d.id}>
                  {d.title} — <code>{getAssetPid(d)}</code>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="fdo-pub-source-card">
          <h4>1. Assets from Execution</h4>
          {publicationInbox.length === 0 ? (
            <p className="fdo-empty">
              Nothing here yet — send outputs or an execution record from
              Execution.
            </p>
          ) : (
            <ul className="fdo-checklist">
              {publicationInbox.map(item => (
                <li key={item.id}>
                  <input
                    type="checkbox"
                    checked={selectedExecutionIds.has(item.id)}
                    disabled={isDrafted(item.id)}
                    onChange={() =>
                      toggleSet(
                        selectedExecutionIds,
                        item.id,
                        setSelectedExecutionIds
                      )
                    }
                  />
                  <span>{item.title}</span>
                  <span className="fdo-badge fdo-badge--output">
                    {item.type}
                  </span>
                  {isDrafted(item.id) && (
                    <span className="fdo-checklist__added">Added</span>
                  )}
                </li>
              ))}
            </ul>
          )}

          <button
            type="button"
            className="fdo-btn fdo-btn--primary"
            disabled={selectedExecutionIds.size === 0}
            onClick={handleAddExecutionSelected}
          >
            Add Selected to Draft FDOs
          </button>
        </div>

        <div className="fdo-pub-source-card">
          <h4>2. Assets from Repository</h4>
          <div className="fdo-search-bar">
            <input
              className="fdo-input fdo-input--wide"
              placeholder="https://github.com/owner/repo"
              value={repoUrl}
              onChange={e => setRepoUrl(e.target.value)}
            />
            <button
              type="button"
              className="fdo-btn fdo-btn--primary"
              disabled={scanning}
              onClick={handleScan}
            >
              {scanning ? 'Scanning...' : 'Scan Repository'}
            </button>
          </div>

          {scanError && <p className="fdo-error">{scanError}</p>}

          {detectedRepoAssets.length > 0 && (
            <>
              <h5>Detected assets</h5>
              <ul className="fdo-checklist">
                {detectedRepoAssets.map(asset => (
                  <li key={asset.id}>
                    <input
                      type="checkbox"
                      checked={selectedRepoIds.has(asset.id)}
                      onChange={() =>
                        toggleSet(selectedRepoIds, asset.id, setSelectedRepoIds)
                      }
                    />
                    <span>{asset.title}</span>
                    <span className={DRAFT_TYPE_BADGE_CLASS[asset.type]}>
                      {draftTypeLabel(asset.type)}
                    </span>
                  </li>
                ))}
              </ul>

              <button
                type="button"
                className="fdo-btn fdo-btn--primary"
                disabled={selectedRepoIds.size === 0}
                onClick={() => void handleAddRepoSelected()}
              >
                Add Selected to Draft FDOs
              </button>
            </>
          )}
        </div>

        <div className="fdo-pub-source-card">
          <h4>3. Assets from Catalogue</h4>
          <div className="fdo-search-bar">
            <input
              className="fdo-input fdo-input--wide"
              placeholder="Search catalogue..."
              value={catalogueQuery}
              onChange={e => setCatalogueQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') void handleCatalogueSearch();
              }}
            />
            <button
              type="button"
              className="fdo-btn fdo-btn--primary"
              disabled={catalogueSearching}
              onClick={() => void handleCatalogueSearch()}
            >
              {catalogueSearching ? 'Searching...' : 'Search'}
            </button>
          </div>

          {catalogueError && <p className="fdo-error">{catalogueError}</p>}

          {catalogueHits.length > 0 && (
            <>
              <h5>Results</h5>
              <ul className="fdo-checklist">
                {catalogueHits.map(hit => (
                  <li key={hit.uuid}>
                    <input
                      type="checkbox"
                      checked={selectedCatalogueIds.has(hit.uuid)}
                      disabled={isDrafted(hit.uuid)}
                      onChange={() =>
                        toggleSet(selectedCatalogueIds, hit.uuid, setSelectedCatalogueIds)
                      }
                    />
                    <span>{hit.title}</span>
                    <span className={CATALOGUE_BADGE_CLASS[hit.type]}>{hit.type}</span>
                    {isDrafted(hit.uuid) && (
                      <span className="fdo-checklist__added">Added</span>
                    )}
                  </li>
                ))}
              </ul>

              <button
                type="button"
                className="fdo-btn fdo-btn--primary"
                disabled={selectedCatalogueIds.size === 0 || addingCatalogue}
                onClick={() => void handleAddCatalogueSelected()}
              >
                {addingCatalogue ? 'Adding...' : 'Add Selected to Draft FDOs'}
              </button>
            </>
          )}
        </div>

        <div className="fdo-pub-workspace">
          <div className="fdo-pub-workspace__list">
            <h4>Selected Assets</h4>

            {draftAssets.length === 0 ? (
              <p className="fdo-empty">
                Nothing added yet — add assets from either source above.
              </p>
            ) : (
              <ul className="fdo-asset-list">
                {draftAssets.map(d => {
                  return (
                    <li key={d.id}>
                      <button
                        type="button"
                        className={
                          d.id === activeAsset?.id
                            ? 'fdo-asset-row fdo-asset-row--active'
                            : 'fdo-asset-row'
                        }
                        onClick={() => selectAsset(d.id)}
                      >
                        <span>{d.missingFields.length === 0 ? '✓' : '⚠'}</span>
                        <span className="fdo-asset-row__title">{d.title}</span>
                        {d.status === 'published' && (
                          <span className="fdo-badge fdo-badge--output">
                            Published
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="fdo-pub-workspace__editor">
            {!activeAsset ? (
              <p className="fdo-empty">Select an asset on the left.</p>
            ) : (
              <>
                <div className="fdo-pub-workspace__editor-header">
                  <div>
                    <h4>{activeAsset.title}</h4>
                    <p className="fdo-pub-workspace__type">
                      Type:{' '}
                      <span
                        className={DRAFT_TYPE_BADGE_CLASS[activeAsset.type]}
                      >
                        {draftTypeLabel(activeAsset.type)} FDO
                      </span>
                    </p>
                    {getAssetPid(activeAsset) && (
                      <p className="fdo-pub-workspace__type">
                        Internal PID: <code>{getAssetPid(activeAsset)}</code>
                      </p>
                    )}
                  </div>
                </div>

                <div className="fdo-tabs">
                  <button
                    type="button"
                    className={
                      tab === 'metadata' ? 'fdo-tab fdo-tab--active' : 'fdo-tab'
                    }
                    onClick={() => setTab('metadata')}
                  >
                    Metadata
                  </button>
                  <button
                    type="button"
                    className={
                      tab === 'relationships'
                        ? 'fdo-tab fdo-tab--active'
                        : 'fdo-tab'
                    }
                    onClick={() => setTab('relationships')}
                  >
                    Relationships
                  </button>
                  <button
                    type="button"
                    className={
                      tab === 'fair' ? 'fdo-tab fdo-tab--active' : 'fdo-tab'
                    }
                    onClick={() => setTab('fair')}
                  >
                    FAIR Assessment
                  </button>
                  <button
                    type="button"
                    className={
                      tab === 'preview' ? 'fdo-tab fdo-tab--active' : 'fdo-tab'
                    }
                    onClick={() => setTab('preview')}
                  >
                    Preview &amp; Publish
                  </button>
                </div>

                {tab === 'metadata' && (
                  <>
                    <div className="fdo-tab-toolbar">
                      <button
                        type="button"
                        className="fdo-btn fdo-btn--ghost fdo-btn--small"
                        disabled={
                          harvesting === activeAsset.id ||
                          activeAsset.source !== 'repository'
                        }
                        onClick={() => void handleHarvestMetadata()}
                      >
                        📄 Harvest Metadata
                      </button>
                      <button
                        type="button"
                        className="fdo-btn fdo-btn--ghost fdo-btn--small"
                        onClick={() => setAiEnrichNote(true)}
                      >
                        ✨ AI Enrich Metadata
                      </button>
                    </div>

                    {aiEnrichNote && (
                      <p className="fdo-tab-toolbar__note">
                        AI-assisted enrichment isn't built yet — coming in a
                        later step.
                      </p>
                    )}

                    {schemaFor(activeAsset.type).map((group: FieldGroup) => (
                      <fieldset className="fdo-field-group" key={group.group}>
                        <legend>{group.group}</legend>
                        {group.fields.map(field => (
                          <label className="fdo-form-field" key={field.key}>
                            <span>
                              {field.label}
                              {isFieldRequired(field, activeAsset.metadata) ? ' *' : ''}
                            </span>
                            <FieldInput
                              field={field}
                              value={activeAsset.metadata[field.key]}
                              onChange={value =>
                                onUpdateDraftMetadata(activeAsset.id, {
                                  [field.key]: value
                                })
                              }
                            />
                          </label>
                        ))}
                      </fieldset>
                    ))}
                  </>
                )}

                {tab === 'relationships' && (
                  <div className="fdo-relations-panel">
                    <div className="fdo-tab-toolbar">
                      <button
                        type="button"
                        className="fdo-btn fdo-btn--ghost fdo-btn--small"
                        onClick={() => setShowDiscoverPanel(v => !v)}
                      >
                        🔍 Discover Relationships
                      </button>
                      <button
                        type="button"
                        className="fdo-btn fdo-btn--ghost fdo-btn--small"
                        onClick={() => setShowAddRelationForm(v => !v)}
                      >
                        ➕ Add Relationship
                      </button>
                      <button
                        type="button"
                        className="fdo-btn fdo-btn--ghost fdo-btn--small"
                        onClick={handleValidateRelationships}
                      >
                        ✔ Validate Relationships
                      </button>
                    </div>

                    {relationsValidation && (
                      <p
                        className={
                          relationsValidation === 'ok'
                            ? 'fdo-validate-note fdo-validate-note--ok'
                            : 'fdo-validate-note fdo-validate-note--warn'
                        }
                      >
                        {relationsValidation === 'ok'
                          ? `✓ ${activeAsset.relations.length} relationship(s) recorded.`
                          : '⚠ No relationships recorded yet — try Discover Relationships.'}
                      </p>
                    )}

                    {showDiscoverPanel && (
                      <div className="fdo-discover-config">
                        <span className="fdo-discover-config__label">
                          Sources
                        </span>
                        {RELATION_SOURCES.map(s => (
                          <label key={s.key} className="fdo-checkbox-inline">
                            <input
                              type="checkbox"
                              checked={relationSources.has(s.key)}
                              onChange={() =>
                                toggleSet(
                                  relationSources,
                                  s.key,
                                  setRelationSources
                                )
                              }
                            />
                            {s.label}
                          </label>
                        ))}
                        <button
                          type="button"
                          className="fdo-btn fdo-btn--primary fdo-btn--small"
                          disabled={discovering}
                          onClick={() => void handleDiscoverRelations()}
                        >
                          {discovering ? 'Discovering...' : 'Discover'}
                        </button>
                      </div>
                    )}

                    {showAddRelationForm && (
                      <div className="fdo-add-relation-form">
                        <select
                          className="fdo-select"
                          value={newRelationType}
                          onChange={e =>
                            setNewRelationType(e.target.value as RelationType)
                          }
                        >
                          {RELATION_TYPE_OPTIONS.map(t => (
                            <option key={t} value={t}>
                              {RELATION_LABEL[t]}
                            </option>
                          ))}
                        </select>

                        <input
                          className="fdo-input"
                          placeholder="Target entity title"
                          value={newRelationTarget}
                          onChange={e => setNewRelationTarget(e.target.value)}
                        />

                        <button
                          type="button"
                          className="fdo-btn fdo-btn--primary fdo-btn--small"
                          onClick={handleAddRelationship}
                        >
                          Add
                        </button>
                      </div>
                    )}

                    {suggestions.length > 0 && (
                      <div className="fdo-suggested-relations">
                        <h5>Suggested Relationships</h5>
                        <ul>
                          {suggestions.map((s, i) => (
                            <li key={i}>
                              <span className="fdo-relation-type">
                                {RELATION_LABEL[s.type] ?? s.type}
                              </span>
                              <span className="fdo-relation-target">
                                {s.targetTitle}
                              </span>
                              <span className="fdo-relation-source-tag">
                                {RELATION_SOURCE_LABEL[s.source] ?? s.source}
                              </span>
                              <button
                                type="button"
                                className="fdo-btn fdo-btn--ghost fdo-btn--small"
                                onClick={() => acceptSuggestion(s)}
                              >
                                Accept
                              </button>
                              <button
                                type="button"
                                className="fdo-link-btn"
                                onClick={() => rejectSuggestion(s)}
                              >
                                Reject
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <h5>
                      Accepted Relationships ({activeAsset.relations.length})
                    </h5>
                    {activeAsset.relations.length === 0 ? (
                      <p className="fdo-empty">
                        No relations accepted yet for "{activeAsset.title}".
                      </p>
                    ) : (
                      <ul className="fdo-accepted-relations">
                        {activeAsset.relations.map((r, i) => (
                          <li key={r.id || i}>
                            <span className="fdo-relation-type">
                              {RELATION_LABEL[r.predicate as RelationType] ??
                                r.predicate}
                            </span>
                            <span className="fdo-relation-target">
                              {r.objectTitle}
                            </span>
                            <button
                              type="button"
                              className="fdo-link-btn"
                              onClick={() => removeRelation(i)}
                            >
                              Remove
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {tab === 'fair' && (
                  <div className="fdo-fair-panel">
                    <p className="fdo-fair-panel__note">
                      Mock scores for now — a real FAIR rubric against this
                      asset's actual metadata/relations/PID state is a good next
                      step.
                    </p>

                    <div className="fdo-fair-bars">
                      {MOCK_FAIR_SCORES.map(s => (
                        <div className="fdo-fair-bar-row" key={s.label}>
                          <span className="fdo-fair-bar-row__label">
                            {s.label}
                          </span>
                          <div className="fdo-fair-bar-track">
                            <div
                              className="fdo-fair-bar-fill"
                              style={{ width: `${s.pct}%` }}
                            />
                          </div>
                          <span className="fdo-fair-bar-row__pct">
                            {s.pct}%
                          </span>
                        </div>
                      ))}
                    </div>

                    <h5>Suggested Improvements</h5>
                    <ul className="fdo-fair-improvements">
                      {!getAssetPid(activeAsset) && <li>Missing PID</li>}
                      <li>Missing vocabulary</li>
                      {activeAsset.relations.length === 0 && (
                        <li>Missing provenance</li>
                      )}
                    </ul>
                  </div>
                )}

                {tab === 'preview' && (
                  <div className="fdo-preview-publish-panel">
                    <div className="fdo-tab-toolbar">
                      <button
                        type="button"
                        className="fdo-btn fdo-btn--ghost fdo-btn--small"
                        onClick={() => void handlePreview()}
                      >
                        Generate FDO
                      </button>
                      <button
                        type="button"
                        className="fdo-btn fdo-btn--ghost fdo-btn--small"
                        onClick={() => handleValidateOne(activeAsset.id)}
                      >
                        Validate FDO
                      </button>
                      <button
                        type="button"
                        className="fdo-btn fdo-btn--ghost fdo-btn--small"
                        disabled={Boolean(getAssetPid(activeAsset))}
                        onClick={() => onReservePid(activeAsset.id)}
                      >
                        Reserve PID
                      </button>
                    </div>

                    <div className="fdo-publish-summary">
                      <div className="fdo-publish-summary__row">
                        <span className="fdo-publish-summary__label">
                          Metadata
                        </span>
                        <span>
                          {activeAsset.missingFields.length === 0
                            ? 'All required fields complete'
                            : `${activeAsset.missingFields.length} required field(s) missing`}
                        </span>
                      </div>

                      <div className="fdo-publish-summary__row">
                        <span className="fdo-publish-summary__label">
                          Relationships
                        </span>
                        <span>{activeAsset.relations.length} recorded</span>
                      </div>

                      <div className="fdo-publish-summary__row">
                        <span className="fdo-publish-summary__label">
                          FAIR Score
                        </span>
                        <span>
                          {MOCK_FAIR_SCORES.map(
                            s => `${s.label[0]}:${s.pct}%`
                          ).join('  ')}
                        </span>
                      </div>

                      <div className="fdo-publish-summary__row">
                        <span className="fdo-publish-summary__label">
                          Internal PID
                        </span>
                        {getAssetPid(activeAsset) ? (
                          <code>{getAssetPid(activeAsset)}</code>
                        ) : (
                          <span className="fdo-publish-summary__pid-missing">
                            Not Assigned
                            <button
                              type="button"
                              className="fdo-link-btn"
                              onClick={() => onReservePid(activeAsset.id)}
                            >
                              Reserve PID
                            </button>
                          </span>
                        )}
                      </div>
                    </div>

                    {previewLoading && (
                      <p className="fdo-empty">Building preview...</p>
                    )}
                    {previewError && (
                      <p className="fdo-error">{previewError}</p>
                    )}
                    {!previewLoading && !previewError && previewCrate ? (
                      <pre className="fdo-preview-json">
                        {JSON.stringify(previewCrate, null, 2)}
                      </pre>
                    ) : null}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {publishError && <p className="fdo-error">{publishError}</p>}

        <div className="fdo-page__footer">
          <span>
            {draftAssets.filter(d => d.status === 'ready').length} of{' '}
            {draftAssets.length} draft FDOs ready
            {' · '}
            {draftAssets.filter(d => getAssetPid(d)).length} PID
            {draftAssets.filter(d => getAssetPid(d)).length === 1
              ? ''
              : 's'}{' '}
            assigned
          </span>

          <div className="fdo-page__footer-actions">
            <button
              type="button"
              className="fdo-btn fdo-btn--ghost"
              onClick={handleValidateSelected}
            >
              Validate Selected
            </button>

            <button
              type="button"
              className="fdo-btn fdo-btn--ghost"
              disabled={draftAssets.every(
                d => d.status !== 'ready' || Boolean(getAssetPid(d))
              )}
              onClick={handleReservePids}
            >
              Reserve PIDs
            </button>

            <button
              type="button"
              className="fdo-btn fdo-btn--primary"
              disabled={
                publishing || draftAssets.every(d => d.status !== 'ready')
              }
              onClick={() => void handlePublish()}
            >
              {publishing
                ? 'Generating & Publishing...'
                : 'Generate & Publish FDOs'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}