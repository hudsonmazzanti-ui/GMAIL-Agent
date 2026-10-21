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
  return db;
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
