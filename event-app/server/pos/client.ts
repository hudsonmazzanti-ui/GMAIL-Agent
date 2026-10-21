import crypto from 'node:crypto';

/**
 * Minimal PayPal POS (Zettle) API client for a self-hosted, single-merchant app:
 * API-key assertion grant → access token, Product Library create, Purchase list.
 */

export interface PosUrls {
  oauth: string;
  products: string;
  purchases: string;
}

export const DEFAULT_POS_URLS: PosUrls = {
  oauth: process.env.POS_OAUTH_URL ?? 'https://oauth.zettle.com',
  products: process.env.POS_PRODUCTS_URL ?? 'https://products.izettle.com',
  purchases: process.env.POS_PURCHASES_URL ?? 'https://purchase.izettle.com',
};

export const API_KEY_SCOPES = ['READ:PURCHASE', 'READ:PRODUCT', 'WRITE:PRODUCT'];
export const API_KEY_URL = `https://my.zettle.com/apps/api-keys?name=${encodeURIComponent('Event Hub')}&scopes=${encodeURIComponent(API_KEY_SCOPES.join(' '))}`;

export interface PosCredentials {
  apiKey: string;
  clientId: string;
}

/** The parts of a purchase we use. The API adds fields over time, so everything else is ignored. */
export interface PosPurchase {
  purchaseUUID1?: string;
  purchaseUUID?: string;
  purchaseNumber?: number | string;
  globalPurchaseNumber?: number | string;
  timestamp?: string;
  created?: string;
  amount?: number;
  currency?: string;
  userDisplayName?: string;
  refund?: boolean;
  refundsPurchaseUUID1?: string;
  refundsPurchaseUUID?: string;
  products?: {
    productUuid?: string;
    variantUuid?: string;
    name?: string;
    quantity?: string | number;
    unitPrice?: number;
  }[];
}

export interface PurchasePage {
  purchases: PosPurchase[];
  lastPurchaseHash?: string | null;
}

export class PosError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Pull the client_id claim out of an API key (a JWT), so staff usually only paste the key. */
export function clientIdFromApiKey(apiKey: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(apiKey.split('.')[1], 'base64url').toString('utf8'));
    return typeof payload.client_id === 'string' ? payload.client_id : null;
  } catch {
    return null;
  }
}

/** Time-based UUID v1, the identifier format the Zettle Product Library uses. */
export function uuidV1(now = Date.now()): string {
  const t = BigInt(now) * 10000n + 0x01b21dd213814000n; // 100ns intervals since 1582-10-15
  const timeLow = (t & 0xffffffffn).toString(16).padStart(8, '0');
  const timeMid = ((t >> 32n) & 0xffffn).toString(16).padStart(4, '0');
  const timeHi = (((t >> 48n) & 0x0fffn) | 0x1000n).toString(16).padStart(4, '0');
  const rand = crypto.randomBytes(8);
  rand[0] = (rand[0] & 0x3f) | 0x80; // variant
  rand[2] |= 0x01; // multicast bit marks a random node id
  const clock = rand.subarray(0, 2).toString('hex');
  const node = rand.subarray(2, 8).toString('hex');
  return `${timeLow}-${timeMid}-${timeHi}-${clock}-${node}`;
}

export class PosClient {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private creds: PosCredentials,
    private urls: PosUrls = DEFAULT_POS_URLS,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private async request(url: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await this.fetchImpl(url, { ...init, signal: ctrl.signal });
    } catch (e) {
      throw new PosError(0, `Can't reach PayPal POS (${(e as Error).message}). Is the internet up?`);
    } finally {
      clearTimeout(timer);
    }
  }

  async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const res = await this.request(`${this.urls.oauth}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        client_id: this.creds.clientId,
        assertion: this.creds.apiKey,
      }),
    });
    if (!res.ok) {
      throw new PosError(res.status, res.status === 400 || res.status === 401 ? 'PayPal POS rejected the API key' : `PayPal POS login failed (${res.status})`);
    }
    const body = (await res.json()) as { access_token: string; expires_in?: number };
    this.token = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 7200) * 1000 };
    return this.token.value;
  }

  /** Authorized call with one retry on 401 (expired token) and on 429/5xx (backoff). */
  private async api(url: string, init: RequestInit = {}): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const token = await this.accessToken();
      const res = await this.request(url, {
        ...init,
        headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      if (res.ok) return res;
      if (attempt === 0 && res.status === 401) {
        this.token = null;
        continue;
      }
      if (attempt < 2 && (res.status === 429 || res.status >= 500)) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        continue;
      }
      const text = await res.text().catch(() => '');
      throw new PosError(res.status, `PayPal POS error ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
    }
  }

  /** Create a single-variant product in the POS Product Library; returns the UUIDs we generated. */
  async createProduct(p: { name: string; description: string; priceCents: number; currency: string }) {
    const productUuid = uuidV1();
    const variantUuid = uuidV1();
    await this.api(`${this.urls.products}/organizations/self/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uuid: productUuid,
        name: p.name,
        description: p.description,
        variants: [{ uuid: variantUuid, name: 'Entry', price: { amount: p.priceCents, currencyId: p.currency } }],
      }),
    });
    return { productUuid, variantUuid };
  }

  /** One page of purchases, oldest first, after `cursor` (or from `startDate` on the first sync). */
  async listPurchases(opts: { cursor?: string | null; startDate?: string; limit?: number }): Promise<PurchasePage> {
    const qs = new URLSearchParams({ limit: String(opts.limit ?? 200), descending: 'false' });
    if (opts.cursor) qs.set('lastPurchaseHash', opts.cursor);
    else if (opts.startDate) qs.set('startDate', opts.startDate);
    const res = await this.api(`${this.urls.purchases}/purchases/v2?${qs}`);
    const body = (await res.json()) as PurchasePage;
    return { purchases: body.purchases ?? [], lastPurchaseHash: body.lastPurchaseHash ?? null };
  }
}
