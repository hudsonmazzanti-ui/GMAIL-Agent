/**
 * Fake PayPal POS (Zettle) server for tests and demos. PayPal POS has no sandbox, so this
 * implements the three endpoints Event Hub uses plus a tiny "register" page to ring up sales.
 *
 *   npm run fake-pos                     # http://localhost:4545
 *   POS_OAUTH_URL=http://localhost:4545 POS_PRODUCTS_URL=http://localhost:4545 \
 *   POS_PURCHASES_URL=http://localhost:4545 npm run serve
 *
 * Connect from Staff → Settings with API key `fake-api-key` and client ID `fake-client`.
 */
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import formbody from '@fastify/formbody';
import Fastify from 'fastify';
import { uuidV1, type PosPurchase } from '../server/pos/client.js';

export const FAKE_API_KEY = 'fake-api-key';
export const FAKE_CLIENT_ID = 'fake-client';

interface FakeProduct {
  uuid: string;
  name: string;
  variants: { uuid: string; name: string; price: { amount: number; currencyId: string } }[];
}

export async function createFakePos(opts: { tokenTtlSeconds?: number } = {}) {
  const app = Fastify();
  await app.register(formbody);
  const products = new Map<string, FakeProduct>();
  const purchases: (PosPurchase & { hash: string; refunded?: boolean })[] = [];
  const tokens = new Map<string, number>();
  let purchaseNumber = 1000;
  const stats = { tokenRequests: 0 };

  const authed = (auth: string | undefined) => {
    const exp = tokens.get((auth ?? '').replace(/^Bearer /, ''));
    return exp !== undefined && exp > Date.now();
  };

  app.post<{ Body: Record<string, string> }>('/token', async (req, reply) => {
    stats.tokenRequests++;
    const b = req.body ?? {};
    if (b.grant_type !== 'urn:ietf:params:oauth:grant-type:jwt-bearer' || b.assertion !== FAKE_API_KEY || b.client_id !== FAKE_CLIENT_ID) {
      return reply.status(400).send({ error: 'invalid_grant' });
    }
    const token = crypto.randomBytes(16).toString('hex');
    const ttl = opts.tokenTtlSeconds ?? 7200;
    tokens.set(token, Date.now() + ttl * 1000);
    return { access_token: token, expires_in: ttl };
  });

  app.post<{ Body: FakeProduct }>('/organizations/self/products', async (req, reply) => {
    if (!authed(req.headers.authorization)) return reply.status(401).send({ error: 'unauthorized' });
    const p = req.body;
    if (!p?.uuid || !p.name || !p.variants?.length) return reply.status(400).send({ error: 'invalid product' });
    products.set(p.uuid, p);
    return reply.status(201).send();
  });

  app.get<{ Querystring: { lastPurchaseHash?: string; startDate?: string; limit?: string } }>('/purchases/v2', async (req, reply) => {
    if (!authed(req.headers.authorization)) return reply.status(401).send({ error: 'unauthorized' });
    const { lastPurchaseHash, startDate } = req.query;
    const limit = Number(req.query.limit ?? 1000);
    let list = purchases;
    if (lastPurchaseHash) list = purchases.slice(purchases.findIndex((p) => p.hash === lastPurchaseHash) + 1);
    else if (startDate) list = purchases.filter((p) => p.timestamp! >= startDate);
    const page = list.slice(0, limit);
    return {
      purchases: page.map(({ hash, ...p }) => p),
      firstPurchaseHash: page[0]?.hash ?? null,
      lastPurchaseHash: page.at(-1)?.hash ?? null,
    };
  });

  /** Ring up a sale, like a cashier tapping products on the POS. */
  function sale(items: { productUuid: string; quantity?: number }[], seller = 'Front desk') {
    const lines = items.map((i) => {
      const p = products.get(i.productUuid);
      if (!p) throw new Error(`Unknown product ${i.productUuid}`);
      return {
        productUuid: p.uuid,
        variantUuid: p.variants[0].uuid,
        name: p.name,
        quantity: String(i.quantity ?? 1),
        unitPrice: p.variants[0].price.amount,
        type: 'PRODUCT',
      };
    });
    const purchase = {
      hash: crypto.randomBytes(8).toString('hex'),
      purchaseUUID1: uuidV1(),
      purchaseNumber: ++purchaseNumber,
      timestamp: new Date().toISOString(),
      amount: lines.reduce((a, l) => a + l.unitPrice * Number(l.quantity), 0),
      currency: products.get(items[0].productUuid)!.variants[0].price.currencyId,
      userDisplayName: seller,
      source: 'POS',
      refund: false,
      products: lines,
    };
    purchases.push(purchase);
    return purchase;
  }

  function refund(purchaseUuid: string, quantity?: number) {
    const orig = purchases.find((p) => p.purchaseUUID1 === purchaseUuid);
    if (!orig) throw new Error('Unknown purchase');
    const lines = orig.products!.map((l) => ({ ...l, quantity: String(-(quantity ?? Number(l.quantity))) }));
    const r = {
      hash: crypto.randomBytes(8).toString('hex'),
      purchaseUUID1: uuidV1(),
      purchaseNumber: ++purchaseNumber,
      timestamp: new Date().toISOString(),
      amount: lines.reduce((a, l) => a + l.unitPrice! * Number(l.quantity), 0),
      currency: orig.currency,
      userDisplayName: orig.userDisplayName,
      refund: true,
      refundsPurchaseUUID1: purchaseUuid,
      products: lines,
    };
    orig.refunded = true;
    purchases.push(r);
    return r;
  }

  app.post<{ Body: { productUuid: string; quantity?: string } }>('/fake/sale', async (req, reply) => {
    sale([{ productUuid: req.body.productUuid, quantity: Number(req.body.quantity ?? 1) }]);
    return reply.redirect('/');
  });
  app.post<{ Body: { purchaseUuid: string } }>('/fake/refund', async (req, reply) => {
    refund(req.body.purchaseUuid);
    return reply.redirect('/');
  });

  app.get('/', async (_req, reply) => {
    const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
    const money = (c: number, cur: string) => `${(c / 100).toFixed(2)} ${esc(cur)}`;
    reply.type('text/html; charset=utf-8').send(`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width">
<title>Fake PayPal POS</title>
<style>body{font:15px system-ui;max-width:720px;margin:24px auto;padding:0 16px}button{font:inherit;padding:6px 12px;margin-left:4px}
li{margin:8px 0;list-style:none}h2{margin-top:28px}.muted{color:#666}</style>
<h1>Fake PayPal POS</h1><p class=muted>For testing Event Hub. Nothing here is real money.</p>
<h2>Products</h2>${
      [...products.values()]
        .map(
          (p) => `<li><b>${esc(p.name)}</b> — ${money(p.variants[0].price.amount, p.variants[0].price.currencyId)}
<form method=post action=/fake/sale style=display:inline><input type=hidden name=productUuid value="${p.uuid}">
<button name=quantity value=1>Ring up ×1</button><button name=quantity value=2>×2</button></form></li>`,
        )
        .join('') || '<p class=muted>No products yet — use “Add to POS” in Event Hub.</p>'
    }
<h2>Sales</h2>${
      [...purchases]
        .reverse()
        .map(
          (p) => `<li>#${p.purchaseNumber} · ${esc(new Date(p.timestamp!).toLocaleTimeString())} · ${money(p.amount!, p.currency!)}
${p.refund ? '<i>refund</i>' : p.refunded ? '<i>refunded</i>' : `<form method=post action=/fake/refund style=display:inline><input type=hidden name=purchaseUuid value="${p.purchaseUUID1}"><button>Refund</button></form>`}</li>`,
        )
        .join('') || '<p class=muted>No sales yet.</p>'
    }`);
  });

  /** Expire every issued token, as if two hours passed on PayPal's side. */
  const revokeTokens = () => tokens.clear();

  return { app, products, purchases, sale, refund, stats, revokeTokens };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.FAKE_POS_PORT ?? 4545);
  const { app } = await createFakePos();
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`Fake PayPal POS on http://localhost:${port}  (API key "${FAKE_API_KEY}", client ID "${FAKE_CLIENT_ID}")`);
}
