import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appCredentialsFromEnv, commonSettings, followEvents, identityDirectory, loadConfigOrExit, publishFrontend, registerApp } from '@augur/service-kit';
import { buildApp } from './app.ts';
import { FOLLOWED, History } from './history.ts';

// Every setting Auspex reads, checked before it starts (in production, a missing one stops it).
// It keeps nothing of its own: no database and no bucket.
loadConfigOrExit('auspex', [
  commonSettings.registry,
  commonSettings.identity,
  commonSettings.events,
  commonSettings.issuer,
  commonSettings.issuerInside,
  commonSettings.clientSecret,
  commonSettings.gateway,
]);

const port = Number(process.env.PORT ?? 8090);
const { REGISTRY_URL, IDENTITY_URL, EVENTS_URL, APP_MANIFEST, APP_FRONTEND } = process.env;
const credentials = appCredentialsFromEnv('auspex');
const history = new History();
const directory = IDENTITY_URL && credentials ? identityDirectory({ identityUrl: IDENTITY_URL, credentials }) : undefined;
const app = await buildApp({ history, directory });
await app.listen({ port, host: '0.0.0.0' });

// What changed lately, read again from the start of the events service's 30 days on every start.
if (EVENTS_URL && credentials) {
  followEvents({
    eventsUrl: EVENTS_URL,
    credentials,
    topics: FOLLOWED,
    cursor: { load: async () => history.cursor, save: async () => {} },
    handle: async (event) => history.add(event),
    onError: (err) => app.log.error({ err: (err as Error).message }, 'could not read platform events'),
  }).start();
} else {
  app.log.info('EVENTS_URL or the app’s sign-in is not set, so Auspex shows no changes (fine under pnpm dev:app).');
}

// Put Auspex in the platform's catalogue on every start, so the shell can offer it, with no admin step.
// It signs in as itself with SERVICE_CLIENT_SECRET: in a deployment, AUSPEX_CLIENT_SECRET, which identity
// makes its sign-in from. The build puts the manifest beside the code; from source it's in apps/auspex.
// The image carries its built frontend too (APP_FRONTEND, or /app/frontend), which it gives the
// registry first, so the shell loads this version's own copy of it.
if (REGISTRY_URL && credentials) {
  const built = new URL('./manifest.json', import.meta.url);
  const manifest = JSON.parse(readFileSync(APP_MANIFEST ?? (existsSync(built) ? built : new URL('../../manifest.json', import.meta.url)), 'utf8'));
  const frontend = APP_FRONTEND ?? fileURLToPath(new URL('../frontend/', import.meta.url));
  const giveFrontend = existsSync(join(frontend, 'entry.js'))
    ? publishFrontend({ registryUrl: REGISTRY_URL, credentials, app: manifest.id, version: manifest.version, dir: frontend })
        .then((kept) => app.log.info({ version: manifest.version, kept }, kept ? 'frontend kept by version' : 'this deployment doesn’t keep frontends by version'))
        .catch((err: Error) => app.log.error(err.message))
    : Promise.resolve();
  void giveFrontend
    .then(() => registerApp({ registryUrl: REGISTRY_URL, credentials, manifest }))
    .then(() => app.log.info({ app: manifest.id, version: manifest.version }, 'registered with the platform'))
    .catch((err: Error) => app.log.error(err.message));
} else {
  app.log.info('REGISTRY_URL or the app’s sign-in (SERVICE_CLIENT_SECRET) is not set, so Auspex is not in the catalogue (fine under pnpm dev:app).');
}
