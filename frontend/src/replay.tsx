import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Button, Heading, State } from '@augur/app-kit';
import type { AuspexApi, Change, Changes, MapFloor } from './api.js';
import { APP_NAME, changeLine } from './words.js';

/** How far back the replay goes: as far as Explorer remembers. */
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

export interface ReplayProps {
  api: AuspexApi;
  floor: MapFloor;
  /** Names an app by its id, as the floor's apps know it. */
  appName?: (id: string) => string;
}

/**
 * The last 30 days on one floor, for its leads and admins: each day a column
 * of marks, played forward a day at a time or picked by hand, with what the
 * month had added up to by then and what happened that day. Nothing on it
 * changes anything.
 */
export function Replay({ api, floor: f, appName = (id) => id }: ReplayProps) {
  const [loaded, setLoaded] = useState<Changes | Error>();
  /** The day picked, 0 the oldest. */
  const [day, setDay] = useState(REPLAY_DAYS - 1);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval>>(undefined);

  const load = useCallback(async () => {
    setLoaded(undefined);
    try {
      setLoaded(await api.changes(f.id, REPLAY_DAYS));
    } catch (err) {
      setLoaded(err as Error);
    }
  }, [api, f.id]);
  useEffect(() => void load(), [load]);

  const stop = () => {
    clearInterval(timer.current);
    timer.current = undefined;
    setPlaying(false);
  };
  useEffect(() => () => clearInterval(timer.current), []);
  const play = () => {
    if (playing) return stop();
    if (day >= REPLAY_DAYS - 1) setDay(0);
    setPlaying(true);
    timer.current = setInterval(() => {
      setDay((d) => {
        if (d >= REPLAY_DAYS - 1) {
          stop();
          return d;
        }
        return d + 1;
      });
    }, STEP_MS);
  };
  const pick = (to: number) => {
    stop();
    setDay(Math.max(0, Math.min(REPLAY_DAYS - 1, to)));
  };

  const summary = (c: Changes) => {
    const n = c.changes.length;
    if (!n) return `Nothing changed on ${f.name} in the last 30 days.`;
    return `${n} ${n === 1 ? 'change' : 'changes'} on ${f.name}: ${tally(daysOf(c.changes))
      .map((t) => t.words)
      .join(', ')}.`;
  };
  const heading = <Heading eyebrow={`Replay · ${f.name}`} heading="The last 30 days" summary={loaded && !(loaded instanceof Error) ? summary(loaded) : undefined} size="l" level={1} />;
  if (loaded instanceof Error)
    return (
      <div className="ax-replaying">
        {heading}
        <State kind="error" heading="Couldn’t see what changed" body={loaded.message} action="Try again" onAction={() => void load()} />
      </div>
    );
  if (!loaded)
    return (
      <div className="ax-replaying">
        {heading}
        <State kind="loading" heading="Gathering the month" size="line" />
      </div>
    );
  const days = daysOf(loaded.changes);
  const picked = days[day]!;
  const sofar = tally(days.slice(0, day + 1));
  const tallest = Math.max(4, ...days.map((d) => d.changes.length));
  return (
    <div className="ax-replaying">
      {heading}
      <section className="ax-section" aria-labelledby="ax-replay-line">
        <h2 className="ax-label" id="ax-replay-line">
          Each day
        </h2>
        <div className="ax-replay" style={{ '--tallest': tallest } as CSSProperties}>
          {days.map((d, i) => (
            <button
              key={d.start}
              type="button"
              className={`ax-rday ${i > day ? 'later' : ''} ${i === day ? 'picked' : ''}`}
              aria-pressed={i === day}
              aria-label={`${dayWords(d.start)}: ${d.changes.length ? `${d.changes.length} ${d.changes.length === 1 ? 'change' : 'changes'}` : 'nothing changed'}`}
              onClick={() => pick(i)}
            >
              <span className="marks">
                {d.changes.map((c, n) => (
                  <i key={n} className={markOf(c)} />
                ))}
              </span>
            </button>
          ))}
        </div>
        <div className="ax-scrub">
          <Button kind="secondary" size="sm" onPress={play}>
            {playing ? 'Pause' : 'Play the month'}
          </Button>
          <input type="range" min="0" max={REPLAY_DAYS - 1} value={String(day)} aria-label="Pick a day" aria-valuetext={dayWords(picked.start)} onChange={(e) => pick(Number(e.target.value))} />
          <span className="ax-meta ax-muted when">{dayWords(picked.start, { day: 'numeric', month: 'short' })}</span>
        </div>
        <ul className="ax-key" aria-label="What the marks mean">
          <li>
            <i className="people" />
            Someone joined or left
          </li>
          <li>
            <i className="app" />
            An app turned on or off
          </li>
          <li>
            <i className="blocked" />
            An app blocked
          </li>
          <li>
            <i className="team" />A team made or renamed
          </li>
        </ul>
      </section>
      <section className="ax-section" aria-labelledby="ax-replay-day" aria-live="polite">
        <h2 className="ax-label" id="ax-replay-day">
          {day === REPLAY_DAYS - 1 ? 'Today' : dayWords(picked.start)}
        </h2>
        {sofar.length ? (
          <ul className="ax-tally" aria-label="By then">
            <li className="lead">By then</li>
            {sofar.map((t) => (
              <li key={t.words} className={t.kind}>
                {t.words}
              </li>
            ))}
          </ul>
        ) : null}
        {picked.changes.length ? (
          <ul className="ax-events">
            {picked.changes.map((c, n) => (
              <li key={n}>
                <span>{changeLine(c, loaded.names, appName)}</span>
                <span>{new Date(c.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ax-muted ax-meta ax-quiet-day">Nothing changed on {f.name} that day.</p>
        )}
      </section>
      <div className="ax-can">
        <p className="ax-label">You can</p>
        <p>
          Play the month, or pick a day to see what had changed by then. Nothing here changes anything: <b>an admin</b> changes who’s on {f.name} and which apps are on. {APP_NAME} remembers {REPLAY_DAYS} days.
        </p>
      </div>
    </div>
  );
}
