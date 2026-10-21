/**
 * The demo's "server": the real route modules from server/routes, registered on a tiny
 * Fastify-shaped router and called from a `fetch` shim instead of over HTTP. The database is
 * sql.js, and PayPal POS calls go to the in-browser fake POS.
 */
import { loadViewer, SESSION_COOKIE } from '../../../server/auth';
import { posRoutes } from '../../../server/routes/pos';
import { authRoutes } from '../../../server/routes/auth';
import { eventRoutes } from '../../../server/routes/events';
import { playRoutes } from '../../../server/routes/play';
import { playerRoutes } from '../../../server/routes/players';
import { PosService } from '../../../server/pos/sync';
import { HttpError } from '../../../server/tournament';
import { createFakePosCore, type FakePosSnapshot } from '../../../scripts/fake-pos-core';
import { openDemoDb, type DemoDb } from './db';

type Handler = (req: any, reply: any) => unknown;
interface Route {
  method: string;
  re: RegExp;
  keys: string[];
  handler: Handler;
}

const FAKE_POS_BASE = 'http://fake-pos';
export const DEMO_STORE_URL = 'http://192.168.1.20:3000';
// Bump when the seed changes so returning visitors get the new sample data.
const STORE_KEY = 'event-hub-demo-v3';

export class DemoBackend {
  private routes: Route[] = [];
  private preHandlers: Handler[] = [];
  private listeners = new Set<() => void>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  token: string | null = null;

  private constructor(
    public db: DemoDb,
    public pos: ReturnType<typeof createFakePosCore>,
    public posService: PosService,
  ) {
    const app = {
      get: (path: string, h: Handler) => this.add('GET', path, h),
      post: (path: string, h: Handler) => this.add('POST', path, h),
      patch: (path: string, h: Handler) => this.add('PATCH', path, h),
      delete: (path: string, h: Handler) => this.add('DELETE', path, h),
      addHook: (name: string, h: Handler) => name === 'preHandler' && this.preHandlers.push(h),
    } as any;
    const sqlite = db as any;
    // The demo has no store computer; QR codes point at a typical store address instead.
    app.get('/api/server-info', async () => ({ publicUrls: [DEMO_STORE_URL], configured: true }));
    authRoutes(app, sqlite);
    playerRoutes(app, sqlite);
    eventRoutes(app, sqlite, posService);
    playRoutes(app, sqlite);
    posRoutes(app, sqlite, posService);
    // The store install polls every 20 s; the demo checks every 3 s so sales show up quickly.
    posService.startPolling(() => this.changed(), 3000);
  }

  static async create(): Promise<{ backend: DemoBackend; fresh: boolean }> {
    let saved: { db: string; pos: FakePosSnapshot; token: string | null } | null = null;
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) saved = JSON.parse(raw);
    } catch {
      saved = null;
    }
    const bytes = saved ? Uint8Array.from(atob(saved.db), (c) => c.charCodeAt(0)) : undefined;
    const db = await openDemoDb(bytes);
    const pos = createFakePosCore({ acceptAnyKey: true, restore: saved?.pos });
    const urls = { oauth: FAKE_POS_BASE, products: FAKE_POS_BASE, purchases: FAKE_POS_BASE };
    const backend = new DemoBackend(db, pos, new PosService(db as any, urls, pos.fetchImpl));
    backend.token = saved?.token ?? null;
    return { backend, fresh: !saved };
  }

  private add(method: string, path: string, handler: Handler) {
    const keys: string[] = [];
    const re = new RegExp(
      '^' +
        path.replace(/[.]/g, '\\.').replace(/:(\w+)/g, (_, k) => {
          keys.push(k);
          return '([^/]+)';
        }) +
        '$',
    );
    this.routes.push({ method, re, keys, handler });
  }

  /** Handle one API request as the current viewer. */
  async handle(method: string, url: string, body: unknown, token = this.token) {
    const u = new URL(url, 'http://demo');
    const route = this.routes.find((r) => r.method === method && r.re.test(u.pathname));
    if (!route) return { status: 404, body: { error: 'Not found' } as unknown, token: undefined };
    const m = u.pathname.match(route.re)!;
    const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    const req = {
      method,
      url: u.pathname + u.search,
      params,
      query: Object.fromEntries(u.searchParams),
      body: body ?? {},
      headers: {},
      cookies: token ? { [SESSION_COOKIE]: token } : {},
      viewer: loadViewer(this.db as any, token ?? undefined),
    };
    let newToken: string | null | undefined;
    const reply: any = {
      setCookie: (_name: string, value: string) => ((newToken = value), reply),
      clearCookie: () => ((newToken = null), reply),
      header: () => reply,
      status: () => reply,
      hijack: () => reply,
    };
    try {
      for (const h of this.preHandlers) await h(req, reply);
      const result = await route.handler(req, reply);
      if (newToken !== undefined && token === this.token) this.token = newToken;
      if (method !== 'GET') this.changed();
      return { status: 200, body: result, token: newToken };
    } catch (e) {
      const status = e instanceof HttpError ? e.statusCode : 500;
      return { status, body: { error: (e as Error).message }, token: undefined };
    }
  }

  /** Something changed: tell every open page (stands in for the server's live updates) and save. */
  changed() {
    for (const l of this.listeners) l();
    this.scheduleSave();
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 300);
  }

  save() {
    try {
      const bytes = this.db.raw.export();
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      localStorage.setItem(STORE_KEY, JSON.stringify({ db: btoa(bin), pos: this.pos.snapshot(), token: this.token }));
    } catch {
      // Storage can be unavailable (private window, blocked site data); the demo still works for this visit.
    }
  }

  static clearSaved() {
    try {
      localStorage.removeItem(STORE_KEY);
    } catch {
      // ignore
    }
  }
}

/** Route `fetch('/api/...')` and `new EventSource('/api/...')` to the in-browser backend. */
export function installShims(backend: DemoBackend) {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = url.startsWith('/') ? url : new URL(url).pathname + new URL(url).search;
    if (!path.startsWith('/api/')) return realFetch(input, init);
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    const res = await backend.handle((init.method ?? 'GET').toUpperCase(), path, body);
    const isText = typeof res.body === 'string';
    return new Response(isText ? (res.body as string) : JSON.stringify(res.body ?? null), {
      status: res.status,
      headers: { 'Content-Type': isText ? 'text/csv' : 'application/json' },
    });
  };

  class DemoEventSource extends EventTarget {
    onopen: (() => void) | null = null;
    private off: () => void;
    constructor(public url: string) {
      super();
      this.off = backend.subscribe(() => this.dispatchEvent(new MessageEvent('change', { data: String(Date.now()) })));
      setTimeout(() => this.onopen?.(), 0);
    }
    close() {
      this.off();
    }
  }
  (window as any).EventSource = DemoEventSource;
}
