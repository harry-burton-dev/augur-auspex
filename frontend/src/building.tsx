import { Icon } from '@augur/app-kit';
import type { PersonMap } from './api.js';
import { layoutCutaway, STOREY, type Room } from './cutaway.js';
import { onEnter } from './map.js';

/** The ground storey: everyone's own floor, as doors. */
const GROUND = 64;
/** The basement: the plant room, for admins. */
const BASEMENT = 60;
/** At most this many doors are drawn; past it, the count says how many. */
const DOORS = 48;

/** About how many characters fit across a room, for its name. */
const fits = (width: number) => Math.max(0, Math.floor((width - 16) / 7.5));
const clip = (text: string, n: number) => (text.length <= n ? text : n > 2 ? `${text.slice(0, n - 1)}…` : '');

export interface BuildingProps {
  map: PersonMap;
  here: string;
  admin: boolean;
  /** The plant room in a line, for the basement: "All 9 parts are answering." */
  plant: string;
  /** Its lamp: up, slow, down or checking. */
  plantState: string;
  onFloor: (id: string) => void;
  onPlant: () => void;
}

/** A staircase up one column, from the ground to the roof. */
const stair = (x: number, bottom: number, top: number) => {
  const rise = 12;
  let d = `M ${x - 6} ${bottom}`;
  for (let y = bottom, left = true; y - rise > top; y -= rise, left = !left) d += ` L ${left ? x - 6 : x + 6} ${y - rise} L ${left ? x + 6 : x - 6} ${y - rise}`;
  return <path key={`stair-${x}`} className="stair" d={d} />;
};

/**
 * The org as a building in cross-section (see cutaway.ts): the org the roof,
 * teams as rooms above the teams inside them, everyone's own floor as doors
 * along the ground, and your way up lit as stairs. Rooms you stand on are
 * filled in the team colour, ones you see into are dashed, and closed ones
 * are outlines that still say their name. For admins, the plant room sits
 * underneath. Every room is a link (Enter or a click).
 */
export function Building({ map, here, admin, plant, plantState, onFloor, onPlant }: BuildingProps) {
  const laid = layoutCutaway(map, here);
  if (!laid) return null;
  const room = (r: Room) => {
    const reach = r.reach === 'closed' ? 'Closed to you.' : r.reach === 'see' ? 'You can see in.' : 'You can go here.';
    const count = r.people !== undefined ? `${r.people} ${r.people === 1 ? 'person' : 'people'}` : '';
    const label = [r.kind === 'org' ? `${r.name}, the whole org.` : `${r.name}.`, reach, count ? `${count}.` : '', r.here ? 'You’re here.' : '', r.lit && r.kind === 'team' && !r.here ? 'On your way up.' : ''].filter(Boolean).join(' ');
    const n = fits(r.width);
    const go = () => onFloor(r.id);
    if (r.kind === 'org') {
      const mid = r.x + r.width / 2;
      return (
        <g key={r.id} className={`room org ${r.here ? 'here' : ''}`} tabIndex={0} role="link" aria-label={label} onClick={go} onKeyDown={onEnter(go)}>
          <polygon className="roof" points={`${r.x + 2},${STOREY - 4} ${r.x + r.width - 2},${STOREY - 4} ${mid + r.width * 0.36},${10} ${mid - r.width * 0.36},${10}`} />
          <text className="nm" x={mid} y={STOREY / 2 + 2} textAnchor="middle">
            {r.name}
          </text>
          {count ? (
            <text className="ct" x={mid} y={STOREY / 2 + 20} textAnchor="middle">
              {count}
            </text>
          ) : null}
        </g>
      );
    }
    const x = r.x + 3;
    const y = r.y + 3;
    const w = r.width - 6;
    const h = r.height - 6;
    return (
      <g key={r.id} className={`room team ${r.reach} ${r.lit ? 'lit' : ''} ${r.here ? 'here' : ''}`} tabIndex={0} role="link" aria-label={label} onClick={go} onKeyDown={onEnter(go)}>
        <rect className="wall" x={x} y={y} width={Math.max(0, w)} height={Math.max(0, h)} rx="6" />
        {n ? (
          <text className="nm" x={x + 10} y={y + 24}>
            {clip(r.name, n)}
          </text>
        ) : null}
        {r.reach === 'closed' && w > 30 ? (
          <g className="lock" transform={`translate(${x + w - 20},${y + 9}) scale(0.5)`}>
            <Icon name="lock" size={24} />
          </g>
        ) : null}
        {count && n > 6 ? (
          <text className="ct" x={x + 10} y={y + 44}>
            {clip(count, n)}
          </text>
        ) : null}
      </g>
    );
  };

  const own = map.floors.find((f) => f.kind === 'personal');
  const org = map.floors.find((f) => f.kind === 'org')!;
  const height = laid.ground + GROUND + (admin ? BASEMENT : 0) + 4;
  const people = org.people;
  const shown = Math.min(DOORS, Math.max(1, people));
  const pitch = laid.width / shown;
  // Your door sits at the foot of your first stair, or in the middle.
  const yours = laid.stairs[0]?.x ?? laid.width / 2;
  const yourDoor = Math.min(shown - 1, Math.floor(yours / pitch));
  const doorY = laid.ground + 18;
  const goOwn = () => own && onFloor(own.id);
  return (
    <svg className="auspex-building" viewBox={`-4 0 ${laid.width + 8} ${height}`} role="group" aria-label="Your organisation as a building: the org is the roof, each team a room above the teams inside it, and everyone’s own floor along the ground">
      <defs>
        <linearGradient id="auspex-room" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--floor-team-high)" />
          <stop offset="1" stopColor="var(--floor-team-low)" />
        </linearGradient>
        <linearGradient id="auspex-roof" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--floor-org-high)" />
          <stop offset="1" stopColor="var(--floor-org-low)" />
        </linearGradient>
        <linearGradient id="auspex-door" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--floor-you-high)" />
          <stop offset="1" stopColor="var(--floor-you-low)" />
        </linearGradient>
      </defs>
      {laid.rooms.map(room)}
      {laid.stairs.map((s) => stair(s.x, s.bottom, STOREY - 4))}
      <line className="slab" x1="0" x2={laid.width} y1={laid.ground} y2={laid.ground} />
      <g className="ground" aria-hidden="true">
        {Array.from({ length: shown }, (_, i) => (i === yourDoor ? null : <rect key={i} className="door" x={i * pitch + pitch / 2 - 5} y={doorY} width="10" height="22" rx="2" />))}
      </g>
      {own ? (
        <g
          className="room door-yours"
          tabIndex={0}
          role="link"
          aria-label={`Your own floor. Only you can go in, and nobody else’s opens for you, admins included. ${people} ${people === 1 ? 'person has' : 'people have'} one.`}
          onClick={goOwn}
          onKeyDown={onEnter(goOwn)}
        >
          <rect className="door mine" x={yourDoor * pitch + pitch / 2 - 7} y={doorY - 4} width="14" height="26" rx="3" />
        </g>
      ) : null}
      <text className="ground-label" x="0" y={laid.ground + GROUND - 6}>
        {people > shown ? `Everyone’s own floor · ${people} doors, ${shown} drawn` : 'Everyone’s own floor'} · only yours opens
      </text>
      {admin ? (
        <g className={`basement ${plantState}`} tabIndex={0} role="link" aria-label={`The plant room. ${plant}`} onClick={onPlant} onKeyDown={onEnter(onPlant)}>
          <rect x="0" y={laid.ground + GROUND + 4} width={laid.width} height={BASEMENT - 8} rx="8" />
          <circle className="lamp" cx="22" cy={laid.ground + GROUND + 4 + (BASEMENT - 8) / 2} r="5" />
          <text className="nm" x="38" y={laid.ground + GROUND + 4 + (BASEMENT - 8) / 2 + 5}>
            Plant room <tspan className="ct">{plant}</tspan>
          </text>
        </g>
      ) : null}
    </svg>
  );
}
