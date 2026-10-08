import React, { useState } from 'react';
import { CatalogueHit, LifecycleItem } from '../types';
import { CATALOGUE_BADGE_CLASS, ITEM_BADGE_CLASS, itemKindLabel } from '../lifecycle';

interface DiscoveryPageProps {
  catalogueBaseUrl: string;
  // Items already sent forward from this phase — i.e. what's currently
  // sitting in Composition's "From Discovery" inbox. Shown here as the
  // "To Composition" panel so the scientist can see what they've already
  // picked without leaving the search screen.
  compositionInbox: LifecycleItem[];
  onSendToComposition: (hit: CatalogueHit) => void;
}

const PAGE_SIZE = 10;

const GEONETWORK_RECORD_BASE =
  'https://lter-life-catalogue.qcdis.org/geonetwork/srv/eng/catalog.search#/metadata/';

// TODO(backend): expects the response shape from catalogue_backend/app.py's
// POST /search — { total, total_pages, hits: { hits: [{ _source: {...} }] } }.
// Exported so PublicationPage's "Assets from Catalogue" search can reuse the
// exact same mapping instead of duplicating it.
export function hitToCatalogueHit(rawHit: any): CatalogueHit {
  const src = rawHit?._source ?? {};
  const uuid: string = src.uuid ?? '';

  const title =
    src.title || src.resourceTitleObject?.default || 'Untitled record';

  const description =
    src.description ||
    src.resourceAbstractObject?.default ||
    src.abstract ||
    'No description available.';

  const organisation =
    src.organisation || src.orgNameObject?.default || src.owner || '';

  return {
    uuid,
    title,
    description,
    organisation,
    type: 'Record',
    link: `${GEONETWORK_RECORD_BASE}${uuid}`
  };
}

export function DiscoveryPage(props: DiscoveryPageProps): JSX.Element {
  const { catalogueBaseUrl, compositionInbox, onSendToComposition } = props;

  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<CatalogueHit[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hasSearched, setHasSearched] = useState(false);

  async function runSearch(targetPage: number, searchQuery: string) {
    if (!searchQuery.trim()) {
      setError('Please enter a search term.');
      setHits([]);
      setTotalPages(0);
      setHasSearched(false);
      return;
    }

    if (!catalogueBaseUrl) {
      setError('Metadata catalogue URL is not configured.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch(
        `${catalogueBaseUrl.replace(/\/$/, '')}/search`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json'
          },
          body: JSON.stringify({
            query: searchQuery,
            page: targetPage,
            size: PAGE_SIZE
          })
        }
      );

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`${response.status} ${response.statusText}: ${text}`);
      }

      const data = await response.json();
      const rawHits = data?.hits?.hits ?? [];

      setHits(rawHits.map(hitToCatalogueHit));
      setTotal(data?.total ?? 0);
      setTotalPages(data?.total_pages ?? 0);
      setPage(targetPage);
    } catch (err: any) {
      setError(String(err?.message ?? err));
      setHits([]);
      setTotalPages(0);
    } finally {
      setLoading(false);
      setHasSearched(true);
    }
  }

  function handleSearchClick(): void {
    void runSearch(1, query);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter') {
      void runSearch(1, query);
    }
  }

  const isInComposition = (uuid: string) => compositionInbox.some(i => i.id === uuid);

  return (
    <div className="fdo-page">
      <div className="fdo-discovery-layout">
        <div className="fdo-page__card fdo-discovery-layout__main">
          <h3 className="fdo-page__heading">Discovery</h3>
          <p className="fdo-page__lead">Search and discover data, models, workflows and services</p>

          <div className="fdo-search-bar">
            <input
              className="fdo-input fdo-input--wide"
              placeholder="Search catalogue..."
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button type="button" className="fdo-btn fdo-btn--primary" onClick={handleSearchClick}>
              Search
            </button>
          </div>

          {loading && <p className="fdo-empty">Searching...</p>}
          {!loading && error && <p className="fdo-error">{error}</p>}

          {!loading && !error && hasSearched && (
            <div className="fdo-results-meta">
              <span>
                About {total} result{total === 1 ? '' : 's'}
              </span>
            </div>
          )}

          <div className="fdo-result-list">
            {hits.map(hit => (
              <div className="fdo-result-card" key={hit.uuid}>
                <div className="fdo-result-card__header">
                  <span className={CATALOGUE_BADGE_CLASS[hit.type]}>{hit.type}</span>
                  <a
                    className="fdo-result-card__title"
                    href={hit.link}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {hit.title}
                  </a>
                </div>
                <p className="fdo-result-card__description">{hit.description}</p>
                {hit.organisation && (
                  <div className="fdo-result-card__meta">
                    <span>{hit.organisation}</span>
                  </div>
                )}
                <div className="fdo-result-card__actions">
                  <a
                    className="fdo-btn fdo-btn--ghost"
                    href={hit.link}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View details
                  </a>
                  <button
                    type="button"
                    className="fdo-btn fdo-btn--primary"
                    disabled={isInComposition(hit.uuid)}
                    onClick={() => onSendToComposition(hit)}
                  >
                    {isInComposition(hit.uuid) ? 'Added' : 'Add to Composition'}
                  </button>
                </div>
              </div>
            ))}

            {!loading && hasSearched && !error && hits.length === 0 && (
              <p className="fdo-empty">No records found for &quot;{query}&quot;.</p>
            )}
          </div>

          {totalPages > 1 && (
            <div className="fdo-pagination">
              <button
                type="button"
                className="fdo-btn fdo-btn--ghost"
                disabled={page <= 1}
                onClick={() => void runSearch(page - 1, query)}
              >
                Previous
              </button>
              <span>
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                className="fdo-btn fdo-btn--ghost"
                disabled={page >= totalPages}
                onClick={() => void runSearch(page + 1, query)}
              >
                Next
              </button>
            </div>
          )}
        </div>

        <aside className="fdo-page__card fdo-discovery-layout__basket">
          <h4>To Composition ({compositionInbox.length})</h4>
          {compositionInbox.length === 0 ? (
            <p className="fdo-empty">
              Nothing sent yet. Search above and use "Add to Composition" on a result.
            </p>
          ) : (
            <ul className="fdo-basket-list">
              {compositionInbox.map(item => (
                <li className="fdo-basket-list__item" key={item.id}>
                  <span className={ITEM_BADGE_CLASS[item.type]}>{itemKindLabel(item.type)}</span>
                  {item.link ? (
                    <a href={item.link} target="_blank" rel="noopener noreferrer">
                      {item.title}
                    </a>
                  ) : (
                    <span>{item.title}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="fdo-tip">
            <div className="fdo-tip__title">Tip</div>
            <p>Add items here, then switch to Composition to build a workflow with them.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
