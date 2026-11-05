import { useEffect, useMemo } from 'react';
import { defineReactApp, type AppProps, type AppSurfaceProps, type PickerProps } from '@augur/app-kit';
import type { Intent, MountContext } from '@augur/mfe-sdk';
import { ACCESS_EXPLAIN, readExplain } from './access.js';
import { Access } from './access-view.js';
import { AuspexApi } from './api.js';
import { ExplorerApp } from './app.js';
import { Glance } from './glance.js';
import { pathFor, placeFor, type Place } from './place.js';
import { places } from './places.js';
import { APP_NAME } from './words.js';
import styles from './styles.css?inline';

export { pathFor, placeFor, type Place } from './place.js';

/** Opens Explorer at a place in it, `{ path }` as its address has it: how its card on Home goes in. */
export const AUSPEX_OPEN = 'auspex.open';
/** Shows someone where they are: Explorer's map, or `{ floor }` to open on one floor. */
export const FLOOR_MAP = 'floor.map';

/** Where an intent asks Explorer to start, if it says. */
export const placeForIntent = (intent: Intent | undefined, here: string): Place | undefined => {
  const payload = (intent?.payload ?? {}) as { path?: unknown; floor?: unknown };
  if (intent?.type === AUSPEX_OPEN) return typeof payload.path === 'string' ? placeFor(payload.path, here) : undefined;
  if (intent?.type === FLOOR_MAP) return typeof payload.floor === 'string' ? { view: 'floor', id: payload.floor } : { view: 'where' };
  return undefined;
};

const apiFor = (ctx: MountContext) => new AuspexApi((path, init) => ctx.fetch(path, init));

/** The frame round every place: the map, loaded once, and the rail to Explorer's places. */
function App({ ctx, children }: AppProps<MountContext>) {
  const api = useMemo(() => apiFor(ctx), [ctx]);
  return (
    <ExplorerApp api={api} here={ctx.workspace.id} userId={ctx.user.id} admin={ctx.user.roles.includes('admin')}>
      {children}
    </ExplorerApp>
  );
}

/** Another app asked who can open one of its things: Explorer answers over it, and goes back when done. */
function WhoCanOpen({ ctx, intent, cancel }: PickerProps<MountContext>) {
  const api = useMemo(() => apiFor(ctx), [ctx]);
  const ask = intent.type === ACCESS_EXPLAIN ? readExplain(intent.payload) : undefined;
  useEffect(() => {
    if (!ask) cancel();
  }, [ask, cancel]);
  return ask ? <Access api={api} ask={ask} appName={ask.thing.appName ?? ''} onDone={cancel} /> : null;
}

/** The card on Home, on a team's floor or the org's: the way up from here, and three facts. */
function Card({ ctx }: AppSurfaceProps<MountContext>) {
  const api = useMemo(() => apiFor(ctx), [ctx]);
  return <Glance api={api} here={ctx.workspace.id} onOpen={(path) => void ctx.raise({ type: AUSPEX_OPEN, payload: { path } })} />;
}

/** The address an intent opens Explorer at, if it says. */
const opensAt = (type: string) => (payload: unknown, ctx: MountContext) => {
  const at = placeForIntent({ type, payload }, ctx.workspace.id);
  return at ? pathFor(at) : undefined;
};

/** Explorer: where you are on AUGUR. What the shell mounts at /auspex. */
export default defineReactApp<MountContext>({
  name: APP_NAME,
  App,
  routes: places,
  intents: { [AUSPEX_OPEN]: opensAt(AUSPEX_OPEN), [FLOOR_MAP]: opensAt(FLOOR_MAP) },
  Picker: WhoCanOpen,
  Glance: Card,
  styles,
});
