import type { FastifyInstance } from 'fastify';
import type { DB } from '../db/client.js';
import { requirePlayer, requireStaff } from '../auth.js';
import { broadcast } from '../live.js';
import * as t from '../tournament.js';

export function playRoutes(app: FastifyInstance, db: DB) {
  app.post<{ Params: { id: string } }>('/api/rounds/:id/repair', async (req) => {
    requireStaff(req);
    broadcast(t.repairRound(db, Number(req.params.id)));
    return { ok: true };
  });

  app.post<{ Params: { id: string }; Body: { action: t.TimerAction; minutes?: number } }>('/api/rounds/:id/timer', async (req) => {
    requireStaff(req);
    const action = req.body?.action;
    if (!['start', 'pause', 'add'].includes(action)) throw new t.HttpError(400, 'Unknown timer action');
    broadcast(t.updateTimer(db, Number(req.params.id), action, Number(req.body?.minutes ?? 0)));
    return { ok: true };
  });

  /** Staff enter or override a result (confirmed immediately); players report (opponent confirms). */
  app.post<{ Params: { id: string }; Body: t.ResultInput }>('/api/matches/:id/result', async (req) => {
    const matchId = Number(req.params.id);
    const body = { p1Games: Number(req.body?.p1Games), p2Games: Number(req.body?.p2Games), draws: Number(req.body?.draws ?? 0) };
    const eventId =
      req.viewer.kind === 'staff' ? t.staffSetResult(db, matchId, body) : t.playerReport(db, matchId, requirePlayer(req), body);
    broadcast(eventId);
    return { ok: true };
  });

  app.post<{ Params: { id: string }; Body: { accept: boolean } }>('/api/matches/:id/respond', async (req) => {
    broadcast(t.playerRespond(db, Number(req.params.id), requirePlayer(req), req.body?.accept !== false));
    return { ok: true };
  });
}
