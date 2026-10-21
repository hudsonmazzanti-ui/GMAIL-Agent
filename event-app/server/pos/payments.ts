import type { DB, PaymentRow } from '../db/client.js';
import { getEvent, HttpError } from '../tournament.js';

const bad = (msg: string) => new HttpError(400, msg);

export function paidPayment(db: DB, eventId: number, playerId: number): PaymentRow | undefined {
  return db
    .prepare("SELECT * FROM payments WHERE event_id = ? AND player_id = ? AND status = 'paid' ORDER BY id LIMIT 1")
    .get(eventId, playerId) as PaymentRow | undefined;
}

function assertRegistered(db: DB, eventId: number, playerId: number) {
  const reg = db.prepare('SELECT status FROM registrations WHERE event_id = ? AND player_id = ?').get(eventId, playerId);
  if (!reg) throw bad('Player is not registered for this event');
}

function assertUnpaid(db: DB, eventId: number, playerId: number) {
  if (paidPayment(db, eventId, playerId)) throw bad('Player has already paid');
}

/**
 * Paying at the desk means the player is here: check them in, unless the event already started
 * (late payers are checked in by staff as usual).
 */
export function checkInAfterPayment(db: DB, eventId: number, playerId: number) {
  db.prepare(
    `UPDATE registrations SET status = 'checked_in'
     WHERE event_id = ? AND player_id = ? AND status IN ('registered', 'waitlist')
       AND (SELECT status FROM events WHERE id = ?) IN ('draft', 'registration', 'checkin')`,
  ).run(eventId, playerId, eventId);
}

/** "Collect on POS": the next sale of this event's entry product is credited to this player. */
export function collect(db: DB, eventId: number, playerId: number) {
  const ev = getEvent(db, eventId);
  if (!ev.pos_product_uuid) throw bad('Add this event to the POS first');
  assertRegistered(db, eventId, playerId);
  assertUnpaid(db, eventId, playerId);
  db.prepare(
    `INSERT INTO pos_waiting (event_id, player_id, since) VALUES (?, ?, ?)
     ON CONFLICT (event_id, player_id) DO UPDATE SET since = excluded.since`,
  ).run(eventId, playerId, Date.now());
}

export function cancelCollect(db: DB, eventId: number, playerId: number) {
  db.prepare('DELETE FROM pos_waiting WHERE event_id = ? AND player_id = ?').run(eventId, playerId);
}

/** Paid at the desk some other way (cash, another terminal) or entry waived. */
export function recordManual(db: DB, eventId: number, playerId: number, method: 'cash' | 'comp') {
  const ev = getEvent(db, eventId);
  assertRegistered(db, eventId, playerId);
  assertUnpaid(db, eventId, playerId);
  db.prepare('INSERT INTO payments (event_id, player_id, method, amount_cents, currency) VALUES (?, ?, ?, ?, ?)').run(
    eventId,
    playerId,
    method,
    method === 'comp' ? 0 : ev.entry_fee_cents,
    ev.currency,
  );
  cancelCollect(db, eventId, playerId);
  checkInAfterPayment(db, eventId, playerId);
}

/** Give an unassigned POS sale to a player (or move one between players). */
export function assign(db: DB, paymentId: number, playerId: number): number {
  const p = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId) as PaymentRow | undefined;
  if (!p) throw new HttpError(404, 'Payment not found');
  if (p.method !== 'pos') throw bad('Only POS sales can be assigned');
  assertRegistered(db, p.event_id, playerId);
  if (p.player_id !== playerId) assertUnpaid(db, p.event_id, playerId);
  db.prepare('UPDATE payments SET player_id = ? WHERE id = ?').run(playerId, paymentId);
  cancelCollect(db, p.event_id, playerId);
  if (p.status === 'paid') checkInAfterPayment(db, p.event_id, playerId);
  return p.event_id;
}

/** Undo: manual payments are deleted; POS sales go back to the unassigned tray. */
export function removePayment(db: DB, paymentId: number): number {
  const p = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId) as PaymentRow | undefined;
  if (!p) throw new HttpError(404, 'Payment not found');
  if (p.method === 'pos') db.prepare('UPDATE payments SET player_id = NULL WHERE id = ?').run(paymentId);
  else db.prepare('DELETE FROM payments WHERE id = ?').run(paymentId);
  return p.event_id;
}

export interface PaymentView {
  id: number;
  method: PaymentRow['method'];
  status: PaymentRow['status'];
  amountCents: number;
  currency: string;
  posNumber: string | null;
  soldAt: string | null;
  seller: string | null;
}

const view = (p: PaymentRow): PaymentView => ({
  id: p.id,
  method: p.method,
  status: p.status,
  amountCents: p.amount_cents,
  currency: p.currency,
  posNumber: p.pos_purchase_number,
  soldAt: p.pos_sold_at,
  seller: p.pos_seller,
});

/** Payment info for the event read model: latest payment per player, waiting list and the unassigned tray. */
export function paymentState(db: DB, eventId: number) {
  const rows = db.prepare('SELECT * FROM payments WHERE event_id = ? ORDER BY id').all(eventId) as PaymentRow[];
  const byPlayer = new Map<number, PaymentView>();
  for (const p of rows) {
    if (p.player_id === null) continue;
    const prev = byPlayer.get(p.player_id);
    // A paid payment wins over a refunded one; otherwise the latest.
    if (!prev || p.status === 'paid' || prev.status !== 'paid') byPlayer.set(p.player_id, view(p));
  }
  const waiting = new Map(
    (db.prepare('SELECT player_id, since FROM pos_waiting WHERE event_id = ?').all(eventId) as { player_id: number; since: number }[]).map(
      (w) => [w.player_id, w.since],
    ),
  );
  const unassigned = rows.filter((p) => p.player_id === null).map(view);
  const paid = rows.filter((p) => p.status === 'paid' && p.player_id !== null);
  const totals = { pos: 0, cash: 0, comp: 0 };
  for (const p of paid) totals[p.method] += p.amount_cents;
  const refunded = rows.filter((p) => p.status === 'refunded').length;
  return { byPlayer, waiting, unassigned, totals, paidCount: paid.length, refunded };
}

export function paymentsCsv(db: DB, eventId: number): string {
  const rows = db
    .prepare(
      `SELECT pay.*, p.name FROM payments pay LEFT JOIN players p ON p.id = pay.player_id
       WHERE pay.event_id = ? ORDER BY pay.id`,
    )
    .all(eventId) as (PaymentRow & { name: string | null })[];
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return [
    'Player,Method,Status,Amount,Currency,POS purchase #,POS purchase id,Sold at,Seller,Recorded at',
    ...rows.map((r) =>
      [
        esc(r.name ?? '(unassigned)'),
        r.method,
        r.status,
        (r.amount_cents / 100).toFixed(2),
        r.currency,
        r.pos_purchase_number ?? '',
        r.pos_purchase_uuid ?? '',
        r.pos_sold_at ?? '',
        esc(r.pos_seller ?? ''),
        r.created_at,
      ].join(','),
    ),
  ].join('\n');
}
