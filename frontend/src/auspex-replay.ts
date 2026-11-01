import { LitElement, html, nothing } from 'lit';
import type { AuspexApi, Change, Changes, MapFloor } from './api.js';
import { APP_NAME, changeLine } from './words.js';

/** How far back the replay goes: as far as Auspex remembers. */
export const REPLAY_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;
/** How long each day shows while it plays. */
const STEP_MS = 600;

export interface ReplayDay {
  start: number;
  changes: Change[];
}

/** The last `n` days, oldest first, each with what changed on it, oldest change first. */
export const daysOf = (changes: Change[], now = Date.now(), n = REPLAY_DAYS): ReplayDay[] => {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: n }, (_, i) => {
    const start = today.getTime() - (n - 1 - i) * DAY;
    const on = changes.filter((c) => {
      const at = Date.parse(c.at);
      return at >= start && at < start + DAY;
    });
    return { start, changes: on.sort((a, b) => Date.parse(a.at) - Date.parse(b.at)) };
  });
};

/** What the days up to one add up to, in words: "3 joined", "1 left", "2 app changes". Nothing for none. */
export const tally = (days: ReplayDay[]) => {
  const all = days.flatMap((d) => d.changes);
  const count = (kinds: Change['kind'][]) => all.filter((c) => kinds.includes(c.kind)).length;
  const joined = count(['joined']);
  const left = count(['left']);
  const apps = count(['app-on', 'app-off', 'app-blocked', 'app-rule-cleared', 'app-removed']);
  const teams = count(['team-made', 'team-renamed']);
  return [
    joined ? { kind: 'people', words: `${joined} joined` } : undefined,
    left ? { kind: 'people', words: `${left} left` } : undefined,
    apps ? { kind: 'app', words: `${apps} app ${apps === 1 ? 'change' : 'changes'}` } : undefined,
    teams ? { kind: 'team', words: `${teams} team ${teams === 1 ? 'change' : 'changes'}` } : undefined,
  ].filter((x): x is { kind: string; words: string } => Boolean(x));
};

/** The mark a change gets on the line: people round, apps square, a block a red diamond. */
const markOf = (c: Change) => (c.kind === 'app-blocked' ? 'blocked' : c.app ? 'app' : c.kind.startsWith('team') ? 'team' : 'people');

const dayWords = (start: number, opts: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' }) => new Date(start).toLocaleDateString(undefined, opts);

/**
 * The last 30 days on one floor, for its leads and admins: each day a column
 * of marks, played forward a day at a time or picked by hand, with what the
 * month had added up to by then and what happened that day. Nothing on it
 * changes anything.
 */
export class AuspexReplay extends LitElement {
  static override properties = {
    api: { attribute: false },
    floor: { attribute: false },
    appName: { attribute: false },
    loaded: { state: true },
    day: { state: true },
    playing: { state: true },
  };

  declare api: AuspexApi;
  declare floor: MapFloor;
  /** Names an app by its id, as the floor's apps know it. */
  declare appName: (id: string) => string;
  declare loaded: Changes | Error | undefined;
  /** The day picked, 0 the oldest. */
  declare day: number;
  declare playing: boolean;

  private timer?: ReturnType<typeof setInterval>;

  constructor() {
    super();
    this.day = REPLAY_DAYS - 1;
    this.playing = false;
    this.appName = (id) => id;
  }

  override createRenderRoot() {
    return this;
  }

  override disconnectedCallback() {
    this.stop();
    super.disconnectedCallback();
  }

  override willUpdate(changed: Map<string, unknown>) {
    if ((changed.has('api') || changed.has('floor')) && this.api && this.floor) void this.load();
  }

  async load() {
    this.loaded = undefined;
    try {
      this.loaded = await this.api.changes(this.floor.id, REPLAY_DAYS);
    } catch (err) {
      this.loaded = err as Error;
    }
  }

  play() {
    if (this.playing) return this.stop();
    if (this.day >= REPLAY_DAYS - 1) this.day = 0;
    this.playing = true;
    this.timer = setInterval(() => {
      if (this.day >= REPLAY_DAYS - 1) return this.stop();
      this.day += 1;
    }, STEP_MS);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = undefined;
    this.playing = false;
  }

  private pick(day: number) {
    this.stop();
    this.day = Math.max(0, Math.min(REPLAY_DAYS - 1, day));
  }

  override render() {
    const f = this.floor;
    const loaded = this.loaded;
    const heading = html`<ui-heading eyebrow=${`Replay · ${f.name}`} heading="The last 30 days" summary=${loaded && !(loaded instanceof Error) ? this.summary(loaded) : ''} size="l" level="1"></ui-heading>`;
    if (loaded instanceof Error) return html`${heading}<ui-state kind="error" heading="Couldn’t see what changed" body=${loaded.message} action="Try again" @ui-action=${() => void this.load()}></ui-state>`;
    if (!loaded) return html`${heading}<ui-state kind="loading" heading="Gathering the month" size="line"></ui-state>`;
    const days = daysOf(loaded.changes);
    const picked = days[this.day]!;
    const sofar = tally(days.slice(0, this.day + 1));
    const tallest = Math.max(4, ...days.map((d) => d.changes.length));
    return html`${heading}
      <section class="ax-section" aria-labelledby="ax-replay-line">
        <h2 class="ax-label" id="ax-replay-line">Each day</h2>
        <div class="ax-replay" style=${`--tallest: ${tallest}`}>
          ${days.map(
            (d, i) => html`<button class="ax-rday ${i > this.day ? 'later' : ''} ${i === this.day ? 'picked' : ''}" aria-pressed=${i === this.day ? 'true' : 'false'}
              aria-label=${`${dayWords(d.start)}: ${d.changes.length ? `${d.changes.length} ${d.changes.length === 1 ? 'change' : 'changes'}` : 'nothing changed'}`}
              @click=${() => this.pick(i)}>
              <span class="marks">${d.changes.map((c) => html`<i class=${markOf(c)}></i>`)}</span>
            </button>`,
          )}
        </div>
        <div class="ax-scrub">
          <ui-button kind="secondary" size="sm" @click=${() => this.play()}>${this.playing ? 'Pause' : 'Play the month'}</ui-button>
          <input type="range" min="0" max=${REPLAY_DAYS - 1} .value=${String(this.day)} aria-label="Pick a day"
            aria-valuetext=${dayWords(picked.start)} @input=${(e: Event) => this.pick(Number((e.target as HTMLInputElement).value))} />
          <span class="ax-meta ax-muted when">${dayWords(picked.start, { day: 'numeric', month: 'short' })}</span>
        </div>
        <ul class="ax-key" aria-label="What the marks mean">
          <li><i class="people"></i>Someone joined or left</li>
          <li><i class="app"></i>An app turned on or off</li>
          <li><i class="blocked"></i>An app blocked</li>
          <li><i class="team"></i>A team made or renamed</li>
        </ul>
      </section>
      <section class="ax-section" aria-labelledby="ax-replay-day" aria-live="polite">
        <h2 class="ax-label" id="ax-replay-day">${this.day === REPLAY_DAYS - 1 ? 'Today' : dayWords(picked.start)}</h2>
        ${sofar.length
          ? html`<ul class="ax-tally" aria-label="By then">
              <li class="lead">By then</li>
              ${sofar.map((t) => html`<li class=${t.kind}>${t.words}</li>`)}
            </ul>`
          : nothing}
        ${picked.changes.length
          ? html`<ul class="ax-events">
              ${picked.changes.map(
                (c) => html`<li><span>${changeLine(c, loaded.names, this.appName)}</span><span>${new Date(c.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span></li>`,
              )}
            </ul>`
          : html`<p class="ax-muted ax-meta">Nothing changed on ${f.name} that day.</p>`}
      </section>
      <div class="ax-can">
        <p class="ax-label">You can</p>
        <p>Play the month, or pick a day to see what had changed by then. Nothing here changes anything: <b>an admin</b> changes who’s on ${f.name} and which apps are on. ${APP_NAME} remembers ${REPLAY_DAYS} days.</p>
      </div>`;
  }

  private summary(loaded: Changes) {
    const n = loaded.changes.length;
    if (!n) return `Nothing changed on ${this.floor.name} in the last 30 days.`;
    return `${n} ${n === 1 ? 'change' : 'changes'} on ${this.floor.name}: ${tally(daysOf(loaded.changes))
      .map((t) => t.words)
      .join(', ')}.`;
  }
}

if (!customElements.get('auspex-replay')) customElements.define('auspex-replay', AuspexReplay);

declare global {
  interface HTMLElementTagNameMap {
    'auspex-replay': AuspexReplay;
  }
}
