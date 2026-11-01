import { hierarchy, tree } from 'd3-hierarchy';
import type { PersonMap } from './api.js';

/**
 * The map of the org as Auspex draws it: the org on the left, the teams
 * inside it to the right, a level per column, laid out by d3-hierarchy's
 * tidy tree so siblings never overlap however many there are.
 *
 * Every team is on it. Ones the person can't go into stay as closed marks
 * with their name, because nothing is hidden for being out of reach; a closed
 * team's own closed teams fold into it ("and 4 teams inside"), so a part of
 * the org they have nothing to do with stays one quiet line.
 */

/** Stand: they can go there. See: they can see in, as a lead above or an admin. Closed: name and who leads it only. */
export type Reach = 'stand' | 'see' | 'closed';

export interface MapNode {
  id: string;
  name: string;
  kind: 'org' | 'team';
  reach: Reach;
  /** The floor they're on now. */
  here: boolean;
  /** Closed teams folded into this one. */
  folded: number;
  depth: number;
  /** Centre, in map units: x across (by level), y down. */
  x: number;
  y: number;
}

export interface MapLink {
  from: MapNode;
  to: MapNode;
  /** On the way to a floor they stand on. */
  lit: boolean;
}

export interface MapLayout {
  nodes: MapNode[];
  links: MapLink[];
  width: number;
  height: number;
  /** How many levels deep the org goes, the org itself being 0. */
  levels: number;
}

/** Space between rows and between levels, and around the edge. */
export const ROW = 56;
export const LEVEL = 232;
export const PAD = { top: 28, right: 200, bottom: 28, left: 28 };

interface Raw {
  id: string;
  name: string;
  kind: 'org' | 'team';
  reach: Reach;
  parentId?: string;
  folded: number;
  children: Raw[];
}

export const layoutMap = (map: PersonMap, here: string): MapLayout | undefined => {
  const org = map.floors.find((f) => f.kind === 'org');
  if (!org) return undefined;
  const root: Raw = { id: org.id, name: org.name, kind: 'org', reach: 'stand', folded: 0, children: [] };
  const raws = new Map<string, Raw>([[org.id, root]]);
  const teams = [
    ...map.floors.filter((f) => f.kind === 'team').map((f) => ({ id: f.id, name: f.name, parentId: f.parentId, reach: (f.open ? 'stand' : 'see') as Reach })),
    ...map.closed.map((t) => ({ id: t.id, name: t.name, parentId: t.parentId, reach: 'closed' as Reach })),
  ];
  for (const t of teams) raws.set(t.id, { ...t, kind: 'team', folded: 0, children: [] });
  // Parents first, so a closed team knows whether the one it sits in is closed too.
  const depthOf = (id: string): number => {
    const parent = raws.get(id)?.parentId;
    return parent && raws.has(parent) && parent !== id ? depthOf(parent) + 1 : 1;
  };
  for (const t of [...teams].sort((a, b) => depthOf(a.id) - depthOf(b.id))) {
    const raw = raws.get(t.id)!;
    const parent = (t.parentId && raws.get(t.parentId)) || root;
    if (raw.reach === 'closed' && parent.reach === 'closed') {
      // Folded into the nearest closed team it's inside, which stays on the map.
      let top = parent;
      while (top.reach === 'closed' && top.parentId && raws.get(top.parentId)?.reach === 'closed') top = raws.get(top.parentId)!;
      top.folded++;
      raws.set(t.id, top);
      continue;
    }
    parent.children.push(raw);
  }
  // Their own floors first, then those they see into, then closed ones; by name within each.
  const order: Record<Reach, number> = { stand: 0, see: 1, closed: 2 };
  const h = hierarchy(root, (d) => d.children).sort((a, b) => order[a.data.reach] - order[b.data.reach] || a.data.name.localeCompare(b.data.name));
  const laid = tree<Raw>().nodeSize([ROW, LEVEL]).separation((a, b) => (a.parent === b.parent ? 1 : 1.25))(h);

  const all = laid.descendants();
  const top = Math.min(...all.map((n) => n.x));
  const nodes = new Map<string, MapNode>();
  for (const n of all) {
    nodes.set(n.data.id, {
      id: n.data.id,
      name: n.data.name,
      kind: n.data.kind,
      reach: n.data.reach,
      here: n.data.id === here,
      folded: n.data.folded,
      depth: n.depth,
      x: PAD.left + n.y,
      y: PAD.top + n.x - top,
    });
  }
  const links = laid.links().map((l) => {
    const to = nodes.get(l.target.data.id)!;
    return { from: nodes.get(l.source.data.id)!, to, lit: to.reach === 'stand' };
  });
  const levels = Math.max(...all.map((n) => n.depth));
  return {
    nodes: [...nodes.values()],
    links,
    width: PAD.left + levels * LEVEL + PAD.right,
    height: PAD.top + Math.max(...all.map((n) => n.x)) - top + PAD.bottom,
    levels,
  };
};

/** A soft curve from one level to the next. */
export const linkPath = ({ from, to }: Pick<MapLink, 'from' | 'to'>) => {
  const mid = (from.x + to.x) / 2;
  return `M${from.x},${from.y}C${mid},${from.y} ${mid},${to.y} ${to.x},${to.y}`;
};
