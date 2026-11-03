import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { callerCheckFromEnv, callerFromHeaders, health, packageVersion, PeopleUnavailable, signedCallers, type Caller, type CallerCheck, type CallerWorkspace, type DirectorySearch } from '@augur/service-kit';
import type { Changes, Names } from './api-types.ts';
import { History, KEEP_DAYS, type Change } from './history.ts';

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

type OnFloor = Caller & { workspace: CallerWorkspace };

/** What Find takes from an app (the SDK's `SearchAnswer`). */
interface SearchAnswer {
  results: { id: string; title: string; detail?: string; path?: string }[];
}

/** How many teams Find shows. */
const FOUND = 8;
/** The most ids one call may ask to have named. */
const MAX_NAMED = 50;

const noDirectory: DirectorySearch = async () => ({ people: [], teams: [] });

export const buildApp = async ({ callers = callerCheckFromEnv('auspex'), history = new History(), directory = noDirectory }: Options = {}) => {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });
  // Only the gateway's signed word says who is calling: headers anyone could send are dropped.
  app.addHook('onRequest', signedCallers(callers));
  app.get('/healthz', async () => health('auspex', version, API_VERSION));

  const signedIn = (req: FastifyRequest, reply: FastifyReply): Caller | undefined => {
    const caller = callerFromHeaders(req.headers);
    if (!caller) reply.code(401).send({ error: 'unauthenticated', message: 'Sign in first.' });
    return caller ?? undefined;
  };
  const onFloor = (req: FastifyRequest, reply: FastifyReply): OnFloor | undefined => {
    const caller = signedIn(req, reply);
    if (caller && !caller.workspace) {
      reply.code(400).send({ error: 'floor-needed', message: 'Say which floor you’re asking about (X-Workspace-Id).' });
      return undefined;
    }
    return caller as OnFloor | undefined;
  };

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
        async (req, reply) => {
          const caller = onFloor(req, reply);
          if (!caller) return reply;
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
        async (req, reply) => {
          if (!signedIn(req, reply)) return reply;
          const ids = req.query.ids.split(',').map((s) => s.trim()).filter(Boolean);
          if (ids.length > MAX_NAMED) return reply.code(400).send({ error: 'too-many', message: `Ask for at most ${MAX_NAMED} names at once.` });
          return { names: await named(ids) } satisfies Names;
        },
      );

      /** Find: teams by name, each opening on its floor in Auspex. Closed ones too, which say who can add you. */
      app.get<{ Querystring: { q?: string } }>(
        '/search',
        { schema: { querystring: { type: 'object', properties: { q: { type: 'string', maxLength: 200 } } } } },
        async (req, reply) => {
          if (!signedIn(req, reply)) return reply;
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
