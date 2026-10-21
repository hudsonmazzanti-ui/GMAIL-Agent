import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { MIGRATIONS } from './migrations.js';
import { backfillJoinCodes } from '../joinCode.js';

export type DB = Database.Database;

const here = path.dirname(fileURLToPath(import.meta.url));

/** Open (and create/migrate) the SQLite database. Pass ':memory:' for tests. */
export function openDb(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'));
  migrate(db);
  backfillJoinCodes(db);
  return db;
}

function migrate(db: DB) {
  const version = db.pragma('user_version', { simple: true }) as number;
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}

export function getSetting(db: DB, key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(db: DB, key: string, value: string | null) {
  if (value === null) db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  else db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value);
}

export interface EventRow {
  id: number;
  name: string;
  game: string;
  format: string;
  date: string;
  start_time: string;
  description: string;
  entry_fee_note: string;
  capacity: number | null;
  status: EventStatus;
  swiss_rounds: number | null;
  top_cut_size: number;
  best_of: number;
  round_minutes: number;
  win_points: number;
  draw_points: number;
  entry_fee_cents: number;
  currency: string;
  require_payment: number;
  pos_product_uuid: string | null;
  pos_variant_uuid: string | null;
  join_code: string | null;
  top_cut_auto: number;
  created_at: string;
}

export type EventStatus = 'draft' | 'registration' | 'checkin' | 'swiss' | 'topcut' | 'complete';
export type RegistrationStatus = 'registered' | 'waitlist' | 'checked_in' | 'dropped';

export interface RoundRow {
  id: number;
  event_id: number;
  phase: 'swiss' | 'topcut';
  number: number;
  status: 'pending' | 'active' | 'complete';
  timer_ends_at: number | null;
  timer_remaining_ms: number;
}

export interface MatchRow {
  id: number;
  round_id: number;
  table_number: number;
  p1_id: number;
  p2_id: number | null;
  p1_games: number;
  p2_games: number;
  draws: number;
  result_status: 'pending' | 'reported' | 'confirmed' | 'disputed';
  reported_by: number | null;
}

export interface PaymentRow {
  id: number;
  event_id: number;
  player_id: number | null;
  method: 'pos' | 'cash' | 'comp';
  status: 'paid' | 'refunded';
  amount_cents: number;
  currency: string;
  pos_purchase_uuid: string | null;
  pos_purchase_number: string | null;
  pos_line_index: number | null;
  pos_unit_index: number | null;
  pos_sold_at: string | null;
  pos_seller: string | null;
  created_at: string;
}
