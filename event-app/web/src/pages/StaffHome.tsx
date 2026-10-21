import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { api, formatDate, type EventListItem } from '../api';
import { EventForm } from '../components/EventForm';
import { Empty, ErrorNote, StatusPill, Tabs } from '../components/ui';
import { useAction, useAuth, useLive } from '../hooks';

type Tab = 'events' | 'new' | 'players' | 'settings';

export function StaffHome() {
  const { viewer } = useAuth();
  const [tab, setTab] = useState<Tab>('events');
  if (viewer.kind !== 'staff') return <Navigate to="/login?mode=staff&next=/staff" replace />;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Staff</h1>
      <Tabs<Tab>
        tabs={[
          ['events', 'Events'],
          ['new', 'New event'],
          ['players', 'Players'],
          ['settings', 'Settings'],
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'events' && <EventsTab />}
      {tab === 'new' && <NewEvent />}
      {tab === 'players' && <PlayersTab />}
      {tab === 'settings' && <SettingsTab />}
    </div>
  );
}

function EventsTab() {
  const [events, setEvents] = useState<EventListItem[]>([]);
  const load = useCallback(() => api<EventListItem[]>('/api/events').then(setEvents), []);
  useEffect(() => {
    load();
  }, [load]);
  useLive('/api/live', load);
  if (!events.length) return <div className="card"><Empty>No events yet — create one in “New event”.</Empty></div>;
  return (
    <div className="card divide-y divide-slate-100 p-0 dark:divide-slate-800">
      {events.map((e) => (
        <Link key={e.id} to={`/staff/events/${e.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50">
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{e.name}</div>
            <div className="text-xs text-slate-500">
              {formatDate(e.date, e.start_time)} · {[e.game, e.format].filter(Boolean).join(' · ')}
            </div>
          </div>
          <span className="text-sm tabular-nums text-slate-500">{e.registered} players</span>
          <StatusPill status={e.status} />
        </Link>
      ))}
    </div>
  );
}

function NewEvent() {
  const navigate = useNavigate();
  const { busy, error, run } = useAction();
  return (
    <div className="card space-y-3">
      <EventForm
        submitLabel="Create event"
        busy={busy}
        onSubmit={(v) =>
          run(async () => {
            const { id } = await api<{ id: number }>('/api/events', v);
            navigate(`/staff/events/${id}`);
          })
        }
      />
      <ErrorNote error={error} />
    </div>
  );
}

interface PlayerRow {
  id: number;
  name: string;
  gameId: string | null;
  hasPin: number;
}

function PlayersTab() {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<PlayerRow[]>([]);
  const { busy, error, run } = useAction();
  const [notice, setNotice] = useState<string | null>(null);
  const load = useCallback(() => api<PlayerRow[]>(`/api/players?q=${encodeURIComponent(q)}`).then(setRows), [q]);
  useEffect(() => {
    load();
  }, [load]);

  const resetPin = (p: PlayerRow) => {
    const pin = prompt(`New 4-digit PIN for ${p.name}:`);
    if (!pin) return;
    run(async () => {
      await api(`/api/players/${p.id}`, { pin }, 'PATCH');
      setNotice(`PIN updated for ${p.name}.`);
      await load();
    });
  };
  const rename = (p: PlayerRow) => {
    const name = prompt('Name:', p.name);
    if (!name || name === p.name) return;
    run(async () => {
      await api(`/api/players/${p.id}`, { name }, 'PATCH');
      await load();
    });
  };

  return (
    <div className="card space-y-3">
      <input className="input" placeholder="Search players…" value={q} onChange={(e) => setQ(e.target.value)} />
      <ErrorNote error={error} />
      {notice && <p className="text-sm text-emerald-600">{notice}</p>}
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {rows.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
            <span className="flex-1 font-medium">
              {p.name}
              {p.gameId && <span className="ml-2 text-xs text-slate-500">{p.gameId}</span>}
              {!p.hasPin && <span className="pill ml-2 bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300">no PIN</span>}
            </span>
            <button className="btn-secondary btn-sm" disabled={busy} onClick={() => rename(p)}>
              Rename
            </button>
            <button className="btn-secondary btn-sm" disabled={busy} onClick={() => resetPin(p)}>
              {p.hasPin ? 'Reset PIN' : 'Set PIN'}
            </button>
          </li>
        ))}
      </ul>
      {!rows.length && <Empty>No players found.</Empty>}
    </div>
  );
}

function SettingsTab() {
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const { busy, error, run } = useAction();
  return (
    <form
      className="card max-w-sm space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          await api('/api/auth/staff/password', { password });
          setPassword('');
          setDone(true);
        });
      }}
    >
      <label className="block">
        <span className="label">Change staff password</span>
        <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      <ErrorNote error={error} />
      {done && <p className="text-sm text-emerald-600">Password changed.</p>}
      <button className="btn-primary" disabled={busy || password.length < 6}>
        Save
      </button>
    </form>
  );
}
