import type { FastifyInstance } from 'fastify';
import type { DB } from '../db/client.js';
import {
  SESSION_COOKIE,
  assertNotLocked,
  checkSecret,
  clearFailures,
  createSession,
  hashPin,
  recordFailure,
  setStaffPassword,
  staffPasswordHash,
  validatePin,
} from '../auth.js';
import { HttpError } from '../tournament.js';

export function authRoutes(app: FastifyInstance, db: DB) {
  app.get('/api/auth/me', async (req) => ({ viewer: req.viewer, staffSetupNeeded: staffPasswordHash(db) === null }));

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
    const pin = validatePin(req.body?.pin);
    const exists = db.prepare('SELECT id, pin_hash FROM players WHERE name = ?').get(name) as
      | { id: number; pin_hash: string | null }
      | undefined;
    let id: number;
    if (exists) {
      // Staff may have created a walk-in profile without a PIN; let the player claim it.
      if (exists.pin_hash) throw new HttpError(400, 'That name is taken — log in instead, or add your last initial');
      db.prepare('UPDATE players SET pin_hash = ?, game_id = COALESCE(?, game_id) WHERE id = ?').run(
        hashPin(pin),
        req.body?.gameId?.trim() || null,
        exists.id,
      );
      id = exists.id;
    } else {
      id = Number(
        db.prepare('INSERT INTO players (name, pin_hash, game_id) VALUES (?, ?, ?)').run(name, hashPin(pin), req.body?.gameId?.trim() || null)
          .lastInsertRowid,
      );
    }
    createSession(db, reply, 'player', id);
    return { ok: true, playerId: id };
  });

  app.post<{ Body: { name: string; pin: string } }>('/api/auth/player/login', async (req, reply) => {
    const name = String(req.body?.name ?? '').trim();
    const key = `player:${name.toLowerCase()}`;
    assertNotLocked(key);
    const row = db.prepare('SELECT id, pin_hash FROM players WHERE name = ?').get(name) as
      | { id: number; pin_hash: string | null }
      | undefined;
    if (!row || !row.pin_hash || !checkSecret(String(req.body?.pin ?? ''), row.pin_hash)) {
      recordFailure(key);
      throw new HttpError(401, 'Name or PIN is wrong');
    }
    clearFailures(key);
    createSession(db, reply, 'player', row.id);
    return { ok: true, playerId: row.id };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });
}
