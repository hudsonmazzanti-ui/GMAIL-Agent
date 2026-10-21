import type { DemoBackend } from './backend';

/** Demo data: a finished event, one mid-Swiss, and one taking paid registrations through the fake POS. */
export const DEMO_PLAYERS = [
  'Ash K.', 'Brock T.', 'Misty W.', 'Gary O.', 'Dawn B.', 'Iris N.', 'Cilan D.', 'Serena Y.',
  'Clemont L.', 'Lillie A.', 'Hau M.', 'Gloria S.', 'Hop P.', 'Nemona Q.',
];
/** Only this player has a PIN, to show the PIN prompt; everyone else logs in by name. */
export const DEMO_PIN_PLAYER = 'Ash K.';
export const DEMO_PIN = '1234';

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

export async function seedDemo(b: DemoBackend) {
  let rng = 7;
  const rand = () => ((rng = (rng * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

  const call = async (token: string | null, method: string, url: string, body?: unknown) => {
    const res = await b.handle(method, url, body, token);
    if (res.status !== 200) throw new Error(`${method} ${url}: ${(res.body as { error: string }).error}`);
    return { body: res.body as any, token: res.token };
  };
  const staffToken = (await call(null, 'POST', '/api/auth/staff/setup', { password: 'changeme' })).token!;
  const staff = (method: string, url: string, body?: unknown) => call(staffToken, method, url, body).then((r) => r.body);

  const players: { id: number; token: string }[] = [];
  for (const name of DEMO_PLAYERS) {
    const r = await call(null, 'POST', '/api/auth/player/signup', { name, pin: name === DEMO_PIN_PLAYER ? DEMO_PIN : '' });
    players.push({ id: r.body.playerId, token: r.token! });
  }
  const tokenOf = new Map(players.map((p) => [p.id, p.token]));

  const result = (bo: number, draws: boolean) => {
    const r = rand();
    if (draws && r < 0.08) return { p1Games: 1, p2Games: 1, draws: 1 };
    const loser = rand() < 0.5 ? 0 : 1;
    const win = Math.ceil(bo / 2);
    return r < 0.54 ? { p1Games: win, p2Games: loser, draws: 0 } : { p1Games: loser, p2Games: win, draws: 0 };
  };

  async function makeEvent(body: Record<string, unknown>, who: { id: number; token: string }[]) {
    const { id } = await staff('POST', '/api/events', body);
    for (const p of who) await call(p.token, 'POST', `/api/events/${id}/register`);
    return id as number;
  }
  const state = (id: number) => staff('GET', `/api/events/${id}/state`);

  // 1. Last Friday's event, finished with a top 8.
  const fnm = await makeEvent(
    { name: 'Friday Night Constructed', game: 'Any TCG', format: 'Constructed', date: day(-4), startTime: '18:30', topCutSize: 8, bestOf: 3 },
    players.slice(0, 12),
  );
  for (const p of players.slice(0, 12)) await staff('POST', `/api/events/${fnm}/checkin`, { playerId: p.id, checkedIn: true });
  await staff('POST', `/api/events/${fnm}/advance`);
  for (let guard = 0; guard < 12; guard++) {
    const s = await state(fnm);
    if (s.event.status === 'complete') break;
    const round = s.rounds.at(-1);
    for (const m of round.matches) {
      if (m.p2) await staff('POST', `/api/matches/${m.id}/result`, result(3, round.phase === 'swiss'));
    }
    await staff('POST', `/api/events/${fnm}/advance`);
  }

  // 2. Tonight's draft league, in round 2 with results coming in.
  const draft = await makeEvent(
    { name: 'Thursday Draft League', game: 'Any TCG', format: 'Booster Draft', date: day(0), startTime: '19:00' },
    players.slice(2, 11),
  );
  for (const p of players.slice(2, 11)) await staff('POST', `/api/events/${draft}/checkin`, { playerId: p.id, checkedIn: true });
  await staff('POST', `/api/events/${draft}/advance`);
  let s = await state(draft);
  for (const m of s.rounds[0].matches) if (m.p2) await staff('POST', `/api/matches/${m.id}/result`, result(3, true));
  await staff('POST', `/api/events/${draft}/advance`);
  s = await state(draft);
  const r2 = s.rounds.at(-1);
  await staff('POST', `/api/rounds/${r2.id}/timer`, { action: 'start' });
  await staff('POST', `/api/rounds/${r2.id}/timer`, { action: 'add', minutes: -18 });
  const real = r2.matches.filter((m: any) => m.p2);
  // Tables 1-2: reported by a player. Table 3: flagged by the opponent. Table 4: not in yet.
  if (real[0]) await call(tokenOf.get(real[0].p1.id)!, 'POST', `/api/matches/${real[0].id}/result`, { p1Games: 2, p2Games: 1, draws: 0 });
  if (real[1]) await call(tokenOf.get(real[1].p2.id)!, 'POST', `/api/matches/${real[1].id}/result`, { p1Games: 0, p2Games: 2, draws: 0 });
  if (real[2]) {
    await call(tokenOf.get(real[2].p1.id)!, 'POST', `/api/matches/${real[2].id}/result`, { p1Games: 2, p2Games: 0, draws: 0 });
    await call(tokenOf.get(real[2].p2.id)!, 'POST', `/api/matches/${real[2].id}/respond`, { accept: false });
  }

  // 3. Saturday's paid sealed event: entry on the (fake) PayPal POS, a few players already paid.
  await staff('POST', '/api/pos/connect', { apiKey: 'demo-api-key', clientId: 'demo-client' });
  const sealed = await makeEvent(
    {
      name: 'Saturday Sealed',
      game: 'Any TCG',
      format: 'Sealed',
      date: day(2),
      startTime: '12:00',
      capacity: 24,
      entryFeeCents: 2500,
      currency: 'USD',
      entryFeeNote: 'Packs to top 4',
    },
    players.slice(0, 7),
  );
  // Created with a fee while the POS is connected, so the entry is already on the POS.
  const product = [...b.pos.products.values()].at(-1)!;
  await staff('POST', `/api/events/${sealed}/payments/collect`, { playerId: players[0].id });
  b.pos.sale([{ productUuid: product.uuid }]);
  await staff('POST', '/api/pos/sync');
  await staff('POST', `/api/events/${sealed}/payments/manual`, { playerId: players[1].id, method: 'cash' });
  b.pos.sale([{ productUuid: product.uuid }], 'Sam (register 2)'); // rung up without pressing Collect
  await staff('POST', '/api/pos/sync');

  return { staffToken, events: { fnm, draft, sealed } };
}
