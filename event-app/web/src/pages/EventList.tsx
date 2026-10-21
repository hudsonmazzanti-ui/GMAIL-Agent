import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, formatDate, type EventListItem } from '../api';
import { Empty, StatusPill } from '../components/ui';
import { useAuth, useLive } from '../hooks';

export function EventList() {
  const { viewer } = useAuth();
  const [events, setEvents] = useState<EventListItem[] | null>(null);
  const load = useCallback(() => api<EventListItem[]>('/api/events').then(setEvents), []);
  useEffect(() => {
    load();
  }, [load, viewer.kind]);
  useLive('/api/live', load);

  if (!events) return null;
  const live = events.filter((e) => e.status === 'swiss' || e.status === 'topcut');
  const upcoming = events.filter((e) => ['draft', 'registration', 'checkin'].includes(e.status));
  const past = events.filter((e) => e.status === 'complete');

  return (
    <div className="space-y-8">
      {viewer.kind === 'anon' && (
        <div className="card flex flex-wrap items-center justify-between gap-3 bg-indigo-50 dark:bg-indigo-950/40">
          <p className="text-sm">Log in with your name to register and see your pairings.</p>
          <Link to="/login" className="btn-primary btn-sm">
            Log in / Sign up
          </Link>
        </div>
      )}
      <CodeEntry />
      <Section title="Happening now" events={live} />
      <Section title="Upcoming" events={upcoming} empty="No upcoming events yet." />
      <Section title="Past events" events={past} />
    </div>
  );
}

function Section({ title, events, empty }: { title: string; events: EventListItem[]; empty?: string }) {
  if (!events.length && !empty) return null;
  return (
    <section>
      <h2 className="mb-3 text-lg font-bold">{title}</h2>
      {events.length === 0 ? (
        <div className="card">
          <Empty>{empty}</Empty>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {events.map((e) => (
            <Link key={e.id} to={`/events/${e.id}`} className="card block transition hover:border-indigo-400">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold">{e.name}</h3>
                <StatusPill status={e.status} />
              </div>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {[e.game, e.format].filter(Boolean).join(' · ') || 'TCG event'}
              </p>
              <p className="mt-2 flex justify-between text-sm">
                <span>{formatDate(e.date, e.start_time)}</span>
                <span className="text-slate-500 dark:text-slate-400">
                  {e.registered}
                  {e.capacity ? ` / ${e.capacity}` : ''} players
                </span>
              </p>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

/** Type the code staff show (the same one in the QR code) to jump straight to an event. */
function CodeEntry() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return (
    <form
      className="card flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (clean.length === 6) navigate(`/join/${clean}`);
      }}
    >
      <label className="min-w-0 flex-1">
        <span className="label">Have an event code?</span>
        <input
          id="event-code"
          className="input font-mono uppercase tracking-widest"
          placeholder="ABC-234"
          autoCapitalize="characters"
          autoComplete="off"
          maxLength={7}
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
      </label>
      <button className="btn-primary" disabled={clean.length !== 6}>
        Find event
      </button>
    </form>
  );
}
