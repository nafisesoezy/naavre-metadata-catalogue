import React from 'react';
import { Phase } from '../types';

interface SidebarProps {
  phase: Phase;
  onNavigate: (phase: Phase) => void;
}

const NAV_ITEMS: { id: Phase; label: string }[] = [
  { id: 'discovery', label: 'Discovery' },
  { id: 'composition', label: 'Composition' },
  { id: 'execution', label: 'Execution' },
  { id: 'publication', label: 'Publication' }
];

export function Sidebar(props: SidebarProps): JSX.Element {
  const { phase, onNavigate } = props;

  return (
    <nav className="fdo-sidebar">
      <div className="fdo-sidebar__brand">LTER-LIFE</div>
      <ul className="fdo-sidebar__list">
        {NAV_ITEMS.map(item => (
          <li key={item.id}>
            <button
              type="button"
              className={
                phase === item.id
                  ? 'fdo-sidebar__item fdo-sidebar__item--active'
                  : 'fdo-sidebar__item'
              }
              onClick={() => onNavigate(item.id)}
            >
              {item.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
