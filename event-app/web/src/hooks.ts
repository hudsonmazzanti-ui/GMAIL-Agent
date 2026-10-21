import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, type EventState, type Viewer } from './api';

export interface AuthState {
  viewer: Viewer;
  staffSetupNeeded: boolean;
  refresh: () => Promise<void>;
}

export const AuthContext = createContext<AuthState>({
  viewer: { kind: 'anon' },
  staffSetupNeeded: false,
  refresh: async () => {},
});

export const useAuth = () => useContext(AuthContext);

/** Subscribe to a Server-Sent Events stream and call `onChange` on every ping (and on reconnect). */
export function useLive(url: string, onChange: () => void) {
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => {
    const es = new EventSource(url);
    es.addEventListener('change', () => cb.current());
    es.onopen = () => cb.current();
    return () => es.close();
  }, [url]);
}

/** Live event state: fetched once, refetched whenever the server broadcasts a change. */
export function useLiveEvent(eventId: number) {
  const [state, setState] = useState<EventState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clockSkew, setClockSkew] = useState(0);

  const reload = useCallback(async () => {
    try {
      const s = await api<EventState>(`/api/events/${eventId}/state`);
      setClockSkew(s.serverNow - Date.now());
      setState(s);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [eventId]);

  useEffect(() => {
    reload();
  }, [reload]);
  useLive(`/api/events/${eventId}/stream`, reload);

  return { state, error, reload, clockSkew };
}

/** Milliseconds left on a round timer, ticking every second. */
export function useCountdown(timer: { endsAt: number | null; remainingMs: number } | undefined, clockSkew: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!timer?.endsAt) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [timer?.endsAt]);
  if (!timer) return null;
  if (timer.endsAt === null) return timer.remainingMs;
  return Math.max(0, timer.endsAt - (now + clockSkew));
}

export function formatClock(ms: number) {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Run an async action, capturing its error message for display. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, setError, run };
}
