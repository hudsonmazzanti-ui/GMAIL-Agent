import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

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
  return db;
}

/**
 * Schema changes after the first release. Each entry runs once, tracked by `PRAGMA user_version`,
 * so existing `events.db` files upgrade in place.
 */
const MIGRATIONS: string[] = [
  // 1: PayPal POS entry fees.
  `ALTER TABLE events ADD COLUMN entry_fee_cents INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE events ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD';
   ALTER TABLE events ADD COLUMN require_payment INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE events ADD COLUMN pos_product_uuid TEXT;
   ALTER TABLE events ADD COLUMN pos_variant_uuid TEXT;

   CREATE TABLE payments (
     id                  INTEGER PRIMARY KEY,
     event_id            INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
     player_id           INTEGER REFERENCES players(id) ON DELETE SET NULL,
     method              TEXT NOT NULL CHECK (method IN ('pos', 'cash', 'comp')),
     status              TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('paid', 'refunded')),
     amount_cents        INTEGER NOT NULL DEFAULT 0,
     currency            TEXT NOT NULL DEFAULT 'USD',
     pos_purchase_uuid   TEXT,
     pos_purchase_number TEXT,
     pos_line_index      INTEGER,
     pos_unit_index      INTEGER,
     pos_sold_at         TEXT,
     pos_seller          TEXT,
     created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
     UNIQUE (pos_purchase_uuid, pos_line_index, pos_unit_index)
   );
   CREATE INDEX idx_payments_event ON payments(event_id);

   CREATE TABLE pos_waiting (
     event_id  INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
     player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
     since     INTEGER NOT NULL,
     PRIMARY KEY (event_id, player_id)
   );`,
];

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
