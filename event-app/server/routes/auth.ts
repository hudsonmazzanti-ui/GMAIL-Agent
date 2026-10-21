import type { FastifyInstance } from 'fastify';
import type { DB } from '../db/client.js';
import {
  SESSION_COOKIE,
  assertNotLocked,
  checkSecret,
  clearFailures,
  createSession,
  hashPin,
  optionalPin,
  recordFailure,
  requirePlayer,
  setStaffPassword,
  staffPasswordHash,
} from '../auth.js';
import { HttpError } from '../tournament.js';

export function authRoutes(app: FastifyInstance, db: DB) {
  app.get('/api/auth/me', async (req) => {
    const v = req.viewer;
    const hasPin =
      v.kind === 'player' ? !!(db.prepare('SELECT pin_hash FROM players WHERE id = ?').get(v.playerId) as { pin_hash: string | null }).pin_hash : undefined;
    return { viewer: req.viewer, staffSetupNeeded: staffPasswordHash(db) === null, hasPin };
  });

  app.post<{ Body: { password: string } }>('/api/auth/staff/setup', async (req, reply) => {
    if (staffPasswordHash(db) !== null) throw new HttpError(400, 'Staff password is already set');
    setStaffPassword(db, String(req.body?.password ?? ''));
    createSession(db, reply, 'staff');
    return { ok: true };
  });

  app.post<{ Body: { password: string } }>('/api/auth/staff/login', async (req, reply) => {
    const hash = staffPasswordHash(db);
    if (!hash) throw new HttpError(400, 'Set a staff password first');
    assertNotLocked('staff');
    if (!checkSecret(String(req.body?.password ?? ''), hash)) {
      recordFailure('staff');
      throw new HttpError(401, 'Wrong password');
    }
    clearFailures('staff');
    createSession(db, reply, 'staff');
    return { ok: true };
  });

  app.post<{ Body: { password: string } }>('/api/auth/staff/password', async (req) => {
    if (req.viewer.kind !== 'staff') throw new HttpError(403, 'Staff login required');
    setStaffPassword(db, String(req.body?.password ?? ''));
    return { ok: true };
  });

  app.post<{ Body: { name: string; pin: string; gameId?: string } }>('/api/auth/player/signup', async (req, reply) => {
    const name = String(req.body?.name ?? '').trim();
    if (name.length < 2 || name.length > 40) throw new HttpError(400, 'Name must be 2–40 characters');
    const pin = optionalPin(req.body?.pin);
    const pinHash = pin ? hashPin(pin) : null;
    const exists = db.prepare('SELECT id, pin_hash FROM players WHERE name = ?').get(name) as
      | { id: number; pin_hash: string | null }
      | undefined;
    let id: number;
    if (exists) {
      // A profile without a PIN (e.g. a walk-in staff added) can be taken over; one with a PIN can't.
      if (exists.pin_hash) throw new HttpError(400, 'That name is taken — log in instead, or add your last initial');
      db.prepare('UPDATE players SET pin_hash = COALESCE(?, pin_hash), game_id = COALESCE(?, game_id) WHERE id = ?').run(
        pinHash,
        req.body?.gameId?.trim() || null,
        exists.id,
      );
      id = exists.id;
    } else {
      id = Number(
        db.prepare('INSERT INTO players (name, pin_hash, game_id) VALUES (?, ?, ?)').run(name, pinHash, req.body?.gameId?.trim() || null)
          .lastInsertRowid,
      );
    }
    createSession(db, reply, 'player', id);
    return { ok: true, playerId: id };
  });

  /**
   * Log in by name. Players without a PIN are let straight in; players with one get
   * `{ needsPin: true }` until they send it.
   */
  app.post<{ Body: { name: string; pin?: string } }>('/api/auth/player/login', async (req, reply) => {
    const name = String(req.body?.name ?? '').trim();
    const pin = String(req.body?.pin ?? '');
    const key = `player:${name.toLowerCase()}`;
    const row = db.prepare('SELECT id, pin_hash FROM players WHERE name = ?').get(name) as
      | { id: number; pin_hash: string | null }
      | undefined;
    if (!row) throw new HttpError(404, `No player named “${name}” yet — create a profile instead`);
    if (row.pin_hash) {
      if (!pin) return { ok: false, needsPin: true };
      assertNotLocked(key);
      if (!checkSecret(pin, row.pin_hash)) {
        recordFailure(key);
        throw new HttpError(401, 'Wrong PIN');
      }
      clearFailures(key);
    }
    createSession(db, reply, 'player', row.id);
    return { ok: true, playerId: row.id };
  });

  /** A logged-in player sets, changes or removes their own PIN. */
  app.post<{ Body: { currentPin?: string; pin: string | null } }>('/api/auth/player/pin', async (req) => {
    const playerId = requirePlayer(req);
    const row = db.prepare('SELECT pin_hash FROM players WHERE id = ?').get(playerId) as { pin_hash: string | null };
    if (row.pin_hash) {
      const key = `player-pin:${playerId}`;
      assertNotLocked(key);
      if (!checkSecret(String(req.body?.currentPin ?? ''), row.pin_hash)) {
        recordFailure(key);
        throw new HttpError(401, 'Your current PIN is wrong');
      }
      clearFailures(key);
    }
    const pin = optionalPin(req.body?.pin);
    db.prepare('UPDATE players SET pin_hash = ? WHERE id = ?').run(pin ? hashPin(pin) : null, playerId);
    // Log out the player's other phones; this one stays logged in.
    db.prepare('DELETE FROM sessions WHERE player_id = ? AND token != ?').run(playerId, req.cookies[SESSION_COOKIE] ?? '');
    return { ok: true, hasPin: !!pin };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });
}
