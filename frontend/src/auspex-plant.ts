import { LitElement, html, nothing } from 'lit';
import { ago } from '@augur/ui-kit';
import type { AuspexApi, BackupRun, Part, PlantStatus, PlantUpdates } from './api.js';
import { INSTALL_STEPS, isLive, jobLine, recent, REMOVE_STEPS, trackOf, UPGRADE_STEPS, upgradeLine, type AppJob, type Installs, type JobStep, type PlatformUpgrade, type RunnerJobs } from './jobs.js';

/** How often the plant room looks again while it's open. */
const REFRESH_MS = 30_000;
/** How often it looks while something is under way. */
const LIVE_MS = 5_000;
/** A runner that hasn't asked for work in this long is shown as quiet. */
const QUIET_MS = 2 * 60_000;
/** An answer this slow fills the meter. */
const FULL_MS = 1000;

const STATE_WORDS: Record<Part['state'], string> = { up: 'Answering', slow: 'Slow', down: 'Not answering', checking: 'Not checked yet' };

/** The parts in three rooms: the way in, the platform's services, and the apps on it. */
export const roomsOf = (parts: Part[]) => {
  const byName = (a: Part, b: Part) => a.name.localeCompare(b.name);
  return [
    { id: 'door', label: 'The way in', parts: parts.filter((p) => p.kind === 'gateway' || p.kind === 'sign-in').sort(byName) },
    { id: 'services', label: 'Services', parts: parts.filter((p) => p.kind === 'service').sort(byName) },
    { id: 'apps', label: 'Apps’ services', parts: parts.filter((p) => p.kind === 'app').sort(byName) },
  ].filter((r) => r.parts.length);
};

/** The plant room in one line: all answering, or how many need someone. */
export const plantLine = (parts: Part[]) => {
  const down = parts.filter((p) => p.state === 'down').length;
  const slow = parts.filter((p) => p.state === 'slow').length;
  if (!down && !slow) return `All ${parts.length} parts are answering.`;
  return [down ? `${down} not answering` : '', slow ? `${slow} slow` : ''].filter(Boolean).join(', ') + ` of ${parts.length} parts.`;
};

type Loaded<T> = T | Error | undefined;

/**
 * The plant room, for admins: every part AUGUR runs on as a machine with a
 * lamp (answering, slow, not answering), its version and how fast it
 * answered; the backups; and the running release against the newest one out.
 * It reads what Admin's Status and Updates read, as the person, and changes
 * nothing. Anyone else is told what it is and who can see it.
 */
export class AuspexPlant extends LitElement {
  static override properties = {
    api: { attribute: false },
    admin: { type: Boolean },
    status: { state: true },
    updates: { state: true },
    jobs: { state: true },
    installs: { state: true },
  };

  declare api: AuspexApi;
  declare admin: boolean;
  declare status: Loaded<PlantStatus>;
  declare updates: Loaded<PlantUpdates>;
  declare jobs: Loaded<RunnerJobs>;
  declare installs: Loaded<Installs>;

  private timer?: ReturnType<typeof setTimeout>;

  constructor() {
    super();
    this.admin = false;
  }

  override createRenderRoot() {
    return this;
  }

  override connectedCallback() {
    super.connectedCallback();
    this.schedule();
  }

  override disconnectedCallback() {
    clearTimeout(this.timer);
    this.timer = undefined;
    super.disconnectedCallback();
  }

  /** Looks again soon while something is under way, and every 30 seconds otherwise. */
  private schedule() {
    clearTimeout(this.timer);
    if (!this.isConnected) return;
    this.timer = setTimeout(() => void this.load().finally(() => this.schedule()), this.underWay() ? LIVE_MS : REFRESH_MS);
  }

  private underWay() {
    const updates = this.updates instanceof Error ? undefined : this.updates;
    const jobs = this.jobs instanceof Error ? undefined : this.jobs;
    return Boolean((updates?.upgrade && isLive(updates.upgrade)) || jobs?.jobs.some(isLive));
  }

  override willUpdate(changed: Map<string, unknown>) {
    if ((changed.has('api') || changed.has('admin')) && this.api && this.admin) void this.load();
  }

  async load() {
    if (!this.admin || !this.api) return;
    const [status, updates, jobs, installs] = await Promise.allSettled([this.api.status(), this.api.updates(), this.api.runnerJobs(), this.api.installs()]);
    const value = <T>(r: PromiseSettledResult<T>) => (r.status === 'fulfilled' ? r.value : (r.reason as Error));
    this.status = value(status);
    this.updates = value(updates);
    this.jobs = value(jobs);
    this.installs = value(installs);
  }

  private machine(p: Part) {
    const meter = p.latencyMs === undefined ? 0 : Math.min(1, p.latencyMs / FULL_MS);
    const when = p.checkedAt ? (ago(p.checkedAt) === 'now' ? 'just now' : `${ago(p.checkedAt)} ago`) : '';
    const line = p.problem ?? [p.latencyMs !== undefined ? `${p.latencyMs} ms` : '', when].filter(Boolean).join(', ');
    return html`<li class="ax-machine ${p.state}" aria-label=${`${p.name}: ${STATE_WORDS[p.state]}${p.version ? `, version ${p.version}` : ''}. ${line}`}>
      <span class="lamp" aria-hidden="true"></span>
      <span class="nm">${p.name}</span>
      <span class="ver">${p.version ?? '—'}</span>
      <span class="meter" aria-hidden="true"><i style=${`width: ${Math.round(meter * 100)}%`}></i></span>
      <span class="st">${STATE_WORDS[p.state]}${line ? `: ${line}` : ''}</span>
    </li>`;
  }

  private backup(label: string, run: BackupRun | undefined, missing: string) {
    const state = !run ? 'checking' : run.ok ? 'up' : 'down';
    return html`<li class="ax-machine ${state}">
      <span class="lamp" aria-hidden="true"></span>
      <span class="nm">${label}</span>
      <span class="ver">${run ? new Date(run.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '—'}</span>
      <span class="st">${!run ? missing : run.ok ? `Worked, ${ago(run.at) === 'now' ? 'just now' : `${ago(run.at)} ago`}` : (run.problem ?? 'Failed')}</span>
    </li>`;
  }

  /** A job as a line of stops from its first step to its last, lit as far as it's got. */
  private track(order: [string, string][], steps: JobStep[], label: string) {
    const stops = trackOf(order, steps);
    const words = { done: 'done', running: 'under way', failed: 'failed', waiting: 'not yet' } as const;
    return html`<ol class="ax-track" aria-label=${label}>
      ${stops.map(
        (s) => html`<li class="stop ${s.state}" aria-label=${`${s.label}: ${words[s.state]}${s.message ? `. ${s.message}` : ''}`}>
          <span class="dot" aria-hidden="true"></span><span class="lb">${s.label}</span>
        </li>`,
      )}
    </ol>`;
  }

  private nameOf(app: string) {
    const installs = this.installs instanceof Error ? undefined : this.installs;
    return installs?.installed.find((i) => i.app === app)?.name ?? app;
  }

  /** When a runner last asked for work, as a lamp: an install waits on the app runner, an upgrade on the updater. */
  private runner(label: string, seenAt: string | undefined, what: string) {
    const quiet = !seenAt || Date.now() - Date.parse(seenAt) > QUIET_MS;
    return html`<li class="ax-machine ${quiet ? 'checking' : 'up'}">
      <span class="lamp" aria-hidden="true"></span>
      <span class="nm">${label}</span>
      <span class="st">${seenAt ? `Last asked for work ${ago(seenAt) === 'now' ? 'just now' : `${ago(seenAt)} ago`}` : `Hasn’t asked for work since the registry started, so ${what} would wait.`}</span>
    </li>`;
  }

  private renderUnderWay() {
    const updates = this.updates instanceof Error ? undefined : this.updates;
    const jobs = this.jobs;
    const installs = this.installs instanceof Error ? undefined : this.installs;
    const upgrade: PlatformUpgrade | undefined = updates?.upgrade;
    const live: AppJob[] = jobs && !(jobs instanceof Error) ? jobs.jobs.filter(isLive) : [];
    const done: AppJob[] = jobs && !(jobs instanceof Error) ? recent(jobs.jobs).slice(0, 5) : [];
    const previews = (installs?.installed ?? []).flatMap((i) => (i.previews ?? []).map((p) => ({ ...p, name: i.name })));
    const upgradeLive = upgrade && isLive(upgrade);
    const upgradeDone = upgrade && !upgradeLive ? recent([upgrade]) : [];
    const lamp = (state: string) => (['done'].includes(state) ? 'up' : ['failed', 'rolled-back'].includes(state) ? 'down' : 'checking');
    return html`<section class="ax-section" aria-labelledby="ax-room-jobs" aria-live="polite">
      <h2 class="ax-label" id="ax-room-jobs">Under way</h2>
      ${upgradeLive || live.length
        ? html`<ul class="ax-jobs">
            ${upgradeLive ? html`<li class="ax-job"><p class="t1">${upgradeLine(upgrade)}</p>${this.track(UPGRADE_STEPS, upgrade.steps, upgradeLine(upgrade))}</li>` : nothing}
            ${live.map((j) => html`<li class="ax-job"><p class="t1">${jobLine(j, this.nameOf(j.app))}</p>${this.track(j.action === 'remove' ? REMOVE_STEPS : INSTALL_STEPS, j.steps, jobLine(j, this.nameOf(j.app)))}</li>`)}
          </ul>`
        : html`<p class="ax-muted ax-meta">Nothing’s being upgraded, installed or removed. It looks every 5 seconds while something is.</p>`}
      ${jobs instanceof Error ? html`<p class="ax-muted ax-meta">Couldn’t see the app runner’s jobs: ${jobs.message}</p>` : nothing}
      ${upgradeDone.length || done.length
        ? html`<ul class="ax-machines">
            ${upgradeDone.map((u) => html`<li class="ax-machine ${lamp(u.state)}"><span class="lamp" aria-hidden="true"></span><span class="nm">${upgradeLine(u)}</span><span class="st">${u.message ?? ''}${u.message ? ' · ' : ''}${ago(u.finishedAt ?? u.requestedAt)} ago</span></li>`)}
            ${done.map((j) => html`<li class="ax-machine ${lamp(j.state)}"><span class="lamp" aria-hidden="true"></span><span class="nm">${jobLine(j, this.nameOf(j.app))}</span><span class="st">${j.message ?? ''}${j.message ? ' · ' : ''}${ago(j.finishedAt ?? j.requestedAt)} ago</span></li>`)}
          </ul>`
        : nothing}
      ${previews.length
        ? html`<p class="ax-label">Previews running</p>
            <ul class="ax-tally">${previews.map((p) => html`<li class="app">${p.name}, pull request ${p.pr} · until ${new Date(p.endsAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</li>`)}</ul>`
        : nothing}
      <ul class="ax-machines">
        ${updates ? this.runner('Updater', updates.updaterSeenAt, 'an upgrade asked for in Admin') : nothing}
        ${jobs && !(jobs instanceof Error) ? this.runner('App runner', jobs.runnerSeenAt, 'an install asked for in Admin') : nothing}
      </ul>
    </section>`;
  }

  private renderRelease(updates: Loaded<PlantUpdates>) {
    if (updates instanceof Error) return html`<p class="ax-muted ax-meta">Couldn’t see which release is running: ${updates.message}</p>`;
    if (!updates) return nothing;
    const next = updates.available;
    return html`<div class="ax-release" aria-label=${next ? `AUGUR ${updates.running.version} is running; ${next.version} is out.` : `AUGUR ${updates.running.version} is running, the newest on ${updates.running.channel}.`}>
      <span class="ver now"><span class="ax-label">Running</span>${updates.running.version}</span>
      ${next
        ? html`<span class="arrow" aria-hidden="true"><ui-icon name="arrow" size="18"></ui-icon></span>
            <span class="ver out"><span class="ax-label">Out</span>${next.version}</span>`
        : html`<span class="ax-muted ax-meta">${updates.feed === 'off' ? 'This server doesn’t look for new releases.' : `The newest on ${updates.running.channel}.`}</span>`}
      ${next && updates.needsYou.length ? html`<span class="ax-muted ax-meta">${updates.needsYou.length} ${updates.needsYou.length === 1 ? 'thing needs' : 'things need'} you first</span>` : nothing}
    </div>`;
  }

  override render() {
    const heading = (summary: string) => html`<div class="ax-hero">
      <span class="ax-orb plant" aria-hidden="true"><ui-icon name="server" size="28"></ui-icon></span>
      <ui-heading eyebrow="Plant room" heading="What AUGUR runs on" summary=${summary} size="l" level="1"></ui-heading>
    </div>`;
    if (!this.admin)
      return html`${heading('Each part of AUGUR, whether it’s answering, and which version is running.')}
        <ui-state kind="empty" heading="The plant room is for admins" body="It shows the machinery under every floor, which is an admin’s to look after. If something seems down, tell an admin."></ui-state>`;
    const status = this.status;
    if (status instanceof Error) return html`${heading('')}<ui-state kind="error" heading="Couldn’t see the plant room" body=${status.message} action="Try again" @ui-action=${() => void this.load()}></ui-state>`;
    if (!status) return html`${heading('')}<ui-state kind="loading" heading="Checking each part" size="line"></ui-state>`;
    const parts = status.components;
    const backups = status.backups;
    return html`${heading(plantLine(parts))}
      ${this.renderRelease(this.updates)}
      ${this.renderUnderWay()}
      ${roomsOf(parts).map(
        (room) => html`<section class="ax-section" aria-labelledby=${`ax-room-${room.id}`}>
          <h2 class="ax-label" id=${`ax-room-${room.id}`}>${room.label}</h2>
          <ul class="ax-machines">${room.parts.map((p) => this.machine(p))}</ul>
        </section>`,
      )}
      <section class="ax-section" aria-labelledby="ax-room-backups">
        <h2 class="ax-label" id="ax-room-backups">Backups</h2>
        ${backups
          ? html`<ul class="ax-machines">
              ${this.backup('Last backup', backups.lastBackup, 'None yet')} ${this.backup('Last restore test', backups.lastRestoreTest, 'None yet: it runs weekly')}
            </ul>
            ${backups.problem ? html`<p class="ax-meta">${backups.problem}</p>` : nothing}`
          : html`<p class="ax-muted ax-meta">Not shown: the gateway isn’t told where backups are kept (see docs/deploy.md).</p>`}
      </section>
      <div class="ax-can">
        <p class="ax-label">You can</p>
        <p>Watch it here: it looks again every 30 seconds, and every 5 while something is under way. Nothing here changes anything. To upgrade, install an app, or see each check in full, open <b>Admin</b>, then Status, Updates or Apps.</p>
      </div>`;
  }
}

if (!customElements.get('auspex-plant')) customElements.define('auspex-plant', AuspexPlant);

declare global {
  interface HTMLElementTagNameMap {
    'auspex-plant': AuspexPlant;
  }
}
