import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { DEMO } from '../env';
import { Bracket } from '../components/Bracket';
import { JoinQr, QrCode, formatJoinCode, useJoinUrl } from '../components/JoinQr';
import { RoundTimer } from '../components/RoundTimer';
import { StandingsTable } from '../components/Tables';
import { useLiveEvent } from '../hooks';

type View = 'pairings' | 'standings' | 'bracket';

/** Full-screen projector view: big timer + pairings sorted by player name. */
export function Display() {
  const eventId = Number(useParams().id);
  const [params, setParams] = useSearchParams();
  const { state, clockSkew } = useLiveEvent(eventId);
  const [auto, setAuto] = useState<View | null>(null);
  const chosen = params.get('view') as View | null;

  // Default view follows the event: pairings while running, bracket/standings when done.
  useEffect(() => {
    if (!state) return;
    const hasCut = state.rounds.some((r) => r.phase === 'topcut');
    setAuto(state.event.status === 'complete' ? (hasCut ? 'bracket' : 'standings') : state.event.status === 'topcut' ? 'bracket' : 'pairings');
  }, [state]);

  if (!state) return <div className="min-h-screen bg-slate-950" />;
  const view = chosen ?? auto ?? 'pairings';
  const round = state.rounds.at(-1);

  // One row per player (both sides of each match), alphabetical — the classic "find your name" list.
  const rows = round
    ? round.matches
        .flatMap((m) => {
          const a = { name: m.p1.name, table: m.p2 ? m.table : null, opp: m.p2?.name ?? 'BYE', done: m.resultStatus === 'confirmed' };
          return m.p2 ? [a, { name: m.p2.name, table: m.table, opp: m.p1.name, done: a.done }] : [a];
        })
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];

  return (
    <div className="dark min-h-screen bg-slate-950 p-6 text-slate-100">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold sm:text-4xl">{state.event.name}</h1>
          <p className="text-xl text-slate-400">{round ? round.label : 'Waiting to start'}</p>
        </div>
        {round && view === 'pairings' && <RoundTimer round={round} clockSkew={clockSkew} big />}
      </header>

      {state.champion && (
        <div className="mb-6 rounded-xl bg-amber-500/20 py-4 text-center text-3xl font-bold text-amber-200">🏆 {state.champion.name}</div>
      )}

      {view === 'pairings' &&
        (rows.length ? (
          <div className="columns-1 gap-8 text-xl md:columns-2 xl:columns-3">
            {rows.map((r) => (
              <div key={r.name} className={`flex break-inside-avoid items-baseline gap-3 border-b border-slate-800 py-1.5 ${r.done ? 'opacity-40' : ''}`}>
                <span className="w-12 shrink-0 text-right font-mono font-bold text-indigo-300">{r.table ?? '–'}</span>
                <span className="min-w-0 flex-1 truncate font-semibold">{r.name}</span>
                <span className="min-w-0 truncate text-base text-slate-400">vs {r.opp}</span>
              </div>
            ))}
          </div>
        ) : state.event.join_code && ['registration', 'checkin'].includes(state.event.status) ? (
          <div className="flex flex-wrap items-center justify-center gap-12 py-8">
            <JoinQr code={state.event.join_code} eventName={state.event.name} size={340} />
            <div className="max-w-md space-y-4">
              <p className="text-5xl font-black leading-tight">Scan to join</p>
              <p className="text-2xl text-slate-300">
                Open your phone camera and point it at the code, or enter the event code on the Events page.
              </p>
              <p className="text-2xl text-slate-400">
                {state.counts.registered} registered · {state.counts.checkedIn} checked in
              </p>
            </div>
          </div>
        ) : (
          <p className="py-24 text-center text-3xl text-slate-500">
            {state.counts.checkedIn} players checked in · pairings coming soon
          </p>
        ))}
      {view === 'standings' && (
        <div className="text-lg">
          <StandingsTable rows={state.standings} limit={32} />
        </div>
      )}
      {view === 'bracket' && <Bracket rounds={state.rounds} champion={state.champion} />}

      {state.event.join_code && round && state.event.status !== 'complete' && (
        <CornerQr code={state.event.join_code} />
      )}

      <nav className="fixed bottom-3 right-3 flex gap-1 opacity-20 transition hover:opacity-100">
        {(['pairings', 'standings', 'bracket'] as View[]).map((v) => (
          <button key={v} className={`tab ${view === v ? 'tab-active' : ''}`} onClick={() => setParams({ view: v })}>
            {v}
          </button>
        ))}
        {chosen && (
          <button className="tab" onClick={() => setParams({})}>
            auto
          </button>
        )}
        {DEMO && (
          <Link className="tab" to={`/staff/events/${eventId}`}>
            exit
          </Link>
        )}
      </nav>
    </div>
  );
}

/** Small QR in the corner during rounds, so latecomers can scan for their table. */
function CornerQr({ code }: { code: string }) {
  const url = useJoinUrl(code);
  if (!url) return null;
  return (
    <div className="fixed bottom-3 left-3 flex items-center gap-3 rounded-xl bg-slate-900/90 p-2 pr-4">
      <QrCode text={url} size={112} label="QR code to open this event" />
      <div>
        <div className="text-sm text-slate-400">Your table on your phone</div>
        <div className="font-mono text-2xl font-bold tracking-widest">{formatJoinCode(code)}</div>
      </div>
    </div>
  );
}
