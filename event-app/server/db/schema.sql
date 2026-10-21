CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS players (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pin_hash   TEXT,
  game_id    TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('staff', 'player')),
  player_id  INTEGER REFERENCES players(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS events (
  id             INTEGER PRIMARY KEY,
  name           TEXT NOT NULL,
  game           TEXT NOT NULL DEFAULT '',
  format         TEXT NOT NULL DEFAULT '',
  date           TEXT NOT NULL DEFAULT '',
  start_time     TEXT NOT NULL DEFAULT '',
  description    TEXT NOT NULL DEFAULT '',
  entry_fee_note TEXT NOT NULL DEFAULT '',
  capacity       INTEGER,
  status         TEXT NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft', 'registration', 'checkin', 'swiss', 'topcut', 'complete')),
  swiss_rounds   INTEGER,
  top_cut_size   INTEGER NOT NULL DEFAULT 0 CHECK (top_cut_size IN (0, 2, 4, 8, 16, 32)),
  best_of        INTEGER NOT NULL DEFAULT 3 CHECK (best_of IN (1, 3, 5)),
  round_minutes  INTEGER NOT NULL DEFAULT 50,
  win_points     INTEGER NOT NULL DEFAULT 3,
  draw_points    INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS registrations (
  id                  INTEGER PRIMARY KEY,
  event_id            INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  player_id           INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  status              TEXT NOT NULL CHECK (status IN ('registered', 'waitlist', 'checked_in', 'dropped')),
  dropped_after_round INTEGER,
  created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (event_id, player_id)
);

CREATE TABLE IF NOT EXISTS rounds (
  id                 INTEGER PRIMARY KEY,
  event_id           INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  phase              TEXT NOT NULL CHECK (phase IN ('swiss', 'topcut')),
  number             INTEGER NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'complete')),
  timer_ends_at      INTEGER,
  timer_remaining_ms INTEGER NOT NULL,
  UNIQUE (event_id, phase, number)
);

CREATE TABLE IF NOT EXISTS matches (
  id            INTEGER PRIMARY KEY,
  round_id      INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  table_number  INTEGER NOT NULL,
  p1_id         INTEGER NOT NULL REFERENCES players(id),
  p2_id         INTEGER REFERENCES players(id),
  p1_games      INTEGER NOT NULL DEFAULT 0,
  p2_games      INTEGER NOT NULL DEFAULT 0,
  draws         INTEGER NOT NULL DEFAULT 0,
  result_status TEXT NOT NULL DEFAULT 'pending'
                CHECK (result_status IN ('pending', 'reported', 'confirmed', 'disputed')),
  reported_by   INTEGER REFERENCES players(id)
);

CREATE INDEX IF NOT EXISTS idx_registrations_event ON registrations(event_id);
CREATE INDEX IF NOT EXISTS idx_rounds_event ON rounds(event_id);
CREATE INDEX IF NOT EXISTS idx_matches_round ON matches(round_id);
