/**
 * Round timer state. The server is the source of truth; clients render a countdown from
 * `endsAt` (when running) or `remainingMs` (when paused / not started).
 */
export interface TimerState {
  /** Epoch ms when time runs out, or null when the timer is not running. */
  endsAt: number | null;
  /** Remaining ms while paused or before the first start. */
  remainingMs: number;
}

export function newTimer(durationMs: number): TimerState {
  return { endsAt: null, remainingMs: durationMs };
}

export function remaining(t: TimerState, now: number): number {
  return t.endsAt === null ? t.remainingMs : Math.max(0, t.endsAt - now);
}

export function isRunning(t: TimerState): boolean {
  return t.endsAt !== null;
}

export function start(t: TimerState, now: number): TimerState {
  if (t.endsAt !== null) return t;
  return { endsAt: now + t.remainingMs, remainingMs: t.remainingMs };
}

export function pause(t: TimerState, now: number): TimerState {
  if (t.endsAt === null) return t;
  return { endsAt: null, remainingMs: remaining(t, now) };
}

export function addTime(t: TimerState, deltaMs: number, now: number): TimerState {
  if (t.endsAt === null) return { endsAt: null, remainingMs: Math.max(0, t.remainingMs + deltaMs) };
  return { endsAt: Math.max(now, t.endsAt + deltaMs), remainingMs: t.remainingMs };
}
