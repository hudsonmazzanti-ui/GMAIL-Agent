import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../server/app.js';
import { makeRng } from '../server/engine/types.js';
import { Client, runDemoEvent } from '../scripts/demo.js';

const { app } = await buildApp({ dbPath: ':memory:' });
afterAll(() => app.close());

describe('full event through the API', () => {
  it('runs registration → Swiss → top 8 → champion', async () => {
    const { state } = await runDemoEvent(app, { staffPassword: 'secret123', rng: makeRng(42) });
    expect(state.rounds.filter((r: any) => r.phase === 'swiss')).toHaveLength(4);
    expect(state.standings.filter((s: any) => s.dropped)).toHaveLength(1);
    // Every Swiss round paired the active players exactly once.
    for (const r of state.rounds.filter((r: any) => r.phase === 'swiss')) {
      const ids = r.matches.flatMap((m: any) => [m.p1.id, m.p2?.id].filter(Boolean));
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('enforces permissions and result rules', async () => {
    const anon = new Client(app);
    await anon.post('/api/events', { name: 'x' }, 403);
    await anon.post('/api/auth/staff/login', { password: 'wrong' }, 401);

    const staff = new Client(app);
    await staff.post('/api/auth/staff/login', { password: 'secret123' });
    const { id } = await staff.post('/api/events', { name: 'Rules test', bestOf: 3 });
    await staff.post(`/api/events/${id}/status`, { status: 'registration' });

    const a = new Client(app);
    const b = new Client(app);
    const c = new Client(app);
    const pa = await a.post('/api/auth/player/signup', { name: 'Rule A', pin: '1111' });
    await b.post('/api/auth/player/signup', { name: 'Rule B', pin: '2222' });
    await c.post('/api/auth/player/signup', { name: 'Rule C', pin: '3333' });
    await c.post('/api/auth/player/signup', { name: 'Rule A', pin: '9999' }, 400);
    for (const p of [a, b]) await p.post(`/api/events/${id}/register`);
    await staff.post(`/api/events/${id}/advance`, {}, 400); // nobody checked in
    const st = await staff.get(`/api/events/${id}/state`);
    for (const r of st.registrations) await staff.post(`/api/events/${id}/checkin`, { playerId: r.playerId, checkedIn: true });
    await staff.post(`/api/events/${id}/advance`);
    const match = (await staff.get(`/api/events/${id}/state`)).rounds[0].matches[0];

    await c.post(`/api/matches/${match.id}/result`, { p1Games: 2, p2Games: 0 }, 403); // not their match
    const [mine, theirs] = match.p1.id === pa.playerId ? [a, b] : [b, a];
    await mine.post(`/api/matches/${match.id}/result`, { p1Games: 3, p2Games: 0 }, 400); // bo3 max 2 wins
    await mine.post(`/api/matches/${match.id}/result`, { p1Games: 2, p2Games: 1 });
    await mine.post(`/api/matches/${match.id}/respond`, { accept: true }, 400); // can't confirm own report
    await staff.post(`/api/events/${id}/advance`, {}, 400); // unconfirmed result
    await theirs.post(`/api/matches/${match.id}/respond`, { accept: false });
    let m = (await staff.get(`/api/events/${id}/state`)).rounds[0].matches[0];
    expect(m.resultStatus).toBe('disputed');
    await staff.post(`/api/matches/${match.id}/result`, { p1Games: 1, p2Games: 2 });
    m = (await staff.get(`/api/events/${id}/state`)).rounds[0].matches[0];
    expect(m).toMatchObject({ resultStatus: 'confirmed', p1Games: 1, p2Games: 2 });
    await staff.post(`/api/events/${id}/advance`);
  });

  it('waitlists past capacity and promotes on unregister', async () => {
    const staff = new Client(app);
    await staff.post('/api/auth/staff/login', { password: 'secret123' });
    const { id } = await staff.post('/api/events', { name: 'Small', capacity: 1 });
    await staff.post(`/api/events/${id}/status`, { status: 'registration' });
    const a = new Client(app);
    const b = new Client(app);
    await a.post('/api/auth/player/signup', { name: 'Cap A', pin: '1111' });
    await b.post('/api/auth/player/signup', { name: 'Cap B', pin: '1111' });
    expect((await a.post(`/api/events/${id}/register`)).status).toBe('registered');
    expect((await b.post(`/api/events/${id}/register`)).status).toBe('waitlist');
    await a.post(`/api/events/${id}/unregister`);
    const st = await staff.get(`/api/events/${id}/state`);
    expect(st.registrations.map((r: any) => r.status)).toEqual(['registered']);
  });

  it('makes the PIN optional', async () => {
    // No PIN: log in with the name alone, from any phone.
    const a = new Client(app);
    await a.post('/api/auth/player/signup', { name: 'No Pin', pin: '' });
    const again = new Client(app);
    expect(await again.post('/api/auth/player/login', { name: 'No Pin' })).toMatchObject({ ok: true });
    expect((await again.get('/api/auth/me')).hasPin).toBe(false);
    await again.post('/api/auth/player/login', { name: 'Nobody Here' }, 404);
    await a.post('/api/auth/player/signup', { name: 'Bad Pin', pin: '12' }, 400);

    // Adding a PIN: the name now needs it, and other phones are logged out.
    await a.post('/api/auth/player/pin', { pin: '2468' });
    expect((await again.get('/api/auth/me')).viewer.kind).toBe('anon');
    const b = new Client(app);
    expect(await b.post('/api/auth/player/login', { name: 'No Pin' })).toEqual({ ok: false, needsPin: true });
    expect((await b.get('/api/auth/me')).viewer.kind).toBe('anon');
    await b.post('/api/auth/player/login', { name: 'No Pin', pin: '1111' }, 401);
    await b.post('/api/auth/player/login', { name: 'No Pin', pin: '2468' });

    // Changing or removing it needs the current PIN.
    await b.post('/api/auth/player/pin', { currentPin: '0000', pin: null }, 401);
    await b.post('/api/auth/player/pin', { currentPin: '2468', pin: null });
    expect(await new Client(app).post('/api/auth/player/login', { name: 'No Pin' })).toMatchObject({ ok: true });

    // Staff walk-ins have no PIN and can log in by name; staff can set and remove PINs.
    const staff = new Client(app);
    await staff.post('/api/auth/staff/login', { password: 'secret123' });
    const walkIn = await staff.post('/api/players', { name: 'Desk Walkin' });
    await new Client(app).post('/api/auth/player/login', { name: 'Desk Walkin' });
    await staff.call('PATCH', `/api/players/${walkIn.id}`, { pin: '1357' });
    expect((await new Client(app).post('/api/auth/player/login', { name: 'Desk Walkin' })).needsPin).toBe(true);
    await staff.call('PATCH', `/api/players/${walkIn.id}`, { pin: null });
    expect((await new Client(app).post('/api/auth/player/login', { name: 'Desk Walkin' })).ok).toBe(true);
    await new Client(app).post('/api/auth/player/pin', { pin: '1234' }, 401); // must be logged in
  });

  it('gives every event a join code that players can look up', async () => {
    const staff = new Client(app);
    await staff.post('/api/auth/staff/login', { password: 'secret123' });
    const { id } = await staff.post('/api/events', { name: 'Code night' });
    const { event } = await staff.get(`/api/events/${id}/state`);
    expect(event.join_code).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);

    const player = new Client(app);
    // Drafts are hidden from players; staff can still look them up.
    await player.call('GET', `/api/join/${event.join_code}`, undefined, 404);
    expect((await staff.get(`/api/join/${event.join_code}`)).eventId).toBe(id);
    await staff.post(`/api/events/${id}/status`, { status: 'registration' });
    // Case, spaces and dashes don't matter.
    const typed = `${event.join_code.slice(0, 3)}-${event.join_code.slice(3)}`.toLowerCase();
    expect(await player.get(`/api/join/${typed}`)).toEqual({ eventId: id, name: 'Code night', status: 'registration' });
    await player.call('GET', '/api/join/ZZZZZZ', undefined, 404);
    expect((await player.get('/api/server-info')).publicUrls).toEqual([]);
  });

  it('locks out PIN guessing', async () => {
    const x = new Client(app);
    await x.post('/api/auth/player/signup', { name: 'Locked', pin: '4321' });
    const guesser = new Client(app);
    for (let i = 0; i < 5; i++) await guesser.post('/api/auth/player/login', { name: 'Locked', pin: '0000' }, 401);
    await guesser.post('/api/auth/player/login', { name: 'Locked', pin: '4321' }, 429);
  });
});
