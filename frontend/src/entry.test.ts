import { describe, expect, it } from 'vitest';
import type { FloorApp, PersonMap } from './api.js';
import { AuspexApi } from './api.js';
import { pathFor, placeFor, type AuspexApp } from './auspex-app.js';
import { addressFor, AUSPEX_OPEN, FLOOR_MAP, placeForIntent } from './entry.js';
import { layoutMap } from './layout.js';
import { ACCESS_EXPLAIN, explain, readExplain, upWords } from './access.js';
import type { AuspexAccess } from './auspex-access.js';
import { plantLine, roomsOf, type AuspexPlant } from './auspex-plant.js';
import { daysOf, tally, type AuspexReplay } from './auspex-replay.js';
import type { Part } from './api.js';
import { layoutCutaway, mayWalk } from './cutaway.js';
import type { AuspexBuilding } from './auspex-building.js';
import { INSTALL_STEPS, jobLine, recent, trackOf, UPGRADE_STEPS, upgradeLine, type AppJob } from './jobs.js';
import { appLine, ledBy, whoCanAdd, whyHere } from './words.js';

/** Acme: Finance (Payroll, Treasury) and Legal (Contracts, inside it Disputes). Alex is on Payroll. */
const acme: PersonMap = {
  floors: [
    { id: 'org', kind: 'org', name: 'Acme', slug: 'acme', depth: 0, open: true, why: { kind: 'org' }, people: 9, leads: [] },
    { id: 'fin', kind: 'team', name: 'Finance', slug: 'finance', parentId: 'org', depth: 1, open: true, why: { kind: 'inside', via: { id: 'pay', name: 'Payroll' } }, people: 4, leads: [{ id: 'priya', name: 'Priya Shah' }], members: [{ id: 'priya', name: 'Priya Shah', role: 'lead' }] },
    { id: 'pay', kind: 'team', name: 'Payroll', slug: 'payroll', parentId: 'fin', depth: 2, open: true, why: { kind: 'member', role: 'member' }, people: 2, leads: [{ id: 'sam', name: 'Sam Okafor' }], members: [{ id: 'sam', name: 'Sam Okafor', role: 'lead' }, { id: 'alex', name: 'Alex Kim', role: 'member' }] },
    { id: 'me', kind: 'personal', name: 'You', slug: 'alex', depth: 0, open: true, why: { kind: 'own' }, people: 1, leads: [{ id: 'alex', name: 'Alex Kim' }] },
  ],
  closed: [
    { id: 'tre', name: 'Treasury', parentId: 'fin', depth: 2, leads: [] },
    { id: 'leg', name: 'Legal', parentId: 'org', depth: 1, leads: [{ id: 'lee', name: 'Lee Park' }] },
    { id: 'con', name: 'Contracts', parentId: 'leg', depth: 2, leads: [] },
    { id: 'dis', name: 'Disputes', parentId: 'con', depth: 3, leads: [] },
  ],
  principals: ['person:alex', 'team:pay', 'tree:fin', 'tree:pay', 'org'],
};

const apps: FloorApp[] = [
  { id: 'home', name: 'Home', icon: 'home', state: { on: true, why: 'platform' } },
  { id: 'agents', name: 'Agents', icon: 'agents', state: { on: false, why: 'blocked', by: 'fin', setBy: 'ada', setAt: '2026-10-20T09:00:00Z' } },
  { id: 'board', name: 'Board', state: { on: true, why: 'set-here', by: 'pay' } },
  { id: 'notes', name: 'Notes', floors: ['personal'], state: { on: false, why: 'not-for-this-kind' } },
  { id: 'ledger', name: 'Ledger', requiredRole: 'publisher', hasRole: false, state: { on: true, why: 'approved' } },
];

describe('the map', () => {
  it('lays the org out left to right, folding closed teams inside closed teams', () => {
    const laid = layoutMap(acme, 'pay')!;
    const byId = new Map(laid.nodes.map((n) => [n.id, n]));
    expect([...byId.keys()].sort()).toEqual(['fin', 'leg', 'org', 'pay', 'tre']);
    expect(byId.get('leg')).toMatchObject({ reach: 'closed', folded: 2, depth: 1 });
    expect(byId.get('pay')).toMatchObject({ reach: 'stand', here: true, depth: 2 });
    // A level per column, and nobody on top of anyone else.
    expect(byId.get('fin')!.x).toBeGreaterThan(byId.get('org')!.x);
    expect(byId.get('pay')!.x).toBeGreaterThan(byId.get('fin')!.x);
    const ys = laid.nodes.filter((n) => n.depth === 1).map((n) => n.y);
    expect(new Set(ys).size).toBe(ys.length);
    expect(laid.links.filter((l) => l.lit).map((l) => l.to.id).sort()).toEqual(['fin', 'pay']);
    // Their own floors come before closed ones.
    expect(byId.get('fin')!.y).toBeLessThan(byId.get('leg')!.y);
  });
});

describe('what Auspex says', () => {
  it('says why you can go somewhere, who leads it and who to ask', () => {
    expect(whyHere(acme.floors[1], 'Acme')).toBe('You’re here because Payroll is inside it');
    expect(whyHere(acme.floors[0], 'Acme')).toBe('Everyone at Acme can come here');
    expect(ledBy([{ id: 'sam', name: 'Sam Okafor' }], 'alex')).toBe('Sam Okafor leads it.');
    expect(ledBy([{ id: 'alex', name: 'Alex Kim' }, { id: 'sam', name: 'Sam Okafor' }], 'alex')).toBe('You and Sam Okafor lead it.');
    expect(whoCanAdd(acme.closed[1])).toBe('Ask Lee Park, who leads it. An admin adds people to teams.');
    expect(whoCanAdd(acme.closed[0])).toBe('No one leads it yet. An admin adds people to teams.');
  });

  it('gives every app a reason, naming the floor a rule comes from', () => {
    const name = (id: string) => ({ fin: 'Finance', pay: 'Payroll' })[id] ?? id;
    expect(apps.map((a) => appLine(a, name, 'team'))).toEqual([
      'Part of AUGUR, on everywhere',
      'Blocked by Finance',
      'Turned on here',
      'Not made for teams',
      'Needs the publisher role',
    ]);
  });
});

describe('places', () => {
  it('reads and writes its address', () => {
    expect(placeFor('/', 'pay')).toEqual({ view: 'where' });
    expect(placeFor('/here', 'pay')).toEqual({ view: 'floor', id: 'pay' });
    expect(placeFor('/floors/fin/apps/agents', 'pay')).toEqual({ view: 'app', floor: 'fin', app: 'agents' });
    expect(pathFor({ view: 'app', floor: 'fin', app: 'agents' })).toBe('/floors/fin/apps/agents');
    expect(addressFor('/auspex/floors/fin', '/floors/fin', { view: 'where' })).toBe('/auspex');
    expect(addressFor('/auspex', '/', { view: 'floor', id: 'pay' })).toBe('/auspex/floors/pay');
  });

  it('opens where an intent asks', () => {
    expect(placeForIntent({ type: AUSPEX_OPEN, payload: { path: '/here' } }, 'pay')).toEqual({ view: 'floor', id: 'pay' });
    expect(placeForIntent({ type: FLOOR_MAP, payload: {} }, 'pay')).toEqual({ view: 'where' });
    expect(placeForIntent({ type: FLOOR_MAP, payload: { floor: 'fin' } }, 'pay')).toEqual({ view: 'floor', id: 'fin' });
    expect(placeForIntent(undefined, 'pay')).toBeUndefined();
  });
});

describe('the app', () => {
  const api = () => {
    const asked: { path: string; floor: string | null }[] = [];
    const api = new AuspexApi(async (path, init) => {
      asked.push({ path, floor: new Headers(init?.headers).get('X-Workspace-Id') });
      const body = path.includes('/me/map')
        ? acme
        : path.includes('/me/apps')
          ? { apps }
          : path.includes('/changes')
            ? { days: 7, changes: [{ at: new Date().toISOString(), kind: 'joined', floor: 'pay', person: 'alex', team: 'pay' }], names: { alex: 'Alex Kim' } }
            : { names: { ada: 'Ada Lovelace' } };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    return { api, asked };
  };
  const mount = async (place: object) => {
    await import('./auspex-app.js');
    const { api: a, asked } = api();
    const el = document.createElement('auspex-app') as AuspexApp;
    Object.assign(el, { api: a, here: 'pay', userId: 'alex', place });
    document.body.replaceChildren(el);
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 5));
      await el.updateComplete;
    }
    return { el, asked };
  };

  it('opens on the map, with every team on it and the closed ones saying so', async () => {
    const { el } = await mount({ view: 'where' });
    expect(el.querySelector('ui-heading')!.getAttribute('heading')).toBe('Where you are');
    const marks = [...el.querySelectorAll('auspex-map .node')].map((n) => n.getAttribute('aria-label'));
    expect(marks).toContain('Legal and 2 teams inside. Closed to you. Ask Lee Park, who leads it. An admin adds people to teams.');
    expect(marks.find((m) => m?.startsWith('Payroll'))).toBe('Payroll. You’re a member');
  });

  it('shows a floor as apps, people and its week, asking each floor it shows', async () => {
    const { el, asked } = await mount({ view: 'floor', id: 'pay' });
    expect(asked).toContainEqual({ path: '/api/registry/v1/me/apps?workspace=pay', floor: 'pay' });
    expect([...el.querySelectorAll('.ax-tile .nm')].map((t) => t.textContent)).toEqual(['Board', 'Home', 'Agents', 'Ledger', 'Notes']);
    expect([...el.querySelectorAll('.ax-person .nm')].map((t) => t.textContent)).toEqual(['Sam Okafor', 'Alex Kim']);
    expect(el.querySelector('.ax-events')!.textContent).toContain('Alex Kim joined');
    expect(el.querySelector('.ax-can ui-button')!.textContent).toBe('Why can’t I use Agents on Payroll?');
  });

  it('answers why not with the rule that decides it and who set it', async () => {
    const { el } = await mount({ view: 'app', floor: 'pay', app: 'agents' });
    expect(el.querySelector('ui-heading')!.getAttribute('heading')).toBe('You can’t use Agents here');
    const steps = [...el.querySelectorAll('.ax-step')].map((s) => [...s.querySelectorAll('.t1, .verdict, .t2')].map((t) => t.textContent).join(' '));
    expect(steps).toEqual([
      'Acme Allows it, with no rule of its own',
      expect.stringMatching(/^Finance blocks it Decides it Set by Ada Lovelace on/),
      'Payroll No rule of its own',
    ]);
    expect(el.querySelector('.ax-step.decides.no')).not.toBeNull();
  });

  it('says a closed team is there, where it sits and who to ask, and nothing inside it but names', async () => {
    const { el } = await mount({ view: 'floor', id: 'leg' });
    expect(el.querySelector('ui-heading')!.getAttribute('heading')).toBe('Legal');
    expect([...el.querySelectorAll('.ax-names li')].map((l) => l.textContent)).toEqual(['Contracts', 'Disputes']);
    expect(el.querySelector('.ax-can')!.textContent).toContain('Lee Park');
  });
});

describe('who can open this (access.explain)', () => {
  const ask = readExplain({
    thing: { app: 'folio', appName: 'Artifacts', id: 'd-1', title: 'Travel policy', kind: 'document' },
    audience: [
      { principal: 'tree:fin', name: 'Finance', level: 'read', via: 'its floor' },
      { principal: 'team:pay', level: 'edit', via: 'its library', since: '2026-10-01T09:00:00Z' },
      { principal: 'person:lee', name: 'Lee Park', level: 'manage', via: 'shared with this document' },
      { principal: 'tree:leg', name: 'Legal', level: 'read', via: 'shared with this document' },
      { principal: 'nonsense' },
    ],
    change: { where: 'Share', allowed: false },
  })!;

  it('reads only what it can explain', () => {
    expect(ACCESS_EXPLAIN).toBe('access.explain');
    expect(readExplain({ thing: { app: 'folio', id: 'd-1' }, audience: [] })).toBeUndefined();
    expect(readExplain(undefined)).toBeUndefined();
    expect(ask.audience.map((a) => a.principal)).toEqual(['tree:fin', 'team:pay', 'person:lee', 'tree:leg']);
    expect(ask.change).toEqual({ where: 'Share', allowed: false });
  });

  it('says how something published up the floors reaches them: the floors it came through, and what it shows', () => {
    const up = readExplain({
      thing: { app: 'folio', id: 'f-1', title: 'Reports', kind: 'folder' },
      audience: [{ principal: 'org', level: 'read', via: 'published up', chain: ['Payroll', 'Finance', 7], shows: ['Complete', 'Issued'] }, { principal: 'tree:fin', chain: 'Payroll' }],
    })!;
    expect(up.audience[0]).toMatchObject({ chain: ['Payroll', 'Finance'], shows: ['Complete', 'Issued'] });
    expect(up.audience[1].chain).toBeUndefined();
    expect(upWords(up.audience[0])).toBe('Up from Payroll through Finance, showing Complete and Issued');
    expect(upWords({ chain: ['Payroll'], shows: ['In review', 'Complete', 'Issued'] })).toBe('Up from Payroll, showing In review, Complete and Issued');
    expect(upWords({ shows: ['Issued'] })).toBe('Showing Issued only');
    expect(upWords({})).toBe('');
  });

  it('counts only people the person may know about, and says when it is at least that', () => {
    const { entries, people, atLeast, org } = explain(ask, acme);
    expect(entries.map((e) => e.who)).toEqual(['Finance and the teams inside it', 'Payroll', 'Lee Park', 'Legal and the teams inside it']);
    expect(entries[1]).toMatchObject({ people: 2 });
    // Legal is closed to them: its size isn't theirs to know.
    expect(entries[3].people).toBeUndefined();
    expect(people).toBe(4);
    expect(atLeast).toBe(true);
    expect(org?.name).toBe('Acme');
  });

  it('says everyone when the org can open it', () => {
    const all = explain({ ...ask, audience: [{ principal: 'org' }] }, acme);
    expect(all).toMatchObject({ people: 9, atLeast: false, org: undefined });
    expect(all.entries[0].who).toBe('Everyone at Acme');
  });

  it('shows each one, who’s left out, and who can change it, over the app that asked', async () => {
    await import('./auspex-access.js');
    const api = new AuspexApi(async () => new Response(JSON.stringify(acme), { status: 200 }));
    const el = document.createElement('auspex-access') as AuspexAccess;
    Object.assign(el, { api, ask, appName: 'Artifacts' });
    document.body.replaceChildren(el);
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 5));
      await el.updateComplete;
    }
    expect(el.querySelector('ui-heading')!.getAttribute('summary')).toBe('At least 4 people can open it.');
    const rows = [...el.querySelectorAll('.ax-who')].map((r) => r.textContent!.replace(/\s+/g, ' ').trim());
    expect(rows).toHaveLength(5);
    expect(rows[3]).toContain('You’re not on it, so its size isn’t shown');
    expect(rows[4]).toContain('Everyone else at Acme');
    expect(el.querySelector('.ax-can')!.textContent).toContain('Only whoever manages it can change who can open it, in Share.');
    let done = 0;
    el.addEventListener('auspex-done', () => done++);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    el.querySelector<HTMLElement>('.ax-can ui-button')!.click();
    expect(done).toBe(2);
    expect(el.querySelector('.ax-can ui-button')!.textContent).toBe('Back to Artifacts');
  });
});

describe('the replay, for leads and admins', () => {
  const now = new Date('2026-10-28T12:00:00').getTime();
  const at = (daysBack: number, hour = 10) => new Date(now - daysBack * 86_400_000).toISOString().replace(/T.*/, `T${String(hour).padStart(2, '0')}:00:00`);
  const changes = [
    { at: at(0), kind: 'joined' as const, floor: 'pay', person: 'alex' },
    { at: at(2), kind: 'app-blocked' as const, floor: 'pay', app: 'agents' },
    { at: at(2, 9), kind: 'left' as const, floor: 'pay', person: 'kim' },
    { at: at(29), kind: 'team-renamed' as const, floor: 'pay', name: 'Payroll' },
    { at: at(31), kind: 'joined' as const, floor: 'pay', person: 'old' },
  ];

  it('lays the month out a day at a time and adds it up', () => {
    const days = daysOf(changes, now);
    expect(days).toHaveLength(30);
    expect(days[0]!.changes.map((c) => c.kind)).toEqual(['team-renamed']);
    expect(days[27]!.changes.map((c) => c.kind)).toEqual(['left', 'app-blocked']);
    expect(days[29]!.changes.map((c) => c.kind)).toEqual(['joined']);
    expect(tally(days).map((t) => t.words)).toEqual(['1 joined', '1 left', '1 app change', '1 team change']);
    expect(tally(days.slice(0, 1)).map((t) => t.words)).toEqual(['1 team change']);
  });

  it('plays forward and lets a day be picked', async () => {
    await import('./auspex-replay.js');
    const api = new AuspexApi(async (path) => {
      expect(path).toBe('/api/auspex/v1/changes?days=30');
      return new Response(JSON.stringify({ days: 30, changes: [{ at: new Date().toISOString(), kind: 'joined', floor: 'pay', person: 'alex' }], names: { alex: 'Alex Kim' } }), { status: 200 });
    });
    const el = document.createElement('auspex-replay') as AuspexReplay;
    Object.assign(el, { api, floor: acme.floors[2] });
    document.body.replaceChildren(el);
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 5));
      await el.updateComplete;
    }
    expect(el.querySelector('ui-heading')!.getAttribute('summary')).toBe('1 change on Payroll: 1 joined.');
    expect(el.querySelectorAll('.ax-rday')).toHaveLength(30);
    expect(el.querySelector('.ax-events')!.textContent).toContain('Alex Kim joined');
    el.querySelectorAll<HTMLButtonElement>('.ax-rday')[3]!.click();
    await el.updateComplete;
    expect(el.day).toBe(3);
    expect(el.querySelectorAll('.ax-rday.later')).toHaveLength(26);
    expect(el.querySelector('#ax-replay-day + p')!.textContent).toBe('Nothing changed on Payroll that day.');
    el.play();
    expect(el.playing).toBe(true);
    el.play();
    expect(el.playing).toBe(false);
  });

  it('is offered to a floor’s leads, and explained to everyone else', async () => {
    await import('./auspex-app.js');
    const api = new AuspexApi(async (path) => new Response(JSON.stringify(path.includes('/me/map') ? acme : path.includes('/me/apps') ? { apps } : { days: 7, changes: [], names: {} }), { status: 200 }));
    const show = async (props: object) => {
      const el = document.createElement('auspex-app') as AuspexApp;
      Object.assign(el, { api, here: 'pay', place: { view: 'floor', id: 'pay' }, ...props });
      document.body.replaceChildren(el);
      for (let i = 0; i < 8; i++) {
        await new Promise((r) => setTimeout(r, 5));
        await el.updateComplete;
      }
      return el;
    };
    const lead = await show({ userId: 'sam' });
    expect([...lead.querySelectorAll('ui-button')].map((b) => b.textContent)).toContain('Replay the last 30 days');
    const member = await show({ userId: 'alex' });
    expect(member.querySelector('.ax-section:last-of-type')!.textContent).toContain('Payroll’s leads and admins can replay its last 30 days.');
    expect(placeFor('/floors/pay/replay', 'pay')).toEqual({ view: 'replay', id: 'pay' });
    expect(pathFor({ view: 'replay', id: 'pay' })).toBe('/floors/pay/replay');
  });
});

describe('the plant room, for admins', () => {
  const parts: Part[] = [
    { name: 'registry', kind: 'service', state: 'up', version: '0.7.0', latencyMs: 12 },
    { name: 'gateway', kind: 'gateway', state: 'up', version: '0.7.0', latencyMs: 3 },
    { name: 'folio', kind: 'app', state: 'down', problem: 'It didn’t answer in 3 s.' },
    { name: 'identity', kind: 'service', state: 'slow', version: '0.7.0', latencyMs: 1400 },
    { name: 'sign-in', kind: 'sign-in', state: 'up', latencyMs: 40 },
  ];

  it('puts each part in its room and says how many need someone', () => {
    expect(roomsOf(parts).map((r) => [r.label, r.parts.map((p) => p.name)])).toEqual([
      ['The way in', ['gateway', 'sign-in']],
      ['Services', ['identity', 'registry']],
      ['Apps’ services', ['folio']],
    ]);
    expect(plantLine(parts)).toBe('1 not answering, 1 slow of 5 parts.');
    expect(plantLine(parts.slice(0, 2))).toBe('All 2 parts are answering.');
    expect(placeFor('/plant', 'pay')).toEqual({ view: 'plant' });
  });

  const mount = async (admin: boolean) => {
    await import('./auspex-plant.js');
    const asked: string[] = [];
    const api = new AuspexApi(async (path) => {
      asked.push(path);
      const body = path.includes('/status')
        ? { components: parts, backups: { state: 'ok', lastBackup: { at: new Date().toISOString(), ok: true } } }
        : path.includes('/jobs')
          ? { jobs: [{ id: 'j1', app: 'board', action: 'install', release: { version: '1.2.0', channel: 'stable' }, requestedAt: new Date().toISOString(), state: 'running', steps: [{ step: 'verify', state: 'done', at: '' }, { step: 'storage', state: 'running', at: '' }] }] }
          : path.includes('/app-runner/apps')
            ? { installed: [{ app: 'board', name: 'Board', version: '1.1.0', previews: [{ pr: 42, version: '1.2.0-pr.42', endsAt: new Date().toISOString() }] }] }
            : { running: { version: '0.6.0', channel: 'beta' }, feed: 'on', available: { version: '0.7.0' }, needsYou: [{ message: 'x' }], updaterSeenAt: new Date().toISOString() };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    const el = document.createElement('auspex-plant') as AuspexPlant;
    Object.assign(el, { api, admin });
    document.body.replaceChildren(el);
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 5));
      await el.updateComplete;
    }
    return { el, asked };
  };

  it('shows every part as a machine with a lamp, and the release against the newest', async () => {
    const { el, asked } = await mount(true);
    expect(asked.sort()).toEqual(['/api/gateway/v1/status', '/api/registry/v1/app-runner/apps', '/api/registry/v1/app-runner/jobs', '/api/registry/v1/platform/updates']);
    // What's under way: the install as a track of stops, lit as far as it's got; the preview; and who last asked for work.
    expect(el.querySelector('.ax-job .t1')!.textContent).toBe('Board 1.2.0: installing');
    expect([...el.querySelectorAll('.ax-job .stop')].map((s) => s.getAttribute('aria-label'))).toEqual(['Signature: done', 'Storage: under way', 'Sign-in: not yet', 'Start: not yet', 'Health: not yet', 'Switch over: not yet', 'Retire old: not yet']);
    expect(el.textContent).toContain('Board, pull request 42');
    expect(el.textContent).toContain('App runner');
    expect(el.textContent).toContain('Hasn’t asked for work since the registry started, so an install asked for in Admin would wait.');
    expect(el.querySelector('.ax-release')!.getAttribute('aria-label')).toBe('AUGUR 0.6.0 is running; 0.7.0 is out.');
    expect(el.querySelector('.ax-machine.down')!.getAttribute('aria-label')).toBe('folio: Not answering. It didn’t answer in 3 s.');
    expect(el.querySelector('.ax-machine.slow .st')!.textContent).toBe('Slow: 1400 ms');
    expect(el.querySelectorAll('.ax-machine')).toHaveLength(9);
    expect(el.textContent).toContain('1 thing needs you first');
    el.remove();
  });

  it('tells anyone else what it is, and asks for nothing', async () => {
    const { el, asked } = await mount(false);
    expect(asked).toEqual([]);
    expect(el.querySelector('ui-state')!.getAttribute('heading')).toBe('The plant room is for admins');
    el.remove();
  });
});

describe('what’s under way in the plant room', () => {
  it('lights each step as far as a job has got, and words it', () => {
    expect(trackOf(UPGRADE_STEPS, [{ step: 'preflight', state: 'done', at: '' }, { step: 'backup', state: 'failed', at: '', message: 'Disk full' }]).map((s) => [s.label, s.state])).toEqual([
      ['Checks', 'done'],
      ['Backup', 'failed'],
      ['Fetch', 'waiting'],
      ['Roll forward', 'waiting'],
      ['Verify', 'waiting'],
    ]);
    // Rolling back shows only once it happens.
    expect(trackOf(UPGRADE_STEPS, [{ step: 'roll-back', state: 'running', at: '' }]).at(-1)).toMatchObject({ label: 'Roll back', state: 'running' });
    expect(trackOf(INSTALL_STEPS, [])).toHaveLength(7);
    const job = { id: 'j', app: 'folio', action: 'remove', requestedAt: '', state: 'failed', steps: [] } as AppJob;
    expect(jobLine(job, 'Artifacts')).toBe('Artifacts: couldn’t be removed');
    expect(upgradeLine({ id: 'u', from: '0.7.0', version: '0.8.0', requestedAt: '', state: 'rolled-back', steps: [] })).toBe('AUGUR 0.7.0 to 0.8.0: rolled back, still on 0.7.0');
  });

  it('keeps a week of finished jobs, newest first', () => {
    const now = Date.parse('2026-10-28T12:00:00Z');
    const j = (id: string, state: AppJob['state'], finishedAt?: string) => ({ id, app: 'a', action: 'install', requestedAt: '2026-10-01T00:00:00Z', state, steps: [], ...(finishedAt ? { finishedAt } : {}) }) as AppJob;
    expect(recent([j('old', 'done', '2026-10-10T00:00:00Z'), j('a', 'done', '2026-10-27T00:00:00Z'), j('live', 'running'), j('b', 'failed', '2026-10-28T00:00:00Z')], now).map((x) => x.id)).toEqual(['b', 'a']);
  });
});

describe('the building, for leads and admins', () => {
  it('puts each team in a room above the teams inside it, the org the roof', () => {
    const laid = layoutCutaway(acme, 'pay')!;
    const room = new Map(laid.rooms.map((r) => [r.id, r]));
    expect(laid.storeys).toBe(4);
    expect(room.get('org')).toMatchObject({ kind: 'org', y: 0, width: 960 });
    // A room spans exactly the rooms below it.
    const fin = room.get('fin')!;
    const kids = ['pay', 'tre'].map((id) => room.get(id)!);
    expect(Math.min(...kids.map((k) => k.x))).toBeCloseTo(fin.x);
    expect(Math.max(...kids.map((k) => k.x + k.width))).toBeCloseTo(fin.x + fin.width);
    expect(kids.every((k) => k.y > fin.y)).toBe(true);
    expect(room.get('dis')).toMatchObject({ reach: 'closed', depth: 3 });
    // Only what they may know: no headcount on a closed team.
    expect(room.get('leg')!.people).toBeUndefined();
    expect(room.get('pay')).toMatchObject({ reach: 'stand', here: true, lit: true, people: 2 });
    expect(room.get('fin')!.lit).toBe(true);
    expect(room.get('leg')!.lit).toBe(false);
    expect(laid.stairs).toEqual([{ from: 'pay', x: room.get('pay')!.x + room.get('pay')!.width - 18, bottom: laid.ground, top: 0 }]);
  });

  it('is for admins and anyone who leads a team', () => {
    expect(mayWalk(acme, 'alex', false)).toBe(false);
    expect(mayWalk(acme, 'sam', false)).toBe(true);
    expect(mayWalk(acme, 'alex', true)).toBe(true);
  });

  it('draws every room as a link, your door on the ground, and the plant room under it for admins', async () => {
    await import('./auspex-building.js');
    const el = document.createElement('auspex-building') as AuspexBuilding;
    Object.assign(el, { map: acme, here: 'pay', admin: true, plant: 'All 9 parts are answering.', plantState: 'up' });
    document.body.replaceChildren(el);
    await el.updateComplete;
    const labels = [...el.querySelectorAll('.room')].map((r) => r.getAttribute('aria-label'));
    expect(labels).toContain('Payroll. You can go here. 2 people. You’re here.');
    expect(labels).toContain('Legal. Closed to you.');
    expect(labels).toContain('Finance. You can go here. 4 people. On your way up.');
    expect(labels.at(-1)).toMatch(/^Your own floor\. Only you can go in/);
    expect(el.querySelectorAll('.stair')).toHaveLength(1);
    expect(el.querySelector('.basement')!.getAttribute('aria-label')).toBe('The plant room. All 9 parts are answering.');
    let floor = '';
    el.addEventListener('auspex-floor', (e) => (floor = (e as CustomEvent<{ id: string }>).detail.id));
    el.querySelector<SVGGElement>('.room.closed')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(floor).toBe('leg');
    el.admin = false;
    await el.updateComplete;
    expect(el.querySelector('.basement')).toBeNull();
  });

  it('tells anyone else who it’s for', async () => {
    await import('./auspex-app.js');
    const api = new AuspexApi(async () => new Response(JSON.stringify(acme), { status: 200 }));
    const el = document.createElement('auspex-app') as AuspexApp;
    Object.assign(el, { api, here: 'pay', userId: 'alex', place: placeFor('/building', 'pay') });
    document.body.replaceChildren(el);
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 5));
      await el.updateComplete;
    }
    expect(el.querySelector('ui-state')!.getAttribute('heading')).toBe('The building is for leads and admins');
    expect(pathFor({ view: 'building' })).toBe('/building');
  });
});
