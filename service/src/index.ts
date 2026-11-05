import { appCredentialsFromEnv, commonSettings, followEvents, identityDirectory, loadConfigOrExit, startAppService } from '@augur/service-kit';
import { buildApp } from './app.ts';
import { FOLLOWED, History } from './history.ts';
import { manifest } from './manifest.ts';

// Every setting Explorer reads, checked before it starts (in production, a missing one stops it).
// It keeps nothing of its own: no database and no bucket.
loadConfigOrExit(manifest.id, [
  commonSettings.registry,
  commonSettings.identity,
  commonSettings.events,
  commonSettings.issuer,
  commonSettings.issuerInside,
  commonSettings.clientSecret,
  commonSettings.gateway,
]);

const { IDENTITY_URL, EVENTS_URL } = process.env;
const credentials = appCredentialsFromEnv(manifest.id);
const history = new History();
const directory = IDENTITY_URL && credentials ? identityDirectory({ identityUrl: IDENTITY_URL, credentials }) : undefined;

// The starter listens, gives the registry this version's frontend, puts Explorer in the catalogue and
// stops cleanly on SIGTERM.
const app = await startAppService({ manifest, buildApp: () => buildApp({ history, directory }) });

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
  app.log.info(`EVENTS_URL or the app’s sign-in is not set, so ${manifest.name} shows no changes (fine under pnpm dev:app).`);
}
