import { LitElement, html, nothing } from 'lit';
import type { Fact } from '@augur/ui-kit';
import { usable, type AuspexApi, type MapFloor, type PersonMap } from './api.js';
import { styles } from './styles.js';
import { whyHere } from './words.js';

/**
 * Auspex's card on Home, on a team's floor or the org's: the way up from
 * here to the org as a line of floor marks, why you're here, and three facts.
 * One quiet button opens the map.
 *
 * @fires auspex-open - to open Auspex at `detail.path`
 */
export class AuspexGlance extends LitElement {
  static override properties = {
    api: { attribute: false },
    here: { type: String },
    map: { state: true },
    facts: { state: true },
    failure: { state: true },
  };

  declare api: AuspexApi;
  declare here: string;
  declare map: PersonMap | undefined;
  declare facts: Fact[] | undefined;
  declare failure: string;

  constructor() {
    super();
    this.here = '';
    this.failure = '';
  }

  override createRenderRoot() {
    return this;
  }

  override willUpdate(changed: Map<string, unknown>) {
    if (changed.has('api') && this.api) void this.load();
  }

  async load() {
    this.failure = '';
    try {
      const [map, apps, changes] = await Promise.all([this.api.map(), this.api.apps(this.here), this.api.changes(this.here)]);
      this.map = map;
      const floor = map.floors.find((f) => f.id === this.here);
      this.facts = [
        { value: floor?.people ?? 0, label: 'People here' },
        { value: apps.filter(usable).length, label: 'Apps you can use' },
        { value: changes.changes.length, label: 'Changes this week' },
      ];
    } catch (err) {
      this.failure = (err as Error).message;
    }
  }

  private open(path: string) {
    this.dispatchEvent(new CustomEvent('auspex-open', { detail: { path }, bubbles: true }));
  }

  /** From the org down to here. */
  private climb(map: PersonMap, here: MapFloor) {
    const byId = new Map(map.floors.map((f) => [f.id, f]));
    const chain: MapFloor[] = [];
    for (let at: MapFloor | undefined = here; at; at = at.parentId ? byId.get(at.parentId) : undefined) chain.unshift(at);
    return chain;
  }

  override render() {
    if (this.failure) return html`<ui-state kind="error" heading="Couldn’t reach Auspex" body=${this.failure} action="Try again" @ui-action=${() => void this.load()}></ui-state>`;
    const map = this.map;
    const here = map?.floors.find((f) => f.id === this.here);
    if (!map || !here || !this.facts) return html`<ui-facts loading count="3"></ui-facts>`;
    const org = map.floors.find((f) => f.kind === 'org');
    const chain = this.climb(map, here);
    const parent = chain.length > 1 ? chain[chain.length - 2] : undefined;
    return html`${styles}<div class="ax-climb" role="img" aria-label=${`From ${chain.map((f) => f.name).join(' to ')}`}>
        ${chain.map(
          (f, i) => html`${i ? html`<span class="bar"></span>` : nothing}<span
              class="step"
              style=${`background: radial-gradient(circle at 35% 30%, var(--floor-${f.kind === 'org' ? 'org' : 'team'}-high), var(--floor-${f.kind === 'org' ? 'org' : 'team'}-low));${f.id === this.here ? ' box-shadow: 0 0 0 2px var(--slate-deep), 0 0 0 4px var(--green);' : ''}`}
            ></span>`,
        )}
      </div>
      <p style="margin:0;font-size:var(--type-meta);line-height:var(--leading-meta)">
        ${here.name}${parent ? html`<span class="ax-muted"> · inside ${parent.name}</span>` : nothing}<br /><span class="ax-muted">${whyHere(here, org?.name ?? 'the organisation')}.</span>
      </p>
      <ui-facts .items=${this.facts}></ui-facts>
      <div><ui-button kind="secondary" size="sm" @click=${() => this.open('/')}>Where you are</ui-button></div>`;
  }
}

if (!customElements.get('auspex-glance')) customElements.define('auspex-glance', AuspexGlance);

declare global {
  interface HTMLElementTagNameMap {
    'auspex-glance': AuspexGlance;
  }
}
