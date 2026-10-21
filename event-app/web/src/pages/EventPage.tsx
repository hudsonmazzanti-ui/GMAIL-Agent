import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, formatDate, money, type EventState, type MatchView, type RoundView } from '../api';
import { Bracket } from '../components/Bracket';
import { ask } from '../components/Dialog';
import { formatJoinCode } from '../components/JoinQr';
import { RoundTimer } from '../components/RoundTimer';
import { PairingsTable, StandingsTable } from '../components/Tables';
import { Empty, ErrorNote } from '../components/ui';
import { useAction, useAuth, useLiveEvent } from '../hooks';

/** An event from a player's side: one card that says what to do now, and everything else folded away. */
export function EventPage() {
  const eventId = Number(useParams().id);
  const { state, error, clockSkew } = useLiveEvent(eventId);
  const { viewer } = useAuth();

  if (error && !state) return <ErrorNote error={error} />;
  if (!state) return null;
  const ev = state.event;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="flex-1 text-2xl font-bold">{ev.name}</h1>
          {viewer.kind === 'staff' && (
            <Link to={`/staff/events/${ev.id}`} className="btn-secondary btn-sm">
              Run event
            </Link>
          )}
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {[
            formatDate(ev.date, ev.start_time),
            ev.entry_fee_cents > 0 && `${money(ev.entry_fee_cents, ev.currency)} entry`,
            ev.join_code && `Code ${formatJoinCode(ev.join_code)}`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {ev.description && <p className="whitespace-pre-line pt-2 text-sm">{ev.description}</p>}
      </header>

      {state.champion && (
        <div className="card bg-amber-50 text-center dark:bg-amber-950/40">
          <div className="label">Champion</div>
          <div className="text-xl font-bold">🏆 {state.champion.name}</div>
        </div>
      )}

      {viewer.kind !== 'staff' && <PlayerCard state={state} clockSkew={clockSkew} />}

      <Everyone state={state} clockSkew={clockSkew} />
    </div>
  );
}

function PlayerCard({ state, clockSkew }: { state: EventState; clockSkew: number }) {
  const { viewer } = useAuth();
  const { busy, error, run } = useAction();
  const ev = state.event;
  const preStart = ['draft', 'registration', 'checkin'].includes(ev.status);
  const running = ev.status === 'swiss' || ev.status === 'topcut';
  const call = (path: string) => run(() => api(`/api/events/${ev.id}/${path}`, {}));

  if (viewer.kind !== 'player') {
    if (ev.status !== 'registration') return null;
    return (
      <div className="card space-y-3 text-center">
        <p>Want to play?</p>
        <Link to={`/login?next=${encodeURIComponent(`/events/${ev.id}`)}`} className="btn-primary w-full py-3 text-base">
          Join this event
        </Link>
      </div>
    );
  }

  const reg = state.registrations.find((r) => r.playerId === viewer.playerId);
  if (!reg) {
    if (ev.status !== 'registration') return null;
    const full = ev.capacity !== null && state.counts.registered >= ev.capacity;
    return (
      <div className="card space-y-3 text-center">
        <button className="btn-primary w-full py-3 text-base" disabled={busy} onClick={() => call('register')}>
          {full ? 'Join the waitlist' : `Join as ${viewer.name}`}
        </button>
        <ErrorNote error={error} />
      </div>
    );
  }

  const round = state.rounds.at(-1);
  const myMatch = round?.matches.find((m) => m.p1.id === viewer.playerId || m.p2?.id === viewer.playerId);
  const standing = state.standings.find((s) => s.playerId === viewer.playerId);
  const unpaid = ev.entry_fee_cents > 0 && reg.payment?.status !== 'paid';

  let body;
  if (preStart) {
    body =
      reg.status === 'waitlist' ? (
        <Big title="You're on the waitlist" text="We'll move you in if a spot opens." />
      ) : reg.status === 'checked_in' ? (
        <Big title="You're checked in ✓" text="Pairings show up here when the event starts." />
      ) : (
        <Big
          title="You're in ✓"
          text={unpaid ? `Check in at the front desk and pay the ${money(ev.entry_fee_cents, ev.currency)} entry.` : 'Check in at the front desk when you arrive.'}
        />
      );
  } else if (running && reg.status === 'dropped') {
    body = <Big title="You've dropped" text="Thanks for playing!" />;
  } else if (running && round && myMatch) {
    body = <MyMatch round={round} match={myMatch} me={viewer.playerId} state={state} clockSkew={clockSkew} />;
  } else if (running && round?.phase === 'topcut') {
    body = <Big title={standing ? `You finished #${standing.rank} in Swiss` : 'Swiss is over'} text="The playoff is on. Thanks for playing!" />;
  } else if (ev.status === 'complete' && standing) {
    body = (
      <Big
        title={state.champion?.id === viewer.playerId ? 'You won! 🏆' : `You finished #${standing.rank} of ${state.standings.length}`}
        text={`${standing.wins}-${standing.losses}-${standing.draws} in Swiss. Thanks for playing!`}
      />
    );
  } else {
    body = <Big title="You're not playing this round" text="Ask staff if that's a mistake." />;
  }

  return (
    <div className="card space-y-3 border-indigo-200 dark:border-indigo-900">
      {body}
      <ErrorNote error={error} />
      {preStart && (
        <button
          className="w-full text-center text-xs text-slate-500 underline"
          disabled={busy}
          onClick={async () => (await ask('Leave this event?', { confirmLabel: 'Leave' })) && call('unregister')}
        >
          Leave event
        </button>
      )}
      {running && reg.status === 'checked_in' && ev.status === 'swiss' && (
        <button
          className="w-full text-center text-xs text-slate-500 underline"
          disabled={busy}
          onClick={async () => (await ask('Drop from the event? You will not be paired again.', { confirmLabel: 'Drop', danger: true })) && call('drop')}
        >
          Drop from event
        </button>
      )}
    </div>
  );
}

function Big({ title, text }: { title: string; text: string }) {
  return (
    <div className="py-2 text-center">
      <div className="text-2xl font-black">{title}</div>
      <p className="mt-1 text-slate-600 dark:text-slate-300">{text}</p>
    </div>
  );
}

/** The few ways a match can end, from the player's side ("I won 2-1"). */
function outcomes(bestOf: number, allowDraw: boolean) {
  const win = Math.ceil(bestOf / 2);
  const list: { label: string; mine: number; theirs: number; draws: number }[] = [];
  for (let l = 0; l < win; l++) list.push({ label: bestOf === 1 ? 'I won' : `I won ${win}-${l}`, mine: win, theirs: l, draws: 0 });
  if (allowDraw) list.push({ label: 'Draw', mine: win - 1, theirs: win - 1, draws: 1 });
  for (let l = win - 1; l >= 0; l--) list.push({ label: bestOf === 1 ? 'I lost' : `I lost ${l}-${win}`, mine: l, theirs: win, draws: 0 });
  return list;
}

function describe(mine: number, theirs: number, bestOf: number) {
  const score = bestOf === 1 ? '' : ` ${mine}-${theirs}`;
  return mine > theirs ? `you won${score}` : mine < theirs ? `you lost${score}` : 'a draw';
}

function MyMatch({ round, match, me, state, clockSkew }: { round: RoundView; match: MatchView; me: number; state: EventState; clockSkew: number }) {
  const { busy, error, run } = useAction();
  const [changing, setChanging] = useState(false);
  useEffect(() => setChanging(false), [match.id]);
  const iAmP1 = match.p1.id === me;
  const opponent = iAmP1 ? match.p2 : match.p1;
  const bestOf = state.event.best_of;
  const mine = iAmP1 ? match.p1Games : match.p2Games;
  const theirs = iAmP1 ? match.p2Games : match.p1Games;
  const closed = round.status === 'complete';

  const report = (o: { mine: number; theirs: number; draws: number }) =>
    run(async () => {
      const body = iAmP1 ? { p1Games: o.mine, p2Games: o.theirs, draws: o.draws } : { p1Games: o.theirs, p2Games: o.mine, draws: o.draws };
      await api(`/api/matches/${match.id}/result`, body);
      setChanging(false);
    });

  let action;
  if (!opponent || closed) action = null;
  else if (match.resultStatus === 'disputed') action = <p className="text-center font-medium text-rose-600">Staff are checking this result.</p>;
  else if (match.resultStatus === 'pending' || changing) {
    action = (
      <div className="space-y-2">
        <p className="text-center text-sm font-medium">How did it go?</p>
        <div className="grid gap-2">
          {outcomes(bestOf, round.phase === 'swiss').map((o) => (
            <button key={o.label} className="btn-secondary py-3 text-base" disabled={busy} onClick={() => report(o)}>
              {o.label}
            </button>
          ))}
        </div>
      </div>
    );
  } else if (match.reportedBy === me) {
    action = (
      <p className="text-center">
        Reported: <b>{describe(mine, theirs, bestOf)}</b> ✓{' '}
        <button className="text-sm text-slate-500 underline" onClick={() => setChanging(true)}>
          Change
        </button>
      </p>
    );
  } else if (match.reportedBy !== null) {
    action = (
      <div className="space-y-2 text-center">
        <p>
          {opponent.name} reported <b>{describe(mine, theirs, bestOf)}</b>.
        </p>
        <button className="btn-secondary btn-sm" disabled={busy} onClick={() => run(() => api(`/api/matches/${match.id}/respond`, { accept: false }))}>
          That's wrong
        </button>
      </div>
    );
  } else {
    action = (
      <p className="text-center">
        Result: <b>{describe(mine, theirs, bestOf)}</b>
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-center">
        <div className="label">{round.label}</div>
        {opponent ? (
          <>
            <div className="text-5xl font-black">Table {match.table}</div>
            <div className="mt-1 text-lg">
              vs <b>{opponent.name}</b>
            </div>
          </>
        ) : (
          <div className="text-3xl font-black">You have a bye 🎉</div>
        )}
        <div className="mt-2 flex justify-center">
          <RoundTimer round={round} clockSkew={clockSkew} />
        </div>
      </div>
      {action}
      <ErrorNote error={error} />
    </div>
  );
}

/** Pairings, standings and the bracket, for anyone curious. */
function Everyone({ state, clockSkew }: { state: EventState; clockSkew: number }) {
  const { viewer } = useAuth();
  const me = viewer.kind === 'player' ? viewer.playerId : undefined;
  const [roundIdx, setRoundIdx] = useState<number | null>(null);
  const roundCount = state.rounds.length;
  useEffect(() => setRoundIdx(null), [roundCount]);
  const round = state.rounds[roundIdx ?? roundCount - 1];
  const hasCut = state.rounds.some((r) => r.phase === 'topcut');

  return (
    <details className="card" open={viewer.kind !== 'player'}>
      <summary className="cursor-pointer font-semibold">Everyone: pairings, standings{hasCut ? ', playoff' : ''}</summary>
      <div className="mt-3 space-y-5">
        {round ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <select id="everyone-round" className="input w-auto py-1" value={roundIdx ?? roundCount - 1} onChange={(e) => setRoundIdx(Number(e.target.value))}>
                {state.rounds.map((r, i) => (
                  <option key={r.id} value={i}>
                    {r.label}
                  </option>
                ))}
              </select>
              <div className="ml-auto">
                <RoundTimer round={round} clockSkew={clockSkew} />
              </div>
            </div>
            <PairingsTable matches={round.matches} highlight={me} />
          </div>
        ) : (
          <Empty>
            {state.counts.registered} player{state.counts.registered === 1 ? '' : 's'} so far. Pairings show up when the event starts.
          </Empty>
        )}
        {hasCut && <Bracket rounds={state.rounds} champion={state.champion} />}
        {state.standings.length > 0 && <StandingsTable rows={state.standings} highlight={me} />}
      </div>
    </details>
  );
}
