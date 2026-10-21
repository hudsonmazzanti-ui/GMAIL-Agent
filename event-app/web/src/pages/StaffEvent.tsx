import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, formatDate, money, type EventState, type MatchView, type RoundView } from '../api';
import { Bracket } from '../components/Bracket';
import { ask } from '../components/Dialog';
import { EventForm, fromRow } from '../components/EventForm';
import { JoinQr } from '../components/JoinQr';
import { DownloadLink, NewTabLink } from '../components/NewTabLink';
import { PaymentActions, PaymentBadge } from '../components/Payments';
import { ResultForm } from '../components/ResultForm';
import { RoundTimer } from '../components/RoundTimer';
import { SideBar, ToolSection } from '../components/SideBar';
import { PairingsTable, StandingsTable } from '../components/Tables';
import { Empty, ErrorNote, StatusPill } from '../components/ui';
import { DEMO } from '../env';
import { useAction, useAuth, useLiveEvent } from '../hooks';

type Step = 'checkin' | 'play' | 'results';
type ToolId = 'timer' | 'round' | 'players' | 'payments' | 'views' | 'settings';

const stepOf = (status: EventState['event']['status']): Step =>
  status === 'swiss' || status === 'topcut' ? 'play' : status === 'complete' ? 'results' : 'checkin';

/**
 * Running an event, one step at a time: check players in, play the rounds, see the results.
 * Each step shows only what's needed now; everything else is in the Tools side bar.
 */
export function StaffEvent() {
  const { viewer } = useAuth();
  const eventId = Number(useParams().id);
  const location = useLocation();
  const { state, error, clockSkew } = useLiveEvent(eventId);
  const [tools, setTools] = useState<{ open: boolean; focus: ToolId | null }>({ open: false, focus: null });
  const openTools = (focus: ToolId | null = null) => setTools({ open: true, focus });

  if (viewer.kind !== 'staff') return <Navigate to={`/login?mode=staff&next=/staff/events/${eventId}`} replace />;
  if (error && !state) return <ErrorNote error={error} />;
  if (!state) return null;

  const ev = state.event;
  const step = stepOf(ev.status);
  const posWarning = (location.state as { posWarning?: string } | null)?.posWarning ?? null;

  return (
    <div className="space-y-4 pb-24">
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold">{ev.name}</h1>
          <p className="text-sm text-slate-500">
            {formatDate(ev.date, ev.start_time)}
            {ev.entry_fee_cents > 0 && ` · ${money(ev.entry_fee_cents, ev.currency)} entry`}
          </p>
        </div>
        <button className="btn-secondary" onClick={() => openTools()}>
          ☰ Tools
        </button>
      </header>

      <StepBar step={step} />
      <AlertStrip state={state} posWarning={posWarning} openTools={openTools} />

      {step === 'checkin' && <CheckInStep state={state} />}
      {step === 'play' && <PlayStep state={state} clockSkew={clockSkew} />}
      {step === 'results' && <ResultsStep state={state} />}

      <SideBar open={tools.open} onClose={() => setTools({ open: false, focus: null })}>
        <EventTools state={state} focus={tools.focus} clockSkew={clockSkew} />
      </SideBar>
    </div>
  );
}

function StepBar({ step }: { step: Step }) {
  const steps: [Step, string][] = [
    ['checkin', 'Check in'],
    ['play', 'Play'],
    ['results', 'Results'],
  ];
  const at = steps.findIndex(([s]) => s === step);
  return (
    <ol className="flex items-center gap-2 text-sm" aria-label="Event progress">
      {steps.map(([s, label], i) => (
        <li key={s} className="flex flex-1 items-center gap-2">
          <span
            className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold ${
              i < at
                ? 'bg-emerald-600 text-white'
                : i === at
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
            }`}
            aria-current={i === at ? 'step' : undefined}
          >
            {i < at ? '✓' : i + 1}
          </span>
          <span className={i === at ? 'font-semibold' : 'text-slate-500'}>{label}</span>
          {i < steps.length - 1 && <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />}
        </li>
      ))}
    </ol>
  );
}

/** Only shown when something needs a person: flagged results, POS sales with no player, POS errors. */
function AlertStrip({ state, posWarning, openTools }: { state: EventState; posWarning: string | null; openTools: (f: ToolId) => void }) {
  const round = state.rounds.at(-1);
  const flagged = round && round.status !== 'complete' ? round.matches.filter((m) => m.resultStatus === 'disputed').length : 0;
  const unassigned = (state.payments.unassigned ?? []).filter((p) => p.status === 'paid').length;
  const alerts: { text: string; action?: [string, () => void] }[] = [];
  if (flagged) alerts.push({ text: `${flagged} result${flagged === 1 ? ' was' : 's were'} flagged by a player. Tap Fix next to it below.` });
  if (unassigned) {
    alerts.push({
      text: `${unassigned} POS sale${unassigned === 1 ? '' : 's'} came in without a player.`,
      action: ['Match to a player', () => openTools('payments')],
    });
  }
  if (posWarning) alerts.push({ text: posWarning, action: ['Payments', () => openTools('payments')] });
  if (!alerts.length) return null;
  return (
    <div className="space-y-2" role="status">
      {alerts.map((a) => (
        <div
          key={a.text}
          className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100"
        >
          <span className="flex-1">⚠ {a.text}</span>
          {a.action && (
            <button className="btn-secondary btn-sm" onClick={a.action[1]}>
              {a.action[0]}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/** The one big button at the bottom of each step. */
function MainButton({ children, onClick, disabled, hint }: { children: ReactNode; onClick: () => void; disabled?: boolean; hint?: string }) {
  return (
    <div className="no-print fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
        {hint && <span className="flex-1 text-sm text-slate-600 dark:text-slate-300">{hint}</span>}
        <button className={`btn-primary px-6 py-3 text-base ${hint ? '' : 'w-full'}`} disabled={disabled} onClick={onClick}>
          {children}
        </button>
      </div>
    </div>
  );
}

// ---------- Step 1: check in ----------

function CheckInStep({ state }: { state: EventState }) {
  const ev = state.event;
  const { busy, error, setError, run } = useAction();
  const here = state.counts.checkedIn;
  const waiting = state.registrations.filter((r) => r.status === 'registered' || r.status === 'waitlist');
  const checkedIn = state.registrations.filter((r) => r.status === 'checked_in');

  const start = async () => {
    const msg = waiting.length
      ? `${waiting.length} player${waiting.length === 1 ? " hasn't" : "s haven't"} checked in and won't play. Start with ${here}?`
      : `Start with ${here} players?`;
    if (await ask(msg, { confirmLabel: 'Start event' })) run(() => api(`/api/events/${ev.id}/advance`, {}));
  };

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="card space-y-4">
          <AddPlayer state={state} />
          <ErrorNote error={error} />
          {waiting.length === 0 && checkedIn.length === 0 && (
            <Empty>No players yet. Players scan the QR code to join, or type a name above.</Empty>
          )}
          {waiting.length > 0 && (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {waiting.map((r) => (
                <li key={r.playerId} className="flex flex-wrap items-center gap-3 py-2.5">
                  <span className="min-w-0 flex-1 truncate text-base font-medium">{r.name}</span>
                  <CheckInButton state={state} reg={r} onError={setError} />
                </li>
              ))}
            </ul>
          )}
          {checkedIn.length > 0 && (
            <div>
              <div className="label mb-1">Here ({checkedIn.length})</div>
              <ul className="flex flex-wrap gap-2">
                {checkedIn.map((r) => (
                  <li key={r.playerId}>
                    <button
                      className="pill bg-emerald-100 py-1 text-sm text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300"
                      title="Undo check-in"
                      disabled={busy}
                      onClick={async () =>
                        (await ask(`Undo ${r.name}'s check-in?`, { confirmLabel: 'Undo' })) &&
                        run(() => api(`/api/events/${ev.id}/checkin`, { playerId: r.playerId, checkedIn: false }))
                      }
                    >
                      ✓ {r.name}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        {ev.join_code && (
          <div className="card h-fit space-y-2">
            <h2 className="text-center font-semibold">Players scan to join</h2>
            <JoinQr code={ev.join_code} eventName={ev.name} size={200} />
            {DEMO && <p className="text-center text-xs text-slate-500">Demo: in the store this opens on players' phones.</p>}
          </div>
        )}
      </div>
      <MainButton onClick={start} disabled={busy || here < 2} hint={here < 2 ? 'Check in at least 2 players to start.' : undefined}>
        Start event · {here} player{here === 1 ? '' : 's'}
      </MainButton>
    </>
  );
}

/** One button per player: check in, or take the entry fee (which checks them in). */
function CheckInButton({ state, reg, onError }: { state: EventState; reg: EventState['registrations'][number]; onError: (m: string) => void }) {
  const ev = state.event;
  const [busy, setBusy] = useState(false);
  const call = async (path: string, body: unknown) => {
    setBusy(true);
    try {
      await api(`/api/events/${ev.id}/${path}`, body);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const fee = money(ev.entry_fee_cents, ev.currency);
  const paid = reg.payment?.status === 'paid';

  if (ev.entry_fee_cents === 0 || paid) {
    return (
      <button className="btn-primary" disabled={busy} onClick={() => call('checkin', { playerId: reg.playerId, checkedIn: true })}>
        Check in
      </button>
    );
  }
  if (reg.waitingForPosSince) {
    return (
      <span className="flex items-center gap-2 text-sm">
        <span className="animate-pulse font-medium text-indigo-700 dark:text-indigo-300">Ring up {fee} on the POS…</span>
        <button className="text-xs text-slate-500 underline" disabled={busy} onClick={() => call('payments/cancel-collect', { playerId: reg.playerId })}>
          Cancel
        </button>
      </span>
    );
  }
  if (state.payments.onPos) {
    return (
      <button className="btn-primary" disabled={busy} onClick={() => call('payments/collect', { playerId: reg.playerId })}>
        Collect {fee}
      </button>
    );
  }
  return (
    <button className="btn-primary" disabled={busy} onClick={() => call('payments/manual', { playerId: reg.playerId, method: 'cash' })}>
      Paid {fee} · Check in
    </button>
  );
}

/** Type a name and press Enter: existing players are added, new names become new players. */
function AddPlayer({ state }: { state: EventState }) {
  const ev = state.event;
  const [q, setQ] = useState('');
  const [results, setResults] = useState<{ id: number; name: string }[]>([]);
  const { busy, error, run } = useAction();
  const inEvent = useMemo(() => new Set(state.registrations.map((r) => r.playerId)), [state.registrations]);

  useEffect(() => {
    if (!q.trim()) return setResults([]);
    const t = setTimeout(() => api(`/api/players?q=${encodeURIComponent(q.trim())}`).then(setResults), 150);
    return () => clearTimeout(t);
  }, [q]);

  const add = (playerId: number) =>
    run(async () => {
      await api(`/api/events/${ev.id}/register`, { playerId });
      // Someone at the desk is here: check them in, unless they still need to pay.
      if (!ev.entry_fee_cents && ['draft', 'registration', 'checkin'].includes(ev.status)) {
        await api(`/api/events/${ev.id}/checkin`, { playerId, checkedIn: true });
      }
      setQ('');
    });
  const name = q.trim();
  const exact = results.find((r) => r.name.toLowerCase() === name.toLowerCase());
  const submit = () =>
    exact ? !inEvent.has(exact.id) && add(exact.id) : name.length >= 2 && run(async () => add((await api<{ id: number }>('/api/players', { name })).id));
  const suggestions = results.filter((r) => !inEvent.has(r.id)).slice(0, 5);

  return (
    <div className="space-y-2">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          id="add-player"
          className="input text-base"
          placeholder="Add a player by name"
          autoComplete="off"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className="btn-secondary" disabled={busy || name.length < 2}>
          Add
        </button>
      </form>
      {suggestions.length > 0 && !exact && (
        <div className="flex flex-wrap gap-2">
          {suggestions.map((r) => (
            <button key={r.id} className="btn-secondary btn-sm" disabled={busy} onClick={() => add(r.id)}>
              + {r.name}
            </button>
          ))}
        </div>
      )}
      <ErrorNote error={error} />
    </div>
  );
}

// ---------- Step 2: play ----------

function nextLabel(state: EventState): string {
  const ev = state.event;
  const round = state.rounds.at(-1)!;
  if (ev.status === 'topcut') return round.matches.length === 1 ? 'Finish event' : 'Next playoff round';
  if (round.number < (ev.swiss_rounds ?? 0)) return `Start round ${round.number + 1}`;
  return ev.top_cut_size ? (ev.top_cut_size === 2 ? 'Start the final' : `Start top ${ev.top_cut_size}`) : 'Finish event';
}

function PlayStep({ state, clockSkew }: { state: EventState; clockSkew: number }) {
  const round = state.rounds.at(-1)!;
  const [editing, setEditing] = useState<number | null>(null);
  const { busy, error, run } = useAction();
  const real = round.matches.filter((m) => m.p2);
  const done = real.filter((m) => m.resultStatus === 'confirmed').length;
  const open = real.length - done;
  const ofRounds = state.event.status === 'swiss' && state.event.swiss_rounds ? ` of ${state.event.swiss_rounds}` : '';

  return (
    <>
      <div className="card flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="label">
            {round.label}
            {ofRounds}
          </div>
          <div className="text-lg font-semibold">
            {done} of {real.length} results in
          </div>
        </div>
        <div className="[&>div]:text-5xl sm:[&>div]:text-6xl">
          <RoundTimer round={round} clockSkew={clockSkew} />
        </div>
      </div>

      <div className="card">
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {round.matches.map((m) => (
            <li key={m.id} className="py-2.5">
              <div className="flex flex-wrap items-center gap-3">
                <span className="w-10 shrink-0 font-mono text-slate-500">{m.p2 ? m.table : '–'}</span>
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{m.p1.name}</span>
                  <span className="text-slate-400"> vs </span>
                  <span className="font-medium">{m.p2 ? m.p2.name : 'Bye'}</span>
                </span>
                <MatchStatus match={m} editing={editing === m.id} onEdit={() => setEditing(editing === m.id ? null : m.id)} />
              </div>
              {editing === m.id && m.p2 && (
                <div className="mt-3">
                  <ResultEditor round={round} match={m} bestOf={state.event.best_of} onDone={() => setEditing(null)} />
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
      <ErrorNote error={error} />
      <MainButton
        onClick={() => run(() => api(`/api/events/${state.event.id}/advance`, {}))}
        disabled={busy || open > 0}
        hint={open > 0 ? `Waiting on ${open} result${open === 1 ? '' : 's'}. Players report on their phones.` : undefined}
      >
        {nextLabel(state)}
      </MainButton>
    </>
  );
}

function MatchStatus({ match: m, editing, onEdit }: { match: MatchView; editing: boolean; onEdit: () => void }) {
  if (!m.p2) return <span className="text-sm text-slate-400">Bye</span>;
  if (m.resultStatus === 'disputed') {
    return (
      <button className="btn-danger btn-sm" onClick={onEdit}>
        Fix
      </button>
    );
  }
  if (m.resultStatus === 'pending') {
    return (
      <button className="btn-secondary btn-sm" onClick={onEdit}>
        {editing ? 'Close' : 'Enter result'}
      </button>
    );
  }
  return (
    <button className="font-mono font-semibold text-emerald-700 hover:underline dark:text-emerald-400" title="Change this result" onClick={onEdit}>
      {m.p1Games}-{m.p2Games}
      {m.draws ? `-${m.draws}` : ''}
    </button>
  );
}

function ResultEditor({ round, match, bestOf, onDone }: { round: RoundView; match: MatchView; bestOf: number; onDone: () => void }) {
  const { busy, error, run } = useAction();
  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-3 dark:border-indigo-900 dark:bg-indigo-950/30">
      {match.resultStatus === 'disputed' && (
        <p className="mb-2 text-sm text-rose-700 dark:text-rose-300">
          A player says the reported {match.p1Games}-{match.p2Games} is wrong. Ask both players and enter the right score.
        </p>
      )}
      <ResultForm
        bestOf={bestOf}
        allowDraw={round.phase === 'swiss'}
        p1Name={match.p1.name}
        p2Name={match.p2!.name}
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

// ---------- Step 3: results ----------

function ResultsStep({ state }: { state: EventState }) {
  const hasCut = state.rounds.some((r) => r.phase === 'topcut');
  return (
    <div className="space-y-4">
      {state.champion && (
        <div className="card bg-amber-50 py-6 text-center dark:bg-amber-950/40">
          <div className="label">Champion</div>
          <div className="text-3xl font-black">🏆 {state.champion.name}</div>
        </div>
      )}
      {hasCut && (
        <div className="card">
          <Bracket rounds={state.rounds} champion={state.champion} />
        </div>
      )}
      <div className="card">
        <h2 className="mb-2 font-semibold">Final standings</h2>
        <StandingsTable rows={state.standings} />
      </div>
    </div>
  );
}

// ---------- Tools side bar ----------

function EventTools({ state, focus, clockSkew }: { state: EventState; focus: ToolId | null; clockSkew: number }) {
  const ev = state.event;
  const round = state.rounds.at(-1);
  const live = round && round.status !== 'complete' && (ev.status === 'swiss' || ev.status === 'topcut');
  return (
    <>
      {live && (
        <ToolSection id="timer" title="Timer" hint={round.label} focus={focus}>
          <TimerTools round={round} clockSkew={clockSkew} />
        </ToolSection>
      )}
      {state.rounds.length > 0 && (
        <ToolSection id="round" title="Rounds" hint="re-pair, earlier results, print" focus={focus}>
          <RoundTools state={state} />
        </ToolSection>
      )}
      <ToolSection id="players" title="Players" hint="drop, remove" focus={focus}>
        <PlayerTools state={state} />
      </ToolSection>
      {ev.entry_fee_cents > 0 && (
        <ToolSection id="payments" title="Payments" hint={state.payments.owing ? `${state.payments.owing} still owe` : undefined} focus={focus}>
          <PaymentTools state={state} />
        </ToolSection>
      )}
      <ToolSection id="views" title="Projector & standings" focus={focus}>
        <div className="flex flex-wrap gap-2">
          <NewTabLink className="btn-secondary btn-sm" to={`/display/${ev.id}`}>
            Projector view
          </NewTabLink>
          <NewTabLink className="btn-secondary btn-sm" to={`/events/${ev.id}`}>
            Player view
          </NewTabLink>
          <DownloadLink className="btn-secondary btn-sm" href={`/api/events/${ev.id}/standings.csv`}>
            Standings CSV
          </DownloadLink>
        </div>
        <StandingsTable rows={state.standings} />
        {state.rounds.some((r) => r.phase === 'topcut') && <Bracket rounds={state.rounds} champion={state.champion} />}
      </ToolSection>
      <ToolSection id="settings" title="Event settings" hint="format, rounds, top cut, fee" focus={focus}>
        <SettingsTools state={state} />
      </ToolSection>
    </>
  );
}

function TimerTools({ round, clockSkew }: { round: RoundView; clockSkew: number }) {
  const { busy, error, run } = useAction();
  const timer = (action: string, minutes?: number) => run(() => api(`/api/rounds/${round.id}/timer`, { action, minutes }));
  return (
    <>
      <RoundTimer round={round} clockSkew={clockSkew} />
      <div className="flex flex-wrap gap-2">
        {round.timer.endsAt === null ? (
          <button className="btn-primary btn-sm" disabled={busy} onClick={() => timer('start')}>
            ▶ Resume
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
          +5 min
        </button>
        <button className="btn-secondary btn-sm" disabled={busy} onClick={() => timer('add', -1)}>
          −1 min
        </button>
      </div>
      <ErrorNote error={error} />
    </>
  );
}

function RoundTools({ state }: { state: EventState }) {
  const ev = state.event;
  const [idx, setIdx] = useState(state.rounds.length - 1);
  const [editing, setEditing] = useState<number | null>(null);
  const { busy, error, run } = useAction();
  const round = state.rounds[Math.min(idx, state.rounds.length - 1)];
  const isCurrent = round.id === state.rounds.at(-1)!.id;
  const editable = (isCurrent && round.status !== 'complete') || (round.phase === 'swiss' && ev.status === 'swiss');
  const canRepair = isCurrent && round.phase === 'swiss' && round.status !== 'complete' && round.matches.every((m) => !m.p2 || m.resultStatus === 'pending');
  const match = round.matches.find((m) => m.id === editing);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <select id="tools-round" className="input w-auto py-1" value={idx} onChange={(e) => setIdx(Number(e.target.value))}>
          {state.rounds.map((r, i) => (
            <option key={r.id} value={i}>
              {r.label}
            </option>
          ))}
        </select>
        {canRepair && (
          <button
            className="btn-secondary btn-sm"
            disabled={busy}
            onClick={async () =>
              (await ask('Throw away these pairings and pair the round again? The clock restarts.', { confirmLabel: 'Re-pair' })) &&
              run(() => api(`/api/rounds/${round.id}/repair`, {}))
            }
          >
            Re-pair round
          </button>
        )}
        <NewTabLink className="btn-secondary btn-sm" to={`/print/${ev.id}?round=${round.id}`}>
          Print slips
        </NewTabLink>
      </div>
      <PairingsTable
        matches={round.matches}
        action={(m) =>
          m.p2 && editable ? (
            <button className="btn-secondary btn-sm" onClick={() => setEditing(editing === m.id ? null : m.id)}>
              Edit
            </button>
          ) : null
        }
      />
      {match?.p2 && <ResultEditor round={round} match={match} bestOf={ev.best_of} onDone={() => setEditing(null)} />}
      <ErrorNote error={error} />
    </>
  );
}

function PlayerTools({ state }: { state: EventState }) {
  const ev = state.event;
  const { busy, error, run } = useAction();
  const running = ev.status === 'swiss' || ev.status === 'topcut';
  const preStart = ['draft', 'registration', 'checkin'].includes(ev.status);
  const call = (path: string, body: unknown) => run(() => api(`/api/events/${ev.id}/${path}`, body));
  return (
    <>
      {running && ev.status === 'swiss' && (
        <div>
          <div className="label mb-1">Late entry (joins next round with 0 points)</div>
          <AddPlayer state={state} />
        </div>
      )}
      <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
        {state.registrations.map((r) => (
          <li key={r.playerId} className="flex flex-wrap items-center gap-2 py-2">
            <span className="min-w-0 flex-1 truncate">
              {r.name}
              <span className="ml-2 text-xs text-slate-500">
                {r.status === 'checked_in' ? 'here' : r.status === 'dropped' ? `dropped after R${r.droppedAfterRound}` : r.status === 'waitlist' ? 'waitlist' : 'not checked in'}
              </span>
            </span>
            {running && r.status === 'checked_in' && (
              <button
                className="btn-secondary btn-sm"
                disabled={busy}
                onClick={async () => (await ask(`Drop ${r.name}? They won't be paired again.`, { confirmLabel: 'Drop', danger: true })) && call('drop', { playerId: r.playerId })}
              >
                Drop
              </button>
            )}
            {preStart && (
              <button
                className="btn-secondary btn-sm"
                disabled={busy}
                onClick={async () => (await ask(`Remove ${r.name} from the event?`, { confirmLabel: 'Remove' })) && call('unregister', { playerId: r.playerId })}
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      <ErrorNote error={error} />
    </>
  );
}

function PaymentTools({ state }: { state: EventState }) {
  const ev = state.event;
  const p = state.payments;
  const { busy, error, setError, run } = useAction();
  const [pick, setPick] = useState<Record<number, number>>({});
  const totals = p.totals ?? { pos: 0, cash: 0, comp: 0 };
  const unpaid = state.registrations.filter((r) => (r.status === 'registered' || r.status === 'checked_in') && r.payment?.status !== 'paid');
  const tray = p.unassigned ?? [];

  return (
    <>
      <p className="text-sm">
        {p.paidCount} paid · {money(totals.pos + totals.cash, ev.currency)} collected
        {p.refunded ? ` · ${p.refunded} refunded` : ''}
      </p>
      {tray.length > 0 && (
        <div className="space-y-2 rounded-lg border border-amber-300 p-2 dark:border-amber-800">
          <div className="text-sm font-semibold">POS sales without a player</div>
          {tray.map((sale) => (
            <div key={sale.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="flex-1">
                #{sale.posNumber} · {money(sale.amountCents, sale.currency)}
                {sale.soldAt && ` · ${new Date(sale.soldAt).toLocaleTimeString()}`}
                {sale.status === 'refunded' && ' · refunded'}
              </span>
              {sale.status === 'paid' && (
                <>
                  <select className="input w-auto py-1" value={pick[sale.id] ?? ''} onChange={(e) => setPick({ ...pick, [sale.id]: Number(e.target.value) })}>
                    <option value="">Who paid?</option>
                    {unpaid.map((r) => (
                      <option key={r.playerId} value={r.playerId}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn-primary btn-sm"
                    disabled={busy || !pick[sale.id]}
                    onClick={() => run(() => api(`/api/payments/${sale.id}/assign`, { playerId: pick[sale.id] }))}
                  >
                    Assign
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {state.registrations
          .filter((r) => r.status !== 'waitlist')
          .map((r) => (
            <li key={r.playerId} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <span className="flex-1">{r.name}</span>
              {r.status === 'dropped' ? (
                <PaymentBadge payment={r.payment} />
              ) : (
                <PaymentActions state={state} playerId={r.playerId} payment={r.payment} waitingSince={r.waitingForPosSince} onError={setError} />
              )}
            </li>
          ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        {p.onPos ? (
          <>
            <button className="btn-secondary btn-sm" disabled={busy} onClick={() => run(() => api('/api/pos/sync', {}))}>
              Check POS now
            </button>
            <button
              className="btn-secondary btn-sm"
              disabled={busy}
              onClick={async () =>
                (await ask('Stop matching POS sales to this event? The product stays on the POS; delete it there if needed.', { confirmLabel: 'Unlink' })) &&
                run(() => api(`/api/events/${ev.id}/pos/product`, undefined, 'DELETE'))
              }
            >
              Unlink from POS
            </button>
          </>
        ) : (
          <button className="btn-secondary btn-sm" disabled={busy} onClick={() => run(() => api(`/api/events/${ev.id}/pos/product`, {}))}>
            Add to PayPal POS
          </button>
        )}
        <DownloadLink className="btn-secondary btn-sm" href={`/api/events/${ev.id}/payments.csv`}>
          Payments CSV
        </DownloadLink>
      </div>
      <ErrorNote error={error} />
    </>
  );
}

function SettingsTools({ state }: { state: EventState }) {
  const ev = state.event;
  const started = !['draft', 'registration', 'checkin'].includes(ev.status);
  const navigate = useNavigate();
  const { busy, error, run } = useAction();
  const [saved, setSaved] = useState<string | null>(null);
  return (
    <>
      <EventForm
        key={`${ev.id}-${ev.status}`}
        initial={fromRow(ev)}
        started={started}
        feeLocked={!!ev.pos_product_uuid}
        recommendedRounds={state.recommendedRounds}
        submitLabel="Save settings"
        busy={busy}
        onSubmit={(v) =>
          run(async () => {
            setSaved(null);
            const r = await api<{ posWarning: string | null }>(`/api/events/${ev.id}`, v, 'PATCH');
            setSaved(r.posWarning ?? 'Saved.');
          })
        }
      />
      <ErrorNote error={error} />
      {saved && <p className="text-sm text-emerald-600">{saved}</p>}
      <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-3 dark:border-slate-800">
        <span className="text-sm text-slate-500">
          <StatusPill status={ev.status} />
        </span>
        <button
          className="btn-danger btn-sm"
          disabled={busy}
          onClick={async () =>
            (await ask(`Delete “${ev.name}” and all its results permanently?`, { confirmLabel: 'Delete', danger: true })) &&
            run(async () => {
              await api(`/api/events/${ev.id}`, undefined, 'DELETE');
              navigate('/staff');
            })
          }
        >
          Delete event
        </button>
      </div>
    </>
  );
}
