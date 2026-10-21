/**
 * In-memory fake of the PayPal POS (Zettle) endpoints Event Hub uses. PayPal POS has no
 * sandbox, so tests, `npm run fake-pos` and the browser demo all run against this.
 * It has no Node or browser dependencies: `handle()` takes a plain request and returns a plain response.
 */
import { uuidV1, type PosPurchase } from '../server/pos/client.js';

export const FAKE_API_KEY = 'fake-api-key';
export const FAKE_CLIENT_ID = 'fake-client';

export interface FakeProduct {
  uuid: string;
  name: string;
  variants: { uuid: string; name: string; price: { amount: number; currencyId: string } }[];
}

export type FakePurchase = PosPurchase & { hash: string; refunded?: boolean };

export interface FakeRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Record<string, string | undefined>;
  /** Parsed JSON body, or form fields for /token. */
  body: any;
}

export interface FakeResponse {
  status: number;
  json?: unknown;
}

const hex = (bytes: number) =>
  Array.from(globalThis.crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');

export interface FakePosSnapshot {
  products: FakeProduct[];
  purchases: FakePurchase[];
}

export function createFakePosCore(opts: { tokenTtlSeconds?: number; acceptAnyKey?: boolean; restore?: FakePosSnapshot } = {}) {
  const products = new Map<string, FakeProduct>((opts.restore?.products ?? []).map((p) => [p.uuid, p]));
  const purchases: FakePurchase[] = [...(opts.restore?.purchases ?? [])];
  const tokens = new Map<string, number>();
  const stats = { tokenRequests: 0 };
  let purchaseNumber = Math.max(1000, ...purchases.map((p) => Number(p.purchaseNumber ?? 0)));

  const authed = (auth: string | undefined) => {
    const exp = tokens.get((auth ?? '').replace(/^Bearer /, ''));
    return exp !== undefined && exp > Date.now();
  };

  function handle(req: FakeRequest): FakeResponse {
    if (req.method === 'POST' && req.path === '/token') {
      stats.tokenRequests++;
      const b = req.body ?? {};
      const keyOk = opts.acceptAnyKey ? !!b.assertion : b.assertion === FAKE_API_KEY && b.client_id === FAKE_CLIENT_ID;
      if (b.grant_type !== 'urn:ietf:params:oauth:grant-type:jwt-bearer' || !keyOk) {
        return { status: 400, json: { error: 'invalid_grant' } };
      }
      const token = hex(16);
      const ttl = opts.tokenTtlSeconds ?? 7200;
      tokens.set(token, Date.now() + ttl * 1000);
      return { status: 200, json: { access_token: token, expires_in: ttl } };
    }

    if (!authed(req.headers.authorization)) return { status: 401, json: { error: 'unauthorized' } };

    if (req.method === 'POST' && req.path === '/organizations/self/products') {
      const p = req.body as FakeProduct;
      if (!p?.uuid || !p.name || !p.variants?.length) return { status: 400, json: { error: 'invalid product' } };
      products.set(p.uuid, p);
      return { status: 201 };
    }

    if (req.method === 'GET' && req.path === '/purchases/v2') {
      const cursor = req.query.get('lastPurchaseHash');
      const startDate = req.query.get('startDate');
      const limit = Number(req.query.get('limit') ?? 1000);
      let list = purchases;
      if (cursor) list = purchases.slice(purchases.findIndex((p) => p.hash === cursor) + 1);
      else if (startDate) list = purchases.filter((p) => p.timestamp! >= startDate);
      const page = list.slice(0, limit);
      return {
        status: 200,
        json: {
          purchases: page.map(({ hash, ...p }) => p),
          firstPurchaseHash: page[0]?.hash ?? null,
          lastPurchaseHash: page.at(-1)?.hash ?? null,
        },
      };
    }

    return { status: 404, json: { error: 'not found' } };
  }

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
    const purchase: FakePurchase = {
      hash: hex(8),
      purchaseUUID1: uuidV1(),
      purchaseNumber: ++purchaseNumber,
      timestamp: new Date().toISOString(),
      amount: lines.reduce((a, l) => a + l.unitPrice * Number(l.quantity), 0),
      currency: products.get(items[0].productUuid)!.variants[0].price.currencyId,
      userDisplayName: seller,
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
    const r: FakePurchase = {
      hash: hex(8),
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

  /** Expire every issued token, as if two hours passed on PayPal's side. */
  const revokeTokens = () => tokens.clear();

  /** A `fetch` that answers from this fake instead of the network (used by the browser demo). */
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://fake-pos');
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => (headers[k.toLowerCase()] = v));
    let body: unknown;
    if (init.body instanceof URLSearchParams) body = Object.fromEntries(init.body);
    else if (typeof init.body === 'string') body = JSON.parse(init.body);
    const res = handle({ method: (init.method ?? 'GET').toUpperCase(), path: url.pathname, query: url.searchParams, headers, body });
    return new Response(res.json === undefined ? null : JSON.stringify(res.json), {
      status: res.status,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const snapshot = (): FakePosSnapshot => ({ products: [...products.values()], purchases });

  return { handle, fetchImpl, products, purchases, sale, refund, stats, revokeTokens, snapshot };
}
