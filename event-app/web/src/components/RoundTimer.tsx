import type { RoundView } from '../api';
import { formatClock, useCountdown } from '../hooks';

export function RoundTimer({ round, clockSkew, big = false }: { round: RoundView; clockSkew: number; big?: boolean }) {
  const ms = useCountdown(round.timer, clockSkew);
  if (ms === null) return null;
  const running = round.timer.endsAt !== null;
  const done = round.status === 'complete';
  const urgent = running && ms <= 5 * 60_000;
  const color = ms === 0 && !done ? 'text-rose-600 dark:text-rose-400' : urgent ? 'text-amber-600 dark:text-amber-400' : '';
  return (
    <div className={`font-mono font-bold tabular-nums ${big ? 'text-7xl sm:text-9xl' : 'text-3xl'} ${color}`}>
      {done ? 'Done' : ms === 0 ? 'Time!' : formatClock(ms)}
      {!running && !done && <span className={`ml-2 align-middle font-sans font-medium text-slate-400 ${big ? 'text-2xl' : 'text-xs'}`}>paused</span>}
    </div>
  );
}
