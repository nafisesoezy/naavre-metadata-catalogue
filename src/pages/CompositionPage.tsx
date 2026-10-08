import React, { useMemo, useState } from 'react';
import { LifecycleItem, WorkflowComponent, WorkflowGraph } from '../types';
import { ITEM_BADGE_CLASS, itemKindLabel } from '../lifecycle';

interface CompositionPageProps {
  graph: WorkflowGraph;
  selectedId: string | null;
  onSelect: (id: string) => void;
  discoveryInbox: LifecycleItem[];
  executionOutbox: LifecycleItem[];
  onUseItem: (id: string) => void;
  onSendComponentToExecution: (componentId: string) => void;
  onSendWorkflowToExecution: () => void;
}

const TYPE_BADGE_CLASS: Record<string, string> = {
  Dataset: 'fdo-badge fdo-badge--dataset',
  Component: 'fdo-badge fdo-badge--model',
  Output: 'fdo-badge fdo-badge--output'
};

// Lays the graph out as a main vertical chain (dataset + components) with
// any Output nodes branching off to the side of the component that
// produced them. Covers the common NaaVRE pattern (linear pipeline, branch
// outputs); a DAG with merging parallel branches will need a real layout
// engine (e.g. react-flow / dagre) instead of this CSS-flexbox approach.
function useChainLayout(graph: WorkflowGraph) {
  return useMemo(() => {
    const outputsByParent = new Map<string, WorkflowComponent[]>();
    const outputNodes = new Map(
      graph.components.filter(c => c.type === 'Output').map(c => [c.id, c])
    );

    graph.edges.forEach(edge => {
      const output = outputNodes.get(edge.to);
      if (output) {
        const list = outputsByParent.get(edge.from) ?? [];
        list.push(output);
        outputsByParent.set(edge.from, list);
      }
    });

    const mainChain = graph.components.filter(c => c.type !== 'Output');

    return mainChain.map(node => ({
      node,
      outputs: outputsByParent.get(node.id) ?? []
    }));
  }, [graph]);
}

export function CompositionPage(props: CompositionPageProps): JSX.Element {
  const {
    graph,
    selectedId,
    onSelect,
    discoveryInbox,
    executionOutbox,
    onUseItem,
    onSendComponentToExecution,
    onSendWorkflowToExecution
  } = props;

  const [tab, setTab] = useState<'graph' | 'details'>('graph');
  const rows = useChainLayout(graph);
  const selected = graph.components.find(c => c.id === selectedId) ?? null;

  return (
    <div className="fdo-page">
      <div className="fdo-composition-layout">
        <aside className="fdo-page__card fdo-composition-layout__inbox">
          <h4>From Discovery ({discoveryInbox.length})</h4>
          {discoveryInbox.length === 0 ? (
            <p className="fdo-empty">Nothing here yet — add items in Discovery first.</p>
          ) : (
            <ul className="fdo-basket-list">
              {discoveryInbox.map(item => (
                <li className="fdo-basket-list__item" key={item.id}>
                  <span className={ITEM_BADGE_CLASS[item.type]}>{itemKindLabel(item.type)}</span>
                  <span>{item.title}</span>
                  <button
                    type="button"
                    className="fdo-link-btn fdo-basket-list__remove"
                    onClick={() => onUseItem(item.id)}
                    disabled={item.status === 'used'}
                  >
                    {item.status === 'used' ? 'Used' : 'Use in Workflow'}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <h4 className="fdo-composition-layout__outbox-title">To Execution ({executionOutbox.length})</h4>
          {executionOutbox.length === 0 ? (
            <p className="fdo-empty">Nothing sent yet.</p>
          ) : (
            <ul className="fdo-basket-list">
              {executionOutbox.map(item => (
                <li className="fdo-basket-list__item" key={item.id}>
                  <span className={ITEM_BADGE_CLASS[item.type]}>{itemKindLabel(item.type)}</span>
                  <span>{item.title}</span>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <div className="fdo-page__card fdo-composition-layout__main">
          <div className="fdo-breadcrumb-row">
            <div className="fdo-breadcrumb">
              <span>Composition</span>
              <span className="fdo-breadcrumb__sep">›</span>
              <span className="fdo-breadcrumb__current">{graph.name}</span>
            </div>
            <button type="button" className="fdo-btn fdo-btn--ghost">
              Open in NaaVRE ↗
            </button>
          </div>

          <div className="fdo-tabs">
            <button
              type="button"
              className={tab === 'graph' ? 'fdo-tab fdo-tab--active' : 'fdo-tab'}
              onClick={() => setTab('graph')}
            >
              Graph View
            </button>
            <button
              type="button"
              className={tab === 'details' ? 'fdo-tab fdo-tab--active' : 'fdo-tab'}
              onClick={() => setTab('details')}
            >
              Details
            </button>
          </div>

          {tab === 'details' ? (
            <div className="fdo-workflow-details">
              <p>
                <strong>{graph.name}</strong>
              </p>
              <p>
                {graph.components.filter(c => c.type === 'Component').length} components,{' '}
                {graph.components.filter(c => c.type === 'Output').length} outputs.
              </p>
            </div>
          ) : (
            <div className="fdo-graph-layout">
              <div className="fdo-graph-canvas">
                {rows.map((row, idx) => (
                  <div className="fdo-graph-row" key={row.node.id}>
                    <div className="fdo-graph-row__main">
                      {idx > 0 && <div className="fdo-graph-connector fdo-graph-connector--vertical" />}
                      <button
                        type="button"
                        className={
                          selectedId === row.node.id
                            ? 'fdo-graph-node fdo-graph-node--selected'
                            : 'fdo-graph-node'
                        }
                        onClick={() => onSelect(row.node.id)}
                      >
                        {row.node.status === 'done' ? (
                          <span className="fdo-graph-node__check">✓</span>
                        ) : (
                          <span className="fdo-graph-node__pending" />
                        )}
                        {row.node.label}
                      </button>
                    </div>
                    {row.outputs.length > 0 && (
                      <div className="fdo-graph-row__outputs">
                        {row.outputs.map(output => (
                          <React.Fragment key={output.id}>
                            <div className="fdo-graph-connector fdo-graph-connector--horizontal" />
                            <button
                              type="button"
                              className={
                                selectedId === output.id
                                  ? 'fdo-graph-node fdo-graph-node--output fdo-graph-node--selected'
                                  : 'fdo-graph-node fdo-graph-node--output'
                              }
                              onClick={() => onSelect(output.id)}
                            >
                              {output.label}
                            </button>
                          </React.Fragment>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="fdo-component-details">
                <h4>Component Details</h4>
                {!selected && <p className="fdo-empty">Select a node to see its details.</p>}
                {selected && (
                  <>
                    <p className="fdo-component-details__name">{selected.label}</p>
                    <span className={TYPE_BADGE_CLASS[selected.type]}>{selected.type}</span>

                    {selected.description && (
                      <p className="fdo-component-details__description">{selected.description}</p>
                    )}

                    {selected.inputs && selected.inputs.length > 0 && (
                      <div className="fdo-component-details__section">
                        <span className="fdo-component-details__label">
                          Inputs ({selected.inputs.length})
                        </span>
                        <ul>
                          {selected.inputs.map(i => (
                            <li key={i}>{i}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {selected.outputs && selected.outputs.length > 0 && (
                      <div className="fdo-component-details__section">
                        <span className="fdo-component-details__label">
                          Outputs ({selected.outputs.length})
                        </span>
                        <ul>
                          {selected.outputs.map(o => (
                            <li key={o}>{o}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {selected.container && (
                      <div className="fdo-component-details__section">
                        <span className="fdo-component-details__label">Container</span>
                        <p>{selected.container}</p>
                      </div>
                    )}

                    {selected.sourceUrl && (
                      <div className="fdo-component-details__section">
                        <span className="fdo-component-details__label">Source</span>
                        <a href={selected.sourceUrl} target="_blank" rel="noopener noreferrer">
                          GitHub Repository ↗
                        </a>
                      </div>
                    )}

                    {selected.type === 'Component' && (
                      <button
                        type="button"
                        className="fdo-btn fdo-btn--primary fdo-component-details__cta"
                        onClick={() => onSendComponentToExecution(selected.id)}
                      >
                        Send Component to Execution
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          <div className="fdo-page__footer">
            <span>{graph.components.filter(c => c.type === 'Component').length} components in this workflow</span>
            <button type="button" className="fdo-btn fdo-btn--primary" onClick={onSendWorkflowToExecution}>
              Send Workflow to Execution →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
