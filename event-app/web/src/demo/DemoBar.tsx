import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { money } from '../api';
import { ask } from '../components/Dialog';
import { useAuth } from '../hooks';
import { DemoBackend } from './backend';
import { DEMO_PIN } from './seed';

/** Demo controls: switch who you are, ring up sales on the fake PayPal POS, start over. */
export function DemoBar({ backend, staffToken }: { backend: DemoBackend; staffToken: string }) {
  const { viewer, refresh } = useAuth();
  const navigate = useNavigate();
  const [players, setPlayers] = useState<{ id: number; name: string }[]>([]);
  const [posOpen, setPosOpen] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    const load = () =>
      setPlayers(backend.db.prepare('SELECT id, name FROM players ORDER BY name COLLATE NOCASE').all() as { id: number; name: string }[]);
    load();
    return backend.subscribe(() => {
      load();
      setTick((t) => t + 1);
    });
  }, [backend]);

  const current = viewer.kind === 'staff' ? 'staff' : viewer.kind === 'player' ? String(viewer.playerId) : 'anon';

  const switchTo = async (value: string) => {
    if (value === 'staff') backend.token = staffToken;
    else if (value === 'anon') backend.token = null;
    else {
      const token = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
      backend.db.prepare("INSERT INTO sessions (token, kind, player_id) VALUES (?, 'player', ?)").run(token, Number(value));
      backend.token = token;
    }
    backend.save();
    await refresh();
    navigate(value === 'staff' ? '/staff' : '/');
  };

  const reset = async () => {
    if (!(await ask('Start the demo over? Everything you changed is cleared.', { confirmLabel: 'Start over', danger: true }))) return;
    DemoBackend.clearSaved();
    location.reload();
  };

  const products = [...backend.pos.products.values()];
  const sales = [...backend.pos.purchases].reverse().slice(0, 8);

  return (
    <div className="no-print border-b border-amber-300 bg-amber-50 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-100">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2">
        <span className="pill bg-amber-200 font-semibold text-amber-900 dark:bg-amber-800 dark:text-amber-100">Demo</span>
        <label className="flex items-center gap-2">
          <span>Viewing as</span>
          <select
            id="demo-viewer"
            className="input w-auto py-1"
            value={current}
            onChange={(e) => switchTo(e.target.value)}
          >
            <option value="staff">Staff</option>
            <option value="anon">Visitor (logged out)</option>
            <optgroup label="Players">
              {players.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <button className="btn-secondary btn-sm" onClick={() => setPosOpen(!posOpen)} aria-expanded={posOpen}>
          {posOpen ? 'Hide' : 'Open'} fake PayPal POS
        </button>
        <button className="btn-secondary btn-sm ml-auto" onClick={reset}>
          Start over
        </button>
      </div>
      {posOpen && (
        <div className="mx-auto grid max-w-5xl gap-4 px-4 pb-3 sm:grid-cols-2">
          <div className="space-y-2">
            <p className="text-xs">
              Stands in for the store's PayPal POS. Press <b>Collect on POS</b> next to a player at the check-in desk, then ring the entry
              up here. It's matched within a few seconds.
            </p>
            {products.length === 0 && <p className="text-xs italic">No products yet. Use “Add to PayPal POS” on an event's Payments tab.</p>}
            {products.map((p) => (
              <div key={p.uuid} className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">
                  {p.name} · {money(p.variants[0].price.amount, p.variants[0].price.currencyId)}
                </span>
                {[1, 2].map((q) => (
                  <button
                    key={q}
                    className="btn-primary btn-sm"
                    onClick={() => {
                      backend.pos.sale([{ productUuid: p.uuid, quantity: q }]);
                      backend.changed();
                    }}
                  >
                    Ring up ×{q}
                  </button>
                ))}
              </div>
            ))}
          </div>
          <div className="space-y-1">
            <div className="label">Recent POS sales</div>
            {sales.length === 0 && <p className="text-xs italic">None yet.</p>}
            {sales.map((s) => (
              <div key={s.purchaseUUID1} className="flex items-center gap-2 text-xs tabular-nums">
                <span className="flex-1">
                  #{s.purchaseNumber} · {new Date(s.timestamp!).toLocaleTimeString()} · {money(s.amount!, s.currency!)}
                  {s.refund && ' · refund'}
                  {s.refunded && ' · refunded'}
                </span>
                {!s.refund && !s.refunded && (
                  <button
                    className="btn-secondary btn-sm"
                    onClick={() => {
                      backend.pos.refund(s.purchaseUUID1!);
                      backend.changed();
                    }}
                  >
                    Refund
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="sr-only">Demo players log in with PIN {DEMO_PIN}. Any staff password works.</p>
    </div>
  );
}
