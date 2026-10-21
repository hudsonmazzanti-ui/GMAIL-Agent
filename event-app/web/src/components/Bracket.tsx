import type { RoundView } from '../api';

/** Top cut bracket: one column per elimination round. */
export function Bracket({ rounds, champion }: { rounds: RoundView[]; champion: { name: string } | null }) {
  const cut = rounds.filter((r) => r.phase === 'topcut');
  if (!cut.length) return null;
  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-max gap-4">
        {cut.map((r) => (
          <div key={r.id} className="flex w-52 flex-col gap-2">
            <div className="label text-center">{r.label}</div>
            <div className="flex flex-1 flex-col justify-around gap-3">
            {r.matches.map((m) => {
              const decided = m.resultStatus === 'confirmed';
              const p1Won = decided && (!m.p2 || m.p1Games > m.p2Games);
              const p2Won = decided && !!m.p2 && m.p2Games > m.p1Games;
              const row = (name: string, games: number | string, won: boolean) => (
                <div className={`flex justify-between px-3 py-1.5 ${won ? 'font-semibold' : decided ? 'text-slate-400' : ''}`}>
                  <span className="truncate">{name}</span>
                  <span className="ml-2 font-mono">{games}</span>
                </div>
              );
              return (
                <div key={m.id} className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white text-sm dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-900">
                  {row(m.p1.name, m.p2 && m.resultStatus !== 'pending' ? m.p1Games : '', p1Won)}
                  {m.p2 ? row(m.p2.name, m.resultStatus !== 'pending' ? m.p2Games : '', p2Won) : row('Bye', '', false)}
                </div>
              );
            })}
            </div>
          </div>
        ))}
        {champion && (
          <div className="flex w-44 flex-col gap-2">
            <div className="label text-center">Champion</div>
            <div className="flex flex-1 flex-col justify-center">
            <div className="rounded-lg bg-amber-100 px-3 py-3 text-center font-bold text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
              🏆 {champion.name}
            </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
