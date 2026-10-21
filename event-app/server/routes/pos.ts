import type { FastifyInstance } from 'fastify';
import type { DB } from '../db/client.js';
import { requireStaff } from '../auth.js';
import { broadcast } from '../live.js';
import { API_KEY_URL, clientIdFromApiKey, PosError } from '../pos/client.js';
import * as pay from '../pos/payments.js';
import type { PosService } from '../pos/sync.js';
import * as t from '../tournament.js';

export function posRoutes(app: FastifyInstance, db: DB, pos: PosService) {
  const id = (p: { id: string }) => Number(p.id);
  const changed = (eventId: number) => {
    broadcast(eventId);
    return { ok: true };
  };
  const posCall = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof PosError) throw new t.HttpError(502, e.message);
      throw e;
    }
  };

  // Every route here is staff-only.
  app.addHook('preHandler', async (req) => {
    if (req.url.startsWith('/api/pos') || /^\/api\/(events\/\d+\/(pos|payments)|payments)/.test(req.url)) requireStaff(req);
  });

  app.get('/api/pos/status', async () => ({ ...pos.status(), apiKeyUrl: API_KEY_URL }));

  app.post<{ Body: { apiKey: string; clientId?: string } }>('/api/pos/connect', async (req) => {
    const apiKey = String(req.body?.apiKey ?? '').trim();
    if (!apiKey) throw new t.HttpError(400, 'Paste the API key from my.zettle.com');
    const clientId = String(req.body?.clientId ?? '').trim() || clientIdFromApiKey(apiKey);
    if (!clientId) throw new t.HttpError(400, 'Also paste the client ID shown next to the API key');
    await posCall(() => pos.connect(apiKey, clientId));
    return pos.status();
  });

  app.post('/api/pos/disconnect', async () => {
    pos.disconnect();
    return pos.status();
  });

  app.post('/api/pos/sync', async () => {
    const ids = await posCall(() => pos.sync());
    for (const eventId of ids) broadcast(eventId);
    return { ok: true, changedEvents: [...ids] };
  });

  app.post<{ Params: { id: string } }>('/api/events/:id/pos/product', async (req) => {
    const ev = t.getEvent(db, id(req.params));
    if (ev.pos_product_uuid) throw new t.HttpError(400, 'This event is already on the POS');
    if (ev.entry_fee_cents <= 0) throw new t.HttpError(400, 'Set an entry fee first');
    const client = pos.getClient();
    if (!client) throw new t.HttpError(400, 'Connect PayPal POS in Staff → Settings first');
    const { productUuid, variantUuid } = await posCall(() =>
      client.createProduct({
        name: `Entry · ${ev.name}${ev.date ? ` · ${ev.date}` : ''}`.slice(0, 120),
        description: [ev.game, ev.format].filter(Boolean).join(' · ') || 'Event entry',
        priceCents: ev.entry_fee_cents,
        currency: ev.currency,
      }),
    );
    db.prepare('UPDATE events SET pos_product_uuid = ?, pos_variant_uuid = ? WHERE id = ?').run(productUuid, variantUuid, ev.id);
    return changed(ev.id);
  });

  /** Stop matching sales to this event. The product stays on the POS; delete it there if unwanted. */
  app.delete<{ Params: { id: string } }>('/api/events/:id/pos/product', async (req) => {
    db.prepare('UPDATE events SET pos_product_uuid = NULL, pos_variant_uuid = NULL WHERE id = ?').run(id(req.params));
    db.prepare('DELETE FROM pos_waiting WHERE event_id = ?').run(id(req.params));
    return changed(id(req.params));
  });

  app.post<{ Params: { id: string }; Body: { playerId: number } }>('/api/events/:id/payments/collect', async (req) => {
    pay.collect(db, id(req.params), Number(req.body?.playerId));
    return changed(id(req.params));
  });

  app.post<{ Params: { id: string }; Body: { playerId: number } }>('/api/events/:id/payments/cancel-collect', async (req) => {
    pay.cancelCollect(db, id(req.params), Number(req.body?.playerId));
    return changed(id(req.params));
  });

  app.post<{ Params: { id: string }; Body: { playerId: number; method: 'cash' | 'comp' } }>('/api/events/:id/payments/manual', async (req) => {
    const method = req.body?.method;
    if (method !== 'cash' && method !== 'comp') throw new t.HttpError(400, 'Method must be cash or comp');
    pay.recordManual(db, id(req.params), Number(req.body?.playerId), method);
    return changed(id(req.params));
  });

  app.get<{ Params: { id: string } }>('/api/events/:id/payments.csv', async (req, reply) => {
    const ev = t.getEvent(db, id(req.params));
    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${ev.name.replace(/[^\w-]+/g, '_')}_payments.csv"`);
    return pay.paymentsCsv(db, ev.id);
  });

  app.post<{ Params: { id: string }; Body: { playerId: number } }>('/api/payments/:id/assign', async (req) => {
    return changed(pay.assign(db, id(req.params), Number(req.body?.playerId)));
  });

  app.delete<{ Params: { id: string } }>('/api/payments/:id', async (req) => {
    return changed(pay.removePayment(db, id(req.params)));
  });
}
