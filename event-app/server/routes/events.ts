import type { FastifyInstance } from 'fastify';
import type { DB, EventRow } from '../db/client.js';
import { requirePlayer, requireStaff } from '../auth.js';
import { broadcast, subscribe } from '../live.js';
import { assignJoinCode, normalizeJoinCode } from '../joinCode.js';
import * as t from '../tournament.js';

export type EventBody = Partial<{
  name: string;
  game: string;
  format: string;
  date: string;
  startTime: string;
  description: string;
  entryFeeNote: string;
  capacity: number | null;
  swissRounds: number | null;
  topCutSize: number;
  bestOf: number;
  roundMinutes: number;
  winPoints: number;
  drawPoints: number;
  entryFeeCents: number;
  currency: string;
  requirePayment: boolean;
}>;

const COLUMNS: Record<keyof EventBody, keyof EventRow> = {
  name: 'name',
  game: 'game',
  format: 'format',
  date: 'date',
  startTime: 'start_time',
  description: 'description',
  entryFeeNote: 'entry_fee_note',
  capacity: 'capacity',
  swissRounds: 'swiss_rounds',
  topCutSize: 'top_cut_size',
  bestOf: 'best_of',
  roundMinutes: 'round_minutes',
  winPoints: 'win_points',
  drawPoints: 'draw_points',
  entryFeeCents: 'entry_fee_cents',
  currency: 'currency',
  requirePayment: 'require_payment',
};

/** Settings that change how pairings/results work are locked once the event starts. */
const LOCKED_AFTER_START = new Set<keyof EventBody>(['bestOf', 'winPoints', 'drawPoints']);

const STATUS_FLOW: Record<string, string[]> = {
  draft: ['registration'],
  registration: ['draft', 'checkin'],
  checkin: ['registration'],
};

export function eventRoutes(app: FastifyInstance, db: DB) {
  const id = (p: { id: string }) => Number(p.id);
  const changed = (eventId: number) => {
    broadcast(eventId);
    return { ok: true };
  };

  app.get('/api/events', async (req) => {
    const staff = req.viewer.kind === 'staff';
    return db
      .prepare(
        `SELECT e.*, (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id AND r.status != 'waitlist') AS registered
         FROM events e ${staff ? '' : "WHERE e.status != 'draft'"}
         ORDER BY CASE WHEN e.status = 'complete' THEN 1 ELSE 0 END, e.date, e.start_time, e.id`,
      )
      .all();
  });

  app.get('/api/live', async (req, reply) => {
    reply.hijack();
    subscribe(0, reply.raw);
  });

  app.post<{ Body: EventBody }>('/api/events', async (req) => {
    requireStaff(req);
    const name = req.body?.name?.trim();
    if (!name) throw new t.HttpError(400, 'Event name is required');
    const newId = Number(db.prepare('INSERT INTO events (name) VALUES (?)').run(name).lastInsertRowid);
    assignJoinCode(db, newId);
    updateEvent(db, newId, req.body);
    return { id: newId };
  });

  app.patch<{ Params: { id: string }; Body: EventBody }>('/api/events/:id', async (req) => {
    requireStaff(req);
    updateEvent(db, id(req.params), req.body ?? {});
    return changed(id(req.params));
  });

  app.delete<{ Params: { id: string } }>('/api/events/:id', async (req) => {
    requireStaff(req);
    db.prepare('DELETE FROM events WHERE id = ?').run(id(req.params));
    return changed(id(req.params));
  });

  app.post<{ Params: { id: string }; Body: { status: string } }>('/api/events/:id/status', async (req) => {
    requireStaff(req);
    const ev = t.getEvent(db, id(req.params));
    if (!STATUS_FLOW[ev.status]?.includes(req.body?.status)) {
      throw new t.HttpError(400, `Can't go from ${ev.status} to ${req.body?.status}`);
    }
    db.prepare('UPDATE events SET status = ? WHERE id = ?').run(req.body.status, ev.id);
    return changed(ev.id);
  });

  /** Look up an event from the code players type or scan (case and dashes don't matter). */
  app.get<{ Params: { code: string } }>('/api/join/:code', async (req) => {
    const ev = db.prepare('SELECT id, name, status FROM events WHERE join_code = ?').get(normalizeJoinCode(req.params.code)) as
      | { id: number; name: string; status: string }
      | undefined;
    if (!ev || (ev.status === 'draft' && req.viewer.kind !== 'staff')) {
      throw new t.HttpError(404, 'No event with that code — check it with staff');
    }
    return { eventId: ev.id, name: ev.name, status: ev.status };
  });

  app.get<{ Params: { id: string } }>('/api/events/:id/state', async (req) => {
    const v = req.viewer;
    const state = t.eventState(db, id(req.params), { staff: v.kind === 'staff', playerId: v.kind === 'player' ? v.playerId : undefined });
    if (state.event.status === 'draft' && req.viewer.kind !== 'staff') throw new t.HttpError(404, 'Event not found');
    return state;
  });

  app.get<{ Params: { id: string } }>('/api/events/:id/stream', async (req, reply) => {
    reply.hijack();
    subscribe(id(req.params), reply.raw);
  });

  app.get<{ Params: { id: string } }>('/api/events/:id/standings.csv', async (req, reply) => {
    const ev = t.getEvent(db, id(req.params));
    const filename = `${ev.name.replace(/[^\w-]+/g, '_')}_standings.csv`;
    reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="${filename}"`);
    return t.standingsCsv(db, ev.id);
  });

  // Registration: players register themselves; staff can register anyone (walk-ins).
  app.post<{ Params: { id: string }; Body: { playerId?: number } }>('/api/events/:id/register', async (req) => {
    const staff = req.viewer.kind === 'staff';
    const playerId = staff && req.body?.playerId ? req.body.playerId : requirePlayer(req);
    const status = t.register(db, id(req.params), playerId, staff);
    broadcast(id(req.params));
    return { ok: true, status };
  });

  app.post<{ Params: { id: string }; Body: { playerId?: number } }>('/api/events/:id/unregister', async (req) => {
    const playerId = req.viewer.kind === 'staff' && req.body?.playerId ? req.body.playerId : requirePlayer(req);
    t.unregister(db, id(req.params), playerId);
    return changed(id(req.params));
  });

  app.post<{ Params: { id: string }; Body: { playerId: number; checkedIn: boolean } }>('/api/events/:id/checkin', async (req) => {
    requireStaff(req);
    t.setCheckIn(db, id(req.params), Number(req.body?.playerId), req.body?.checkedIn !== false);
    return changed(id(req.params));
  });

  app.post<{ Params: { id: string }; Body: { playerId?: number } }>('/api/events/:id/drop', async (req) => {
    const playerId = req.viewer.kind === 'staff' && req.body?.playerId ? req.body.playerId : requirePlayer(req);
    t.drop(db, id(req.params), playerId);
    return changed(id(req.params));
  });

  /** Start Swiss / pair next round / start top cut / finish — whatever comes next. */
  app.post<{ Params: { id: string } }>('/api/events/:id/advance', async (req) => {
    requireStaff(req);
    t.advance(db, id(req.params));
    return changed(id(req.params));
  });
}

export function updateEvent(db: DB, eventId: number, body: EventBody) {
  const ev = t.getEvent(db, eventId);
  const started = !['draft', 'registration', 'checkin'].includes(ev.status);
  for (const [key, value] of Object.entries(body) as [keyof EventBody, unknown][]) {
    const column = COLUMNS[key];
    if (!column || value === undefined) continue;
    const normalized =
      key === 'requirePayment' ? (value ? 1 : 0) : value === '' && (key === 'capacity' || key === 'swissRounds') ? null : value;
    if (normalized === ev[column]) continue;
    if (started && LOCKED_AFTER_START.has(key)) {
      throw new t.HttpError(400, `${key} can't change after the event starts`);
    }
    if (key === 'swissRounds' && started) {
      const played = (db.prepare("SELECT MAX(number) AS n FROM rounds WHERE event_id = ? AND phase = 'swiss'").get(eventId) as { n: number }).n;
      if (ev.status !== 'swiss' || typeof normalized !== 'number' || normalized < played) throw new t.HttpError(400, `Swiss rounds can't go below ${played}`);
    }
    if (key === 'topCutSize' && ev.status !== 'swiss' && started) throw new t.HttpError(400, 'Top cut is already decided');
    if ((key === 'entryFeeCents' || key === 'currency') && ev.pos_product_uuid) {
      throw new t.HttpError(400, 'The fee is linked to a POS product — unlink it from the POS first to change the price');
    }
    if (key === 'entryFeeCents' && (!Number.isInteger(normalized) || (normalized as number) < 0)) {
      throw new t.HttpError(400, 'Entry fee must be a whole number of cents');
    }
    if (key === 'currency' && !/^[A-Z]{3}$/.test(String(normalized))) throw new t.HttpError(400, 'Currency must be a 3-letter code');
    db.prepare(`UPDATE events SET ${column} = ? WHERE id = ?`).run(normalized as string | number | null, eventId);
  }
}
