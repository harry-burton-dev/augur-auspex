import { partition, stratify } from 'd3-hierarchy';
import type { PersonMap } from './api.js';
import type { Reach } from './layout.js';

/**
 * The org as a building in cross-section, for leads and admins: the org is
 * the roof, each team a room on the storey below the team it sits in, and
 * every room exactly as wide as the rooms beneath it (d3-hierarchy's
 * partition), so the drawing is the tree without looking like an org chart.
 * Under the lowest storey is the ground: everyone's own floor, as doors.
 * Your way up, from your own door through each team you're on to the roof,
 * is lit as stairs.
 */

export interface Room {
  id: string;
  name: string;
  kind: 'org' | 'team';
  reach: Reach;
  depth: number;
  /** The floor they're on now. */
  here: boolean;
  /** On the way up from a team they're on. */
  lit: boolean;
  /** Only when they may know it: a floor they stand on or see into. */
  people?: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Stair {
  /** The team it starts from, and the column it climbs. */
  from: string;
  x: number;
  /** From the ground up to the roof. */
  bottom: number;
  top: number;
}

export interface Cutaway {
  rooms: Room[];
  stairs: Stair[];
  width: number;
  /** Where the ground (everyone's own floor) starts, below the lowest storey. */
  ground: number;
  storeys: number;
}

export const WIDTH = 960;
export const STOREY = 72;

interface Raw {
  id: string;
  parentId?: string;
  name: string;
  kind: 'org' | 'team';
  reach: Reach;
  people?: number;
}

/** The building for one person's map. Undefined when there's no org to put a roof on. */
export const layoutCutaway = (map: PersonMap, here: string): Cutaway | undefined => {
  const org = map.floors.find((f) => f.kind === 'org');
  if (!org) return undefined;
  const raws: Raw[] = [
    { id: org.id, name: org.name, kind: 'org', reach: 'stand', people: org.people },
    ...map.floors
      .filter((f) => f.kind === 'team')
      .map((f): Raw => ({ id: f.id, parentId: f.parentId ?? org.id, name: f.name, kind: 'team', reach: f.open ? 'stand' : 'see', people: f.people })),
    ...map.closed.map((t): Raw => ({ id: t.id, parentId: t.parentId ?? org.id, name: t.name, kind: 'team', reach: 'closed' })),
  ];
  // A team whose parent the person can't place hangs from the roof rather than vanishing.
  const ids = new Set(raws.map((r) => r.id));
  for (const r of raws) if (r.parentId && !ids.has(r.parentId)) r.parentId = org.id;

  const root = stratify<Raw>()
    .id((r) => r.id)
    .parentId((r) => r.parentId)(raws)
    .sort((a, b) => a.data.name.localeCompare(b.data.name))
    .count();
  const storeys = root.height + 1;
  partition<Raw>().size([WIDTH, storeys * STOREY]).padding(0)(root);

  // Your way up: every team you're a member of (and the one you're on), and each team it sits in.
  const mine = new Set(map.floors.filter((f) => f.kind === 'team' && (f.why.kind === 'member' || f.id === here)).map((f) => f.id));
  const lit = new Set<string>();
  const stairs: Stair[] = [];
  const ground = storeys * STOREY;
  for (const node of root.descendants() as unknown as { data: Raw; x0: number; x1: number; ancestors(): { data: Raw }[] }[]) {
    if (!mine.has(node.data.id)) continue;
    for (const a of node.ancestors()) lit.add(a.data.id);
    // Up the room's right-hand side, clear of its name.
    stairs.push({ from: node.data.id, x: node.x1 - 18, bottom: ground, top: 0 });
  }

  const rooms = (root.descendants() as unknown as { data: Raw; depth: number; x0: number; x1: number; y0: number; y1: number }[]).map(
    (n): Room => ({
      id: n.data.id,
      name: n.data.name,
      kind: n.data.kind,
      reach: n.data.reach,
      depth: n.depth,
      here: n.data.id === here,
      lit: lit.has(n.data.id),
      ...(n.data.people !== undefined ? { people: n.data.people } : {}),
      x: n.x0,
      y: n.y0,
      width: n.x1 - n.x0,
      height: n.y1 - n.y0,
    }),
  );
  return { rooms, stairs, width: WIDTH, ground, storeys };
};

/** Who may walk round the building: admins, and anyone who leads a team. */
export const mayWalk = (map: PersonMap, userId: string, admin: boolean) =>
  admin || map.floors.some((f) => (f.why.kind === 'member' && f.why.role === 'lead') || f.why.kind === 'leads-above' || f.members?.some((m) => m.id === userId && m.role === 'lead'));
