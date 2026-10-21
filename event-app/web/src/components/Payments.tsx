import { useEffect, useState } from 'react';
import { api, money, type EventState, type PaymentView } from '../api';

const STYLE = {
  paid: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300',
  comp: 'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-300',
  refunded: 'bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-300',
  unpaid: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300',
};

export function paymentLabel(p: PaymentView | null): [string, string] {
  if (!p) return ['Unpaid', STYLE.unpaid];
  if (p.status === 'refunded') return [`Refunded${p.posNumber ? ` · POS #${p.posNumber}` : ''}`, STYLE.refunded];
  if (p.method === 'comp') return ['Comped', STYLE.comp];
  if (p.method === 'cash') return ['Paid · desk', STYLE.paid];
  return [`Paid · POS #${p.posNumber ?? '?'}`, STYLE.paid];
}

export function PaymentBadge({ payment }: { payment: PaymentView | null }) {
  const [label, style] = paymentLabel(payment);
  return <span className={`pill ${style}`}>{label}</span>;
}

/** Desk controls for one player's entry fee. */
export function PaymentActions({
  state,
  playerId,
  payment,
  waitingSince,
  onError,
}: {
  state: EventState;
  playerId: number;
  payment: PaymentView | null;
  waitingSince: number | null;
  onError: (msg: string) => void;
}) {
  const ev = state.event;
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!waitingSince) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [waitingSince]);

  const call = async (path: string, body: unknown, method?: string) => {
    setBusy(true);
    try {
      await api(path, body, method);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const base = `/api/events/${ev.id}/payments`;

  if (payment?.status === 'paid') {
    return (
      <span className="inline-flex items-center gap-1">
        <PaymentBadge payment={payment} />
        <button
          className="text-xs text-slate-400 hover:text-rose-600"
          title={payment.method === 'pos' ? 'Move this POS sale back to unassigned' : 'Undo'}
          disabled={busy}
          onClick={() => confirm('Undo this payment?') && call(`/api/payments/${payment.id}`, undefined, 'DELETE')}
        >
          ✕
        </button>
      </span>
    );
  }

  if (waitingSince) {
    const secs = Math.max(0, Math.round((now + (state.serverNow - Date.now()) - waitingSince) / 1000));
    return (
      <span className="inline-flex flex-wrap items-center gap-2 text-xs">
        <span className="pill animate-pulse bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-300">
          {secs > 180 ? 'No POS sale seen' : `Ring up on POS… ${secs}s`}
        </span>
        <button className="btn-secondary btn-sm" disabled={busy} onClick={() => call(`${base}/cancel-collect`, { playerId })}>
          Cancel
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {payment && <PaymentBadge payment={payment} />}
      {state.payments.onPos && (
        <button className="btn-primary btn-sm" disabled={busy} onClick={() => call(`${base}/collect`, { playerId })}>
          Collect {money(ev.entry_fee_cents, ev.currency)} on POS
        </button>
      )}
      <button className="btn-secondary btn-sm" disabled={busy} onClick={() => call(`${base}/manual`, { playerId, method: 'cash' })}>
        Paid at desk
      </button>
      <button className="btn-secondary btn-sm" disabled={busy} onClick={() => call(`${base}/manual`, { playerId, method: 'comp' })}>
        Comp
      </button>
    </span>
  );
}
