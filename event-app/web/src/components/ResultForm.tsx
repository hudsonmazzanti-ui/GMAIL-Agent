import { useState } from 'react';

/** Quick result buttons for a best-of-N match, from player 1's point of view. */
export function resultOptions(bestOf: number, allowDraw: boolean) {
  const win = Math.ceil(bestOf / 2);
  const opts: { label: string; p1Games: number; p2Games: number; draws: number }[] = [];
  for (let l = 0; l < win; l++) opts.push({ label: `${win}-${l}`, p1Games: win, p2Games: l, draws: 0 });
  for (let l = win - 1; l >= 0; l--) opts.push({ label: `${l}-${win}`, p1Games: l, p2Games: win, draws: 0 });
  if (allowDraw) {
    if (bestOf > 1) opts.push({ label: `${win - 1}-${win - 1} draw`, p1Games: win - 1, p2Games: win - 1, draws: 1 });
    opts.push({ label: '0-0 draw', p1Games: 0, p2Games: 0, draws: 1 });
  }
  return opts;
}

export function ResultForm({
  bestOf,
  allowDraw,
  p1Name,
  p2Name,
  initial,
  busy,
  onSubmit,
}: {
  bestOf: number;
  allowDraw: boolean;
  p1Name: string;
  p2Name: string;
  initial?: { p1Games: number; p2Games: number; draws: number };
  busy?: boolean;
  onSubmit: (r: { p1Games: number; p2Games: number; draws: number }) => void;
}) {
  const [custom, setCustom] = useState(initial ?? { p1Games: 0, p2Games: 0, draws: 0 });
  const [showCustom, setShowCustom] = useState(false);
  const options = resultOptions(bestOf, allowDraw);
  return (
    <div className="space-y-3">
      <div className="flex justify-between text-xs font-medium text-slate-500">
        <span className="truncate">{p1Name}</span>
        <span>vs</span>
        <span className="truncate text-right">{p2Name}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {options.map((o) => (
          <button key={o.label} disabled={busy} className="btn-secondary font-mono" onClick={() => onSubmit(o)}>
            {o.label}
          </button>
        ))}
      </div>
      <button className="text-xs text-indigo-600 underline dark:text-indigo-400" onClick={() => setShowCustom(!showCustom)}>
        {showCustom ? 'Hide' : 'Other score…'}
      </button>
      {showCustom && (
        <div className="flex items-end gap-2">
          {(['p1Games', 'p2Games', 'draws'] as const).map((k) => (
            <label key={k} className="flex-1">
              <span className="label">{k === 'p1Games' ? p1Name : k === 'p2Games' ? p2Name : 'Draws'}</span>
              <input
                type="number"
                min={0}
                max={bestOf}
                className="input"
                value={custom[k]}
                onChange={(e) => setCustom({ ...custom, [k]: Number(e.target.value) })}
              />
            </label>
          ))}
          <button disabled={busy} className="btn-primary" onClick={() => onSubmit(custom)}>
            Save
          </button>
        </div>
      )}
    </div>
  );
}
