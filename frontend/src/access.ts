import type { MapFloor, PersonMap } from './api.js';

/**
 * `access.explain`: another app asks Auspex to say who can open one of its
 * things and why, over the app, as a request (`ctx.request`). The app sends
 * what it already shows the person; Auspex adds what it knows about the
 * floors: how many people each team is, who's left out, and who can change it.
 *
 * The payload, which any app may send:
 *
 * ```ts
 * { thing: { app: 'folio', appName?: 'Artifacts', id, title, kind?: 'document' },
 *   audience: [{ principal: 'tree:<team>', name?, level?: 'read', since?: '<iso>', via?: 'its floor',
 *                chain?: ['Payroll', 'Finance'], shows?: ['Complete', 'Issued'] }],
 *   change?: { where: 'Share', allowed: true } }
 * ```
 */
export const ACCESS_EXPLAIN = 'access.explain';

export interface AccessEntry {
  /** `person:<id>`, `team:<id>` (that team), `tree:<id>` (that team and the teams inside it) or `org`. */
  principal: string;
  name?: string;
  level?: 'read' | 'edit' | 'manage';
  since?: string;
  /** How it reaches them, in the app's words: "its floor", "its library", "shared with them". */
  via?: string;
  /** For something published up the floors: the floors it came up through, from where it was made to them. */
  chain?: string[];
  /** For something published up: the states it shows them there, e.g. Complete and Issued, and nothing else. */
  shows?: string[];
}

export interface AccessExplain {
  /** `appName` is what people call the app that asks, for the way back. */
  thing: { app: string; appName?: string; id: string; title: string; kind?: string };
  audience: AccessEntry[];
  /** Where a change is made, and whether this person may make it. */
  change?: { where: string; allowed: boolean };
}

const text = (v: unknown, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
/** A short list of words, as sent: anything that isn't words is dropped. */
const words = (v: unknown, most: number, max: number) => {
  const list = Array.isArray(v) ? v.slice(0, most).flatMap((w) => text(w, max) ?? []) : [];
  return list.length ? list : undefined;
};

/** The payload as sent, or undefined when it isn't one Auspex can explain. */
export const readExplain = (payload: unknown): AccessExplain | undefined => {
  const p = (payload ?? {}) as Record<string, unknown>;
  const thing = (p.thing ?? {}) as Record<string, unknown>;
  const app = text(thing.app, 40);
  const id = text(thing.id, 100);
  const title = text(thing.title);
  if (!app || !id || !title || !Array.isArray(p.audience)) return undefined;
  const audience = p.audience.slice(0, 100).flatMap((raw): AccessEntry[] => {
    const e = (raw ?? {}) as Record<string, unknown>;
    const principal = text(e.principal, 120);
    if (!principal || !/^(org|(person|team|tree):.+)$/.test(principal)) return [];
    const level = e.level === 'read' || e.level === 'edit' || e.level === 'manage' ? e.level : undefined;
    const chain = words(e.chain, 8, 80);
    const shows = words(e.shows, 6, 40);
    return [{ principal, name: text(e.name), level, since: text(e.since, 40), via: text(e.via, 80), ...(chain ? { chain } : {}), ...(shows ? { shows } : {}) }];
  });
  const change = (p.change ?? undefined) as Record<string, unknown> | undefined;
  return {
    thing: { app, appName: text(thing.appName, 60), id, title, kind: text(thing.kind, 40) },
    audience,
    ...(change && text(change.where, 40) ? { change: { where: text(change.where, 40)!, allowed: change.allowed === true } } : {}),
  };
};

export interface Explained extends AccessEntry {
  kind: 'person' | 'team' | 'tree' | 'org';
  /** Their name in plain words: "Payroll and the teams inside it". */
  who: string;
  /** How many people it is, when the person may know: never for a team they can't see into. */
  people?: number;
}

/** Who each entry is and how many people, as far as the person's own map says, and how many can open it in all. */
export const explain = (ask: AccessExplain, map: PersonMap): { entries: Explained[]; people: number; atLeast: boolean; org?: MapFloor } => {
  const floors = new Map(map.floors.map((f) => [f.id, f]));
  const org = map.floors.find((f) => f.kind === 'org');
  const closed = new Map(map.closed.map((t) => [t.id, t]));
  const nameOf = (id: string, given?: string) => floors.get(id)?.name ?? closed.get(id)?.name ?? given ?? 'A team that’s gone';
  const inside = (id: string) => map.floors.filter((f) => f.id === id || isInside(f, id));
  const isInside = (f: { parentId?: string }, id: string): boolean => {
    for (let p = f.parentId; p; p = floors.get(p)?.parentId ?? closed.get(p)?.parentId) if (p === id) return true;
    return false;
  };
  const known = new Set<string>();
  let atLeast = false;
  let everyone = false;
  const entries = ask.audience.map((e): Explained => {
    const at = e.principal.indexOf(':');
    const kind = (e.principal === 'org' ? 'org' : e.principal.slice(0, at)) as Explained['kind'];
    const id = at < 0 ? '' : e.principal.slice(at + 1);
    if (kind === 'org') {
      everyone = true;
      return { ...e, kind, who: `Everyone at ${org?.name ?? 'the organisation'}`, people: org?.people };
    }
    if (kind === 'person') {
      known.add(id);
      return { ...e, kind, who: e.name ?? 'Someone no longer here', people: 1 };
    }
    const floor = floors.get(id);
    if (kind === 'team') {
      // Members only show for teams they can see into.
      if (floor?.members) floor.members.forEach((m) => known.add(m.id));
      else atLeast = true;
      return { ...e, kind, who: nameOf(id, e.name), people: floor?.members?.length };
    }
    const teams = inside(id);
    for (const t of teams) t.members?.forEach((m) => known.add(m.id));
    if (!floor || map.closed.some((c) => isInside(c, id)) || teams.some((t) => !t.members)) atLeast = true;
    return { ...e, kind, who: `${nameOf(id, e.name)} and the teams inside it`, people: floor?.people };
  });
  return { entries, people: everyone ? (org?.people ?? known.size) : known.size, atLeast: everyone ? false : atLeast, org: everyone ? undefined : org };
};

/** A list in words: "Complete", "Complete and Issued", "In review, Complete and Issued". */
const listWords = (list: readonly string[]) => (list.length < 2 ? (list[0] ?? '') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`);

/**
 * How something published up the floors reaches them, in a line: "Up from
 * Payroll through Finance, showing Complete and Issued". Nothing for anything
 * else.
 */
export const upWords = (e: Pick<AccessEntry, 'chain' | 'shows'>) => {
  const [from, ...through] = e.chain ?? [];
  const up = from ? `Up from ${from}${through.length ? ` through ${listWords(through)}` : ''}` : '';
  const shows = e.shows?.length ? `showing ${listWords(e.shows)}${up ? '' : ' only'}` : '';
  const line = [up, shows].filter(Boolean).join(', ');
  return line ? line[0].toUpperCase() + line.slice(1) : '';
};
