import { LitElement, html, nothing, svg } from 'lit';
import { icons } from '@augur/ui-kit';
import type { PersonMap } from './api.js';
import { layoutMap, linkPath, type MapNode } from './layout.js';

/**
 * The org as a map: the org on the left, the teams inside it to the right,
 * your way in lit up in the floor colours and the floor you're on ringed.
 * Teams you see into are rings; closed ones are small marks that still say
 * their name. Every mark is a link (Enter or a click) to that floor.
 *
 * @fires auspex-floor - detail `{ id: string }`, a floor or closed team chosen
 */
export class AuspexMap extends LitElement {
  static override properties = {
    map: { attribute: false },
    here: { type: String },
    reasons: { attribute: false },
  };

  declare map: PersonMap | undefined;
  declare here: string;
  /** The line under each name: why they can go there, or who to ask. */
  declare reasons: Map<string, string>;

  constructor() {
    super();
    this.here = '';
    this.reasons = new Map();
  }

  override createRenderRoot() {
    return this;
  }

  private choose(id: string) {
    this.dispatchEvent(new CustomEvent('auspex-floor', { detail: { id }, bubbles: true }));
  }

  private onKey(e: KeyboardEvent, id: string) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    this.choose(id);
  }

  private node(n: MapNode) {
    const r = n.kind === 'org' ? 14 : n.reach === 'closed' ? 5 : 10;
    const why = this.reasons.get(n.id) ?? '';
    const folded = n.folded ? ` and ${n.folded} ${n.folded === 1 ? 'team' : 'teams'} inside` : '';
    const label = `${n.name}${folded}. ${n.reach === 'closed' ? 'Closed to you. ' : ''}${why}`;
    return svg`<g class="node ${n.kind} ${n.reach} ${n.here ? 'here' : ''}" transform="translate(${n.x},${n.y})" tabindex="0" role="link" aria-label=${label}
        @click=${() => this.choose(n.id)} @keydown=${(e: KeyboardEvent) => this.onKey(e, n.id)}>
      <circle class="hit" r="24"></circle>
      ${n.here ? svg`<circle class="halo" r=${r + 9}></circle><circle class="halo ping" r=${r + 9}></circle>` : nothing}
      <circle class="mark" r=${r}></circle>
      ${n.reach === 'closed' ? svg`<g class="lock" transform="translate(${r + 7},-6.5) scale(0.5)">${icons.lock}</g>` : nothing}
      <text class="name" x=${n.reach === 'closed' ? r + 26 : r + 12} y="-1">${n.name}${n.folded ? svg`<tspan class="folded"> +${n.folded}</tspan>` : nothing}</text>
      <text class="why" x=${r + 12} y="17">${why}</text>
    </g>`;
  }

  override render() {
    const laid = this.map ? layoutMap(this.map, this.here) : undefined;
    if (!laid) return nothing;
    return html`<svg class="auspex-map" viewBox="0 0 ${laid.width} ${laid.height}" style="max-width:${laid.width}px" role="group" aria-label="Your organisation, the org on the left and the teams inside it to the right">
      <defs>
        <radialGradient id="auspex-org" cx="35%" cy="30%"><stop offset="0" stop-color="var(--floor-org-high)"></stop><stop offset="1" stop-color="var(--floor-org-low)"></stop></radialGradient>
        <radialGradient id="auspex-team" cx="35%" cy="30%"><stop offset="0" stop-color="var(--floor-team-high)"></stop><stop offset="1" stop-color="var(--floor-team-low)"></stop></radialGradient>
      </defs>
      ${laid.links.map((l) => svg`<path class="link ${l.lit ? 'lit' : ''} ${l.to.reach}" d=${linkPath(l)}></path>`)}
      ${laid.nodes.map((n) => this.node(n))}
    </svg>`;
  }
}

if (!customElements.get('auspex-map')) customElements.define('auspex-map', AuspexMap);

declare global {
  interface HTMLElementTagNameMap {
    'auspex-map': AuspexMap;
  }
}
