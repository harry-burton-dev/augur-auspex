import { PLATFORM_TOPICS, type DomainEvent } from '@augur/service-kit';

/** How long Auspex remembers: as long as the events service keeps events, so a restart loses nothing. */
export const KEEP_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

/** What Auspex follows: who joined or left a team, teams made or renamed, and apps turned on, off or blocked. */
export const FOLLOWED = ['platform.team.*', 'platform.app.*'];

/** One change, as Auspex tells it: what happened, on which floor, to whom or what. Ids only; names come later. */
export interface Change {
  at: string;
  kind: 'joined' | 'left' | 'team-made' | 'team-renamed' | 'app-on' | 'app-off' | 'app-blocked' | 'app-rule-cleared' | 'app-removed';
  /** The floor it happened on; absent when it was everywhere (an app turned off for the whole org). */
  floor?: string;
  person?: string;
  team?: string;
  app?: string;
  /** A team's new name. */
  name?: string;
}

const KINDS: Record<string, Change['kind']> = {
  [PLATFORM_TOPICS.memberAdded]: 'joined',
  [PLATFORM_TOPICS.memberRemoved]: 'left',
  [PLATFORM_TOPICS.teamCreated]: 'team-made',
  [PLATFORM_TOPICS.teamRenamed]: 'team-renamed',
  [PLATFORM_TOPICS.appTurnedOn]: 'app-on',
  [PLATFORM_TOPICS.appTurnedOff]: 'app-off',
  [PLATFORM_TOPICS.appBlocked]: 'app-blocked',
  [PLATFORM_TOPICS.appRuleCleared]: 'app-rule-cleared',
  [PLATFORM_TOPICS.appRemoved]: 'app-removed',
};

const text = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

/** A platform event as a change, or undefined for one Auspex doesn't tell. */
export const changeOf = (event: DomainEvent): Change | undefined => {
  const kind = KINDS[event.topic];
  if (!kind) return undefined;
  const p = (event.payload ?? {}) as Record<string, unknown>;
  // A team's own events happened on that team, whatever floor the admin stood on.
  const floor = text(p.team) ?? event.workspace?.id;
  const change: Change = { at: event.at, kind, ...(floor ? { floor } : {}) };
  for (const key of ['person', 'team', 'app', 'name'] as const) {
    const v = text(p[key]);
    if (v) change[key] = v;
  }
  return change;
};

/**
 * What has happened on the platform in the last 30 days, in memory. Auspex
 * follows from the oldest event the events service keeps, so on every start it
 * reads the whole 30 days again and needs no database of its own.
 */
export class History {
  private changes: Change[] = [];
  private seen = new Set<string>();
  /** The last event handled: where following picks up. */
  cursor: string | undefined;

  constructor(private now: () => number = Date.now) {}

  add(event: DomainEvent) {
    this.cursor = event.seq;
    if (this.seen.has(event.id)) return;
    this.seen.add(event.id);
    const change = changeOf(event);
    if (change) this.changes.push(change);
    this.forget();
  }

  /** Changes on one floor since `days` ago, newest first. `orgFloor` also takes the ones that happened everywhere. */
  on(floor: string, { days, orgFloor = false }: { days: number; orgFloor?: boolean }): Change[] {
    const since = this.now() - days * DAY;
    return this.changes.filter((c) => Date.parse(c.at) >= since && (c.floor === floor || (orgFloor && !c.floor))).sort((a, b) => b.at.localeCompare(a.at));
  }

  private forget() {
    const keep = this.now() - KEEP_DAYS * DAY;
    if (this.changes.length && Date.parse(this.changes[0].at) < keep) this.changes = this.changes.filter((c) => Date.parse(c.at) >= keep);
  }
}
