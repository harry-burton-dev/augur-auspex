import type { KeyboardEvent } from 'react';
import { Icon } from '@augur/app-kit';
import type { PersonMap } from './api.js';
import { layoutMap, linkPath, type MapNode } from './layout.js';

/** Enter or Space on a drawn mark does what a click does. */
export const onEnter = (go: () => void) => (e: KeyboardEvent) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  go();
};

export interface OrgMapProps {
  map: PersonMap;
  here: string;
  /** The line under each name: why they can go there, or who to ask. */
  reasons: Map<string, string>;
  onFloor: (id: string) => void;
}

/**
 * The org as a map: the org on the left, the teams inside it to the right,
 * your way in lit up in the floor colours and the floor you're on ringed.
 * Teams you see into are rings; closed ones are small marks that still say
 * their name. Every mark is a link (Enter or a click) to that floor.
 */
export function OrgMap({ map, here, reasons, onFloor }: OrgMapProps) {
  const laid = layoutMap(map, here);
  if (!laid) return null;
  const node = (n: MapNode) => {
    const r = n.kind === 'org' ? 14 : n.reach === 'closed' ? 5 : 10;
    const why = reasons.get(n.id) ?? '';
    const folded = n.folded ? ` and ${n.folded} ${n.folded === 1 ? 'team' : 'teams'} inside` : '';
    const label = `${n.name}${folded}. ${n.reach === 'closed' ? 'Closed to you. ' : ''}${why}`;
    const go = () => onFloor(n.id);
    return (
      <g key={n.id} className={`node ${n.kind} ${n.reach} ${n.here ? 'here' : ''}`} transform={`translate(${n.x},${n.y})`} tabIndex={0} role="link" aria-label={label} onClick={go} onKeyDown={onEnter(go)}>
        <circle className="hit" r="24" />
        {n.here ? (
          <>
            <circle className="halo" r={r + 9} />
            <circle className="halo ping" r={r + 9} />
          </>
        ) : null}
        <circle className="mark" r={r} />
        {n.reach === 'closed' ? (
          <g className="lock" transform={`translate(${r + 7},-6.5) scale(0.5)`}>
            <Icon name="lock" size={24} />
          </g>
        ) : null}
        <text className="name" x={n.reach === 'closed' ? r + 26 : r + 12} y="-1">
          {n.name}
          {n.folded ? <tspan className="folded"> +{n.folded}</tspan> : null}
        </text>
        <text className="why" x={r + 12} y="17">
          {why}
        </text>
      </g>
    );
  };
  return (
    <svg className="auspex-map" viewBox={`0 0 ${laid.width} ${laid.height}`} style={{ maxWidth: laid.width }} role="group" aria-label="Your organisation, the org on the left and the teams inside it to the right">
      <defs>
        <radialGradient id="auspex-org" cx="35%" cy="30%">
          <stop offset="0" stopColor="var(--floor-org-high)" />
          <stop offset="1" stopColor="var(--floor-org-low)" />
        </radialGradient>
        <radialGradient id="auspex-team" cx="35%" cy="30%">
          <stop offset="0" stopColor="var(--floor-team-high)" />
          <stop offset="1" stopColor="var(--floor-team-low)" />
        </radialGradient>
      </defs>
      {laid.links.map((l) => (
        <path key={`${l.from.id}-${l.to.id}`} className={`link ${l.lit ? 'lit' : ''} ${l.to.reach}`} d={linkPath(l)} />
      ))}
      {laid.nodes.map(node)}
    </svg>
  );
}
