import Fastify from 'fastify';
import { appServer, floorCaller, packageVersion, PeopleUnavailable, Problem, serviceFastifyOptions, signedInCaller, type CallerCheck, type DirectorySearch } from '@augur/service-kit';
import type { Changes, Names } from './api-types.ts';
import { History, KEEP_DAYS, type Change } from './history.ts';
import { manifest } from './manifest.ts';

/** The major version of the API this service serves. Its routes go under /v1, as the platform's do. */
export const API_VERSION = 'v1';
const version = packageVersion(import.meta.url);

export interface Options {
  /** Checks the caller the gateway signed for this app. In production it is on by default; in dev `x-user-*` headers are believed. */
  callers?: CallerCheck;
  /** What has happened on the platform lately. */
  history?: History;
  /** Names people and teams, and finds teams for Find. Without it, ids stand in for names and Find finds nothing. */
  directory?: DirectorySearch;
}

/** What Find takes from an app (the SDK's `SearchAnswer`). */
interface SearchAnswer {
  results: { id: string; title: string; detail?: string; path?: string }[];
}

/** How many teams Find shows. */
const FOUND = 8;
/** The most ids one call may ask to have named. */
const MAX_NAMED = 50;

const noDirectory: DirectorySearch = async () => ({ people: [], teams: [] });

export const buildApp = async ({ callers, history = new History(), directory = noDirectory }: Options = {}) => {
  const app = Fastify(serviceFastifyOptions());
  // Only the gateway's signed word says who is calling, every error is problem details, and /healthz says what runs.
  await appServer(app, { manifest, version, api: API_VERSION, ...(callers ? { callers } : {}) });
  // Each throws a problem (401 signed out, 400 no floor) that appServer answers.
  const signedIn = signedInCaller(manifest);
  const onFloor = floorCaller(manifest);

  /** People and teams by id, as far as the directory knows them. If it can't be reached, ids stand in. */
  const named = async (ids: string[]): Promise<Record<string, string>> => {
    const unique = [...new Set(ids)];
    if (!unique.length) return {};
    try {
      const found = await directory({ ids: unique });
      return Object.fromEntries([...found.people, ...found.teams].map((x) => [x.id, x.name]));
    } catch (err) {
      if (err instanceof PeopleUnavailable) return {};
      throw err;
    }
  };

  await app.register(
    async (app) => {
      /**
       * What changed on the floor the caller is on: who joined or left, and
       * which apps were turned on, off or blocked there. The gateway has
       * checked they can stand on it, so they see only what its own people see.
       */
      app.get<{ Querystring: { days?: number } }>(
        '/changes',
        { schema: { querystring: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: KEEP_DAYS, default: 7 } } } } },
        async (req) => {
          const caller = onFloor(req);
          const days = req.query.days ?? 7;
          // Nothing happens to anyone's own floor that someone else did.
          const changes: Change[] = caller.workspace.kind === 'personal' ? [] : history.on(caller.workspace.id, { days, orgFloor: caller.workspace.kind === 'org' });
          return { days, changes, names: await named(changes.flatMap((c) => [c.person, c.team].filter((x): x is string => Boolean(x)))) } satisfies Changes;
        },
      );

      /** Names for people, such as whoever set a floor's rule for an app. */
      app.get<{ Querystring: { ids: string } }>(
        '/names',
        { schema: { querystring: { type: 'object', required: ['ids'], properties: { ids: { type: 'string', maxLength: 4000 } } } } },
        async (req) => {
          signedIn(req);
          const ids = req.query.ids.split(',').map((s) => s.trim()).filter(Boolean);
          if (ids.length > MAX_NAMED) throw new Problem(400, 'too_many', `Ask for at most ${MAX_NAMED} names at once.`);
          return { names: await named(ids) } satisfies Names;
        },
      );

      /** Find: teams by name, each opening on its floor in Explorer. Closed ones too, which say who can add you. */
      app.get<{ Querystring: { q?: string } }>(
        '/search',
        { schema: { querystring: { type: 'object', properties: { q: { type: 'string', maxLength: 200 } } } } },
        async (req) => {
          signedIn(req);
          const q = (req.query.q ?? '').trim();
          if (!q) return { results: [] } satisfies SearchAnswer;
          const { teams } = await directory({ q, limit: FOUND }).catch((err: Error) => {
            if (err instanceof PeopleUnavailable) return { people: [], teams: [] };
            throw err;
          });
          return {
            results: teams.slice(0, FOUND).map((t) => ({
              id: t.id,
              title: t.name,
              detail: t.within.length ? `Team inside ${t.within[t.within.length - 1]}` : 'Team',
              path: `/floors/${encodeURIComponent(t.id)}`,
            })),
          } satisfies SearchAnswer;
        },
      );
    },
    { prefix: `/${API_VERSION}` },
  );
  return app;
};
