/**
 * Fake PayPal POS (Zettle) server for tests and demos. PayPal POS has no sandbox, so this
 * serves the three endpoints Event Hub uses plus a tiny "register" page to ring up sales.
 *
 *   npm run fake-pos                     # http://localhost:4545
 *   npm run build && npm run serve:fake-pos
 *
 * Connect from Staff → Settings with API key `fake-api-key` and client ID `fake-client`.
 */
import { fileURLToPath } from 'node:url';
import formbody from '@fastify/formbody';
import Fastify from 'fastify';
import { createFakePosCore, FAKE_API_KEY, FAKE_CLIENT_ID } from './fake-pos-core.js';

export { FAKE_API_KEY, FAKE_CLIENT_ID };

export async function createFakePos(opts: { tokenTtlSeconds?: number } = {}) {
  const app = Fastify();
  await app.register(formbody);
  const core = createFakePosCore(opts);
  const { products, purchases } = core;

  for (const [method, url] of [
    ['POST', '/token'],
    ['POST', '/organizations/self/products'],
    ['GET', '/purchases/v2'],
  ] as const) {
    app.route({
      method,
      url,
      handler: async (req, reply) => {
        const res = core.handle({
          method,
          path: url,
          query: new URLSearchParams(req.query as Record<string, string>),
          headers: req.headers as Record<string, string | undefined>,
          body: req.body,
        });
        return reply.status(res.status).send(res.json ?? '');
      },
    });
  }

  app.post<{ Body: { productUuid: string; quantity?: string } }>('/fake/sale', async (req, reply) => {
    core.sale([{ productUuid: req.body.productUuid, quantity: Number(req.body.quantity ?? 1) }]);
    return reply.redirect('/');
  });
  app.post<{ Body: { purchaseUuid: string } }>('/fake/refund', async (req, reply) => {
    core.refund(req.body.purchaseUuid);
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

  return { app, ...core };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.FAKE_POS_PORT ?? 4545);
  const { app } = await createFakePos();
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`Fake PayPal POS on http://localhost:${port}  (API key "${FAKE_API_KEY}", client ID "${FAKE_CLIENT_ID}")`);
}
