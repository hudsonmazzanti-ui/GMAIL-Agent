import type { FastifyInstance } from 'fastify';
import type { DB } from '../db/client.js';
import { hashPin, requireStaff, validatePin } from '../auth.js';
import { HttpError } from '../tournament.js';

export function playerRoutes(app: FastifyInstance, db: DB) {
  app.get<{ Querystring: { q?: string } }>('/api/players', async (req) => {
    requireStaff(req);
    const q = `%${(req.query.q ?? '').trim()}%`;
    return db
      .prepare(
        `SELECT id, name, game_id AS gameId, pin_hash IS NOT NULL AS hasPin, created_at AS createdAt
         FROM players WHERE name LIKE ? OR IFNULL(game_id, '') LIKE ? ORDER BY name COLLATE NOCASE LIMIT 50`,
      )
      .all(q, q);
  });

  /** Staff-created profile (walk-ins). PIN is optional; the player can claim the name later by signing up. */
  app.post<{ Body: { name: string; pin?: string; gameId?: string } }>('/api/players', async (req) => {
    requireStaff(req);
    const name = String(req.body?.name ?? '').trim();
    if (name.length < 2 || name.length > 40) throw new HttpError(400, 'Name must be 2–40 characters');
    if (db.prepare('SELECT 1 FROM players WHERE name = ?').get(name)) throw new HttpError(400, 'A player with that name exists');
    const pin = req.body?.pin ? hashPin(validatePin(req.body.pin)) : null;
    const id = Number(
      db.prepare('INSERT INTO players (name, pin_hash, game_id) VALUES (?, ?, ?)').run(name, pin, req.body?.gameId?.trim() || null)
        .lastInsertRowid,
    );
    return { id, name };
  });

  app.patch<{ Params: { id: string }; Body: { name?: string; pin?: string | null; gameId?: string } }>('/api/players/:id', async (req) => {
    requireStaff(req);
    const id = Number(req.params.id);
    const b = req.body ?? {};
    if (b.name !== undefined) db.prepare('UPDATE players SET name = ? WHERE id = ?').run(b.name.trim(), id);
    if (b.gameId !== undefined) db.prepare('UPDATE players SET game_id = ? WHERE id = ?').run(b.gameId.trim() || null, id);
    if (b.pin !== undefined) {
      // `pin: null` removes the PIN, so the player logs in by name only.
      db.prepare('UPDATE players SET pin_hash = ? WHERE id = ?').run(b.pin === null ? null : hashPin(validatePin(b.pin)), id);
      db.prepare('DELETE FROM sessions WHERE player_id = ?').run(id);
    }
    return { ok: true };
  });
}
