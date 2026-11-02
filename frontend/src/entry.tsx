import { defineMicroFrontend, type Intent, type MountContext } from '@augur/mfe-sdk';
import { createRoot, type Root } from 'react-dom/client';
import { ACCESS_EXPLAIN, readExplain } from './access.js';
import { Access } from './access-view.js';
import { AuspexApi } from './api.js';
import { ExplorerApp } from './app.js';
import { Glance } from './glance.js';
import { pathFor, placeFor, type Place } from './place.js';
import styles from './styles.css?inline';

export { pathFor, placeFor, type Place } from './place.js';

/** Opens Explorer at a place in it, `{ path }` as its address has it: how its card on Home goes in. */
export const AUSPEX_OPEN = 'auspex.open';
/** Shows someone where they are: Explorer's map, or `{ floor }` to open on one floor. */
export const FLOOR_MAP = 'floor.map';

/**
 * Where Explorer is in the address bar, so a place in it can be shared and
 * Back goes to the last one: the shell mounts Explorer again with that path.
 */
export const addressFor = (pathname: string, mountedAt: string, place: Place) => {
  const inner = mountedAt === '/' ? '' : mountedAt;
  if (!pathname.endsWith(inner)) return undefined;
  return `${pathname.slice(0, pathname.length - inner.length).replace(/\/$/, '')}${pathFor(place)}`.replace(/\/$/, '') || '/';
};

/** Where an intent asks Explorer to start, if it says. */
export const placeForIntent = (intent: Intent | undefined, here: string): Place | undefined => {
  const payload = (intent?.payload ?? {}) as { path?: unknown; floor?: unknown };
  if (intent?.type === AUSPEX_OPEN) return typeof payload.path === 'string' ? placeFor(payload.path, here) : undefined;
  if (intent?.type === FLOOR_MAP) return typeof payload.floor === 'string' ? { view: 'floor', id: payload.floor } : { view: 'where' };
  return undefined;
};

const apiFor = (ctx: MountContext) => new AuspexApi((path, init) => ctx.fetch(path, init));

const roots = new WeakMap<HTMLElement, Root>();
const STYLE_ID = 'augur-auspex-styles';

/** A React root in `el`, with Explorer's stylesheet on the page once. */
const rootIn = (el: HTMLElement) => {
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = styles;
    document.head.append(style);
  }
  const root = createRoot(el);
  roots.set(el, root);
  return root;
};
const unmount = (el: HTMLElement) => {
  roots.get(el)?.unmount();
  roots.delete(el);
};

/** Explorer: where you are on AUGUR. What the shell mounts at /auspex. */
export default defineMicroFrontend({
  mount(el: HTMLElement, ctx: MountContext) {
    const root = rootIn(el);
    // Another app asked who can open one of its things: Explorer answers over it, and goes back when done.
    const ask = ctx.intent?.type === ACCESS_EXPLAIN ? readExplain(ctx.intent.payload) : undefined;
    if (ask && ctx.reply) {
      const reply = ctx.reply;
      root.render(<Access api={apiFor(ctx)} ask={ask} appName={ask.thing.appName ?? ''} onDone={() => reply.cancel()} />);
      return;
    }
    let mountedAt = ctx.path;
    const moved = (place: Place) => {
      const to = addressFor(window.location.pathname, mountedAt, place);
      if (!to || to === window.location.pathname) return;
      window.history.pushState(window.history.state, '', to);
      mountedAt = pathFor(place);
    };
    root.render(
      <ExplorerApp
        api={apiFor(ctx)}
        here={ctx.workspace.id}
        userId={ctx.user.id}
        admin={ctx.user.roles.includes('admin')}
        place={placeForIntent(ctx.intent, ctx.workspace.id) ?? placeFor(ctx.path, ctx.workspace.id)}
        onPlace={moved}
      />,
    );
  },
  unmount,
  surfaces: {
    /** The card on Home, on a team's floor or the org's: the way up from here, and three facts. */
    './Glance': {
      mount(el: HTMLElement, ctx: MountContext) {
        rootIn(el).render(<Glance api={apiFor(ctx)} here={ctx.workspace.id} onOpen={(path) => void ctx.raise({ type: AUSPEX_OPEN, payload: { path } })} />);
      },
      unmount,
    },
  },
});
