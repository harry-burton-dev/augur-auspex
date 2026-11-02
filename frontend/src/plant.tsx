import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Heading, Icon, State, relativeTime } from '@augur/app-kit';
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
const got = <T,>(x: Loaded<T>) => (x instanceof Error ? undefined : x);

interface Looked {
  status: Loaded<PlantStatus>;
  updates: Loaded<PlantUpdates>;
  jobs: Loaded<RunnerJobs>;
  installs: Loaded<Installs>;
}

const underWay = (l: Looked) => {
  const updates = got(l.updates);
  const jobs = got(l.jobs);
  return Boolean((updates?.upgrade && isLive(updates.upgrade)) || jobs?.jobs.some(isLive));
};

const lampOf = (state: string) => (state === 'done' ? 'up' : ['failed', 'rolled-back'].includes(state) ? 'down' : 'checking');

/** A job as a line of stops from its first step to its last, lit as far as it's got. */
const Track = ({ order, steps, label }: { order: [string, string][]; steps: JobStep[]; label: string }) => {
  const words = { done: 'done', running: 'under way', failed: 'failed', waiting: 'not yet' } as const;
  return (
    <ol className="ax-track" aria-label={label}>
      {trackOf(order, steps).map((s) => (
        <li key={s.label} className={`stop ${s.state}`} aria-label={`${s.label}: ${words[s.state]}${s.message ? `. ${s.message}` : ''}`}>
          <span className="dot" aria-hidden="true" />
          <span className="lb">{s.label}</span>
        </li>
      ))}
    </ol>
  );
};

const Machine = ({ state, name, version, meter, line, label }: { state: string; name: string; version?: ReactNode; meter?: number; line: ReactNode; label?: string }) => (
  <li className={`ax-machine ${state}`} aria-label={label}>
    <span className="lamp" aria-hidden="true" />
    <span className="nm">{name}</span>
    {version !== undefined ? <span className="ver">{version}</span> : null}
    {meter !== undefined ? (
      <span className="meter" aria-hidden="true">
        <i style={{ width: `${Math.round(meter * 100)}%` }} />
      </span>
    ) : null}
    <span className="st">{line}</span>
  </li>
);

/**
 * The plant room, for admins: every part AUGUR runs on as a machine with a
 * lamp (answering, slow, not answering), its version and how fast it
 * answered; the backups; and the running release against the newest one out.
 * It reads what Admin's Status and Updates read, as the person, and changes
 * nothing. Anyone else is told what it is and who can see it.
 */
export function Plant({ api, admin }: { api: AuspexApi; admin: boolean }) {
  const [looked, setLooked] = useState<Looked>({ status: undefined, updates: undefined, jobs: undefined, installs: undefined });
  const live = useRef(true);

  const load = useCallback(async () => {
    const [status, updates, jobs, installs] = await Promise.allSettled([api.status(), api.updates(), api.runnerJobs(), api.installs()]);
    const value = <T,>(r: PromiseSettledResult<T>) => (r.status === 'fulfilled' ? r.value : (r.reason as Error));
    const next = { status: value(status), updates: value(updates), jobs: value(jobs), installs: value(installs) };
    if (live.current) setLooked(next);
    return next;
  }, [api]);

  // Looks again soon while something is under way, and every 30 seconds otherwise.
  useEffect(() => {
    if (!admin) return;
    live.current = true;
    let timer: ReturnType<typeof setTimeout>;
    const again = (l: Looked) => {
      if (live.current) timer = setTimeout(() => void load().then(again), underWay(l) ? LIVE_MS : REFRESH_MS);
    };
    void load().then(again);
    return () => {
      live.current = false;
      clearTimeout(timer);
    };
  }, [admin, load]);

  const head = (summary: string) => (
    <div className="ax-hero">
      <span className="ax-orb plant" aria-hidden="true">
        <Icon name="server" size={28} />
      </span>
      <Heading eyebrow="Plant room" heading="What AUGUR runs on" summary={summary || undefined} size="l" level={1} />
    </div>
  );
  if (!admin)
    return (
      <div className="ax-plant">
        {head('Each part of AUGUR, whether it’s answering, and which version is running.')}
        <State heading="The plant room is for admins" body="It shows the machinery under every floor, which is an admin’s to look after. If something seems down, tell an admin." />
      </div>
    );
  const { status, updates, jobs } = looked;
  if (status instanceof Error)
    return (
      <div className="ax-plant">
        {head('')}
        <State kind="error" heading="Couldn’t see the plant room" body={status.message} action="Try again" onAction={() => void load()} />
      </div>
    );
  if (!status)
    return (
      <div className="ax-plant">
        {head('')}
        <State kind="loading" heading="Checking each part" size="line" />
      </div>
    );

  const installs = got(looked.installs);
  const nameOf = (app: string) => installs?.installed.find((i) => i.app === app)?.name ?? app;
  const since = (at: string) => relativeTime(at);
  const runner = (label: string, seenAt: string | undefined, what: string) => {
    const quiet = !seenAt || Date.now() - Date.parse(seenAt) > QUIET_MS;
    return <Machine state={quiet ? 'checking' : 'up'} name={label} line={seenAt ? `Last asked for work ${since(seenAt)}` : `Hasn’t asked for work since the registry started, so ${what} would wait.`} />;
  };
  const machine = (p: Part) => {
    const meter = p.latencyMs === undefined ? 0 : Math.min(1, p.latencyMs / FULL_MS);
    const line = p.problem ?? [p.latencyMs !== undefined ? `${p.latencyMs} ms` : '', p.checkedAt ? since(p.checkedAt) : ''].filter(Boolean).join(', ');
    return (
      <Machine
        key={p.name}
        state={p.state}
        name={p.name}
        version={p.version ?? '—'}
        meter={meter}
        line={`${STATE_WORDS[p.state]}${line ? `: ${line}` : ''}`}
        label={`${p.name}: ${STATE_WORDS[p.state]}${p.version ? `, version ${p.version}` : ''}. ${line}`}
      />
    );
  };
  const backup = (label: string, run: BackupRun | undefined, missing: string) => (
    <Machine
      state={!run ? 'checking' : run.ok ? 'up' : 'down'}
      name={label}
      version={run ? new Date(run.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '—'}
      line={!run ? missing : run.ok ? `Worked, ${since(run.at)}` : (run.problem ?? 'Failed')}
    />
  );

  const ups = got(updates);
  const upgrade: PlatformUpgrade | undefined = ups?.upgrade;
  const allJobs = got(jobs)?.jobs ?? [];
  const liveJobs: AppJob[] = allJobs.filter(isLive);
  const done: AppJob[] = recent(allJobs).slice(0, 5);
  const previews = (installs?.installed ?? []).flatMap((i) => (i.previews ?? []).map((p) => ({ ...p, name: i.name })));
  const upgradeLive = upgrade && isLive(upgrade);
  const upgradeDone = upgrade && !upgradeLive ? recent([upgrade]) : [];
  const next = ups?.available;

  return (
    <div className="ax-plant">
      {head(plantLine(status.components))}
      {updates instanceof Error ? (
        <p className="ax-muted ax-meta">Couldn’t see which release is running: {updates.message}</p>
      ) : ups ? (
        <div className="ax-release" aria-label={next ? `AUGUR ${ups.running.version} is running; ${next.version} is out.` : `AUGUR ${ups.running.version} is running, the newest on ${ups.running.channel}.`}>
          <span className="ver now">
            <span className="ax-label">Running</span>
            {ups.running.version}
          </span>
          {next ? (
            <>
              <span className="arrow" aria-hidden="true">
                <Icon name="arrow" size={18} />
              </span>
              <span className="ver out">
                <span className="ax-label">Out</span>
                {next.version}
              </span>
            </>
          ) : (
            <span className="ax-muted ax-meta">{ups.feed === 'off' ? 'This server doesn’t look for new releases.' : `The newest on ${ups.running.channel}.`}</span>
          )}
          {next && ups.needsYou.length ? (
            <span className="ax-muted ax-meta">
              {ups.needsYou.length} {ups.needsYou.length === 1 ? 'thing needs' : 'things need'} you first
            </span>
          ) : null}
        </div>
      ) : null}
      <section className="ax-section" aria-labelledby="ax-room-jobs" aria-live="polite">
        <h2 className="ax-label" id="ax-room-jobs">
          Under way
        </h2>
        {upgradeLive || liveJobs.length ? (
          <ul className="ax-jobs">
            {upgradeLive ? (
              <li className="ax-job">
                <p className="t1">{upgradeLine(upgrade)}</p>
                <Track order={UPGRADE_STEPS} steps={upgrade.steps} label={upgradeLine(upgrade)} />
              </li>
            ) : null}
            {liveJobs.map((j) => (
              <li key={j.id} className="ax-job">
                <p className="t1">{jobLine(j, nameOf(j.app))}</p>
                <Track order={j.action === 'remove' ? REMOVE_STEPS : INSTALL_STEPS} steps={j.steps} label={jobLine(j, nameOf(j.app))} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="ax-muted ax-meta">Nothing’s being upgraded, installed or removed. It looks every 5 seconds while something is.</p>
        )}
        {jobs instanceof Error ? <p className="ax-muted ax-meta">Couldn’t see the app runner’s jobs: {jobs.message}</p> : null}
        {upgradeDone.length || done.length ? (
          <ul className="ax-machines">
            {upgradeDone.map((u) => (
              <Machine key={u.id} state={lampOf(u.state)} name={upgradeLine(u)} line={`${u.message ?? ''}${u.message ? ' · ' : ''}${since(u.finishedAt ?? u.requestedAt)}`} />
            ))}
            {done.map((j) => (
              <Machine key={j.id} state={lampOf(j.state)} name={jobLine(j, nameOf(j.app))} line={`${j.message ?? ''}${j.message ? ' · ' : ''}${since(j.finishedAt ?? j.requestedAt)}`} />
            ))}
          </ul>
        ) : null}
        {previews.length ? (
          <>
            <p className="ax-label">Previews running</p>
            <ul className="ax-tally">
              {previews.map((p) => (
                <li key={`${p.name}-${p.pr}`} className="app">
                  {p.name}, pull request {p.pr} · until {new Date(p.endsAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                </li>
              ))}
            </ul>
          </>
        ) : null}
        <ul className="ax-machines">
          {ups ? runner('Updater', ups.updaterSeenAt, 'an upgrade asked for in Admin') : null}
          {got(jobs) ? runner('App runner', got(jobs)!.runnerSeenAt, 'an install asked for in Admin') : null}
        </ul>
      </section>
      {roomsOf(status.components).map((room) => (
        <section key={room.id} className="ax-section" aria-labelledby={`ax-room-${room.id}`}>
          <h2 className="ax-label" id={`ax-room-${room.id}`}>
            {room.label}
          </h2>
          <ul className="ax-machines">{room.parts.map(machine)}</ul>
        </section>
      ))}
      <section className="ax-section" aria-labelledby="ax-room-backups">
        <h2 className="ax-label" id="ax-room-backups">
          Backups
        </h2>
        {status.backups ? (
          <>
            <ul className="ax-machines">
              {backup('Last backup', status.backups.lastBackup, 'None yet')}
              {backup('Last restore test', status.backups.lastRestoreTest, 'None yet: it runs weekly')}
            </ul>
            {status.backups.problem ? <p className="ax-meta">{status.backups.problem}</p> : null}
          </>
        ) : (
          <p className="ax-muted ax-meta">Not shown: the gateway isn’t told where backups are kept (see docs/deploy.md).</p>
        )}
      </section>
      <div className="ax-can">
        <p className="ax-label">You can</p>
        <p>
          Watch it here: it looks again every 30 seconds, and every 5 while something is under way. Nothing here changes anything. To upgrade, install an app, or see each check in full, open <b>Admin</b>, then Status,
          Updates or Apps.
        </p>
      </div>
    </div>
  );
}
