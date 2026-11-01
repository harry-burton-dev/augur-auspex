import { defineMicroFrontend, type Intent, type MountContext } from '@augur/mfe-sdk';
import { html, render } from 'lit';
import '@augur/ui-kit';
import { ACCESS_EXPLAIN, readExplain } from './access.js';
import { AuspexApi } from './api.js';
import './auspex-access.js';
import { pathFor, placeFor, type Place } from './auspex-app.js';
import './auspex-app.js';
import './auspex-glance.js';

/** Opens Auspex at a place in it, `{ path }` as its address has it: how its card on Home goes in. */
export const AUSPEX_OPEN = 'auspex.open';
/** Shows someone where they are: Auspex's map, or `{ floor }` to open on one floor. */
export const FLOOR_MAP = 'floor.map';

/**
 * Where Auspex is in the address bar, so a place in it can be shared and
 * Back goes to the last one: the shell mounts Auspex again with that path.
 */
export const addressFor = (pathname: string, mountedAt: string, place: Place) => {
  const inner = mountedAt === '/' ? '' : mountedAt;
  if (!pathname.endsWith(inner)) return undefined;
  return `${pathname.slice(0, pathname.length - inner.length).replace(/\/$/, '')}${pathFor(place)}`.replace(/\/$/, '') || '/';
};

/** Where an intent asks Auspex to start, if it says. */
export const placeForIntent = (intent: Intent | undefined, here: string): Place | undefined => {
  const payload = (intent?.payload ?? {}) as { path?: unknown; floor?: unknown };
  if (intent?.type === AUSPEX_OPEN) return typeof payload.path === 'string' ? placeFor(payload.path, here) : undefined;
  if (intent?.type === FLOOR_MAP) return typeof payload.floor === 'string' ? { view: 'floor', id: payload.floor } : { view: 'where' };
  return undefined;
};

const apiFor = (ctx: MountContext) => new AuspexApi((path, init) => ctx.fetch(path, init));

/** Auspex: where you are on AUGUR. What the shell mounts at /auspex. */
export default defineMicroFrontend({
  mount(el: HTMLElement, ctx: MountContext) {
    // Another app asked who can open one of its things: Auspex answers over it, and goes back when done.
    const ask = ctx.intent?.type === ACCESS_EXPLAIN ? readExplain(ctx.intent.payload) : undefined;
    if (ask && ctx.reply) {
      const reply = ctx.reply;
      render(html`<auspex-access .api=${apiFor(ctx)} .ask=${ask} app-name=${ask.thing.appName ?? ''} @auspex-done=${() => reply.cancel()}></auspex-access>`, el);
      return;
    }
    let mountedAt = ctx.path;
    const moved = (e: CustomEvent<Place>) => {
      const to = addressFor(window.location.pathname, mountedAt, e.detail);
      if (!to || to === window.location.pathname) return;
      window.history.pushState(window.history.state, '', to);
      mountedAt = pathFor(e.detail);
    };
    render(
      html`<auspex-app
        .api=${apiFor(ctx)}
        here=${ctx.workspace.id}
        user-id=${ctx.user.id}
        ?admin=${ctx.user.roles.includes('admin')}
        .place=${placeForIntent(ctx.intent, ctx.workspace.id) ?? placeFor(ctx.path, ctx.workspace.id)}
        @auspex-place=${moved}
      ></auspex-app>`,
      el,
    );
  },
  unmount(el: HTMLElement) {
    render(html``, el);
  },
  surfaces: {
    /** The card on Home, on a team's floor or the org's: the way up from here, and three facts. */
    './Glance': {
      mount(el: HTMLElement, ctx: MountContext) {
        render(
          html`<auspex-glance .api=${apiFor(ctx)} here=${ctx.workspace.id} @auspex-open=${(e: CustomEvent<{ path: string }>) => void ctx.raise({ type: AUSPEX_OPEN, payload: { path: e.detail.path } })}></auspex-glance>`,
          el,
        );
      },
      unmount(el: HTMLElement) {
        render(html``, el);
      },
    },
  },
});
