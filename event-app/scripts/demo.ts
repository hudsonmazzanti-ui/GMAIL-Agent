import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';

/** Minimal cookie-jar client around fastify.inject, one per simulated browser. */
export class Client {
  cookie = '';
  constructor(private app: FastifyInstance) {}

  async call<T = any>(method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown, expectStatus = 200): Promise<T> {
    const res = await this.app.inject({ method, url, payload: payload as any, headers: this.cookie ? { cookie: this.cookie } : {} });
    const set = res.headers['set-cookie'];
    if (set) this.cookie = (Array.isArray(set) ? set[0] : set).split(';')[0];
    assert.equal(res.statusCode, expectStatus, `${method} ${url} → ${res.statusCode} ${res.body}`);
    return res.headers['content-type']?.includes('json') ? res.json() : (res.body as T);
  }
  get = <T = any>(url: string) => this.call<T>('GET', url);
  post = <T = any>(url: string, body: unknown = {}, status = 200) => this.call<T>('POST', url, body, status);
}

export const DEMO_NAMES = [
  'Ash K.', 'Brock T.', 'Misty W.', 'Gary O.', 'Dawn B.', 'Iris N.', 'Cilan D.',
  'Serena Y.', 'Clemont L.', 'Lillie A.', 'Hau M.', 'Gloria S.', 'Hop P.',
];

/**
 * Walk a complete event through the HTTP API: staff setup → players sign up and register →
 * check-in → Swiss rounds with player-reported results → top 8 → champion.
 * Returns the final event state.
 */
export async function runDemoEvent(app: FastifyInstance, opts: { staffPassword: string; rng?: () => number; eventName?: string }) {
  const rng = opts.rng ?? Math.random;
  const staff = new Client(app);
  const me = await staff.get('/api/auth/me');
  if (me.staffSetupNeeded) await staff.post('/api/auth/staff/setup', { password: opts.staffPassword });
  else await staff.post('/api/auth/staff/login', { password: opts.staffPassword });

  const { id: eventId } = await staff.post('/api/events', {
    name: opts.eventName ?? 'Friday Night Demo',
    game: 'Any TCG',
    format: 'Constructed',
    date: new Date().toISOString().slice(0, 10),
    startTime: '18:30',
    bestOf: 3,
    roundMinutes: 50,
    topCutSize: 8,
  });
  await staff.post(`/api/events/${eventId}/status`, { status: 'registration' });

  const players = new Map<number, Client>();
  for (const name of DEMO_NAMES) {
    const c = new Client(app);
    const res = await c.post('/api/auth/player/signup', { name, pin: '1234' }, 200).catch(async () => {
      return c.post('/api/auth/player/login', { name, pin: '1234' });
    });
    await c.post(`/api/events/${eventId}/register`);
    players.set(res.playerId, c);
  }

  // A walk-in added by staff, and a no-show who never checks in.
  const walkIn = await staff.post('/api/players', { name: `Walk-in ${Date.now() % 10000}` });
  await staff.post(`/api/events/${eventId}/register`, { playerId: walkIn.id });
  const noShow = [...players.keys()].at(-1)!;

  await staff.post(`/api/events/${eventId}/status`, { status: 'checkin' });
  let state = await staff.get(`/api/events/${eventId}/state`);
  for (const r of state.registrations) {
    if (r.playerId !== noShow) await staff.post(`/api/events/${eventId}/checkin`, { playerId: r.playerId, checkedIn: true });
  }
  state = await staff.get(`/api/events/${eventId}/state`);
  assert.equal(state.counts.checkedIn, 13);

  await staff.post(`/api/events/${eventId}/advance`);
  state = await staff.get(`/api/events/${eventId}/state`);
  assert.equal(state.event.status, 'swiss');
  assert.equal(state.event.swiss_rounds, 4);

  const randomResult = (bo: number, allowDraw: boolean) => {
    const roll = rng();
    if (allowDraw && roll < 0.08) return { p1Games: 1, p2Games: 1, draws: 0 };
    const loser = bo === 1 ? 0 : rng() < 0.5 ? 0 : 1;
    const win = Math.ceil(bo / 2);
    return roll < 0.5 ? { p1Games: win, p2Games: loser, draws: 0 } : { p1Games: loser, p2Games: win, draws: 0 };
  };

  for (let guard = 0; guard < 20 && state.event.status !== 'complete'; guard++) {
    const round = state.rounds.at(-1);
    await staff.post(`/api/rounds/${round.id}/timer`, { action: 'start' });
    for (const m of round.matches) {
      if (!m.p2) continue;
      const result = randomResult(state.event.best_of, round.phase === 'swiss');
      const p1 = players.get(m.p1.id);
      const p2 = players.get(m.p2.id);
      if (p1 && p2) {
        // Player 1 reports, player 2 confirms.
        await p1.post(`/api/matches/${m.id}/result`, result);
        await p2.post(`/api/matches/${m.id}/respond`, { accept: true });
      } else {
        await staff.post(`/api/matches/${m.id}/result`, result);
      }
    }
    // One player drops after round 2.
    if (round.phase === 'swiss' && round.number === 2) {
      const dropper = state.standings.at(-1).playerId;
      await staff.post(`/api/events/${eventId}/drop`, { playerId: dropper });
    }
    await staff.post(`/api/events/${eventId}/advance`);
    state = await staff.get(`/api/events/${eventId}/state`);
  }

  assert.equal(state.event.status, 'complete');
  const topcut = state.rounds.filter((r: any) => r.phase === 'topcut');
  assert.deepEqual(topcut.map((r: any) => r.label), ['Quarterfinals', 'Semifinals', 'Finals']);
  assert.ok(state.champion, 'event has a champion');
  return { eventId, state, staff, players };
}
