/**
 * Explorer's wire types: what crosses between its frontend and this service, written once.
 *
 * The service owns the API, so the file lives here; the frontend imports it with `import type` by relative
 * path (`../../service/src/api-types`). Types only: nothing here runs, so neither build changes. Keep it free
 * of imports, so the frontend's typecheck never pulls in the service's own modules.
 *
 * Only this service's own routes are here. What the frontend reads from identity, the registry and the
 * gateway are the platform's types, not this app's.
 */

/** What kind of change it was. */
export type ChangeKind = 'joined' | 'left' | 'team-made' | 'team-renamed' | 'app-on' | 'app-off' | 'app-blocked' | 'app-rule-cleared' | 'app-removed';

/** One change: what happened, on which floor, to whom or what. Ids only; names come with them (`Changes.names`). */
export interface Change {
  at: string;
  kind: ChangeKind;
  /** The floor it happened on; absent when it was everywhere (an app turned off for the whole org). */
  floor?: string;
  person?: string;
  team?: string;
  app?: string;
  /** A team's new name. */
  name?: string;
}

/** `GET /changes?days=`: what changed on the caller's floor, newest first, with names for the people and teams in it. */
export interface Changes {
  days: number;
  changes: Change[];
  names: Record<string, string>;
}

/** `GET /names?ids=`: people and teams by id, as far as the directory knows them. */
export interface Names {
  names: Record<string, string>;
}

/** What the service sends when it refuses: a code and words people can act on. */
export interface Problem {
  error: string;
  message: string;
}
