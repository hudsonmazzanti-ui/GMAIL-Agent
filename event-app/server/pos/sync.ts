import { getSetting, setSetting, type DB } from '../db/client.js';
import { PosClient, type PosPurchase, type PosUrls } from './client.js';

/** A sale matches a "Collect on POS" request made up to this long before it (plus clock slack after). */
export const COLLECT_WINDOW_MS = 3 * 60_000;
const CLOCK_SLACK_MS = 2 * 60_000;
/** Waiting requests are cleared after this, so stale ones never grab a later sale. */
const WAITING_TTL_MS = 15 * 60_000;

const purchaseId = (p: PosPurchase) => p.purchaseUUID1 ?? p.purchaseUUID ?? null;

/**
 * Apply a page of POS purchases (oldest first). Each unit of an entry-fee product becomes one
 * payment: given to the player waiting at the desk for that event, or left unassigned for staff
 * to match. Refunds flip the matching payments to `refunded`. Safe to replay: every unit is
 * keyed by (purchase, line, unit).
 * Returns the ids of events whose payments changed.
 */
export function applyPurchases(db: DB, purchases: PosPurchase[], now = Date.now()): Set<number> {
  const changed = new Set<number>();
  const events = db
    .prepare('SELECT id, pos_product_uuid, currency FROM events WHERE pos_product_uuid IS NOT NULL')
    .all() as { id: number; pos_product_uuid: string; currency: string }[];
  const byProduct = new Map(events.map((e) => [e.pos_product_uuid, e]));
  if (!byProduct.size) return changed;

  const insert = db.prepare(
    `INSERT INTO payments (event_id, player_id, method, amount_cents, currency, pos_purchase_uuid, pos_purchase_number,
       pos_line_index, pos_unit_index, pos_sold_at, pos_seller)
     VALUES (?, ?, 'pos', ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (pos_purchase_uuid, pos_line_index, pos_unit_index) DO NOTHING`,
  );
  const nextWaiter = db.prepare(
    `SELECT w.player_id FROM pos_waiting w
     WHERE w.event_id = ? AND w.since BETWEEN ? AND ?
       AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.event_id = w.event_id AND p.player_id = w.player_id AND p.status = 'paid')
     ORDER BY w.since LIMIT 1`,
  );
  const clearWaiter = db.prepare('DELETE FROM pos_waiting WHERE event_id = ? AND player_id = ?');

  db.transaction(() => {
    for (const p of purchases) {
      const uuid = purchaseId(p);
      if (!uuid) continue;
      const soldAt = Date.parse(p.timestamp ?? p.created ?? '') || now;

      (p.products ?? []).forEach((line, lineIndex) => {
        const ev = line.productUuid ? byProduct.get(line.productUuid) : undefined;
        if (!ev) return;
        const qty = Math.trunc(Number(line.quantity ?? 1));

        if (p.refund || qty < 0) {
          const original = p.refundsPurchaseUUID1 ?? p.refundsPurchaseUUID;
          if (!original) return;
          const res = db
            .prepare(
              `UPDATE payments SET status = 'refunded' WHERE id IN (
                 SELECT id FROM payments WHERE pos_purchase_uuid = ? AND event_id = ? AND status = 'paid'
                 ORDER BY pos_unit_index DESC LIMIT ?)`,
            )
            .run(original, ev.id, Math.abs(qty) || 1);
          if (res.changes) changed.add(ev.id);
          return;
        }

        for (let unit = 0; unit < qty; unit++) {
          const already = db
            .prepare('SELECT 1 FROM payments WHERE pos_purchase_uuid = ? AND pos_line_index = ? AND pos_unit_index = ?')
            .get(uuid, lineIndex, unit);
          if (already) continue;
          const waiter = nextWaiter.get(ev.id, soldAt - COLLECT_WINDOW_MS, soldAt + CLOCK_SLACK_MS) as { player_id: number } | undefined;
          insert.run(
            ev.id,
            waiter?.player_id ?? null,
            line.unitPrice ?? 0,
            p.currency ?? ev.currency,
            uuid,
            p.purchaseNumber != null ? String(p.purchaseNumber) : null,
            lineIndex,
            unit,
            new Date(soldAt).toISOString(),
            p.userDisplayName ?? null,
          );
          if (waiter) clearWaiter.run(ev.id, waiter.player_id);
          changed.add(ev.id);
        }
      });
    }
    db.prepare('DELETE FROM pos_waiting WHERE since < ?').run(now - WAITING_TTL_MS);
  })();
  return changed;
}

// ---------- Connection + polling ----------

export interface PosStatus {
  connected: boolean;
  clientId: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
}

export class PosService {
  private client: PosClient | null = null;
  private syncing: Promise<Set<number>> | null = null;

  constructor(
    private db: DB,
    private urls?: PosUrls,
    private fetchImpl?: typeof fetch,
  ) {}

  status(): PosStatus {
    return {
      connected: !!getSetting(this.db, 'pos_api_key'),
      clientId: getSetting(this.db, 'pos_client_id'),
      lastSyncAt: getSetting(this.db, 'pos_last_sync_at'),
      lastError: getSetting(this.db, 'pos_last_error'),
    };
  }

  /** The live client, or null when no API key is saved. */
  getClient(): PosClient | null {
    if (this.client) return this.client;
    const apiKey = getSetting(this.db, 'pos_api_key');
    const clientId = getSetting(this.db, 'pos_client_id');
    if (!apiKey || !clientId) return null;
    this.client = new PosClient({ apiKey, clientId }, this.urls, this.fetchImpl);
    return this.client;
  }

  /** Verify the key works, then save it. Only sales from now on are imported. */
  async connect(apiKey: string, clientId: string) {
    const client = new PosClient({ apiKey, clientId }, this.urls, this.fetchImpl);
    await client.accessToken();
    setSetting(this.db, 'pos_api_key', apiKey);
    setSetting(this.db, 'pos_client_id', clientId);
    setSetting(this.db, 'pos_sync_start', new Date().toISOString().slice(0, 19));
    setSetting(this.db, 'pos_purchase_cursor', null);
    setSetting(this.db, 'pos_last_error', null);
    this.client = client;
  }

  disconnect() {
    for (const k of ['pos_api_key', 'pos_client_id', 'pos_purchase_cursor', 'pos_sync_start', 'pos_last_sync_at', 'pos_last_error']) {
      setSetting(this.db, k, null);
    }
    this.client = null;
  }

  /** Fetch every new purchase since the saved cursor and apply it. Concurrent calls share one run. */
  sync(): Promise<Set<number>> {
    this.syncing ??= this.runSync().finally(() => (this.syncing = null));
    return this.syncing;
  }

  private async runSync(): Promise<Set<number>> {
    const client = this.getClient();
    if (!client) return new Set();
    const changed = new Set<number>();
    try {
      let cursor = getSetting(this.db, 'pos_purchase_cursor');
      const startDate = getSetting(this.db, 'pos_sync_start') ?? undefined;
      for (let page = 0; page < 50; page++) {
        const res = await client.listPurchases({ cursor, startDate, limit: 200 });
        for (const id of applyPurchases(this.db, res.purchases)) changed.add(id);
        if (res.lastPurchaseHash) {
          cursor = res.lastPurchaseHash;
          setSetting(this.db, 'pos_purchase_cursor', cursor);
        }
        if (res.purchases.length < 200 || !res.lastPurchaseHash) break;
      }
      setSetting(this.db, 'pos_last_error', null);
    } catch (e) {
      setSetting(this.db, 'pos_last_error', (e as Error).message);
      throw e;
    } finally {
      setSetting(this.db, 'pos_last_sync_at', new Date().toISOString());
    }
    return changed;
  }

  /** Poll while any event with a POS product is still taking entries or running. */
  startPolling(onChange: (eventIds: Set<number>) => void, intervalMs = 20_000) {
    const tick = async () => {
      const active = this.db
        .prepare("SELECT 1 FROM events WHERE pos_product_uuid IS NOT NULL AND status NOT IN ('draft', 'complete') LIMIT 1")
        .get();
      if (!active || !this.getClient()) return;
      try {
        const changed = await this.sync();
        if (changed.size) onChange(changed);
      } catch {
        // Recorded in pos_last_error and shown on the staff screens.
      }
    };
    const handle = setInterval(tick, intervalMs);
    handle.unref();
    return () => clearInterval(handle);
  }
}
