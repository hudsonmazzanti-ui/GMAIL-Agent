import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type EventState } from '../api';
import { formatJoinCode } from '../components/JoinQr';
import { ErrorNote } from '../components/ui';
import { useAction, useAuth } from '../hooks';

/** Where a scanned QR code or typed event code lands: find the event, then one tap to join. */
export function Join() {
  const code = useParams().code ?? '';
  const { viewer } = useAuth();
  const navigate = useNavigate();
  const [found, setFound] = useState<{ eventId: number; name: string; status: string } | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const { busy, error, run } = useAction();

  useEffect(() => {
    api(`/api/join/${encodeURIComponent(code)}`).then(setFound, (e) => setLookupError((e as Error).message));
  }, [code]);

  // Already in this event, or it's past registration: just show the event.
  useEffect(() => {
    if (!found || viewer.kind === 'anon') return;
    if (viewer.kind === 'staff' || found.status !== 'registration') {
      navigate(`/events/${found.eventId}`, { replace: true });
      return;
    }
    api<EventState>(`/api/events/${found.eventId}/state`).then((s) => {
      if (s.registrations.some((r) => r.playerId === viewer.playerId)) navigate(`/events/${found.eventId}`, { replace: true });
    });
  }, [found, viewer, navigate]);

  if (lookupError) {
    return (
      <div className="mx-auto max-w-sm space-y-3">
        <ErrorNote error={lookupError} />
        <Link to="/" className="btn-secondary">
          See all events
        </Link>
      </div>
    );
  }
  if (!found) return null;

  const join = () =>
    run(async () => {
      await api(`/api/events/${found.eventId}/register`, {});
      navigate(`/events/${found.eventId}`);
    });

  return (
    <div className="mx-auto max-w-sm space-y-4">
      <div className="card space-y-4 text-center">
        <div>
          <div className="label">Event {formatJoinCode(code.toUpperCase())}</div>
          <h1 className="text-2xl font-bold">{found.name}</h1>
        </div>
        {found.status !== 'registration' ? (
          <Link to={`/events/${found.eventId}`} className="btn-primary w-full">
            See pairings and standings
          </Link>
        ) : viewer.kind === 'anon' ? (
          <>
            <p className="text-sm text-slate-600 dark:text-slate-300">Log in with your name to join. New here? It takes a few seconds.</p>
            <Link to={`/login?next=${encodeURIComponent(`/join/${code}`)}`} className="btn-primary w-full">
              Log in to join
            </Link>
          </>
        ) : (
          <button className="btn-primary w-full text-base" disabled={busy} onClick={join}>
            Join as {viewer.kind === 'player' ? viewer.name : 'player'}
          </button>
        )}
        <ErrorNote error={error} />
      </div>
    </div>
  );
}
