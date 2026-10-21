import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, formatDate, money, record, type EventState, type MatchView, type RoundView } from '../api';
import { Bracket } from '../components/Bracket';
import { ResultForm } from '../components/ResultForm';
import { RoundTimer } from '../components/RoundTimer';
import { PairingsTable, StandingsTable } from '../components/Tables';
import { Empty, ErrorNote, StatusPill, Tabs } from '../components/ui';
import { useAction, useAuth, useLiveEvent } from '../hooks';

type Tab = 'pairings' | 'standings' | 'bracket' | 'players';

export function EventPage() {
  const eventId = Number(useParams().id);
  const { state, error, clockSkew } = useLiveEvent(eventId);
  const { viewer } = useAuth();
  const [tab, setTab] = useState<Tab>('pairings');
  const [roundIdx, setRoundIdx] = useState<number | null>(null);

  const roundCount = state?.rounds.length ?? 0;
  useEffect(() => setRoundIdx(null), [roundCount]);

  if (error && !state) return <ErrorNote error={error} />;
  if (!state) return null;
  const { event: ev } = state;
  const me = viewer.kind === 'player' ? viewer.playerId : undefined;
  const hasTopCut = state.rounds.some((r) => r.phase === 'topcut');
  const shownRound = state.rounds[roundIdx ?? roundCount - 1];

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold">{ev.name}</h1>
          <StatusPill status={ev.status} />
          {viewer.kind === 'staff' && (
            <Link to={`/staff/events/${ev.id}`} className="btn-secondary btn-sm ml-auto">
              Manage
            </Link>
          )}
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {[formatDate(ev.date, ev.start_time), ev.game, ev.format, `Best of ${ev.best_of}`].filter(Boolean).join(' · ')}
        </p>
        {ev.description && <p className="whitespace-pre-line pt-2 text-sm">{ev.description}</p>}
        {(ev.entry_fee_cents > 0 || ev.entry_fee_note) && (
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Entry: {[ev.entry_fee_cents > 0 && money(ev.entry_fee_cents, ev.currency), ev.entry_fee_note].filter(Boolean).join(' · ')}
          </p>
        )}
      </header>

      {state.champion && (
        <div className="card bg-amber-50 text-center dark:bg-amber-950/40">
          <div className="label">Champion</div>
          <div className="text-xl font-bold">🏆 {state.champion.name}</div>
        </div>
      )}

      {viewer.kind !== 'staff' && <PlayerPanel state={state} clockSkew={clockSkew} />}

      <Tabs<Tab>
        tabs={[
          ['pairings', 'Pairings'],
          ['standings', 'Standings'],
          ...(hasTopCut ? ([['bracket', 'Top cut']] as [Tab, string][]) : []),
          ['players', `Players (${state.counts.registered})`],
        ]}
        value={tab}
        onChange={setTab}
      />

      <div className="card">
        {tab === 'pairings' &&
          (shownRound ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="input w-auto"
                  value={roundIdx ?? roundCount - 1}
                  onChange={(e) => setRoundIdx(Number(e.target.value))}
                >
                  {state.rounds.map((r, i) => (
                    <option key={r.id} value={i}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <div className="ml-auto">
                  <RoundTimer round={shownRound} clockSkew={clockSkew} />
                </div>
              </div>
              <PairingsTable matches={shownRound.matches} highlight={me} />
            </div>
          ) : (
            <Empty>Pairings are posted when the event starts.</Empty>
          ))}
        {tab === 'standings' && <StandingsTable rows={state.standings} highlight={me} />}
        {tab === 'bracket' && <Bracket rounds={state.rounds} champion={state.champion} />}
        {tab === 'players' && (
          <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {state.registrations
              .filter((r) => r.status !== 'waitlist')
              .map((r) => (
                <li key={r.playerId} className="flex justify-between border-b border-slate-100 py-1.5 dark:border-slate-800">
                  <span className={r.playerId === me ? 'font-semibold' : ''}>{r.name}</span>
                  {r.status === 'dropped' && <span className="text-xs text-slate-400">dropped</span>}
                  {r.status === 'checked_in' && ev.status === 'checkin' && <span className="text-xs text-emerald-600">✓ here</span>}
                </li>
              ))}
            {state.counts.waitlist > 0 && <li className="pt-2 text-xs text-slate-500">+ {state.counts.waitlist} on the waitlist</li>}
          </ul>
        )}
      </div>

      <p className="no-print text-center text-xs text-slate-400">
        <Link to={`/display/${ev.id}`} className="underline">
          Projector view
        </Link>
      </p>
    </div>
  );
}

function PlayerPanel({ state, clockSkew }: { state: EventState; clockSkew: number }) {
  const { viewer } = useAuth();
  const { busy, error, run } = useAction();
  const ev = state.event;

  if (viewer.kind !== 'player') {
    if (ev.status !== 'registration') return null;
    return (
      <div className="card flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm">Registration is open.</span>
        <Link to={`/login?next=/events/${ev.id}`} className="btn-primary">
          Log in to register
        </Link>
      </div>
    );
  }

  const reg = state.registrations.find((r) => r.playerId === viewer.playerId);
  const call = (path: string, body: unknown = {}) => run(() => api(`/api/events/${ev.id}/${path}`, body));
  const preStart = ['draft', 'registration', 'checkin'].includes(ev.status);
  const running = ev.status === 'swiss' || ev.status === 'topcut';

  if (!reg) {
    if (ev.status !== 'registration') return null;
    const full = ev.capacity !== null && state.counts.registered >= ev.capacity;
    return (
      <div className="card flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm">{full ? 'This event is full — you can join the waitlist.' : 'Spots available.'}</span>
        <button className="btn-primary" disabled={busy} onClick={() => call('register')}>
          {full ? 'Join waitlist' : 'Register'}
        </button>
        <ErrorNote error={error} />
      </div>
    );
  }

  const round = state.rounds.at(-1);
  const myMatch = round?.matches.find((m) => m.p1.id === viewer.playerId || m.p2?.id === viewer.playerId);
  const myStanding = state.standings.find((s) => s.playerId === viewer.playerId);

  return (
    <div className="card space-y-4 border-indigo-200 dark:border-indigo-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="label">You</div>
          <div className="font-semibold">
            {viewer.name}
            {myStanding && (
              <span className="ml-2 text-sm font-normal text-slate-500">
                #{myStanding.rank} · {myStanding.matchPoints} pts · {record(myStanding)}
              </span>
            )}
          </div>
        </div>
        <RegStatus status={reg.status} eventStatus={ev.status} />
      </div>

      {preStart && reg.status !== 'checked_in' && (
        <p className="text-sm text-slate-600 dark:text-slate-300">Check in at the front desk when you arrive.</p>
      )}
      {ev.entry_fee_cents > 0 && reg.status !== 'waitlist' && (
        <p className="text-sm">
          Entry {money(ev.entry_fee_cents, ev.currency)}:{' '}
          {reg.payment?.status === 'paid' ? (
            <span className="font-semibold text-emerald-700 dark:text-emerald-400">Paid ✓</span>
          ) : reg.payment?.status === 'refunded' ? (
            <span className="font-semibold text-rose-600">Refunded</span>
          ) : (
            <span className="font-semibold text-amber-700 dark:text-amber-400">Pay at the front desk</span>
          )}
        </p>
      )}

      {running && reg.status !== 'dropped' && round && (
        myMatch ? (
          <MyMatch round={round} match={myMatch} me={viewer.playerId} state={state} clockSkew={clockSkew} />
        ) : (
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {round.phase === 'topcut' ? "You didn't make the top cut this time — thanks for playing!" : 'You are not paired this round.'}
          </p>
        )
      )}

      <ErrorNote error={error} />
      <div className="flex flex-wrap gap-2">
        {preStart && (
          <button className="btn-secondary btn-sm" disabled={busy} onClick={() => confirm('Unregister from this event?') && call('unregister')}>
            Unregister
          </button>
        )}
        {running && reg.status === 'checked_in' && (
          <button
            className="btn-secondary btn-sm"
            disabled={busy}
            onClick={() => confirm('Drop from the event? You will not be paired in future rounds.') && call('drop')}
          >
            Drop from event
          </button>
        )}
      </div>
    </div>
  );
}

function RegStatus({ status, eventStatus }: { status: string; eventStatus: string }) {
  const map: Record<string, [string, string]> = {
    registered: ['Registered', 'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-300'],
    waitlist: ['Waitlisted', 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300'],
    checked_in: [eventStatus === 'complete' ? 'Played' : 'Checked in', 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300'],
    dropped: ['Dropped', 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'],
  };
  const [label, style] = map[status];
  return <span className={`pill ${style}`}>{label}</span>;
}

function MyMatch({
  round,
  match,
  me,
  state,
  clockSkew,
}: {
  round: RoundView;
  match: MatchView;
  me: number;
  state: EventState;
  clockSkew: number;
}) {
  const { busy, error, run } = useAction();
  const [editing, setEditing] = useState(false);
  const opponent = match.p1.id === me ? match.p2 : match.p1;
  const iAmP1 = match.p1.id === me;
  const closed = round.status === 'complete';

  // Show results from the viewer's perspective.
  const mine = iAmP1 ? match.p1Games : match.p2Games;
  const theirs = iAmP1 ? match.p2Games : match.p1Games;
  const score = `${mine}-${theirs}${match.draws ? `-${match.draws}` : ''}`;

  const report = (r: { p1Games: number; p2Games: number; draws: number }) =>
    run(async () => {
      // The form is from the viewer's perspective; convert to p1/p2.
      const body = iAmP1 ? r : { p1Games: r.p2Games, p2Games: r.p1Games, draws: r.draws };
      await api(`/api/matches/${match.id}/result`, body);
      setEditing(false);
    });
  const respond = (accept: boolean) => run(() => api(`/api/matches/${match.id}/respond`, { accept }));

  return (
    <div className="rounded-lg bg-indigo-50 p-4 dark:bg-indigo-950/40">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="label">{round.label}</div>
          {opponent ? (
            <>
              <div className="text-3xl font-black">Table {match.table}</div>
              <div className="text-sm">
                vs <span className="font-semibold">{opponent.name}</span>
              </div>
            </>
          ) : (
            <div className="text-2xl font-bold">You have a bye 🎉</div>
          )}
        </div>
        <RoundTimer round={round} clockSkew={clockSkew} />
      </div>

      {opponent && !closed && (
        <div className="mt-4 space-y-3">
          {match.resultStatus === 'confirmed' && (
            <p className="text-sm">
              Result confirmed: <span className="font-mono font-semibold">{score}</span>. Ask a judge if it's wrong.
            </p>
          )}
          {match.resultStatus === 'reported' && match.reportedBy === me && !editing && (
            <p className="text-sm">
              You reported <span className="font-mono font-semibold">{score}</span>. Waiting for {opponent.name} to confirm.{' '}
              <button className="underline" onClick={() => setEditing(true)}>
                Change
              </button>
            </p>
          )}
          {match.resultStatus === 'reported' && match.reportedBy !== me && (
            <div className="space-y-2">
              <p className="text-sm">
                {opponent.name} reported <span className="font-mono font-semibold">{score}</span> (your games first). Is that right?
              </p>
              <div className="flex gap-2">
                <button className="btn-primary" disabled={busy} onClick={() => respond(true)}>
                  Confirm
                </button>
                <button className="btn-secondary" disabled={busy} onClick={() => respond(false)}>
                  That's wrong
                </button>
              </div>
            </div>
          )}
          {match.resultStatus === 'disputed' && <p className="text-sm font-medium text-rose-600">Result disputed — a judge is on the way.</p>}
          {(match.resultStatus === 'pending' || editing) && (
            <div>
              <p className="mb-2 text-sm font-medium">Report your result (your games first):</p>
              <ResultForm
                bestOf={state.event.best_of}
                allowDraw={round.phase === 'swiss'}
                p1Name="You"
                p2Name={opponent.name}
                busy={busy}
                onSubmit={report}
              />
            </div>
          )}
          <ErrorNote error={error} />
        </div>
      )}
    </div>
  );
}
