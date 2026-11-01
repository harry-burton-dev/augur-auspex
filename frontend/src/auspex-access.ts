import { LitElement, html, nothing } from 'lit';
import type { AuspexApi, PersonMap } from './api.js';
import { explain, upWords, type AccessExplain, type Explained } from './access.js';
import { styles } from './styles.js';

const LEVEL_WORDS = { read: 'Can read', edit: 'Can edit', manage: 'Can manage' } as const;
const dateOf = (at?: string) => (at && !Number.isNaN(Date.parse(at)) ? new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '');

/**
 * Who can open one thing, asked from the app it belongs to (`access.explain`),
 * over that app: each person or team with how many people that is, how it
 * reaches them and since when; who's left out; and where a change is made and
 * whether this person may make it. Nothing on it changes anything; Esc goes back.
 *
 * @fires auspex-done - back to the app that asked
 */
export class AuspexAccess extends LitElement {
  static override properties = {
    api: { attribute: false },
    ask: { attribute: false },
    appName: { type: String, attribute: 'app-name' },
    map: { state: true },
    failure: { state: true },
  };

  declare api: AuspexApi;
  declare ask: AccessExplain;
  /** The app that asked, by the name people know it by. */
  declare appName: string;
  declare map: PersonMap | undefined;
  declare failure: string;

  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this.done();
  };

  constructor() {
    super();
    this.appName = '';
    this.failure = '';
  }

  override createRenderRoot() {
    return this;
  }

  override connectedCallback() {
    super.connectedCallback();
    window.addEventListener('keydown', this.onKey);
  }

  override disconnectedCallback() {
    window.removeEventListener('keydown', this.onKey);
    super.disconnectedCallback();
  }

  override willUpdate(changed: Map<string, unknown>) {
    if (changed.has('api') && this.api) void this.load();
  }

  async load() {
    this.failure = '';
    try {
      this.map = await this.api.map();
    } catch (err) {
      this.failure = (err as Error).message;
    }
  }

  private done() {
    this.dispatchEvent(new CustomEvent('auspex-done', { bubbles: true }));
  }

  private row(e: Explained) {
    const icon = e.kind === 'person' ? 'person' : e.kind === 'org' ? 'org' : 'people';
    const orb = e.kind === 'person' ? 'personal' : e.kind === 'org' ? 'org' : 'team';
    const count = e.people === undefined ? (e.kind === 'person' ? '' : 'You’re not on it, so its size isn’t shown') : `${e.people} ${e.people === 1 ? 'person' : 'people'}`;
    const line = [count, e.via, e.since ? `since ${dateOf(e.since)}` : ''].filter(Boolean).join(' · ');
    return html`<li class="ax-who">
      <span class="ax-orb ${orb} sm" aria-hidden="true"><ui-icon name=${icon} size="18"></ui-icon></span>
      <span class="txt"><span class="t1">${e.who}</span><span class="t2">${line}</span>${upWords(e) ? html`<span class="t2">${upWords(e)}</span>` : nothing}</span>
      ${e.level ? html`<span class="lvl">${LEVEL_WORDS[e.level]}</span>` : nothing}
    </li>`;
  }

  override render() {
    const ask = this.ask;
    const body = () => {
      if (this.failure) return html`<ui-state kind="error" heading="Couldn’t work out who that is" body=${this.failure} action="Try again" @ui-action=${() => void this.load()}></ui-state>`;
      if (!this.map) return html`<ui-state kind="loading" heading="Working out who can open it"></ui-state>`;
      const { entries, people, atLeast, org } = explain(ask, this.map);
      const summary = !org
        ? `Everyone at ${this.map.floors.find((f) => f.kind === 'org')?.name ?? 'the organisation'} can open it.`
        : `${atLeast ? 'At least ' : ''}${people} ${people === 1 ? 'person' : 'people'} can open it.`;
      const where = ask.change?.where;
      return html`<ui-heading eyebrow="Who can open this" heading=${ask.thing.title} summary=${summary} level="1"></ui-heading>
        <ul class="ax-whos">
          ${entries.map((e) => this.row(e))}
          ${org
            ? html`<li class="ax-who out">
                <span class="ax-orb closed sm" aria-hidden="true"><ui-icon name="lock" size="18"></ui-icon></span>
                <span class="txt"><span class="t1">Everyone else at ${org.name}</span><span class="t2">Can’t open it</span></span>
              </li>`
            : nothing}
        </ul>
        <div class="ax-can">
          <p class="ax-label">You can</p>
          <p>
            ${where
              ? ask.change?.allowed
                ? html`Change who can open it in <b>${where}</b>, because you manage it.`
                : html`See it here. Only whoever manages it can change who can open it, in <b>${where}</b>.`
              : 'See it here. Nothing here changes who can open it.'}
          </p>
          <div class="acts"><ui-button kind="secondary" size="sm" @click=${() => this.done()}>Back to ${this.appName || 'the app'}</ui-button></div>
        </div>`;
    };
    return html`${styles}<div class="ax-stage glance"><div class="ax-pane">${ask ? body() : nothing}</div></div>`;
  }
}

if (!customElements.get('auspex-access')) customElements.define('auspex-access', AuspexAccess);

declare global {
  interface HTMLElementTagNameMap {
    'auspex-access': AuspexAccess;
  }
}
