import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { SESSION_COOKIE, loadViewer } from './auth.js';
import { openDb, type DB } from './db/client.js';
import { authRoutes } from './routes/auth.js';
import { eventRoutes } from './routes/events.js';
import { playRoutes } from './routes/play.js';
import { playerRoutes } from './routes/players.js';
import { posRoutes } from './routes/pos.js';
import type { PosUrls } from './pos/client.js';
import { PosService } from './pos/sync.js';
import { HttpError } from './tournament.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const WEB_DIST = path.join(here, '..', 'web', 'dist');

export async function buildApp(opts: { dbPath: string; logger?: boolean; posUrls?: PosUrls }) {
  const db: DB = openDb(opts.dbPath);
  const pos = new PosService(db, opts.posUrls);
  const app = Fastify({ logger: opts.logger ?? false });
  await app.register(cookie);

  app.decorateRequest('viewer', null as never);
  app.addHook('onRequest', async (req) => {
    req.viewer = loadViewer(db, req.cookies[SESSION_COOKIE]);
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.status(err.statusCode).send({ error: err.message });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.status(status).send({ error: (err as Error).message });
    app.log.error(err);
    return reply.status(500).send({ error: 'Something went wrong' });
  });

  authRoutes(app, db);
  playerRoutes(app, db);
  eventRoutes(app, db);
  playRoutes(app, db);
  posRoutes(app, db, pos);

  if (fs.existsSync(WEB_DIST)) {
    await app.register(fastifyStatic, { root: WEB_DIST });
    // Single-page app: unknown non-API paths serve index.html.
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.status(404).send({ error: 'Not found' });
      return reply.sendFile('index.html');
    });
  }

  app.addHook('onClose', async () => db.close());
  return { app, db, pos };
}
