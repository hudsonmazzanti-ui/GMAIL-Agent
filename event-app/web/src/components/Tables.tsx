import type { ReactNode } from 'react';
import { pct, record, resultText, type MatchView, type StandingView } from '../api';
import { Empty } from './ui';

const RESULT_STYLE: Record<MatchView['resultStatus'], string> = {
  pending: 'text-slate-400',
  reported: 'text-amber-600 dark:text-amber-400',
  disputed: 'text-rose-600 dark:text-rose-400 font-semibold',
  confirmed: 'text-emerald-700 dark:text-emerald-400 font-semibold',
};

export function PairingsTable({
  matches,
  highlight,
  action,
}: {
  matches: MatchView[];
  highlight?: number;
  action?: (m: MatchView) => ReactNode;
}) {
  if (!matches.length) return <Empty>No pairings yet.</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-slate-500 dark:text-slate-400">
          <tr>
            <th className="w-12 py-2 pr-2">Table</th>
            <th className="py-2 pr-2">Player 1</th>
            <th className="py-2 pr-2">Player 2</th>
            <th className="py-2 pr-2 text-center">Result</th>
            {action && <th className="no-print py-2" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {matches.map((m) => {
            const mine = highlight !== undefined && (m.p1.id === highlight || m.p2?.id === highlight);
            return (
              <tr key={m.id} className={mine ? 'bg-indigo-50 dark:bg-indigo-950/40' : ''}>
                <td className="py-2 pr-2 font-mono text-slate-500">{m.p2 ? m.table : '–'}</td>
                <td className="py-2 pr-2 font-medium">{m.p1.name}</td>
                <td className="py-2 pr-2">{m.p2 ? m.p2.name : <span className="italic text-slate-400">Bye</span>}</td>
                <td className={`py-2 pr-2 text-center font-mono ${m.p2 ? RESULT_STYLE[m.resultStatus] : 'text-slate-400'}`}>
                  {resultText(m)}
                  {m.resultStatus === 'reported' && m.p2 && <div className="font-sans text-[10px] uppercase">unconfirmed</div>}
                  {m.resultStatus === 'disputed' && <div className="font-sans text-[10px] uppercase">disputed</div>}
                </td>
                {action && <td className="no-print py-2 text-right">{action(m)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function StandingsTable({ rows, highlight, limit }: { rows: StandingView[]; highlight?: number; limit?: number }) {
  if (!rows.length) return <Empty>Standings appear once the first round starts.</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-slate-500 dark:text-slate-400">
          <tr>
            <th className="w-10 py-2 pr-2">#</th>
            <th className="py-2 pr-2">Player</th>
            <th className="py-2 pr-2 text-right">Pts</th>
            <th className="py-2 pr-2 text-right">W-L-D</th>
            <th className="py-2 pr-2 text-right">OMW</th>
            <th className="hidden py-2 pr-2 text-right sm:table-cell">GW</th>
            <th className="hidden py-2 text-right sm:table-cell">OGW</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 tabular-nums dark:divide-slate-800">
          {rows.slice(0, limit).map((r) => (
            <tr key={r.playerId} className={r.playerId === highlight ? 'bg-indigo-50 dark:bg-indigo-950/40' : ''}>
              <td className="py-2 pr-2 text-slate-500">{r.rank}</td>
              <td className="py-2 pr-2 font-medium">
                {r.name}
                {r.dropped && <span className="pill ml-2 bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400">dropped</span>}
              </td>
              <td className="py-2 pr-2 text-right font-semibold">{r.matchPoints}</td>
              <td className="py-2 pr-2 text-right">{record(r)}</td>
              <td className="py-2 pr-2 text-right">{pct(r.omw)}</td>
              <td className="hidden py-2 pr-2 text-right sm:table-cell">{pct(r.gwp)}</td>
              <td className="hidden py-2 text-right sm:table-cell">{pct(r.ogw)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
