import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { DB } from './db/client.js';
import { HttpError } from './tournament.js';

export const SESSION_COOKIE = 'session';

export type Viewer = { kind: 'anon' } | { kind: 'staff' } | { kind: 'player'; playerId: number; name: string };

declare module 'fastify' {
  interface FastifyRequest {
    viewer: Viewer;
  }
}

export function loadViewer(db: DB, token: string | undefined): Viewer {
  if (!token) return { kind: 'anon' };
  const row = db
    .prepare(
      `SELECT s.kind, s.player_id, p.name FROM sessions s LEFT JOIN players p ON p.id = s.player_id WHERE s.token = ?`,
    )
    .get(token) as { kind: 'staff' | 'player'; player_id: number | null; name: string | null } | undefined;
  if (!row) return { kind: 'anon' };
  if (row.kind === 'staff') return { kind: 'staff' };
  return { kind: 'player', playerId: row.player_id!, name: row.name! };
}

export function createSession(db: DB, reply: FastifyReply, kind: 'staff' | 'player', playerId: number | null = null) {
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions (token, kind, player_id) VALUES (?, ?, ?)').run(token, kind, playerId);
  reply.setCookie(SESSION_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 180 });
}

export function requireStaff(req: FastifyRequest) {
  if (req.viewer.kind !== 'staff') throw new HttpError(403, 'Staff login required');
}

export function requirePlayer(req: FastifyRequest): number {
  if (req.viewer.kind !== 'player') throw new HttpError(401, 'Log in as a player first');
  return req.viewer.playerId;
}

export function staffPasswordHash(db: DB): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'staff_password'").get() as { value: string } | undefined;
  return row?.value ?? null;
}

export function setStaffPassword(db: DB, password: string) {
  if (password.length < 6) throw new HttpError(400, 'Staff password must be at least 6 characters');
  db.prepare(
    "INSERT INTO settings (key, value) VALUES ('staff_password', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
  ).run(bcrypt.hashSync(password, 10));
}

export const checkSecret = (secret: string, hash: string) => bcrypt.compareSync(secret, hash);
export const hashPin = (pin: string) => bcrypt.hashSync(pin, 8);

export function validatePin(pin: unknown): string {
  if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) throw new HttpError(400, 'PIN must be 4 digits');
  return pin;
}

/** Simple lockout so 4-digit PINs can't be brute-forced from the store Wi-Fi. */
const failures = new Map<string, { count: number; until: number }>();
const MAX_FAILURES = 5;
const LOCK_MS = 5 * 60_000;

export function assertNotLocked(key: string) {
  const f = failures.get(key);
  if (f && f.count >= MAX_FAILURES && f.until > Date.now()) {
    throw new HttpError(429, 'Too many wrong attempts — try again in a few minutes or ask staff');
  }
}

export function recordFailure(key: string) {
  const f = failures.get(key);
  const count = f && f.until > Date.now() ? f.count + 1 : 1;
  failures.set(key, { count, until: Date.now() + LOCK_MS });
}

export const clearFailures = (key: string) => failures.delete(key);
