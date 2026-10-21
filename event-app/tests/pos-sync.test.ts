import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DB } from '../server/db/client.js';
import { clientIdFromApiKey, uuidV1, type PosPurchase } from '../server/pos/client.js';
import * as pay from '../server/pos/payments.js';
import { applyPurchases, COLLECT_WINDOW_MS } from '../server/pos/sync.js';
import { buildApp } from '../server/app.js';
import { Client } from '../scripts/demo.js';
import { createFakePos, FAKE_API_KEY, FAKE_CLIENT_ID } from '../scripts/fake-pos.js';

const PRODUCT = 'prod-entry';
let db: DB;
let eventId: number;
let players: number[];

function setup() {
  db = openDb(':memory:');
  eventId = Number(
    db.prepare("INSERT INTO events (name, status, entry_fee_cents, pos_product_uuid) VALUES ('FNM', 'registration', 1000, ?)").run(PRODUCT)
      .lastInsertRowid,
  );
  players = ['Ann', 'Ben', 'Cy'].map((name) => {
    const id = Number(db.prepare('INSERT INTO players (name) VALUES (?)').run(name).lastInsertRowid);
    db.prepare("INSERT INTO registrations (event_id, player_id, status) VALUES (?, ?, 'registered')").run(eventId, id);
    return id;
  });
}

const sale = (uuid: string, quantity: number, at: number, product = PRODUCT): PosPurchase => ({
  purchaseUUID1: uuid,
  purchaseNumber: 7,
  timestamp: new Date(at).toISOString(),
  currency: 'USD',
  products: [{ productUuid: product, quantity: String(quantity), unitPrice: 1000 }],
});
const payments = () => db.prepare('SELECT player_id, status FROM payments ORDER BY id').all() as { player_id: number | null; status: string }[];

describe('applyPurchases', () => {
  beforeEach(setup);

  it('credits the player waiting at the desk', () => {
    const now = Date.now();
    pay.collect(db, eventId, players[1]);
    const changed = applyPurchases(db, [sale('s1', 1, now + 5_000)], now + 6_000);
    expect([...changed]).toEqual([eventId]);
    expect(payments()).toEqual([{ player_id: players[1], status: 'paid' }]);
    expect(pay.paymentState(db, eventId).waiting.size).toBe(0);
  });

  it('fills waiting players in order for a multi-quantity sale', () => {
    const now = Date.now();
    pay.collect(db, eventId, players[2]);
    db.prepare('UPDATE pos_waiting SET since = ? WHERE player_id = ?').run(now - 2000, players[2]);
    pay.collect(db, eventId, players[0]);
    applyPurchases(db, [sale('s1', 2, now + 1000)], now + 1000);
    expect(payments().map((p) => p.player_id)).toEqual([players[2], players[0]]);
  });

  it('leaves sales unassigned when nobody is waiting, or the request is stale', () => {
    const now = Date.now();
    pay.collect(db, eventId, players[0]);
    db.prepare('UPDATE pos_waiting SET since = ?').run(now - COLLECT_WINDOW_MS - 10_000);
    applyPurchases(db, [sale('s1', 1, now)], now);
    expect(payments()).toEqual([{ player_id: null, status: 'paid' }]);
    expect(pay.paymentState(db, eventId).unassigned).toHaveLength(1);
  });

  it('ignores sales of other products', () => {
    expect(applyPurchases(db, [sale('s1', 3, Date.now(), 'coffee')]).size).toBe(0);
    expect(payments()).toEqual([]);
  });

  it('is idempotent when the same page is applied twice', () => {
    const page = [sale('s1', 2, Date.now())];
    applyPurchases(db, page);
    expect(applyPurchases(db, page).size).toBe(0);
    expect(payments()).toHaveLength(2);
  });

  it('marks payments refunded when the POS refunds the sale', () => {
    const now = Date.now();
    pay.collect(db, eventId, players[0]);
    applyPurchases(db, [sale('s1', 1, now)], now);
    const refund: PosPurchase = { ...sale('r1', -1, now + 1000), refund: true, refundsPurchaseUUID1: 's1' };
    applyPurchases(db, [refund], now + 1000);
    expect(payments()).toEqual([{ player_id: players[0], status: 'refunded' }]);
    expect(pay.paymentState(db, eventId).byPlayer.get(players[0])?.status).toBe('refunded');
  });

  it('desk operations: cash, comp, assign, undo', () => {
    pay.recordManual(db, eventId, players[0], 'cash');
    expect(() => pay.recordManual(db, eventId, players[0], 'comp')).toThrow(/already paid/);
    pay.recordManual(db, eventId, players[1], 'comp');
    applyPurchases(db, [sale('s1', 1, Date.now())]);
    const tray = pay.paymentState(db, eventId).unassigned;
    pay.assign(db, tray[0].id, players[2]);
    const s = pay.paymentState(db, eventId);
    expect(s.totals).toEqual({ pos: 1000, cash: 1000, comp: 0 });
    expect(s.paidCount).toBe(3);
    pay.removePayment(db, tray[0].id); // POS sale goes back to the tray
    expect(pay.paymentState(db, eventId).unassigned).toHaveLength(1);
  });
});

describe('POS client helpers', () => {
  it('generates version-1 UUIDs', () => {
    expect(uuidV1()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-1[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it('reads client_id from an API key JWT', () => {
    const jwt = ['x', Buffer.from(JSON.stringify({ client_id: 'abc' })).toString('base64url'), 'sig'].join('.');
    expect(clientIdFromApiKey(jwt)).toBe('abc');
    expect(clientIdFromApiKey('not-a-jwt')).toBeNull();
  });
});

describe('end to end against the fake PayPal POS', async () => {
  const fake = await createFakePos();
  const url = await fake.app.listen({ port: 0, host: '127.0.0.1' });
  const { app } = await buildApp({ dbPath: ':memory:', posUrls: { oauth: url, products: url, purchases: url } });
  afterAll(async () => {
    await app.close();
    await fake.app.close();
  });

  it('connects, puts the fee on the POS, and marks the right player paid', async () => {
    const staff = new Client(app);
    await staff.post('/api/auth/staff/setup', { password: 'secret123' });
    await staff.post('/api/pos/connect', { apiKey: 'wrong', clientId: FAKE_CLIENT_ID }, 502);
    const status = await staff.post('/api/pos/connect', { apiKey: FAKE_API_KEY, clientId: FAKE_CLIENT_ID });
    expect(status.connected).toBe(true);

    const { id } = await staff.post('/api/events', { name: 'Paid event', entryFeeCents: 1500, currency: 'USD', requirePayment: true });
    await staff.post(`/api/events/${id}/status`, { status: 'registration' });
    await staff.post(`/api/events/${id}/pos/product`);
    expect(fake.products.size).toBe(1);
    const product = [...fake.products.values()][0];
    expect(product.variants[0].price).toEqual({ amount: 1500, currencyId: 'USD' });
    await staff.call('PATCH', `/api/events/${id}`, { entryFeeCents: 2000 }, 400); // price locked while linked

    const p = new Client(app);
    const me = await p.post('/api/auth/player/signup', { name: 'Payer', pin: '1234' });
    await p.post(`/api/events/${id}/register`);
    await staff.post(`/api/events/${id}/checkin`, { playerId: me.playerId, checkedIn: true }, 400); // unpaid

    await staff.post(`/api/events/${id}/payments/collect`, { playerId: me.playerId });
    fake.sale([{ productUuid: product.uuid }]);
    const tokensBefore = fake.stats.tokenRequests;
    fake.revokeTokens();
    await staff.post('/api/pos/sync');
    expect(fake.stats.tokenRequests).toBeGreaterThan(tokensBefore); // 401 → token re-fetched → retried

    let st = await staff.get(`/api/events/${id}/state`);
    const reg = st.registrations.find((r: any) => r.playerId === me.playerId);
    expect(reg.payment).toMatchObject({ method: 'pos', status: 'paid', amountCents: 1500, posNumber: '1001' });
    expect(st.payments).toMatchObject({ paidCount: 1, owing: 0, totals: { pos: 1500 } });
    await staff.post(`/api/events/${id}/checkin`, { playerId: me.playerId, checkedIn: true });

    // Players only see their own payment, and never the tray.
    const mine = await p.get(`/api/events/${id}/state`);
    expect(mine.registrations[0].payment.status).toBe('paid');
    expect(mine.payments.unassigned).toBeUndefined();
    await p.post('/api/pos/sync', {}, 403);

    // A second sale with nobody waiting lands in the tray; a refund flips the first one.
    fake.sale([{ productUuid: product.uuid }]);
    fake.refund(fake.purchases[0].purchaseUUID1!);
    await staff.post('/api/pos/sync');
    st = await staff.get(`/api/events/${id}/state`);
    expect(st.payments.unassigned).toHaveLength(1);
    expect(st.registrations[0].payment.status).toBe('refunded');

    // Staff move the tray sale onto the player; the CSV has both POS sales.
    await staff.post(`/api/payments/${st.payments.unassigned[0].id}/assign`, { playerId: me.playerId });
    st = await staff.get(`/api/events/${id}/state`);
    expect(st.registrations[0].payment).toMatchObject({ status: 'paid', posNumber: '1002' });
    const csv = await staff.get(`/api/events/${id}/payments.csv`);
    expect(csv.split('\n')).toHaveLength(3);
  });
});
