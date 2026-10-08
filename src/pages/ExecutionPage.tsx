import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LifecycleItem, WorkflowGraph } from '../types';
import { ITEM_BADGE_CLASS, itemKindLabel } from '../lifecycle';

interface ExecutionPageProps {
  graph: WorkflowGraph;
  compositionInbox: LifecycleItem[];
  publicationOutbox: LifecycleItem[];
  onSendOutputToPublication: (outputId: string, label: string) => void;
  onSendExecutionRecordToPublication: () => void;
}

type StepStatus = 'pending' | 'running' | 'completed';

// TODO(backend): this whole page simulates a run client-side. Replace the
// progress simulation with a real execution-status poll/websocket once a
// workflow run can actually be triggered, and replace the output list with
// whatever the execution engine reports as produced artifacts.
const STEP_DURATION_MS = 900;

function suggestionTier(label: string): 'High' | 'Medium' | 'Low' {
  const lower = label.toLowerCase();
  if (lower.includes('carbon') || lower.includes('map')) return 'High';
  if (lower.includes('intermediate') || lower.includes('temp')) return 'Low';
  return 'Medium';
}

function initialStepStatus(stepList: { id: string }[]): Record<string, StepStatus> {
  const result: Record<string, StepStatus> = {};
  stepList.forEach(s => {
    result[s.id] = 'pending';
  });
  return result;
}

export function ExecutionPage(props: ExecutionPageProps): JSX.Element {
  const { graph, compositionInbox, publicationOutbox, onSendOutputToPublication, onSendExecutionRecordToPublication } =
    props;

  const steps = useMemo(() => graph.components.filter(c => c.type === 'Component'), [graph]);
  const outputs = useMemo(() => graph.components.filter(c => c.type === 'Output'), [graph]);

  const [stepStatus, setStepStatus] = useState<Record<string, StepStatus>>(() =>
    initialStepStatus(steps)
  );
  const [running, setRunning] = useState(false);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  function runNextStep(index: number) {
    if (index >= steps.length) {
      setRunning(false);
      return;
    }
    setStepStatus(prev => ({ ...prev, [steps[index].id]: 'running' }));
    timerRef.current = setTimeout(() => {
      setStepStatus(prev => ({ ...prev, [steps[index].id]: 'completed' }));
      runNextStep(index + 1);
    }, STEP_DURATION_MS);
  }

  function handleRun() {
    if (running) {
      return;
    }
    setRunning(true);
    setStartedAt(new Date().toLocaleString());
    setStepStatus(initialStepStatus(steps));
    runNextStep(0);
  }

  function handleStop() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    setRunning(false);
  }

  function producedByLabel(outputId: string): string {
    const edge = graph.edges.find(e => e.to === outputId);
    const producer = edge ? steps.find(s => s.id === edge.from) : undefined;
    return producer?.label ?? 'Unknown';
  }

  function isOutputReady(outputId: string): boolean {
    const edge = graph.edges.find(e => e.to === outputId);
    return edge ? stepStatus[edge.from] === 'completed' : false;
  }

  const isAlreadySent = (id: string) => publicationOutbox.some(item => item.metadata.sourceNodeId === id);

  return (
    <div className="fdo-page">
      <div className="fdo-page__card">
        <h3 className="fdo-page__heading">Execution</h3>
        <p className="fdo-page__lead">Run the workflow, monitor progress and capture provenance</p>

        <div className="fdo-execution-layout">
          <aside className="fdo-execution-layout__inbox">
            <h4>From Composition ({compositionInbox.length})</h4>
            {compositionInbox.length === 0 ? (
              <p className="fdo-empty">Nothing here yet — send a workflow or component from Composition.</p>
            ) : (
              <ul className="fdo-basket-list">
                {compositionInbox.map(item => (
                  <li className="fdo-basket-list__item" key={item.id}>
                    <span className={ITEM_BADGE_CLASS[item.type]}>{itemKindLabel(item.type)}</span>
                    <span>{item.title}</span>
                  </li>
                ))}
              </ul>
            )}

            <h4 className="fdo-composition-layout__outbox-title">To Publication ({publicationOutbox.length})</h4>
            {publicationOutbox.length === 0 ? (
              <p className="fdo-empty">Nothing sent yet.</p>
            ) : (
              <ul className="fdo-basket-list">
                {publicationOutbox.map(item => (
                  <li className="fdo-basket-list__item" key={item.id}>
                    <span className={ITEM_BADGE_CLASS[item.type]}>{itemKindLabel(item.type)}</span>
                    <span>{item.title}</span>
                  </li>
                ))}
              </ul>
            )}
          </aside>

          <div className="fdo-execution-layout__main">
            <div className="fdo-execution-runrow">
              <div className="fdo-run-control">
                <h4>Run Control</h4>
                <label className="fdo-form-field">
                  <span>Environment</span>
                  <select className="fdo-select" defaultValue="Default Environment">
                    <option>Default Environment</option>
                    <option>Docker</option>
                  </select>
                </label>
                {running ? (
                  <button type="button" className="fdo-btn fdo-btn--danger" onClick={handleStop}>
                    Stop Execution
                  </button>
                ) : (
                  <button type="button" className="fdo-btn fdo-btn--primary" onClick={handleRun}>
                    Run
                  </button>
                )}
              </div>

              <div className="fdo-progress-panel">
                <h4>Progress</h4>
                <ul className="fdo-progress-list">
                  {steps.map(s => (
                    <li key={s.id}>
                      <span>
                        {stepStatus[s.id] === 'completed' && '✅ '}
                        {stepStatus[s.id] === 'running' && '⏳ '}
                        {stepStatus[s.id] === 'pending' && '⏵ '}
                        {s.label}
                      </span>
                      <span className="fdo-progress-list__status">{stepStatus[s.id]}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="fdo-provenance-panel">
                <h4>Captured Provenance</h4>
                <dl>
                  <dt>Workflow Version</dt>
                  <dd>v1.2.0</dd>
                  <dt>Workflow File</dt>
                  <dd>veluwe_workflow.naavrewf</dd>
                  <dt>Execution Start</dt>
                  <dd>{startedAt ?? '—'}</dd>
                  <dt>Environment</dt>
                  <dd>Docker</dd>
                </dl>
              </div>
            </div>

            <div className="fdo-outputs-panel">
              <h4>Outputs (so far)</h4>
              <table className="fdo-builder-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Produced By</th>
                    <th>Status</th>
                    <th aria-label="action" />
                  </tr>
                </thead>
                <tbody>
                  {outputs.map(o => {
                    const ready = isOutputReady(o.id);
                    return (
                      <tr key={o.id}>
                        <td>{o.label}</td>
                        <td>{producedByLabel(o.id)}</td>
                        <td>{ready ? 'Ready' : 'Pending'}</td>
                        <td>
                          <button
                            type="button"
                            className="fdo-btn fdo-btn--ghost fdo-btn--small"
                            disabled={!ready || isAlreadySent(o.id)}
                            onClick={() => onSendOutputToPublication(o.id, o.label)}
                          >
                            {isAlreadySent(o.id) ? 'Sent' : 'Send to Publication'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div className="fdo-suggestions-panel">
                <h4>Publication Suggestions</h4>
                <ul className="fdo-suggestions-list">
                  {outputs.map(o => (
                    <li key={o.id} className={`fdo-suggestions-list__${suggestionTier(o.label).toLowerCase()}`}>
                      {suggestionTier(o.label)} value — {o.label}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>

        <div className="fdo-page__footer">
          <span>{steps.filter(s => stepStatus[s.id] === 'completed').length} / {steps.length} steps completed</span>
          <button type="button" className="fdo-btn fdo-btn--primary" onClick={onSendExecutionRecordToPublication}>
            Send Execution Record to Publication →
          </button>
        </div>
      </div>
    </div>
  );
}
