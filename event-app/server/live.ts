import type { ServerResponse } from 'node:http';

/** Server-Sent Events hub: every open page for an event gets a "change" ping and refetches. */
const listeners = new Map<number, Set<ServerResponse>>();

export function subscribe(eventId: number, res: ServerResponse) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  if (!listeners.has(eventId)) listeners.set(eventId, new Set());
  listeners.get(eventId)!.add(res);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);
  res.on('close', () => {
    clearInterval(heartbeat);
    listeners.get(eventId)?.delete(res);
  });
}

export function broadcast(eventId: number) {
  for (const res of listeners.get(eventId) ?? []) res.write(`event: change\ndata: ${Date.now()}\n\n`);
  for (const res of listeners.get(0) ?? []) res.write(`event: change\ndata: ${eventId}\n\n`);
}
