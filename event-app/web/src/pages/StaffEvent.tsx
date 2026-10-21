import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { api, formatDate, type EventState, type MatchView, type RoundView } from '../api';
import { Bracket } from '../components/Bracket';
import { EventForm, fromRow } from '../components/EventForm';
import { ResultForm } from '../components/ResultForm';
import { RoundTimer } from '../components/RoundTimer';
import { PairingsTable, StandingsTable } from '../components/Tables';
import { Empty, ErrorNote, Stat, StatusPill, Tabs } from '../components/ui';
import { useAction, useAuth, useLiveEvent } from '../hooks';

type Tab = 'checkin' | 'round' | 'standings' | 'bracket' | 'settings';

export function StaffEvent() {
  const { viewer } = useAuth();
  const eventId = Number(useParams().id);
  const { state, error, clockSkew } = useLiveEvent(eventId);
  const [tab, setTab] = useState<Tab | null>(null);
  const action = useAction();

  if (viewer.kind !== 'staff') return <Navigate to={`/login?mode=staff&next=/staff/events/${eventId}`} replace />;
  if (error && !state) return <ErrorNote error={error} />;
  if (!state) return null;

  const ev = state.event;
  const running = ev.status === 'swiss' || ev.status === 'topcut';
  const current = state.rounds.at(-1);
  const activeTab: Tab = tab ?? (running ? 'round' : ev.status === 'complete' ? 'standings' : 'checkin');
  const post = (path: string, body: unknown = {}) => action.run(() => api(`/api/events/${ev.id}/${path}`, body));

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold">{ev.name}</h1>
            <StatusPill status={ev.status} />
          </div>
          <p className="text-sm text-slate-500">
            {[formatDate(ev.date, ev.start_time), ev.game, ev.format, `Bo${ev.best_of}`, `${ev.round_minutes} min rounds`]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <div className="no-print flex flex-wrap gap-2">
          <Link className="btn-secondary btn-sm" to={`/events/${ev.id}`}>
            Player view
          </Link>
          <a className="btn-secondary btn-sm" href={`/display/${ev.id}`} target="_blank" rel="noreferrer">
            Projector ↗
          </a>
        </div>
      </header>

      <NextStep state={state} post={post} busy={action.busy} />
      <ErrorNote error={action.error} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Registered" value={`${state.counts.registered}${ev.capacity ? `/${ev.capacity}` : ''}`} />
        <Stat label="Checked in" value={state.counts.checkedIn} />
        <Stat label="Swiss rounds" value={ev.swiss_rounds ?? `auto (${state.recommendedRounds})`} />
        <Stat label="Top cut" value={ev.top_cut_size ? `Top ${ev.top_cut_size}` : 'None'} />
      </div>

      <Tabs<Tab>
        tabs={[
          ['checkin', 'Players & check-in'],
          ['round', current ? current.label : 'Rounds'],
          ['standings', 'Standings'],
          ...(state.rounds.some((r) => r.phase === 'topcut') ? ([['bracket', 'Bracket']] as [Tab, string][]) : []),
          ['settings', 'Settings'],
        ]}
        value={activeTab}
        onChange={setTab}
      />

      {activeTab === 'checkin' && <CheckInTab state={state} />}
      {activeTab === 'round' && <RoundTab state={state} clockSkew={clockSkew} />}
      {activeTab === 'standings' && (
        <div className="card space-y-3">
          <div className="flex justify-end">
            <a className="btn-secondary btn-sm" href={`/api/events/${ev.id}/standings.csv`}>
              Download CSV
            </a>
          </div>
          <StandingsTable rows={state.standings} />
        </div>
      )}
      {activeTab === 'bracket' && (
        <div className="card">
          <Bracket rounds={state.rounds} champion={state.champion} />
        </div>
      )}
      {activeTab === 'settings' && <SettingsTab state={state} />}
    </div>
  );
}

/** The single big "what to do next" control for the event. */
function NextStep({ state, post, busy }: { state: EventState; post: (path: string, body?: unknown) => void; busy: boolean }) {
  const ev = state.event;
  const round = state.rounds.at(-1);
  const open = round ? round.matches.filter((m) => m.resultStatus !== 'confirmed').length : 0;

  let text: string;
  let buttons: [string, () => void, boolean?][] = [];
  switch (ev.status) {
    case 'draft':
      text = 'This event is a draft and only staff can see it.';
      buttons = [['Open registration', () => post('status', { status: 'registration' })]];
      break;
    case 'registration':
      text = 'Players can register from their phones. Check players in as they arrive.';
      buttons = [
        ['Close registration', () => post('status', { status: 'checkin' }), true],
        [`Start event (${state.counts.checkedIn} checked in)`, () => confirmStart(state) && post('advance')],
      ];
      break;
    case 'checkin':
      text = 'Registration is closed. Only checked-in players are paired.';
      buttons = [
        ['Reopen registration', () => post('status', { status: 'registration' }), true],
        [`Start event (${state.counts.checkedIn} checked in)`, () => confirmStart(state) && post('advance')],
      ];
      break;
    case 'swiss':
    case 'topcut': {
      const lastSwiss = ev.status === 'swiss' && round!.number >= (ev.swiss_rounds ?? 0);
      const label =
        ev.status === 'topcut'
          ? round!.matches.length === 1
            ? 'Finish event'
            : 'Pair next bracket round'
          : lastSwiss
            ? ev.top_cut_size
              ? `Start top ${ev.top_cut_size}`
              : 'Finish event'
            : `Pair round ${round!.number + 1}`;
      text = open ? `${round!.label}: waiting on ${open} result${open === 1 ? '' : 's'}.` : `${round!.label}: all results are in.`;
      buttons = [[label, () => post('advance')]];
      break;
    }
    default:
      text = state.champion ? `Event complete. Champion: ${state.champion.name}.` : 'Event complete.';
  }
  const disabled = (ev.status === 'swiss' || ev.status === 'topcut') && open > 0;

  return (
    <div className="card flex flex-wrap items-center gap-3 border-indigo-200 bg-indigo-50/60 dark:border-indigo-900 dark:bg-indigo-950/30">
      <p className="flex-1 text-sm font-medium">{text}</p>
      {buttons.map(([label, fn, secondary]) => (
        <button key={label} className={secondary ? 'btn-secondary' : 'btn-primary'} disabled={busy || (!secondary && disabled)} onClick={fn}>
          {label}
        </button>
      ))}
    </div>
  );
}

function confirmStart(state: EventState) {
  const notHere = state.registrations.filter((r) => r.status === 'registered').length;
  const rounds = state.event.swiss_rounds ?? state.recommendedRounds;
  return confirm(
    `Start with ${state.counts.checkedIn} players and ${rounds} Swiss rounds?` +
      (notHere ? `\n${notHere} registered player(s) are not checked in and won't be paired.` : ''),
  );
}

// ---------- Players & check-in ----------

function CheckInTab({ state }: { state: EventState }) {
  const ev = state.event;
  const [q, setQ] = useState('');
  const { busy, error, run } = useAction();
  const call = (path: string, body: unknown) => run(() => api(`/api/events/${ev.id}/${path}`, body));
  const canCheckIn = ['draft', 'registration', 'checkin', 'swiss'].includes(ev.status);

  const filtered = state.registrations.filter((r) => r.name.toLowerCase().includes(q.toLowerCase()));
  const order = { registered: 0, waitlist: 2, checked_in: 1, dropped: 3 } as const;
  filtered.sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="card space-y-3 lg:col-span-2">
        <input className="input" placeholder="Search registered players…" value={q} onChange={(e) => setQ(e.target.value)} />
        <ErrorNote error={error} />
        {filtered.length === 0 && <Empty>No players yet.</Empty>}
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {filtered.map((r) => (
            <li key={r.playerId} className="flex flex-wrap items-center gap-2 py-2">
              <span className="min-w-0 flex-1 truncate font-medium">
                {r.name}
                {r.gameId && <span className="ml-2 text-xs font-normal text-slate-500">{r.gameId}</span>}
              </span>
              {r.status === 'waitlist' && <span className="pill bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300">waitlist</span>}
              {r.status === 'dropped' && <span className="pill bg-slate-200 text-slate-600 dark:bg-slate-800">dropped after R{r.droppedAfterRound}</span>}
              {canCheckIn && (r.status === 'registered' || r.status === 'waitlist') && (
                <button className="btn-primary btn-sm" disabled={busy} onClick={() => call('checkin', { playerId: r.playerId, checkedIn: true })}>
                  Check in
                </button>
              )}
              {r.status === 'checked_in' && !['swiss', 'topcut', 'complete'].includes(ev.status) && (
                <button className="btn-secondary btn-sm" disabled={busy} onClick={() => call('checkin', { playerId: r.playerId, checkedIn: false })}>
                  ✓ Here — undo
                </button>
              )}
              {r.status === 'checked_in' && (ev.status === 'swiss' || ev.status === 'topcut') && (
                <button
                  className="btn-secondary btn-sm"
                  disabled={busy}
                  onClick={() => confirm(`Drop ${r.name}?`) && call('drop', { playerId: r.playerId })}
                >
                  Drop
                </button>
              )}
              {['draft', 'registration', 'checkin'].includes(ev.status) && (
                <button
                  className="btn-secondary btn-sm"
                  disabled={busy}
                  onClick={() => confirm(`Remove ${r.name} from the event?`) && call('unregister', { playerId: r.playerId })}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
      {ev.status !== 'complete' && ev.status !== 'topcut' && <AddPlayer state={state} />}
    </div>
  );
}

function AddPlayer({ state }: { state: EventState }) {
  const ev = state.event;
  const [q, setQ] = useState('');
  const [results, setResults] = useState<{ id: number; name: string }[]>([]);
  const { busy, error, run } = useAction();
  const registered = useMemo(() => new Set(state.registrations.map((r) => r.playerId)), [state.registrations]);

  useEffect(() => {
    if (!q.trim()) return setResults([]);
    const t = setTimeout(() => api(`/api/players?q=${encodeURIComponent(q)}`).then(setResults), 150);
    return () => clearTimeout(t);
  }, [q]);

  const add = (playerId: number) =>
    run(async () => {
      await api(`/api/events/${ev.id}/register`, { playerId });
      // Walk-ins at the desk are present, so check them in right away.
      if (['registration', 'checkin', 'draft'].includes(ev.status)) {
        await api(`/api/events/${ev.id}/checkin`, { playerId, checkedIn: true });
      }
      setQ('');
    });
  const create = () =>
    run(async () => {
      const p = await api<{ id: number }>('/api/players', { name: q.trim() });
      await add(p.id);
    });

  const exact = results.some((r) => r.name.toLowerCase() === q.trim().toLowerCase());
  return (
    <div className="card h-fit space-y-3">
      <div>
        <h3 className="font-semibold">Add walk-in</h3>
        <p className="text-xs text-slate-500">
          {ev.status === 'swiss' ? 'Late entries join from the next round with 0 points.' : 'Added players are checked in automatically.'}
        </p>
      </div>
      <input className="input" placeholder="Player name" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="space-y-1">
        {results.map((r) => (
          <li key={r.id} className="flex items-center justify-between text-sm">
            <span>{r.name}</span>
            {registered.has(r.id) ? (
              <span className="text-xs text-slate-400">in event</span>
            ) : (
              <button className="btn-primary btn-sm" disabled={busy} onClick={() => add(r.id)}>
                Add
              </button>
            )}
          </li>
        ))}
      </ul>
      {q.trim().length >= 2 && !exact && (
        <button className="btn-secondary w-full" disabled={busy} onClick={create}>
          Create “{q.trim()}” and add
        </button>
      )}
      <ErrorNote error={error} />
    </div>
  );
}

// ---------- Rounds ----------

function RoundTab({ state, clockSkew }: { state: EventState; clockSkew: number }) {
  const [idx, setIdx] = useState<number | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [onlyOpen, setOnlyOpen] = useState(false);
  const { busy, error, run } = useAction();
  const roundCount = state.rounds.length;
  useEffect(() => setIdx(null), [roundCount]);

  if (!roundCount) return <div className="card"><Empty>Rounds appear once you start the event.</Empty></div>;
  const round = state.rounds[idx ?? roundCount - 1];
  const isCurrent = round.id === state.rounds[roundCount - 1].id;
  const ev = state.event;
  const editable = (isCurrent && round.status !== 'complete') || (round.phase === 'swiss' && ev.status === 'swiss');
  const timer = (action: string, minutes?: number) => run(() => api(`/api/rounds/${round.id}/timer`, { action, minutes }));
  const matches = onlyOpen ? round.matches.filter((m) => m.resultStatus !== 'confirmed') : round.matches;
  const canRepair =
    isCurrent && round.phase === 'swiss' && round.status === 'pending' && round.timer.endsAt === null &&
    round.matches.every((m) => !m.p2 || m.resultStatus === 'pending');

  const counts = {
    open: round.matches.filter((m) => m.resultStatus === 'pending').length,
    reported: round.matches.filter((m) => m.resultStatus === 'reported').length,
    disputed: round.matches.filter((m) => m.resultStatus === 'disputed').length,
  };

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center gap-3">
        <select className="input w-auto" value={idx ?? roundCount - 1} onChange={(e) => setIdx(Number(e.target.value))}>
          {state.rounds.map((r, i) => (
            <option key={r.id} value={i}>
              {r.label}
            </option>
          ))}
        </select>
        <RoundTimer round={round} clockSkew={clockSkew} />
        {isCurrent && round.status !== 'complete' && (
          <div className="no-print flex flex-wrap gap-2">
            {round.timer.endsAt === null ? (
              <button className="btn-primary btn-sm" disabled={busy} onClick={() => timer('start')}>
                ▶ {round.status === 'pending' ? 'Start round' : 'Resume'}
              </button>
            ) : (
              <button className="btn-secondary btn-sm" disabled={busy} onClick={() => timer('pause')}>
                ❚❚ Pause
              </button>
            )}
            <button className="btn-secondary btn-sm" disabled={busy} onClick={() => timer('add', 1)}>
              +1 min
            </button>
            <button className="btn-secondary btn-sm" disabled={busy} onClick={() => timer('add', 5)}>
              +5
            </button>
            <button className="btn-secondary btn-sm" disabled={busy} onClick={() => timer('add', -1)}>
              −1
            </button>
          </div>
        )}
        <div className="no-print ml-auto flex flex-wrap gap-2">
          {canRepair && (
            <button
              className="btn-secondary btn-sm"
              disabled={busy}
              onClick={() => confirm('Throw away these pairings and pair again?') && run(() => api(`/api/rounds/${round.id}/repair`, {}))}
            >
              Re-pair
            </button>
          )}
          <a className="btn-secondary btn-sm" href={`/print/${ev.id}?round=${round.id}`} target="_blank" rel="noreferrer">
            Print slips
          </a>
        </div>
      </div>
      <ErrorNote error={error} />

      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span>
            <b>{counts.open}</b> waiting
          </span>
          <span className="text-amber-600">
            <b>{counts.reported}</b> unconfirmed
          </span>
          {counts.disputed > 0 && (
            <span className="text-rose-600">
              <b>{counts.disputed}</b> disputed
            </span>
          )}
          <label className="ml-auto flex items-center gap-2">
            <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> Outstanding only
          </label>
        </div>
        <PairingsTable
          matches={matches}
          action={(m) =>
            m.p2 && editable ? (
              <button className="btn-secondary btn-sm" onClick={() => setEditing(editing === m.id ? null : m.id)}>
                {m.resultStatus === 'confirmed' ? 'Edit' : m.resultStatus === 'pending' ? 'Enter' : 'Resolve'}
              </button>
            ) : null
          }
        />
        {editing !== null && (
          <ResultEditor
            round={round}
            match={round.matches.find((m) => m.id === editing)}
            bestOf={ev.best_of}
            onDone={() => setEditing(null)}
          />
        )}
      </div>
    </div>
  );
}

function ResultEditor({ round, match, bestOf, onDone }: { round: RoundView; match?: MatchView; bestOf: number; onDone: () => void }) {
  const { busy, error, run } = useAction();
  if (!match || !match.p2) return null;
  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-4 dark:border-indigo-900 dark:bg-indigo-950/30">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="font-semibold">Table {match.table} result</h4>
        <button className="text-sm text-slate-500" onClick={onDone}>
          Close
        </button>
      </div>
      {match.resultStatus !== 'pending' && (
        <p className="mb-2 text-xs text-slate-500">
          Currently {match.p1Games}-{match.p2Games}
          {match.draws ? `-${match.draws}` : ''} ({match.resultStatus}). Saving here confirms it.
        </p>
      )}
      <ResultForm
        bestOf={bestOf}
        allowDraw={round.phase === 'swiss'}
        p1Name={match.p1.name}
        p2Name={match.p2.name}
        initial={{ p1Games: match.p1Games, p2Games: match.p2Games, draws: match.draws }}
        busy={busy}
        onSubmit={(r) =>
          run(async () => {
            await api(`/api/matches/${match.id}/result`, r);
            onDone();
          })
        }
      />
      <ErrorNote error={error} />
    </div>
  );
}

// ---------- Settings ----------

function SettingsTab({ state }: { state: EventState }) {
  const ev = state.event;
  const started = !['draft', 'registration', 'checkin'].includes(ev.status);
  const navigate = useNavigate();
  const { busy, error, run } = useAction();
  const [saved, setSaved] = useState(false);
  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <EventForm
          key={ev.id}
          initial={fromRow(ev)}
          started={started}
          recommendedRounds={state.recommendedRounds}
          submitLabel="Save changes"
          busy={busy}
          onSubmit={(v) =>
            run(async () => {
              setSaved(false);
              await api(`/api/events/${ev.id}`, v, 'PATCH');
              setSaved(true);
            })
          }
        />
        <ErrorNote error={error} />
        {saved && <p className="text-sm text-emerald-600">Saved.</p>}
      </div>
      <div className="card flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">Delete this event and all its results.</p>
        <button
          className="btn-danger btn-sm"
          disabled={busy}
          onClick={() =>
            confirm(`Delete “${ev.name}” permanently?`) &&
            run(async () => {
              await api(`/api/events/${ev.id}`, undefined, 'DELETE');
              navigate('/staff');
            })
          }
        >
          Delete event
        </button>
      </div>
    </div>
  );
}
