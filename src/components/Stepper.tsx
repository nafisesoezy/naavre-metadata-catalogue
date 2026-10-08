import React from 'react';
import { Phase } from '../types';

interface StepDef {
  id: Phase;
  number: number;
  title: string;
  subtitle: string;
}

const STEPS: StepDef[] = [
  {
    id: 'discovery',
    number: 1,
    title: 'Discovery',
    subtitle: 'Search and discover data, models, workflows and services'
  },
  {
    id: 'composition',
    number: 2,
    title: 'Composition',
    subtitle: 'Compose workflows using assets from Discovery'
  },
  {
    id: 'execution',
    number: 3,
    title: 'Execution',
    subtitle: 'Run the workflow, monitor progress and capture provenance'
  },
  {
    id: 'publication',
    number: 4,
    title: 'Publication',
    subtitle: 'Create and publish FDOs from executed results or repository assets'
  }
];

interface StepperProps {
  phase: Phase;
  onJump: (phase: Phase) => void;
}

export function Stepper(props: StepperProps): JSX.Element {
  const { phase, onJump } = props;
  const current = STEPS.find(s => s.id === phase) ?? STEPS[0];

  return (
    <div className="fdo-stepper">
      <div className="fdo-stepper__rail">
        {STEPS.map((s, i) => (
          <React.Fragment key={s.id}>
            <button
              type="button"
              className={
                s.id === phase
                  ? 'fdo-stepper__badge fdo-stepper__badge--current'
                  : 'fdo-stepper__badge'
              }
              onClick={() => onJump(s.id)}
              title={s.title}
            >
              {s.number}
            </button>
            {i < STEPS.length - 1 && <span className="fdo-stepper__arrow">→</span>}
          </React.Fragment>
        ))}
      </div>
      <h2 className="fdo-stepper__title">{current.title}</h2>
      <p className="fdo-stepper__subtitle">{current.subtitle}</p>
    </div>
  );
}
