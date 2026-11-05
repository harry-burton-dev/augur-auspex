import { callerCheckFor, callerHeaders, callerSigner, signedCallerHeaders, type CallerWorkspace, type DirectorySearch, type DomainEvent } from '@augur/service-kit';
import { describe, expect, it } from 'vitest';
import { buildApp } from './app.ts';
import { History } from './history.ts';

const NOW = Date.parse('2026-10-27T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
let seq = 0;
const event = (topic: string, payload: object, daysAgo: number, workspace?: string): DomainEvent => ({
  seq: String(++seq),
  id: `e${seq}`,
  topic,
  publisher: 'platform',
  at: new Date(NOW - daysAgo * DAY).toISOString(),
  payload,
  ...(workspace ? { workspace: { id: workspace, path: [workspace] } } : {}),
});

const directory: DirectorySearch = async ({ q, ids }) => {
  const people = [{ id: 'sam', name: 'Sam Okafor' }, { id: 'alex', name: 'Alex Kim' }];
  const teams = [{ id: 'w-payroll', name: 'Payroll', within: ['Finance'] }, { id: 'w-finance', name: 'Finance', within: [] }];
  if (ids) return { people: people.filter((p) => ids.includes(p.id)), teams: teams.filter((t) => ids.includes(t.id)) };
  return { people, teams: teams.filter((t) => t.name.toLowerCase().includes((q ?? '').toLowerCase())) };
};

const on = (workspace: CallerWorkspace, id = 'alex') => callerHeaders({ id, name: id, departments: [], roles: [], workspace });
const payroll: CallerWorkspace = { id: 'w-payroll', kind: 'team', role: 'member' };
const org: CallerWorkspace = { id: 'w-org', kind: 'org', role: 'member' };

const withHistory = async () => {
  const history = new History(() => NOW);
  const joined = event('platform.team.member-added', { team: 'w-payroll', person: 'alex' }, 2, 'w-org');
  // Read twice, as after a retry: kept once.
  history.add(joined);
  history.add(joined);
  history.add(event('platform.app.blocked', { app: 'agents' }, 1, 'w-finance'));
  history.add(event('platform.app.turned-on', { app: 'board' }, 3, 'w-payroll'));
  history.add(event('platform.app.turned-off', { app: 'notes' }, 1));
  history.add(event('platform.team.member-removed', { team: 'w-payroll', person: 'sam' }, 20, 'w-org'));
  history.add(event('platform.person.disabled', { person: 'sam' }, 1));
  return { history, app: await buildApp({ history, directory }) };
};

describe('auspex', () => {
  it('reports healthy', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.json()).toMatchObject({ status: 'ok', service: 'auspex', version: expect.stringMatching(/^\d+\.\d+\.\d+/), api: 'v1' });
  });

  it('tells what changed on the floor you’re on this week, newest first, with names', async () => {
    const { app } = await withHistory();
    const res = await app.inject({ method: 'GET', url: '/v1/changes', headers: on(payroll) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // The repeated event counts once; the one 20 days ago is past this week; Finance's block is Finance's.
    expect(body.changes).toEqual([
      { at: expect.any(String), kind: 'joined', floor: 'w-payroll', person: 'alex', team: 'w-payroll' },
      { at: expect.any(String), kind: 'app-on', floor: 'w-payroll', app: 'board' },
    ]);
    expect(body.names).toEqual({ alex: 'Alex Kim', 'w-payroll': 'Payroll' });
    const month = (await app.inject({ method: 'GET', url: '/v1/changes?days=30', headers: on(payroll) })).json();
    expect(month.changes.map((c: { kind: string }) => c.kind)).toEqual(['joined', 'app-on', 'left']);
  });

  it('shows the org floor what happened everywhere, but never anyone’s sign-in', async () => {
    const { app } = await withHistory();
    const body = (await app.inject({ method: 'GET', url: '/v1/changes', headers: on(org) })).json();
    expect(body.changes).toEqual([{ at: expect.any(String), kind: 'app-off', app: 'notes' }]);
  });

  it('shows nothing on your own floor, and needs a floor and a caller', async () => {
    const { app } = await withHistory();
    const own = (await app.inject({ method: 'GET', url: '/v1/changes', headers: on({ id: 'p-alex', kind: 'personal', role: 'lead' }) })).json();
    expect(own.changes).toEqual([]);
    expect((await app.inject({ method: 'GET', url: '/v1/changes', headers: callerHeaders({ id: 'alex', name: 'alex', departments: [], roles: [] }) })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/v1/changes' })).statusCode).toBe(401);
  });

  it('names people by id, a few at a time', async () => {
    const { app } = await withHistory();
    expect((await app.inject({ method: 'GET', url: '/v1/names?ids=sam,nobody', headers: on(payroll) })).json()).toEqual({ names: { sam: 'Sam Okafor' } });
    const many = Array.from({ length: 51 }, (_, i) => `p${i}`).join(',');
    const tooMany = await app.inject({ method: 'GET', url: `/v1/names?ids=${many}`, headers: on(payroll) });
    expect(tooMany.statusCode).toBe(400);
    // A problem (RFC 9457) that says the limit, as every refusal is.
    expect(tooMany.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(tooMany.json()).toMatchObject({ status: 400, reason: 'too_many', detail: expect.stringMatching(/at most 50/) });
  });

  it('finds teams for Find, each opening on its floor', async () => {
    const { app } = await withHistory();
    const body = (await app.inject({ method: 'GET', url: '/v1/search?q=pay', headers: on(payroll) })).json();
    expect(body.results).toEqual([{ id: 'w-payroll', title: 'Payroll', detail: 'Team inside Finance', path: '/floors/w-payroll' }]);
    expect((await app.inject({ method: 'GET', url: '/v1/search?q=', headers: on(payroll) })).json()).toEqual({ results: [] });
  });

  it('believes only the caller the gateway signed for it', async () => {
    const gateway = callerSigner();
    const app = await buildApp({ callers: callerCheckFor(gateway, 'auspex') });
    const sam = { id: 'u1', name: 'Sam Okafor', departments: [], roles: [] };
    const signed = await app.inject({ remoteAddress: '172.18.0.9', method: 'GET', url: '/v1/names?ids=u1', headers: await signedCallerHeaders(gateway, sam, 'auspex') });
    expect(signed.statusCode).toBe(200);
    const forged = await app.inject({ remoteAddress: '172.18.0.9', method: 'GET', url: '/v1/names?ids=u1', headers: callerHeaders(sam) });
    expect(forged.statusCode).toBe(401);
  });
});
