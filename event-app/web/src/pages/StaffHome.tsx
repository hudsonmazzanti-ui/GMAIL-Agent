import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { api, formatDate, type EventListItem } from '../api';
import { QuickEventForm } from '../components/EventForm';
import { SideBar, ToolSection } from '../components/SideBar';
import { Empty, ErrorNote, StatusPill } from '../components/ui';
import { useAction, useAuth, useLive } from '../hooks';
import { ask, askText } from '../components/Dialog';

/** Staff home: tonight's events and one way to make a new one. Store-wide tools live in the side bar. */
export function StaffHome() {
  const { viewer } = useAuth();
  const [toolsOpen, setToolsOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [events, setEvents] = useState<EventListItem[] | null>(null);
  const load = useCallback(() => api<EventListItem[]>('/api/events').then(setEvents), []);
  useEffect(() => {
    if (viewer.kind === 'staff') load();
  }, [load, viewer.kind]);
  useLive('/api/live', load);

  if (viewer.kind !== 'staff') return <Navigate to="/login?mode=staff&next=/staff" replace />;
  if (!events) return null;
  const current = events.filter((e) => e.status !== 'complete');
  const past = events.filter((e) => e.status === 'complete');
  const showForm = creating || current.length === 0;

  return (
    <div className="space-y-5">
      <header className="flex items-center gap-3">
        <h1 className="flex-1 text-2xl font-bold">Events</h1>
        <button className="btn-secondary" onClick={() => setToolsOpen(true)}>
          ☰ Tools
        </button>
      </header>

      {showForm ? (
        <div className="card mx-auto max-w-md space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">New event</h2>
            {current.length > 0 && (
              <button className="text-sm text-slate-500 underline" onClick={() => setCreating(false)}>
                Cancel
              </button>
            )}
          </div>
          <NewEvent />
        </div>
      ) : (
        <button className="btn-primary w-full py-3 text-base" onClick={() => setCreating(true)}>
          + New event
        </button>
      )}

      {current.length > 0 && (
        <ul className="space-y-2">
          {current.map((e) => (
            <li key={e.id}>
              <Link to={`/staff/events/${e.id}`} className="card flex flex-wrap items-center gap-3 transition hover:border-indigo-400">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-lg font-semibold">{e.name}</div>
                  <div className="text-sm text-slate-500">
                    {formatDate(e.date, e.start_time)} · {e.registered} player{e.registered === 1 ? '' : 's'}
                  </div>
                </div>
                <span className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">
                  {e.status === 'swiss' || e.status === 'topcut' ? 'Running →' : 'Check in →'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {past.length > 0 && (
        <details className="card">
          <summary className="cursor-pointer font-semibold">Past events ({past.length})</summary>
          <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
            {past.map((e) => (
              <li key={e.id}>
                <Link to={`/staff/events/${e.id}`} className="flex items-center gap-3 py-2 text-sm hover:underline">
                  <span className="flex-1">{e.name}</span>
                  <span className="text-slate-500">{formatDate(e.date)}</span>
                  <StatusPill status={e.status} />
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}

      <SideBar open={toolsOpen} onClose={() => setToolsOpen(false)}>
        <ToolSection id="players" title="Players" hint="rename, PINs">
          <PlayersTab />
        </ToolSection>
        <ToolSection id="pos" title="PayPal POS">
          <PosSettings />
        </ToolSection>
        <ToolSection id="password" title="Staff password">
          <PasswordSettings />
        </ToolSection>
      </SideBar>
    </div>
  );
}

function NewEvent() {
  const navigate = useNavigate();
  const { busy, error, run } = useAction();
  return (
    <>
      <QuickEventForm
        busy={busy}
        onSubmit={(v) =>
          run(async () => {
            const { id, posWarning } = await api<{ id: number; posWarning: string | null }>('/api/events', v);
            navigate(`/staff/events/${id}`, { state: { posWarning } });
          })
        }
      />
      <ErrorNote error={error} />
    </>
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

  const resetPin = async (p: PlayerRow) => {
    const pin = await askText(`New 4-digit PIN for ${p.name}:`, '', { inputMode: 'numeric' });
    if (!pin) return;
    run(async () => {
      await api(`/api/players/${p.id}`, { pin }, 'PATCH');
      setNotice(`PIN updated for ${p.name}.`);
      await load();
    });
  };
  const removePin = async (p: PlayerRow) => {
    if (!(await ask(`Remove ${p.name}'s PIN? They'll log in with just their name.`, { confirmLabel: 'Remove PIN' }))) return;
    run(async () => {
      await api(`/api/players/${p.id}`, { pin: null }, 'PATCH');
      setNotice(`PIN removed for ${p.name}.`);
      await load();
    });
  };
  const rename = async (p: PlayerRow) => {
    const name = await askText('Name:', p.name);
    if (!name || name === p.name) return;
    run(async () => {
      await api(`/api/players/${p.id}`, { name }, 'PATCH');
      await load();
    });
  };

  return (
    <div className="space-y-3">
      <input className="input" placeholder="Search players…" value={q} onChange={(e) => setQ(e.target.value)} />
      <ErrorNote error={error} />
      {notice && <p className="text-sm text-emerald-600">{notice}</p>}
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {rows.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
            <span className="flex-1 font-medium">
              {p.name}
              {p.gameId && <span className="ml-2 text-xs text-slate-500">{p.gameId}</span>}
              {!p.hasPin && <span className="pill ml-2 bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300">no PIN</span>}
            </span>
            <button className="btn-secondary btn-sm" disabled={busy} onClick={() => rename(p)}>
              Rename
            </button>
            <button className="btn-secondary btn-sm" disabled={busy} onClick={() => resetPin(p)}>
              {p.hasPin ? 'Reset PIN' : 'Set PIN'}
            </button>
            {!!p.hasPin && (
              <button className="btn-secondary btn-sm" disabled={busy} onClick={() => removePin(p)}>
                Remove PIN
              </button>
            )}
          </li>
        ))}
      </ul>
      {!rows.length && <Empty>No players found.</Empty>}
    </div>
  );
}

interface PosStatus {
  connected: boolean;
  clientId: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  apiKeyUrl: string;
}

function PosSettings() {
  const [status, setStatus] = useState<PosStatus | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [clientId, setClientId] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  const load = useCallback(() => api<PosStatus>('/api/pos/status').then(setStatus), []);
  useEffect(() => {
    load();
  }, [load]);
  if (!status) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="sr-only">PayPal POS</h3>
        <span
          className={`pill ${status.connected ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300' : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}
        >
          {status.connected ? 'Connected' : 'Not connected'}
        </span>
      </div>
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Entry fees are rung up on your PayPal POS like any other item. Event Hub reads the sales back and marks players paid. No
        payment happens in this app.
      </p>
      {status.connected ? (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-slate-500">Client ID</dt>
            <dd className="truncate font-mono">{status.clientId}</dd>
            <dt className="text-slate-500">Last sync</dt>
            <dd>{status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleTimeString() : 'never'}</dd>
          </dl>
          <ErrorNote error={status.lastError} />
          {note && <p className="text-sm text-emerald-600">{note}</p>}
          <ErrorNote error={error} />
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-secondary btn-sm"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  setNote(null);
                  const r = await api<{ changedEvents: number[] }>('/api/pos/sync', {});
                  setNote(r.changedEvents.length ? 'New sales imported.' : 'Up to date — no new entry sales.');
                }).finally(load)
              }
            >
              Sync now
            </button>
            <button
              className="btn-secondary btn-sm"
              disabled={busy}
              onClick={async () =>
                (await ask('Disconnect PayPal POS? Recorded payments are kept.', { confirmLabel: 'Disconnect' })) &&
                run(() => api('/api/pos/disconnect', {})).then(load)
              }
            >
              Disconnect
            </button>
          </div>
        </>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              setStatus({ ...(await api<PosStatus>('/api/pos/connect', { apiKey, clientId })), apiKeyUrl: status.apiKeyUrl });
              setApiKey('');
            });
          }}
        >
          <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-300">
            <li>
              <a className="text-indigo-600 underline dark:text-indigo-400" href={status.apiKeyUrl} target="_blank" rel="noreferrer">
                Create an API key
              </a>{' '}
              while logged in to your PayPal POS account as the owner. The needed permissions are pre-filled.
            </li>
            <li>Paste the API key (and the client ID shown with it) below.</li>
          </ol>
          <label className="block">
            <span className="label">API key</span>
            <textarea className="input min-h-20 font-mono text-xs" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
          </label>
          <label className="block">
            <span className="label">Client ID</span>
            <input className="input font-mono" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="Usually read from the key automatically" />
          </label>
          <ErrorNote error={error} />
          <button className="btn-primary" disabled={busy || !apiKey.trim()}>
            Test &amp; connect
          </button>
        </form>
      )}
    </div>
  );
}

function PasswordSettings() {
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const { busy, error, run } = useAction();
  return (
    <form
      className="space-y-3"
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
