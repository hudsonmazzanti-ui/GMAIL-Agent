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
  const active = events.filter((e) => e.status !== 'complete');
  const mine = active.filter((e) => e.joined);
  const others = active.filter((e) => !e.joined);
  const past = events.filter((e) => e.status === 'complete');

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {mine.length > 0 && <Section title="Your event" events={mine} highlight />}
      <CodeEntry />
      {viewer.kind === 'anon' && (
        <p className="text-center text-sm text-slate-500">
          Playing tonight? Scan the QR code at the desk, enter the event code, or pick an event below.
        </p>
      )}
      <Section title={mine.length ? 'Other events' : 'Events'} events={others} empty="No events coming up yet." />
      {past.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm font-semibold text-slate-500">Past events ({past.length})</summary>
          <div className="mt-3">
            <Section title="" events={past} />
          </div>
        </details>
      )}
    </div>
  );
}

function Section({ title, events, empty, highlight }: { title: string; events: EventListItem[]; empty?: string; highlight?: boolean }) {
  if (!events.length && !empty) return null;
  return (
    <section>
      {title && <h2 className="mb-3 text-lg font-bold">{title}</h2>}
      {events.length === 0 ? (
        <div className="card">
          <Empty>{empty}</Empty>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {events.map((e) => (
            <Link
              key={e.id}
              to={`/events/${e.id}`}
              className={`card block transition hover:border-indigo-400 ${highlight ? 'border-indigo-400 ring-2 ring-indigo-200 dark:ring-indigo-900' : ''}`}
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold">{e.name}</h3>
                <StatusPill status={e.status} />
              </div>
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
