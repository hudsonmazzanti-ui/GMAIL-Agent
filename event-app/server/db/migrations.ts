/**
 * Schema changes after the first release. Each entry runs once, tracked by `PRAGMA user_version`,
 * so existing `events.db` files upgrade in place.
 */
export const MIGRATIONS: string[] = [
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
