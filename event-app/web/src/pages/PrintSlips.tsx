import { useParams, useSearchParams } from 'react-router-dom';
import { useLiveEvent } from '../hooks';

/** Printable match slips for a round (one per table), for stores that collect paper results. */
export function PrintSlips() {
  const eventId = Number(useParams().id);
  const [params] = useSearchParams();
  const { state } = useLiveEvent(eventId);
  if (!state) return null;
  const roundId = Number(params.get('round'));
  const round = state.rounds.find((r) => r.id === roundId) ?? state.rounds.at(-1);
  if (!round) return <p className="p-6">No rounds yet.</p>;
  const games = state.event.best_of;

  return (
    <div className="bg-white p-6 text-black">
      <div className="no-print mb-4 flex items-center gap-3">
        <button className="btn-primary" onClick={() => window.print()}>
          Print
        </button>
        <span className="text-sm text-slate-600">
          {state.event.name} — {round.label} — {round.matches.filter((m) => m.p2).length} slips
        </span>
      </div>
      <div className="grid grid-cols-2 gap-4">
        {round.matches
          .filter((m) => m.p2)
          .map((m) => (
            <div key={m.id} className="break-inside-avoid rounded border-2 border-dashed border-slate-400 p-3 text-sm">
              <div className="mb-2 flex justify-between font-semibold">
                <span>{state.event.name}</span>
                <span>
                  {round.label} · Table {m.table}
                </span>
              </div>
              <table className="w-full">
                <thead>
                  <tr className="text-left text-xs">
                    <th className="py-1">Player</th>
                    <th className="w-16 text-center">Games won</th>
                    <th className="w-28">Signature</th>
                  </tr>
                </thead>
                <tbody>
                  {[m.p1, m.p2!].map((p) => (
                    <tr key={p.id} className="border-t border-slate-300">
                      <td className="py-3 font-medium">{p.name}</td>
                      <td className="border-x border-slate-300" />
                      <td />
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-2 text-xs text-slate-600">Drawn games: ____ · Best of {games} · Drop? ☐ {m.p1.name} ☐ {m.p2!.name}</div>
            </div>
          ))}
      </div>
    </div>
  );
}
