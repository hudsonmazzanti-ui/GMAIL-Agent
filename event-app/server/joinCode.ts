import type { DB } from './db/client.js';

/** Letters and digits that can't be confused when read off a screen (no 0/O, 1/I/L). */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const JOIN_CODE_LENGTH = 6;

export function newJoinCode(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(JOIN_CODE_LENGTH));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

/** Normalize what a player typed: uppercase, no spaces or dashes. */
export const normalizeJoinCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Give an event a unique join code (retrying on the rare collision). */
export function assignJoinCode(db: DB, eventId: number): string {
  for (;;) {
    const code = newJoinCode();
    if (db.prepare('SELECT 1 FROM events WHERE join_code = ?').get(code)) continue;
    db.prepare('UPDATE events SET join_code = ? WHERE id = ?').run(code, eventId);
    return code;
  }
}

/** Events created before join codes existed get one at startup. */
export function backfillJoinCodes(db: DB) {
  const missing = db.prepare('SELECT id FROM events WHERE join_code IS NULL').all() as { id: number }[];
  for (const { id } of missing) assignJoinCode(db, id);
}
