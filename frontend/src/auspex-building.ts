import { LitElement, html, nothing, svg } from 'lit';
import { icons } from '@augur/ui-kit';
import type { PersonMap } from './api.js';
import { layoutCutaway, STOREY, type Room } from './cutaway.js';

/** The ground storey: everyone's own floor, as doors. */
const GROUND = 64;
/** The basement: the plant room, for admins. */
const BASEMENT = 60;
/** At most this many doors are drawn; past it, the count says how many. */
const DOORS = 48;

/** About how many characters fit across a room, for its name. */
const fits = (width: number) => Math.max(0, Math.floor((width - 16) / 7.5));
const clip = (text: string, n: number) => (text.length <= n ? text : n > 2 ? `${text.slice(0, n - 1)}…` : '');

/**
 * The org as a building in cross-section (see cutaway.ts): the org the roof,
 * teams as rooms above the teams inside them, everyone's own floor as doors
 * along the ground, and your way up lit as stairs. Rooms you stand on are
 * filled in the team colour, ones you see into are dashed, and closed ones
 * are outlines that still say their name. For admins, the plant room sits
 * underneath. Every room is a link (Enter or a click).
 *
 * @fires auspex-floor - detail `{ id: string }`, a room chosen
 * @fires auspex-plant - the plant room chosen
 */
export class AuspexBuilding extends LitElement {
  static override properties = {
    map: { attribute: false },
    here: { type: String },
    admin: { type: Boolean },
    plant: { type: String },
    plantState: { type: String, attribute: 'plant-state' },
  };

  declare map: PersonMap | undefined;
  declare here: string;
  declare admin: boolean;
  /** The plant room in a line, for the basement: "All 9 parts are answering." */
  declare plant: string;
  /** Its lamp: up, slow, down or checking. */
  declare plantState: string;

  constructor() {
    super();
    this.here = '';
    this.admin = false;
    this.plant = '';
    this.plantState = 'checking';
  }

  override createRenderRoot() {
    return this;
  }

  private choose(id: string) {
    this.dispatchEvent(new CustomEvent('auspex-floor', { detail: { id }, bubbles: true }));
  }

  private link(go: () => void) {
    return (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      go();
    };
  }

  private room(r: Room) {
    const reach = r.reach === 'closed' ? 'Closed to you.' : r.reach === 'see' ? 'You can see in.' : 'You can go here.';
    const count = r.people !== undefined ? `${r.people} ${r.people === 1 ? 'person' : 'people'}` : '';
    const label = [r.kind === 'org' ? `${r.name}, the whole org.` : `${r.name}.`, reach, count ? `${count}.` : '', r.here ? 'You’re here.' : '', r.lit && r.kind === 'team' && !r.here ? 'On your way up.' : ''].filter(Boolean).join(' ');
    const n = fits(r.width);
    const go = () => this.choose(r.id);
    if (r.kind === 'org') {
      const mid = r.x + r.width / 2;
      return svg`<g class="room org ${r.here ? 'here' : ''}" tabindex="0" role="link" aria-label=${label} @click=${go} @keydown=${this.link(go)}>
        <polygon class="roof" points="${r.x + 2},${STOREY - 4} ${r.x + r.width - 2},${STOREY - 4} ${mid + r.width * 0.36},${10} ${mid - r.width * 0.36},${10}"></polygon>
        <text class="nm" x=${mid} y=${STOREY / 2 + 2} text-anchor="middle">${r.name}</text>
        ${count ? svg`<text class="ct" x=${mid} y=${STOREY / 2 + 20} text-anchor="middle">${count}</text>` : nothing}
      </g>`;
    }
    const x = r.x + 3;
    const y = r.y + 3;
    const w = r.width - 6;
    const h = r.height - 6;
    return svg`<g class="room team ${r.reach} ${r.lit ? 'lit' : ''} ${r.here ? 'here' : ''}" tabindex="0" role="link" aria-label=${label} @click=${go} @keydown=${this.link(go)}>
      <rect class="wall" x=${x} y=${y} width=${Math.max(0, w)} height=${Math.max(0, h)} rx="6"></rect>
      ${n ? svg`<text class="nm" x=${x + 10} y=${y + 24}>${clip(r.name, n)}</text>` : nothing}
      ${r.reach === 'closed' && w > 30 ? svg`<g class="lock" transform="translate(${x + w - 20},${y + 9}) scale(0.5)">${icons.lock}</g>` : nothing}
      ${count && n > 6 ? svg`<text class="ct" x=${x + 10} y=${y + 44}>${clip(count, n)}</text>` : nothing}
    </g>`;
  }

  /** A staircase up one column, from the ground to the roof. */
  private stair(x: number, bottom: number, top: number) {
    const rise = 12;
    let d = `M ${x - 6} ${bottom}`;
    for (let y = bottom, left = true; y - rise > top; y -= rise, left = !left) d += ` L ${left ? x - 6 : x + 6} ${y - rise} L ${left ? x + 6 : x - 6} ${y - rise}`;
    return svg`<path class="stair" d=${d}></path>`;
  }

  override render() {
    const map = this.map;
    const laid = map ? layoutCutaway(map, this.here) : undefined;
    if (!map || !laid) return nothing;
    const org = map.floors.find((f) => f.kind === 'org')!;
    const own = map.floors.find((f) => f.kind === 'personal');
    const height = laid.ground + GROUND + (this.admin ? BASEMENT : 0) + 4;
    const people = org.people;
    const shown = Math.min(DOORS, Math.max(1, people));
    const pitch = laid.width / shown;
    // Your door sits at the foot of your first stair, or in the middle.
    const yours = laid.stairs[0]?.x ?? laid.width / 2;
    const yourDoor = Math.min(shown - 1, Math.floor(yours / pitch));
    const doorY = laid.ground + 18;
    const goOwn = () => own && this.choose(own.id);
    const goPlant = () => this.dispatchEvent(new CustomEvent('auspex-plant', { bubbles: true }));
    return html`<svg class="auspex-building" viewBox="-4 0 ${laid.width + 8} ${height}" role="group" aria-label="Your organisation as a building: the org is the roof, each team a room above the teams inside it, and everyone’s own floor along the ground">
      <defs>
        <linearGradient id="auspex-room" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--floor-team-high)"></stop><stop offset="1" stop-color="var(--floor-team-low)"></stop></linearGradient>
        <linearGradient id="auspex-roof" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--floor-org-high)"></stop><stop offset="1" stop-color="var(--floor-org-low)"></stop></linearGradient>
        <linearGradient id="auspex-door" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--floor-you-high)"></stop><stop offset="1" stop-color="var(--floor-you-low)"></stop></linearGradient>
      </defs>
      ${laid.rooms.map((r) => this.room(r))}
      ${laid.stairs.map((s) => this.stair(s.x, s.bottom, STOREY - 4))}
      <line class="slab" x1="0" x2=${laid.width} y1=${laid.ground} y2=${laid.ground}></line>
      <g class="ground" aria-hidden="true">
        ${Array.from({ length: shown }, (_, i) => (i === yourDoor ? nothing : svg`<rect class="door" x=${i * pitch + pitch / 2 - 5} y=${doorY} width="10" height="22" rx="2"></rect>`))}
      </g>
      ${own
        ? svg`<g class="room door-yours" tabindex="0" role="link" aria-label=${`Your own floor. Only you can go in, and nobody else’s opens for you, admins included. ${people} ${people === 1 ? 'person has' : 'people have'} one.`} @click=${goOwn} @keydown=${this.link(goOwn)}>
            <rect class="door mine" x=${yourDoor * pitch + pitch / 2 - 7} y=${doorY - 4} width="14" height="26" rx="3"></rect>
          </g>`
        : nothing}
      <text class="ground-label" x="0" y=${laid.ground + GROUND - 6}>${people > shown ? `Everyone’s own floor · ${people} doors, ${shown} drawn` : 'Everyone’s own floor'} · only yours opens</text>
      ${this.admin
        ? svg`<g class="basement ${this.plantState}" tabindex="0" role="link" aria-label=${`The plant room. ${this.plant}`} @click=${goPlant} @keydown=${this.link(goPlant)}>
            <rect x="0" y=${laid.ground + GROUND + 4} width=${laid.width} height=${BASEMENT - 8} rx="8"></rect>
            <circle class="lamp" cx="22" cy=${laid.ground + GROUND + 4 + (BASEMENT - 8) / 2} r="5"></circle>
            <text class="nm" x="38" y=${laid.ground + GROUND + 4 + (BASEMENT - 8) / 2 + 5}>Plant room <tspan class="ct">${this.plant}</tspan></text>
          </g>`
        : nothing}
    </svg>`;
  }
}

if (!customElements.get('auspex-building')) customElements.define('auspex-building', AuspexBuilding);

declare global {
  interface HTMLElementTagNameMap {
    'auspex-building': AuspexBuilding;
  }
}
