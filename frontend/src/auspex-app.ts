import { LitElement, html, nothing, type TemplateResult } from 'lit';
import type { Fact } from '@augur/ui-kit';
import { usable, type AuspexApi, type Changes, type ClosedTeam, type FloorApp, type MapFloor, type PersonMap } from './api.js';
import './auspex-building.js';
import './auspex-map.js';
import './auspex-plant.js';
import './auspex-replay.js';
import { mayWalk } from './cutaway.js';
import { plantLine } from './auspex-plant.js';
import { styles } from './styles.js';
import { appLine, appQuestion, changeLine, daysAgo, floorEyebrow, ledBy, listOf, whoCanAdd, whyHere } from './words.js';

/**
 * Where Auspex is: your map, one floor, the answer about one app on one floor,
 * a floor's last 30 days (its leads and admins), or the plant room (admins).
 */
export type Place = { view: 'where' } | { view: 'floor'; id: string } | { view: 'app'; floor: string; app: string } | { view: 'replay'; id: string } | { view: 'plant' } | { view: 'building' };

/** Auspex's own address for a place, below its route. */
export const pathFor = (place: Place): string => {
  switch (place.view) {
    case 'where':
      return '/';
    case 'plant':
      return '/plant';
    case 'building':
      return '/building';
    case 'floor':
      return `/floors/${encodeURIComponent(place.id)}`;
    case 'replay':
      return `/floors/${encodeURIComponent(place.id)}/replay`;
    case 'app':
      return `/floors/${encodeURIComponent(place.floor)}/apps/${encodeURIComponent(place.app)}`;
  }
};

/** The place an address names; `/here` is the floor they're on. Anything else is the map. */
export const placeFor = (path: string, here: string): Place => {
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'here') return { view: 'floor', id: here };
  if (parts[0] === 'plant') return { view: 'plant' };
  if (parts[0] === 'building') return { view: 'building' };
  if (parts[0] === 'floors' && parts[1] && parts[2] === 'replay') return { view: 'replay', id: parts[1] };
  if (parts[0] === 'floors' && parts[1] && parts[2] === 'apps' && parts[3]) return { view: 'app', floor: parts[1], app: parts[3] };
  if (parts[0] === 'floors' && parts[1]) return { view: 'floor', id: parts[1] };
  return { view: 'where' };
};

/** At most this many people are shown as discs before "and N more". */
const DISCS = 24;
/** At most this many changes are told in words. */
const TOLD = 5;
const DAY = 24 * 60 * 60 * 1000;

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

const dateOf = (at?: string) => (at ? new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'long' }) : '');

type Loaded<T> = T | Error | undefined;

/**
 * Auspex: where you are on AUGUR, who's there, and why you can or can't use
 * things. Every screen answers three questions: what am I looking at (the
 * heading), what can I do (the "You can" line, at most two actions), and why
 * (a reason on everything, and who can change each "no"). It changes nothing.
 *
 * @fires auspex-place - detail `Place`, when the person moves within Auspex
 */
export class AuspexApp extends LitElement {
  static override properties = {
    api: { attribute: false },
    place: { attribute: false },
    here: { type: String },
    userId: { type: String, attribute: 'user-id' },
    admin: { type: Boolean },
    map: { state: true },
    failure: { state: true },
    showAll: { state: true },
  };

  declare api: AuspexApi;
  declare place: Place;
  /** The floor they're on now. */
  declare here: string;
  declare userId: string;
  /** They have the admin role: the plant room, and every floor's replay they stand on. */
  declare admin: boolean;
  declare map: PersonMap | undefined;
  declare failure: string;
  declare showAll: boolean;

  /** The plant room in a line, for the building's basement (admins). */
  private plant?: { line: string; state: string };
  private apps = new Map<string, Loaded<FloorApp[]>>();
  private changes = new Map<string, Loaded<Changes>>();
  private names = new Map<string, string>();

  constructor() {
    super();
    this.place = { view: 'where' };
    this.here = '';
    this.userId = '';
    this.admin = false;
    this.failure = '';
    this.showAll = false;
  }

  override createRenderRoot() {
    return this;
  }

  override willUpdate(changed: Map<string, unknown>) {
    if (changed.has('api') && this.api) void this.load();
    if (changed.has('place')) {
      this.showAll = false;
      this.fetchFor();
    }
  }

  async load() {
    this.failure = '';
    try {
      this.map = await this.api.map();
      this.fetchFor();
    } catch (err) {
      this.failure = (err as Error).message;
    }
  }

  go(place: Place) {
    this.place = place;
    this.dispatchEvent(new CustomEvent('auspex-place', { detail: place, bubbles: true }));
    window.scrollTo?.({ top: 0 });
  }

  private floor(id: string) {
    return this.map?.floors.find((f) => f.id === id);
  }

  private closedTeam(id: string) {
    return this.map?.closed.find((t) => t.id === id);
  }

  /** Teams and floors by id, closed ones too, for their names and where they sit. */
  private get byId() {
    const all: { id: string; name: string; parentId?: string; kind?: string }[] = [...(this.map?.floors ?? []), ...(this.map?.closed ?? [])];
    return new Map(all.map((x) => [x.id, x]));
  }

  private nameOf = (id: string) => this.byId.get(id)?.name ?? 'a floor above';

  private get org() {
    return this.map?.floors.find((f) => f.kind === 'org');
  }

  /** Loads what the current place needs that isn't loaded yet. */
  private fetchFor() {
    const map = this.map;
    if (!map || !this.api) return;
    const place = this.place;
    const floorId = place.view === 'floor' || place.view === 'replay' ? place.id : place.view === 'app' ? place.floor : undefined;
    const floor = floorId ? this.floor(floorId) : undefined;
    if (place.view === 'building' && this.admin && !this.plant) this.loadPlant();
    if (!floor?.open) return;
    this.loadApps(floor.id);
    if (place.view === 'floor' && floor.kind !== 'personal') this.loadChanges(floor.id);
    // For an answer: every floor they stand on, to say where else the app is on for them.
    if (place.view === 'app') for (const f of map.floors.filter((x) => x.open)) this.loadApps(f.id);
  }

  private loadApps(floor: string) {
    if (this.apps.has(floor)) return;
    this.apps.set(floor, undefined);
    this.api
      .apps(floor)
      .then(async (apps) => {
        this.apps.set(floor, apps);
        // Who set the rules that decide, by name.
        const ids = [...new Set(apps.flatMap((a) => ('setBy' in a.state && a.state.setBy ? [a.state.setBy] : [])))].filter((id) => !this.names.has(id));
        if (ids.length) for (const [id, name] of Object.entries(await this.api.names(ids).catch(() => ({})))) this.names.set(id, name);
      })
      .catch((err: Error) => this.apps.set(floor, err))
      .finally(() => this.requestUpdate());
  }

  private loadPlant() {
    this.plant = { line: 'Checking each part…', state: 'checking' };
    this.api
      .status()
      .then(({ components }) => {
        const state = components.some((c) => c.state === 'down') ? 'down' : components.some((c) => c.state === 'slow') ? 'slow' : 'up';
        this.plant = { line: plantLine(components), state };
      })
      .catch((err: Error) => (this.plant = { line: `Couldn’t check it: ${err.message}`, state: 'checking' }))
      .finally(() => this.requestUpdate());
  }

  // ---- The building --------------------------------------------------------

  private renderBuilding(map: PersonMap) {
    const org = this.org!;
    if (!mayWalk(map, this.userId, this.admin))
      return html`<div class="ax-pane">
        <ui-heading eyebrow="Auspex" heading="The building" summary="The whole org in cross-section: every team as a room above the teams inside it." size="l" level="1"></ui-heading>
        <ui-state kind="empty" heading="The building is for leads and admins" body="It shows the shape of the whole org at once, which leads and admins look after. Where you are shows the same teams, and why you can or can’t go into each."></ui-state>
        ${this.can(html`<ui-button kind="tertiary" @click=${() => this.go({ view: 'where' })}>See where you are</ui-button>`, 'Nothing here changes anything.')}
      </div>`;
    const teams = map.floors.filter((f) => f.kind === 'team');
    const stand = teams.filter((f) => f.open).length;
    const see = teams.length - stand;
    const parts = [`go into ${stand}`, see ? `see into ${see}` : '', map.closed.length ? `find ${map.closed.length} closed` : ''].filter(Boolean);
    const summary = `${org.name} has ${teams.length + map.closed.length} ${teams.length + map.closed.length === 1 ? 'team' : 'teams'}. You ${listOf(parts)}.`;
    return html`<div class="ax-pane">
      <ui-heading eyebrow="Auspex" heading="The building" summary=${summary} size="l" level="1"></ui-heading>
      <div class="ax-map">
        <auspex-building .map=${map} here=${this.here} ?admin=${this.admin} plant=${this.plant?.line ?? ''} plant-state=${this.plant?.state ?? 'checking'}
          @auspex-floor=${(e: CustomEvent<{ id: string }>) => this.go({ view: 'floor', id: e.detail.id })} @auspex-plant=${() => this.go({ view: 'plant' })}></auspex-building>
      </div>
      <ul class="ax-key" aria-label="What the drawing means">
        <li><i class="stand"></i>You can go here</li>
        ${see ? html`<li><i class="see"></i>You can see in</li>` : nothing}
        ${map.closed.length ? html`<li><i class="closed"></i>Closed to you</li>` : nothing}
        <li><i class="stairs"></i>Your way up</li>
      </ul>
      ${this.can(
        this.admin ? html`<ui-button kind="tertiary" @click=${() => this.go({ view: 'plant' })}>Open the plant room</ui-button>` : nothing,
        html`Choose a room to see who’s there and which apps are on. A closed room still says <b>who to ask</b>. Only an admin changes who’s on a team.`,
      )}
    </div>`;
  }

  private loadChanges(floor: string) {
    if (this.changes.has(floor)) return;
    this.changes.set(floor, undefined);
    this.api
      .changes(floor)
      .then((c) => this.changes.set(floor, c))
      .catch((err: Error) => this.changes.set(floor, err))
      .finally(() => this.requestUpdate());
  }

  /** The replay is for a floor's leads and admins, on a team or the org they stand on. */
  private mayReplay(f: MapFloor) {
    return f.open && f.kind !== 'personal' && (this.admin || (f.why.kind === 'member' && f.why.role === 'lead') || Boolean(f.members?.some((m) => m.id === this.userId && m.role === 'lead')));
  }

  private appName = (id: string) => [...this.apps.values()].flatMap((a) => (Array.isArray(a) ? a : [])).find((a) => a.id === id)?.name ?? id;

  private can(actions: TemplateResult | typeof nothing, why: TemplateResult | string) {
    return html`<div class="ax-can">
      <p class="ax-label">You can</p>
      ${actions === nothing ? nothing : html`<div class="acts">${actions}</div>`}
      <p>${why}</p>
    </div>`;
  }

  private orb(kind: string, extra = '', size: 'sm' | '' = '') {
    const icon = kind === 'org' ? 'org' : kind === 'personal' ? 'account' : kind === 'closed' ? 'lock' : 'people';
    return html`<span class="ax-orb ${kind} ${extra} ${size}" aria-hidden="true"><ui-icon name=${icon} size=${size ? 18 : 28}></ui-icon></span>`;
  }

  // ---- Where you are -------------------------------------------------------

  private renderWhere(map: PersonMap) {
    const org = this.org!;
    const here = this.floor(this.here);
    const own = map.floors.find((f) => f.kind === 'personal');
    const stand = map.floors.filter((f) => f.open).length;
    const reasons = new Map<string, string>([
      ...map.floors.map((f) => [f.id, whyHere(f, org.name)] as [string, string]),
      ...map.closed.map((t) => [t.id, whoCanAdd(t)] as [string, string]),
    ]);
    return html`<div class="ax-pane">
      <ui-heading eyebrow="Auspex" heading="Where you are" summary=${`You can go to ${stand} ${stand === 1 ? 'floor' : 'floors'}.${here ? ` You’re on ${here.kind === 'personal' ? 'your own floor' : here.name} now.` : ''}`} size="l" level="1"></ui-heading>
      <div class="ax-map">
        <auspex-map .map=${map} here=${this.here} .reasons=${reasons} @auspex-floor=${(e: CustomEvent<{ id: string }>) => this.go({ view: 'floor', id: e.detail.id })}></auspex-map>
      </div>
      ${own
        ? html`<button class="ax-own" @click=${() => this.go({ view: 'floor', id: own.id })}>
            ${this.orb('personal', own.id === this.here ? 'here' : '', 'sm')}
            <span><span class="t1">Your own floor</span><br /><span class="t2">Only you can come here</span></span>
          </button>`
        : nothing}
      <ul class="ax-key" aria-label="What the marks mean">
        <li><i class="here"></i>You’re here</li>
        <li><i class="stand"></i>You can go here</li>
        ${map.floors.some((f) => !f.open) ? html`<li><i class="see"></i>You can see in</li>` : nothing}
        ${map.closed.length ? html`<li><i class="closed"></i>Closed to you</li>` : nothing}
      </ul>
      ${this.can(
        mayWalk(map, this.userId, this.admin) ? html`<ui-button kind="tertiary" @click=${() => this.go({ view: 'building' })}>See it as a building</ui-button>` : nothing,
        map.closed.length
          ? html`Choose a floor to see who’s there and which apps you can use on it. A closed team says <b>who to ask</b> to be added.`
          : 'Choose a floor to see who’s there and which apps you can use on it.',
      )}
    </div>`;
  }

  // ---- A floor -------------------------------------------------------------

  private renderFloor(f: MapFloor) {
    const org = this.org!;
    const apps = this.apps.get(f.id);
    const changes = this.changes.get(f.id);
    const list = Array.isArray(apps) ? apps : undefined;
    const week = changes && !(changes instanceof Error) ? changes : undefined;
    const title = f.kind === 'personal' ? 'Your own floor' : f.name;
    // Said once: a lead's reason for being here and who leads it can be the same sentence.
    const summary = [...new Set([whyHere(f, org.name) + '.', ledBy(f.leads.filter(() => f.kind === 'team'), this.userId)].filter(Boolean))].join(' ');
    const facts: Fact[] = [
      ...(f.kind !== 'personal' ? [{ value: f.people, label: f.people === 1 ? 'Person' : 'People' }] : []),
      ...(f.open ? [{ value: list ? list.filter(usable).length : '…', label: 'Apps you can use' }] : []),
      ...(f.open && f.kind !== 'personal' ? [{ value: week ? week.changes.length : '…', label: 'Changes this week' }] : []),
      ...(!f.open ? [{ value: f.leads.length, label: f.leads.length === 1 ? 'Lead' : 'Leads' }] : []),
    ];
    const firstNo = list?.find((a) => !usable(a) && a.state.why !== 'not-for-this-kind');
    return html`<div class="ax-pane">
      <div class="ax-hero">
        ${this.orb(f.kind, `${f.open ? '' : 'see'} ${f.id === this.here ? 'here' : ''}`)}
        <ui-heading eyebrow=${floorEyebrow(f, this.byId)} heading=${title} summary=${summary} size="l" level="1"></ui-heading>
      </div>
      <ui-facts .items=${facts}></ui-facts>
      ${f.open ? this.renderApps(f, apps) : html`<p class="ax-muted ax-meta">You can see who’s on ${f.name}, ${f.why.kind === 'admin' ? 'as an admin' : `as a lead of ${f.why.kind === 'leads-above' ? f.why.team.name : 'a team above it'}`}. Its apps and what changes on it are for the people on it.</p>`}
      ${f.members?.length ? this.renderPeople(f) : nothing}
      ${f.kind === 'org' ? html`<p class="ax-muted ax-meta">Everyone at ${f.name} is here: ${f.people} ${f.people === 1 ? 'person' : 'people'}. Auspex shows people on the teams you share with them, and nothing else about them.</p>` : nothing}
      ${f.open && f.kind !== 'personal' ? this.renderWeek(f, changes) : nothing}
      ${this.can(
        firstNo ? html`<ui-button kind="tertiary" @click=${() => this.go({ view: 'app', floor: f.id, app: firstNo.id })}>${appQuestion(firstNo, title)}</ui-button>` : nothing,
        f.kind === 'personal'
          ? 'Choose an app to see why you can or can’t use it here.'
          : html`Choose an app to see why. You can’t change who’s here or which apps are on: <b>an admin</b> does${f.leads.length ? `, and ${listOf(f.leads.map((l) => (l.id === this.userId ? 'you' : l.name)))} ${f.leads.length > 1 || f.leads[0]?.id === this.userId ? 'lead' : 'leads'} ${f.name}` : ''}.`,
      )}
    </div>`;
  }

  private renderApps(f: MapFloor, apps: Loaded<FloorApp[]>) {
    if (apps instanceof Error) return html`<ui-state kind="error" heading="Couldn’t see this floor’s apps" body=${apps.message} action="Try again" @ui-action=${() => (this.apps.delete(f.id), this.fetchFor())}></ui-state>`;
    if (!apps) return html`<ui-state kind="loading" heading="Looking at the apps here" size="line"></ui-state>`;
    // What they can use first, then what's off, each by name.
    const sorted = [...apps].sort((a, b) => Number(usable(b)) - Number(usable(a)) || a.name.localeCompare(b.name));
    return html`<section class="ax-section" aria-labelledby="ax-apps">
      <h2 class="ax-label" id="ax-apps">Apps here</h2>
      <div class="ax-tiles">
        ${sorted.map((a) => {
          const on = usable(a);
          const state = on ? 'on' : `off ${a.state.why === 'blocked' ? 'blocked' : ''}`;
          return html`<button class="ax-tile ${state}" @click=${() => this.go({ view: 'app', floor: f.id, app: a.id })} aria-label=${`${a.name}: ${appLine(a, this.nameOf, f.kind)}. ${appQuestion(a, f.kind === 'personal' ? 'your own floor' : f.name)}`}>
            <span class="glyph"><ui-icon name=${a.icon ?? 'apps'} size="20"></ui-icon></span>
            <span class="nm">${a.name}</span>
            <span class="st">${appLine(a, this.nameOf, f.kind)}</span>
          </button>`;
        })}
      </div>
    </section>`;
  }

  private renderPeople(f: MapFloor) {
    const members = f.members ?? [];
    const shown = this.showAll ? members : members.slice(0, DISCS);
    return html`<section class="ax-section" aria-labelledby="ax-people">
      <h2 class="ax-label" id="ax-people">On ${f.name}</h2>
      <ul class="ax-people">
        ${shown.map(
          (m) => html`<li class="ax-person ${m.role} ${m.id === this.userId ? 'you' : ''}">
            <span class="ax-disc" aria-hidden="true">${initials(m.name)}</span>
            <span class="nm">${m.name}</span>
            ${m.role === 'lead' || m.id === this.userId ? html`<span class="rl">${[m.role === 'lead' ? 'Lead' : '', m.id === this.userId ? 'You' : ''].filter(Boolean).join(' · ')}</span>` : nothing}
          </li>`,
        )}
        ${members.length > shown.length
          ? html`<li class="ax-person"><button class="ax-more" @click=${() => (this.showAll = true)}><span class="ax-disc">+${members.length - shown.length}</span></button><span class="nm">more</span></li>`
          : nothing}
      </ul>
      ${f.people > members.length ? html`<p class="ax-muted ax-meta">And ${f.people - members.length} more on the teams inside ${f.name}.</p>` : nothing}
    </section>`;
  }

  private renderWeek(f: MapFloor, changes: Loaded<Changes>) {
    if (changes instanceof Error) return html`<ui-state kind="error" size="line" heading="Couldn’t see what changed" body=${changes.message}></ui-state>`;
    if (!changes) return nothing;
    const now = Date.now();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const days = Array.from({ length: 7 }, (_, i) => new Date(today.getTime() - (6 - i) * DAY));
    const appName = this.appName;
    return html`<section class="ax-section" aria-labelledby="ax-week">
      <h2 class="ax-label" id="ax-week">This week</h2>
      <div class="ax-week" aria-hidden="true">
        ${days.map((d, i) => {
          const on = changes.changes.filter((c) => {
            const at = Date.parse(c.at);
            return at >= d.getTime() && at < d.getTime() + DAY;
          });
          return html`<div class="ax-day ${i === 6 ? 'today' : ''}">
            <span class="dots">${on.slice(0, 5).map((c) => html`<i class=${c.app ? 'app' : 'people'}></i>`)}</span>
            <span class="day">${i === 6 ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'short' })}</span>
          </div>`;
        })}
      </div>
      ${changes.changes.length
        ? html`<ul class="ax-events">
            ${changes.changes.slice(0, TOLD).map((c) => html`<li><span>${changeLine(c, changes.names, appName)}</span><span>${daysAgo(c.at, now)}</span></li>`)}
          </ul>`
        : html`<p class="ax-muted ax-meta">Nothing changed here this week.</p>`}
      ${this.mayReplay(f)
        ? html`<div><ui-button kind="tertiary" size="sm" @click=${() => this.go({ view: 'replay', id: f.id })}>Replay the last 30 days</ui-button></div>`
        : html`<p class="ax-muted ax-meta">${f.name}’s leads and admins can replay its last 30 days.</p>`}
    </section>`;
  }

  // ---- A closed team -------------------------------------------------------

  private renderClosed(t: ClosedTeam) {
    const byId = this.byId;
    const up: string[] = [];
    for (let p = t.parentId; p && byId.get(p); p = byId.get(p)!.parentId) up.unshift(byId.get(p)!.name);
    const inside = this.map!.closed.filter((c) => c.id !== t.id && this.isInside(c, t.id));
    return html`<div class="ax-pane">
      <div class="ax-hero">
        ${this.orb('closed')}
        <ui-heading eyebrow="Closed to you" heading=${t.name} summary="You’re not on this team, so you can’t go in or see who’s there." size="l" level="1"></ui-heading>
      </div>
      <div class="ax-path" aria-label="Where it sits">${up.map((n) => html`<span>${n}</span><span aria-hidden="true">›</span>`)}<b>${t.name}</b></div>
      ${inside.length
        ? html`<section class="ax-section"><h2 class="ax-label">Teams inside it</h2><ul class="ax-names">${inside.map((c) => html`<li>${c.name}</li>`)}</ul></section>`
        : nothing}
      ${this.can(nothing, html`To be added, ${t.leads.length ? html`ask <b>${listOf(t.leads.map((l) => l.name))}</b>, who ${t.leads.length > 1 ? 'lead' : 'leads'} it. An admin adds people to teams.` : html`ask <b>an admin</b>: no one leads it yet.`}`)}
    </div>`;
  }

  private isInside(team: { parentId?: string }, ancestor: string): boolean {
    const byId = this.byId;
    for (let p = team.parentId; p; p = byId.get(p)?.parentId) if (p === ancestor) return true;
    return false;
  }

  // ---- An answer about one app on one floor --------------------------------

  /** From the org down to this floor: the floors whose rules count here. */
  private chainTo(f: MapFloor): { id: string; name: string; kind: string }[] {
    const org = this.org!;
    if (f.kind === 'org') return [org];
    if (f.kind === 'personal') return [org, f];
    const byId = this.byId;
    const chain: { id: string; name: string; kind: string }[] = [];
    for (let at: string | undefined = f.id; at && byId.get(at); at = byId.get(at)!.parentId) chain.unshift({ ...byId.get(at)!, kind: 'team' });
    return [org, ...chain.filter((c) => c.id !== org.id)];
  }

  private renderApp(f: MapFloor, appId: string) {
    const apps = this.apps.get(f.id);
    if (apps instanceof Error) return html`<div class="ax-pane"><ui-state kind="error" heading="Couldn’t see this floor’s apps" body=${apps.message}></ui-state></div>`;
    if (!apps) return html`<div class="ax-pane"><ui-state kind="loading" heading="Working it out"></ui-state></div>`;
    const a = apps.find((x) => x.id === appId);
    const floorName = f.kind === 'personal' ? 'your own floor' : f.name;
    if (!a) return html`<div class="ax-pane"><ui-state kind="empty" heading="No such app here" body=${`There’s no app called that on ${floorName}. It may have been removed.`}></ui-state></div>`;
    const yes = usable(a);
    const s = a.state;
    const who = (id?: string) => (id ? (this.names.get(id) ?? 'an admin') : 'an admin');
    const by = 'by' in s ? s.by : undefined;
    const setLine = 'setBy' in s && s.setBy ? `Set by ${who(s.setBy)}${s.setAt ? ` on ${dateOf(s.setAt)}` : ''}` : 'Set by an admin';

    let summary: string;
    let steps: TemplateResult[];
    const step = (orbKind: string, t1: string, t2: string, verdict: '' | 'yes' | 'no' | 'quiet', word = '') =>
      html`<li class="ax-step ${verdict === 'quiet' ? 'quiet' : verdict ? `decides ${verdict}` : ''}">
        ${this.orb(orbKind, '', 'sm')}
        <div><span class="t1">${t1}</span>${word ? html`<span class="verdict">${word}</span>` : nothing}<br /><span class="t2">${t2}</span></div>
      </li>`;

    if (s.why === 'platform') {
      summary = `${a.name} is part of AUGUR itself, so it’s on everywhere for everyone.`;
      steps = [step('org', 'AUGUR', 'It comes with the platform', 'yes', 'Decides it')];
    } else if (s.why === 'turned-off') {
      summary = `An admin has turned ${a.name} off for everyone.`;
      steps = [step('org', this.org!.name, 'Turned off everywhere by an admin', 'no', 'Decides it')];
    } else if (s.why === 'not-for-this-kind') {
      const kinds = (a.floors ?? []).map((k) => (k === 'personal' ? 'your own floor' : k === 'team' ? 'teams' : 'the whole organisation'));
      summary = `${a.name} isn’t made for ${floorName}. It works on ${listOf(kinds) || 'other floors'}.`;
      steps = [step(f.kind, f.kind === 'personal' ? 'Your own floor' : f.name, `${a.name} is made for ${listOf(kinds) || 'other floors'}`, 'no', 'Decides it')];
    } else {
      const chain = this.chainTo(f);
      summary =
        s.why === 'blocked'
          ? `${this.nameOf(s.by)} has blocked it for itself${chain.length > 1 && s.by !== f.id ? ' and every team inside it' : ''}.`
          : s.why === 'approved'
            ? `An admin approved it for everyone, and no floor on your way here has a rule of its own.`
            : `${s.why === 'set-here' ? floorName.replace(/^./, (c) => c.toUpperCase()) : this.nameOf(s.by)} has it turned ${s.on ? 'on' : 'off'}.`;
      steps = chain.map((c) => {
        const kind = c.kind === 'org' ? 'org' : c.kind === 'personal' ? 'personal' : 'team';
        const name = c.kind === 'personal' ? 'Your own floor' : c.name;
        if (c.id === by) {
          if (s.why === 'blocked') return step(kind, `${name} blocks it`, setLine, 'no', 'Decides it');
          return step(kind, `${name} turns it ${s.on ? 'on' : 'off'}`, setLine, s.on ? 'yes' : 'no', 'Decides it');
        }
        if (s.why === 'approved' && c.kind === 'org') return step(kind, `${name} allows it`, 'Approved by an admin for everyone', 'yes', 'Decides it');
        const below = c.id !== f.id ? `So ${name}’s rules reach the floors inside it` : 'No rule of its own';
        return step(kind, name, c.id === this.org!.id && s.why !== 'approved' ? 'Allows it, with no rule of its own' : below, 'quiet');
      });
    }
    if (a.hasRole === false) {
      steps.push(step('closed', `Needs the ${a.requiredRole} role`, `You don’t have it. An admin gives people roles.`, 'no', 'Decides it'));
      if (a.state.on) summary = `It’s on here, but only for people with the ${a.requiredRole} role.`;
    }

    // Where else it's on for them, said rather than offered: Auspex doesn't move you between floors.
    const elsewhere = yes
      ? []
      : this.map!.floors.filter((x) => x.open && x.id !== f.id && (this.apps.get(x.id) as FloorApp[] | undefined)?.some?.((y) => y.id === a.id && usable(y)));
    const changer = a.hasRole === false ? 'an admin, who gives roles' : 'an admin';
    return html`<div class="ax-pane">
      <div class="ax-answer">
        <span class="big ${yes ? '' : 'no'}" aria-hidden="true"><ui-icon name=${yes ? 'check' : 'blocked'} size="28"></ui-icon></span>
        <ui-heading eyebrow=${`${a.name} on ${floorName}`} heading=${yes ? `You can use ${a.name} here` : `You can’t use ${a.name} here`} summary=${summary} size="l" level="1"></ui-heading>
      </div>
      <section class="ax-section" aria-labelledby="ax-how">
        <h2 class="ax-label" id="ax-how">How this was decided</h2>
        <ol class="ax-chain">${steps}</ol>
      </section>
      ${this.can(
        nothing,
        yes
          ? html`Nothing to do: it’s on for you here. Only <b>an admin</b> changes which apps are on.`
          : html`${elsewhere.length ? html`It’s on for you on <b>${listOf(elsewhere.map((x) => (x.kind === 'personal' ? 'your own floor' : x.name)))}</b>. ` : nothing}To change it here, ask <b>${changer}</b>.`,
      )}
    </div>`;
  }

  override render() {
    if (this.failure) return html`${styles}<ui-app-frame><ui-state kind="error" heading="Couldn’t load your map" body=${this.failure} action="Try again" @ui-action=${() => void this.load()}></ui-state></ui-app-frame>`;
    const map = this.map;
    if (!map || !this.org) return html`${styles}<ui-app-frame><ui-state kind="loading" heading="Finding where you are"></ui-state></ui-app-frame>`;
    const place = this.place;
    let body: TemplateResult;
    if (place.view === 'where') body = this.renderWhere(map);
    else if (place.view === 'building') body = this.renderBuilding(map);
    else if (place.view === 'plant') body = html`<div class="ax-pane"><auspex-plant .api=${this.api} ?admin=${this.admin}></auspex-plant></div>`;
    else {
      const id = place.view === 'app' ? place.floor : place.id;
      const floor = this.floor(id);
      const closed = floor ? undefined : this.closedTeam(id);
      if (closed) body = this.renderClosed(closed);
      else if (!floor) body = html`<div class="ax-pane"><ui-state kind="empty" heading="No such floor" body="It may have been removed, or the link is wrong." action="See where you are" @ui-action=${() => this.go({ view: 'where' })}></ui-state></div>`;
      else if (place.view === 'app' && floor.open) body = this.renderApp(floor, place.app);
      else if (place.view === 'replay' && this.mayReplay(floor))
        body = html`<div class="ax-pane"><auspex-replay .api=${this.api} .floor=${floor} .appName=${this.appName}></auspex-replay></div>`;
      else body = this.renderFloor(floor);
    }
    return html`${styles}<ui-app-frame>${body}</ui-app-frame>`;
  }
}

if (!customElements.get('auspex-app')) customElements.define('auspex-app', AuspexApp);

declare global {
  interface HTMLElementTagNameMap {
    'auspex-app': AuspexApp;
  }
}
