import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppFrame, Button, Facts, Heading, Icon, RailLink, State, type Fact, type IconName } from '@augur/app-kit';
import { usable, type AuspexApi, type Changes, type ClosedTeam, type FloorApp, type MapFloor, type PersonMap } from './api.js';
import { Building } from './building.js';
import { mayWalk } from './cutaway.js';
import { OrgMap } from './map.js';
import { type Place } from './place.js';
import { Plant, plantLine } from './plant.js';
import { Replay } from './replay.js';
import { APP_NAME, appLine, appQuestion, changeLine, daysAgo, floorEyebrow, ledBy, listOf, whoCanAdd, whyHere } from './words.js';

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

/** A floor's orb: its colour, its kind's icon. */
const Orb = ({ kind, extra = '', small }: { kind: string; extra?: string; small?: boolean }) => {
  const icon = kind === 'org' ? 'org' : kind === 'personal' ? 'account' : kind === 'closed' ? 'lock' : 'people';
  return (
    <span className={`ax-orb ${kind} ${extra} ${small ? 'sm' : ''}`} aria-hidden="true">
      <Icon name={icon} size={small ? 18 : 28} />
    </span>
  );
};

/** The "You can" line: at most two actions, and why. */
const Can = ({ actions, children }: { actions?: ReactNode; children: ReactNode }) => (
  <div className="ax-can">
    <p className="ax-label">You can</p>
    {actions ? <div className="acts">{actions}</div> : null}
    <p>{children}</p>
  </div>
);

const Quiet = ({ onPress, children }: { onPress: () => void; children: string }) => (
  <Button kind="tertiary" onPress={onPress}>
    {children}
  </Button>
);

export interface ExplorerAppProps {
  api: AuspexApi;
  place: Place;
  /** The floor they're on now. */
  here: string;
  userId: string;
  /** They have the admin role: the plant room, and every floor's replay they stand on. */
  admin?: boolean;
  /** Where the person went, for the address bar. */
  onPlace?: (place: Place) => void;
}

/**
 * Explorer: where you are on AUGUR, who's there, and why you can or can't use
 * things. Every screen answers three questions: what am I looking at (the
 * heading), what can I do (the "You can" line, at most two actions), and why
 * (a reason on everything, and who can change each "no"). It changes nothing.
 */
export function ExplorerApp({ api, place: start, here, userId, admin = false, onPlace }: ExplorerAppProps) {
  const [place, setPlace] = useState<Place>(start);
  const [map, setMap] = useState<PersonMap>();
  const [failure, setFailure] = useState('');
  const [showAll, setShowAll] = useState(false);
  /** The plant room in a line, for the building's basement (admins). */
  const [plant, setPlant] = useState<{ line: string; state: string }>();
  // What's loaded per floor; a tick redraws when any of it lands.
  const apps = useRef(new Map<string, Loaded<FloorApp[]>>());
  const changes = useRef(new Map<string, Loaded<Changes>>());
  const names = useRef(new Map<string, string>());
  const [, redraw] = useState(0);
  const tick = () => redraw((n) => n + 1);

  const load = useCallback(async () => {
    setFailure('');
    try {
      setMap(await api.map());
    } catch (err) {
      setFailure((err as Error).message);
    }
  }, [api]);
  useEffect(() => void load(), [load]);

  const go = (to: Place) => {
    setPlace(to);
    setShowAll(false);
    onPlace?.(to);
    window.scrollTo?.({ top: 0 });
  };

  const byId = useMemo(() => {
    const all: { id: string; name: string; parentId?: string; kind?: string }[] = [...(map?.floors ?? []), ...(map?.closed ?? [])];
    return new Map(all.map((x) => [x.id, x]));
  }, [map]);
  const nameOf = (id: string) => byId.get(id)?.name ?? 'a floor above';
  const floorOf = (id: string) => map?.floors.find((f) => f.id === id);
  const org = map?.floors.find((f) => f.kind === 'org');

  const loadApps = (floor: string) => {
    if (apps.current.has(floor)) return;
    apps.current.set(floor, undefined);
    api
      .apps(floor)
      .then(async (list) => {
        apps.current.set(floor, list);
        // Who set the rules that decide, by name.
        const ids = [...new Set(list.flatMap((a) => ('setBy' in a.state && a.state.setBy ? [a.state.setBy] : [])))].filter((id) => !names.current.has(id));
        if (ids.length) for (const [id, name] of Object.entries(await api.names(ids).catch(() => ({})))) names.current.set(id, name);
      })
      .catch((err: Error) => apps.current.set(floor, err))
      .finally(tick);
  };
  const loadChanges = (floor: string) => {
    if (changes.current.has(floor)) return;
    changes.current.set(floor, undefined);
    api
      .changes(floor)
      .then((c) => changes.current.set(floor, c))
      .catch((err: Error) => changes.current.set(floor, err))
      .finally(tick);
  };

  // Loads what the current place needs that isn't loaded yet.
  useEffect(() => {
    if (!map) return;
    const floorId = place.view === 'floor' || place.view === 'replay' ? place.id : place.view === 'app' ? place.floor : undefined;
    const floor = floorId ? map.floors.find((f) => f.id === floorId) : undefined;
    if (place.view === 'building' && admin && !plant) {
      setPlant({ line: 'Checking each part…', state: 'checking' });
      api
        .status()
        .then(({ components }) => {
          const state = components.some((c) => c.state === 'down') ? 'down' : components.some((c) => c.state === 'slow') ? 'slow' : 'up';
          setPlant({ line: plantLine(components), state });
        })
        .catch((err: Error) => setPlant({ line: `Couldn’t check it: ${err.message}`, state: 'checking' }));
    }
    if (!floor?.open) return;
    loadApps(floor.id);
    if (place.view === 'floor' && floor.kind !== 'personal') loadChanges(floor.id);
    // For an answer: every floor they stand on, to say where else the app is on for them.
    if (place.view === 'app') for (const f of map.floors.filter((x) => x.open)) loadApps(f.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, place]);

  /** The replay is for a floor's leads and admins, on a team or the org they stand on. */
  const mayReplay = (f: MapFloor) => f.open && f.kind !== 'personal' && (admin || (f.why.kind === 'member' && f.why.role === 'lead') || Boolean(f.members?.some((m) => m.id === userId && m.role === 'lead')));
  const appName = (id: string) => [...apps.current.values()].flatMap((a) => (Array.isArray(a) ? a : [])).find((a) => a.id === id)?.name ?? id;

  // ---- The building --------------------------------------------------------
  const renderBuilding = (m: PersonMap) => {
    if (!mayWalk(m, userId, admin))
      return (
        <div className="ax-pane">
          <Heading eyebrow={APP_NAME} heading="The building" summary="The whole org in cross-section: every team as a room above the teams inside it." size="l" level={1} />
          <State
            heading="The building is for leads and admins"
            body="It shows the shape of the whole org at once, which leads and admins look after. Where you are shows the same teams, and why you can or can’t go into each."
          />
          <Can actions={<Quiet onPress={() => go({ view: 'where' })}>See where you are</Quiet>}>Nothing here changes anything.</Can>
        </div>
      );
    const teams = m.floors.filter((f) => f.kind === 'team');
    const stand = teams.filter((f) => f.open).length;
    const see = teams.length - stand;
    const parts = [`go into ${stand}`, see ? `see into ${see}` : '', m.closed.length ? `find ${m.closed.length} closed` : ''].filter(Boolean);
    const total = teams.length + m.closed.length;
    return (
      <div className="ax-pane">
        <Heading eyebrow={APP_NAME} heading="The building" summary={`${org!.name} has ${total} ${total === 1 ? 'team' : 'teams'}. You ${listOf(parts)}.`} size="l" level={1} />
        <div className="ax-map">
          <Building map={m} here={here} admin={admin} plant={plant?.line ?? ''} plantState={plant?.state ?? 'checking'} onFloor={(id) => go({ view: 'floor', id })} onPlant={() => go({ view: 'plant' })} />
        </div>
        <ul className="ax-key" aria-label="What the drawing means">
          <li>
            <i className="stand" />
            You can go here
          </li>
          {see ? (
            <li>
              <i className="see" />
              You can see in
            </li>
          ) : null}
          {m.closed.length ? (
            <li>
              <i className="closed" />
              Closed to you
            </li>
          ) : null}
          <li>
            <i className="stairs" />
            Your way up
          </li>
        </ul>
        <Can actions={admin ? <Quiet onPress={() => go({ view: 'plant' })}>Open the plant room</Quiet> : undefined}>
          Choose a room to see who’s there and which apps are on. A closed room still says <b>who to ask</b>. Only an admin changes who’s on a team.
        </Can>
      </div>
    );
  };

  // ---- Where you are -------------------------------------------------------
  const renderWhere = (m: PersonMap) => {
    const at = floorOf(here);
    const own = m.floors.find((f) => f.kind === 'personal');
    const stand = m.floors.filter((f) => f.open).length;
    const reasons = new Map<string, string>([...m.floors.map((f) => [f.id, whyHere(f, org!.name)] as [string, string]), ...m.closed.map((t) => [t.id, whoCanAdd(t)] as [string, string])]);
    return (
      <div className="ax-pane">
        <Heading
          eyebrow={APP_NAME}
          heading="Where you are"
          summary={`You can go to ${stand} ${stand === 1 ? 'floor' : 'floors'}.${at ? ` You’re on ${at.kind === 'personal' ? 'your own floor' : at.name} now.` : ''}`}
          size="l"
          level={1}
        />
        <div className="ax-map">
          <OrgMap map={m} here={here} reasons={reasons} onFloor={(id) => go({ view: 'floor', id })} />
        </div>
        {own ? (
          <button type="button" className="ax-own" onClick={() => go({ view: 'floor', id: own.id })}>
            <Orb kind="personal" extra={own.id === here ? 'here' : ''} small />
            <span>
              <span className="t1">Your own floor</span>
              <br />
              <span className="t2">Only you can come here</span>
            </span>
          </button>
        ) : null}
        <ul className="ax-key" aria-label="What the marks mean">
          <li>
            <i className="here" />
            You’re here
          </li>
          <li>
            <i className="stand" />
            You can go here
          </li>
          {m.floors.some((f) => !f.open) ? (
            <li>
              <i className="see" />
              You can see in
            </li>
          ) : null}
          {m.closed.length ? (
            <li>
              <i className="closed" />
              Closed to you
            </li>
          ) : null}
        </ul>
        <Can actions={mayWalk(m, userId, admin) ? <Quiet onPress={() => go({ view: 'building' })}>See it as a building</Quiet> : undefined}>
          {m.closed.length ? (
            <>
              Choose a floor to see who’s there and which apps you can use on it. A closed team says <b>who to ask</b> to be added.
            </>
          ) : (
            'Choose a floor to see who’s there and which apps you can use on it.'
          )}
        </Can>
      </div>
    );
  };

  // ---- A floor -------------------------------------------------------------
  const renderApps = (f: MapFloor, list: Loaded<FloorApp[]>) => {
    if (list instanceof Error)
      return (
        <State
          kind="error"
          heading="Couldn’t see this floor’s apps"
          body={list.message}
          action="Try again"
          onAction={() => {
            apps.current.delete(f.id);
            loadApps(f.id);
            tick();
          }}
        />
      );
    if (!list) return <State kind="loading" heading="Looking at the apps here" size="line" />;
    // What they can use first, then what's off, each by name.
    const sorted = [...list].sort((a, b) => Number(usable(b)) - Number(usable(a)) || a.name.localeCompare(b.name));
    return (
      <section className="ax-section" aria-labelledby="ax-apps">
        <h2 className="ax-label" id="ax-apps">
          Apps here
        </h2>
        <div className="ax-tiles">
          {sorted.map((a) => {
            const on = usable(a);
            return (
              <button
                key={a.id}
                type="button"
                className={`ax-tile ${on ? 'on' : `off ${a.state.why === 'blocked' ? 'blocked' : ''}`}`}
                onClick={() => go({ view: 'app', floor: f.id, app: a.id })}
                aria-label={`${a.name}: ${appLine(a, nameOf, f.kind)}. ${appQuestion(a, f.kind === 'personal' ? 'your own floor' : f.name)}`}
              >
                <span className="glyph">
                  <Icon name={(a.icon ?? 'apps') as IconName} size={20} />
                </span>
                <span className="nm">{a.name}</span>
                <span className="st">{appLine(a, nameOf, f.kind)}</span>
              </button>
            );
          })}
        </div>
      </section>
    );
  };

  const renderPeople = (f: MapFloor) => {
    const members = f.members ?? [];
    const shown = showAll ? members : members.slice(0, DISCS);
    return (
      <section className="ax-section" aria-labelledby="ax-people">
        <h2 className="ax-label" id="ax-people">
          On {f.name}
        </h2>
        <ul className="ax-people">
          {shown.map((m) => (
            <li key={m.id} className={`ax-person ${m.role} ${m.id === userId ? 'you' : ''}`}>
              <span className="ax-disc" aria-hidden="true">
                {initials(m.name)}
              </span>
              <span className="nm">{m.name}</span>
              {m.role === 'lead' || m.id === userId ? <span className="rl">{[m.role === 'lead' ? 'Lead' : '', m.id === userId ? 'You' : ''].filter(Boolean).join(' · ')}</span> : null}
            </li>
          ))}
          {members.length > shown.length ? (
            <li className="ax-person">
              <button type="button" className="ax-more" onClick={() => setShowAll(true)}>
                <span className="ax-disc">+{members.length - shown.length}</span>
              </button>
              <span className="nm">more</span>
            </li>
          ) : null}
        </ul>
        {f.people > members.length ? (
          <p className="ax-muted ax-meta">
            And {f.people - members.length} more on the teams inside {f.name}.
          </p>
        ) : null}
      </section>
    );
  };

  const renderWeek = (f: MapFloor, week: Loaded<Changes>) => {
    if (week instanceof Error) return <State kind="error" size="line" heading="Couldn’t see what changed" body={week.message} />;
    if (!week) return null;
    const now = Date.now();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const days = Array.from({ length: 7 }, (_, i) => new Date(today.getTime() - (6 - i) * DAY));
    return (
      <section className="ax-section" aria-labelledby="ax-week">
        <h2 className="ax-label" id="ax-week">
          This week
        </h2>
        <div className="ax-week" aria-hidden="true">
          {days.map((d, i) => {
            const on = week.changes.filter((c) => {
              const at = Date.parse(c.at);
              return at >= d.getTime() && at < d.getTime() + DAY;
            });
            return (
              <div key={i} className={`ax-day ${i === 6 ? 'today' : ''}`}>
                <span className="dots">
                  {on.slice(0, 5).map((c, n) => (
                    <i key={n} className={c.app ? 'app' : 'people'} />
                  ))}
                </span>
                <span className="day">{i === 6 ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'short' })}</span>
              </div>
            );
          })}
        </div>
        {week.changes.length ? (
          <ul className="ax-events">
            {week.changes.slice(0, TOLD).map((c, n) => (
              <li key={n}>
                <span>{changeLine(c, week.names, appName)}</span>
                <span>{daysAgo(c.at, now)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ax-muted ax-meta">Nothing changed here this week.</p>
        )}
        {mayReplay(f) ? (
          <div>
            <Button kind="tertiary" size="sm" onPress={() => go({ view: 'replay', id: f.id })}>
              Replay the last 30 days
            </Button>
          </div>
        ) : (
          <p className="ax-muted ax-meta">{f.name}’s leads and admins can replay its last 30 days.</p>
        )}
      </section>
    );
  };

  const renderFloor = (f: MapFloor) => {
    const list = apps.current.get(f.id);
    const week = changes.current.get(f.id);
    const loaded = Array.isArray(list) ? list : undefined;
    const thisWeek = week && !(week instanceof Error) ? week : undefined;
    const title = f.kind === 'personal' ? 'Your own floor' : f.name;
    // Said once: a lead's reason for being here and who leads it can be the same sentence.
    const summary = [...new Set([whyHere(f, org!.name) + '.', ledBy(f.leads.filter(() => f.kind === 'team'), userId)].filter(Boolean))].join(' ');
    const facts: Fact[] = [
      ...(f.kind !== 'personal' ? [{ value: f.people, label: f.people === 1 ? 'Person' : 'People' }] : []),
      ...(f.open ? [{ value: loaded ? loaded.filter(usable).length : '…', label: 'Apps you can use' }] : []),
      ...(f.open && f.kind !== 'personal' ? [{ value: thisWeek ? thisWeek.changes.length : '…', label: 'Changes this week' }] : []),
      ...(!f.open ? [{ value: f.leads.length, label: f.leads.length === 1 ? 'Lead' : 'Leads' }] : []),
    ];
    const firstNo = loaded?.find((a) => !usable(a) && a.state.why !== 'not-for-this-kind');
    return (
      <div className="ax-pane">
        <div className="ax-hero">
          <Orb kind={f.kind} extra={`${f.open ? '' : 'see'} ${f.id === here ? 'here' : ''}`} />
          <Heading eyebrow={floorEyebrow(f, byId)} heading={title} summary={summary} size="l" level={1} />
        </div>
        <Facts items={facts} />
        {f.open ? (
          renderApps(f, list)
        ) : (
          <p className="ax-muted ax-meta">
            You can see who’s on {f.name}, {f.why.kind === 'admin' ? 'as an admin' : `as a lead of ${f.why.kind === 'leads-above' ? f.why.team.name : 'a team above it'}`}. Its apps and what changes on it are for the people on it.
          </p>
        )}
        {f.members?.length ? renderPeople(f) : null}
        {f.kind === 'org' ? (
          <p className="ax-muted ax-meta">
            Everyone at {f.name} is here: {f.people} {f.people === 1 ? 'person' : 'people'}. {APP_NAME} shows people on the teams you share with them, and nothing else about them.
          </p>
        ) : null}
        {f.open && f.kind !== 'personal' ? renderWeek(f, week) : null}
        <Can actions={firstNo ? <Quiet onPress={() => go({ view: 'app', floor: f.id, app: firstNo.id })}>{appQuestion(firstNo, title)}</Quiet> : undefined}>
          {f.kind === 'personal' ? (
            'Choose an app to see why you can or can’t use it here.'
          ) : (
            <>
              Choose an app to see why. You can’t change who’s here or which apps are on: <b>an admin</b> does
              {f.leads.length
                ? `, and ${listOf(f.leads.map((l) => (l.id === userId ? 'you' : l.name)))} ${f.leads.length > 1 || f.leads[0]?.id === userId ? 'lead' : 'leads'} ${f.name}`
                : ''}
              .
            </>
          )}
        </Can>
      </div>
    );
  };

  // ---- A closed team -------------------------------------------------------
  const isInside = (team: { parentId?: string }, ancestor: string): boolean => {
    for (let p = team.parentId; p; p = byId.get(p)?.parentId) if (p === ancestor) return true;
    return false;
  };
  const renderClosed = (t: ClosedTeam) => {
    const up: string[] = [];
    for (let p = t.parentId; p && byId.get(p); p = byId.get(p)!.parentId) up.unshift(byId.get(p)!.name);
    const inside = map!.closed.filter((c) => c.id !== t.id && isInside(c, t.id));
    return (
      <div className="ax-pane">
        <div className="ax-hero">
          <Orb kind="closed" />
          <Heading eyebrow="Closed to you" heading={t.name} summary="You’re not on this team, so you can’t go in or see who’s there." size="l" level={1} />
        </div>
        <div className="ax-path" aria-label="Where it sits">
          {up.map((n, i) => (
            <span key={i} className="ax-path-step">
              <span>{n}</span>
              <span aria-hidden="true">›</span>
            </span>
          ))}
          <b>{t.name}</b>
        </div>
        {inside.length ? (
          <section className="ax-section">
            <h2 className="ax-label">Teams inside it</h2>
            <ul className="ax-names">
              {inside.map((c) => (
                <li key={c.id}>{c.name}</li>
              ))}
            </ul>
          </section>
        ) : null}
        <Can>
          To be added,{' '}
          {t.leads.length ? (
            <>
              ask <b>{listOf(t.leads.map((l) => l.name))}</b>, who {t.leads.length > 1 ? 'lead' : 'leads'} it. An admin adds people to teams.
            </>
          ) : (
            <>
              ask <b>an admin</b>: no one leads it yet.
            </>
          )}
        </Can>
      </div>
    );
  };

  // ---- An answer about one app on one floor --------------------------------
  /** From the org down to this floor: the floors whose rules count here. */
  const chainTo = (f: MapFloor): { id: string; name: string; kind: string }[] => {
    if (f.kind === 'org') return [org!];
    if (f.kind === 'personal') return [org!, f];
    const chain: { id: string; name: string; kind: string }[] = [];
    for (let at: string | undefined = f.id; at && byId.get(at); at = byId.get(at)!.parentId) chain.unshift({ ...byId.get(at)!, kind: 'team' });
    return [org!, ...chain.filter((c) => c.id !== org!.id)];
  };

  const renderApp = (f: MapFloor, appId: string) => {
    const list = apps.current.get(f.id);
    if (list instanceof Error)
      return (
        <div className="ax-pane">
          <State kind="error" heading="Couldn’t see this floor’s apps" body={list.message} />
        </div>
      );
    if (!list)
      return (
        <div className="ax-pane">
          <State kind="loading" heading="Working it out" />
        </div>
      );
    const a = list.find((x) => x.id === appId);
    const floorName = f.kind === 'personal' ? 'your own floor' : f.name;
    if (!a)
      return (
        <div className="ax-pane">
          <State heading="No such app here" body={`There’s no app called that on ${floorName}. It may have been removed.`} />
        </div>
      );
    const yes = usable(a);
    const s = a.state;
    const who = (id?: string) => (id ? (names.current.get(id) ?? 'an admin') : 'an admin');
    const by = 'by' in s ? s.by : undefined;
    const setLine = 'setBy' in s && s.setBy ? `Set by ${who(s.setBy)}${s.setAt ? ` on ${dateOf(s.setAt)}` : ''}` : 'Set by an admin';

    let summary: string;
    let steps: ReactNode[];
    let n = 0;
    const step = (orbKind: string, t1: string, t2: string, verdict: '' | 'yes' | 'no' | 'quiet', word = '') => (
      <li key={n++} className={`ax-step ${verdict === 'quiet' ? 'quiet' : verdict ? `decides ${verdict}` : ''}`}>
        <Orb kind={orbKind} small />
        <div>
          <span className="t1">{t1}</span>
          {word ? <span className="verdict">{word}</span> : null}
          <br />
          <span className="t2">{t2}</span>
        </div>
      </li>
    );

    if (s.why === 'platform') {
      summary = `${a.name} is part of AUGUR itself, so it’s on everywhere for everyone.`;
      steps = [step('org', 'AUGUR', 'It comes with the platform', 'yes', 'Decides it')];
    } else if (s.why === 'turned-off') {
      summary = `An admin has turned ${a.name} off for everyone.`;
      steps = [step('org', org!.name, 'Turned off everywhere by an admin', 'no', 'Decides it')];
    } else if (s.why === 'not-for-this-kind') {
      const kinds = (a.floors ?? []).map((k) => (k === 'personal' ? 'your own floor' : k === 'team' ? 'teams' : 'the whole organisation'));
      summary = `${a.name} isn’t made for ${floorName}. It works on ${listOf(kinds) || 'other floors'}.`;
      steps = [step(f.kind, f.kind === 'personal' ? 'Your own floor' : f.name, `${a.name} is made for ${listOf(kinds) || 'other floors'}`, 'no', 'Decides it')];
    } else {
      const chain = chainTo(f);
      summary =
        s.why === 'blocked'
          ? `${nameOf(s.by)} has blocked it for itself${chain.length > 1 && s.by !== f.id ? ' and every team inside it' : ''}.`
          : s.why === 'approved'
            ? `An admin approved it for everyone, and no floor on your way here has a rule of its own.`
            : `${s.why === 'set-here' ? floorName.replace(/^./, (c) => c.toUpperCase()) : nameOf(s.by)} has it turned ${s.on ? 'on' : 'off'}.`;
      steps = chain.map((c) => {
        const kind = c.kind === 'org' ? 'org' : c.kind === 'personal' ? 'personal' : 'team';
        const name = c.kind === 'personal' ? 'Your own floor' : c.name;
        if (c.id === by) {
          if (s.why === 'blocked') return step(kind, `${name} blocks it`, setLine, 'no', 'Decides it');
          return step(kind, `${name} turns it ${s.on ? 'on' : 'off'}`, setLine, s.on ? 'yes' : 'no', 'Decides it');
        }
        if (s.why === 'approved' && c.kind === 'org') return step(kind, `${name} allows it`, 'Approved by an admin for everyone', 'yes', 'Decides it');
        const below = c.id !== f.id ? `So ${name}’s rules reach the floors inside it` : 'No rule of its own';
        return step(kind, name, c.id === org!.id && s.why !== 'approved' ? 'Allows it, with no rule of its own' : below, 'quiet');
      });
    }
    if (a.hasRole === false) {
      steps.push(step('closed', `Needs the ${a.requiredRole} role`, `You don’t have it. An admin gives people roles.`, 'no', 'Decides it'));
      if (a.state.on) summary = `It’s on here, but only for people with the ${a.requiredRole} role.`;
    }

    // Where else it's on for them, said rather than offered: Explorer doesn't move you between floors.
    const elsewhere = yes ? [] : map!.floors.filter((x) => x.open && x.id !== f.id && (apps.current.get(x.id) as FloorApp[] | undefined)?.some?.((y) => y.id === a.id && usable(y)));
    const changer = a.hasRole === false ? 'an admin, who gives roles' : 'an admin';
    return (
      <div className="ax-pane">
        <div className="ax-answer">
          <span className={`big ${yes ? '' : 'no'}`} aria-hidden="true">
            <Icon name={yes ? 'check' : 'blocked'} size={28} />
          </span>
          <Heading eyebrow={`${a.name} on ${floorName}`} heading={yes ? `You can use ${a.name} here` : `You can’t use ${a.name} here`} summary={summary} size="l" level={1} />
        </div>
        <section className="ax-section" aria-labelledby="ax-how">
          <h2 className="ax-label" id="ax-how">
            How this was decided
          </h2>
          <ol className="ax-chain">{steps}</ol>
        </section>
        <Can>
          {yes ? (
            <>
              Nothing to do: it’s on for you here. Only <b>an admin</b> changes which apps are on.
            </>
          ) : (
            <>
              {elsewhere.length ? (
                <>
                  It’s on for you on <b>{listOf(elsewhere.map((x) => (x.kind === 'personal' ? 'your own floor' : x.name)))}</b>.{' '}
                </>
              ) : null}
              To change it here, ask <b>{changer}</b>.
            </>
          )}
        </Can>
      </div>
    );
  };

  // ---- The frame ------------------------------------------------------------
  let body: ReactNode;
  if (failure) body = <State kind="error" heading="Couldn’t load your map" body={failure} action="Try again" onAction={() => void load()} />;
  else if (!map || !org) body = <State kind="loading" heading="Finding where you are" />;
  else if (place.view === 'where') body = renderWhere(map);
  else if (place.view === 'building') body = renderBuilding(map);
  else if (place.view === 'plant')
    body = (
      <div className="ax-pane">
        <Plant api={api} admin={admin} />
      </div>
    );
  else {
    const id = place.view === 'app' ? place.floor : place.id;
    const floor = floorOf(id);
    const closed = floor ? undefined : map.closed.find((t) => t.id === id);
    if (closed) body = renderClosed(closed);
    else if (!floor)
      body = (
        <div className="ax-pane">
          <State heading="No such floor" body="It may have been removed, or the link is wrong." action="See where you are" onAction={() => go({ view: 'where' })} />
        </div>
      );
    else if (place.view === 'app' && floor.open) body = renderApp(floor, place.app);
    else if (place.view === 'replay' && mayReplay(floor))
      body = (
        <div className="ax-pane">
          <Replay api={api} floor={floor} appName={appName} />
        </div>
      );
    else body = renderFloor(floor);
  }

  // The rail: the places Explorer has, each shown only to whoever it's for.
  const own = map?.floors.find((f) => f.kind === 'personal');
  const at = floorOf(here);
  const shownFloor = place.view === 'floor' || place.view === 'replay' ? place.id : place.view === 'app' ? place.floor : undefined;
  const rail = map ? (
    <>
      <RailLink icon="explore" label="Where you are" current={place.view === 'where'} onPress={() => go({ view: 'where' })} />
      {at && at.kind !== 'personal' ? <RailLink icon={at.kind === 'org' ? 'org' : 'people'} label={at.name} current={shownFloor === at.id} onPress={() => go({ view: 'floor', id: at.id })} /> : null}
      {own ? <RailLink icon="account" label="Your own floor" current={shownFloor === own.id} onPress={() => go({ view: 'floor', id: own.id })} /> : null}
      {mayWalk(map, userId, admin) ? <RailLink icon="facility" label="The building" current={place.view === 'building'} onPress={() => go({ view: 'building' })} /> : null}
      {admin ? <RailLink icon="server" label="Plant room" current={place.view === 'plant'} onPress={() => go({ view: 'plant' })} /> : null}
    </>
  ) : undefined;
  const screen = place.view === 'app' ? `app:${place.floor}:${place.app}` : 'id' in place ? `${place.view}:${place.id}` : place.view;
  return (
    <div className="ax-app">
      <AppFrame app={{ name: APP_NAME, icon: 'explore' }} onFront={() => go({ view: 'where' })} rail={rail} railLabel={APP_NAME} screen={screen}>
        {body}
      </AppFrame>
    </div>
  );
}
