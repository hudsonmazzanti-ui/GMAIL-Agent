import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../api';
import { ErrorNote } from '../components/ui';
import { useAction, useAuth } from '../hooks';

const pinInput = 'input font-mono tracking-[0.5em]';
const digits = (v: string) => v.replace(/\D/g, '').slice(0, 4);

/** A player's own settings: add, change or remove the PIN that protects their name. */
export function Profile() {
  const { viewer } = useAuth();
  const [hasPin, setHasPin] = useState<boolean | null>(null);
  const [currentPin, setCurrentPin] = useState('');
  const [pin, setPin] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const { busy, error, run } = useAction();

  const load = useCallback(() => api<{ hasPin?: boolean }>('/api/auth/me').then((r) => setHasPin(!!r.hasPin)), []);
  useEffect(() => {
    load();
  }, [load]);

  if (viewer.kind !== 'player') return <Navigate to="/login?next=/me" replace />;
  if (hasPin === null) return null;

  const save = (newPin: string | null) =>
    run(async () => {
      setNotice(null);
      await api('/api/auth/player/pin', { currentPin, pin: newPin });
      setCurrentPin('');
      setPin('');
      setNotice(newPin ? 'PIN saved. You’ll need it next time you log in.' : 'PIN removed. You can log in with just your name.');
      await load();
    });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save(pin);
  };

  return (
    <div className="mx-auto max-w-sm space-y-4">
      <h1 className="text-2xl font-bold">{viewer.name}</h1>
      <form onSubmit={submit} className="card space-y-4">
        <div>
          <h2 className="font-semibold">PIN</h2>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {hasPin
              ? 'Your name is protected: logging in asks for your PIN.'
              : 'Anyone can log in with your name right now. Add a PIN so only you can report your results.'}
          </p>
        </div>
        {hasPin && (
          <label className="block">
            <span className="label">Current PIN</span>
            <input
              id="current-pin"
              className={pinInput}
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              value={currentPin}
              onChange={(e) => setCurrentPin(digits(e.target.value))}
            />
          </label>
        )}
        <label className="block">
          <span className="label">{hasPin ? 'New 4-digit PIN' : '4-digit PIN'}</span>
          <input
            id="new-pin"
            className={pinInput}
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            value={pin}
            onChange={(e) => setPin(digits(e.target.value))}
          />
        </label>
        <ErrorNote error={error} />
        {notice && <p className="text-sm text-emerald-600">{notice}</p>}
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" disabled={busy || pin.length !== 4 || (hasPin && currentPin.length !== 4)}>
            {hasPin ? 'Change PIN' : 'Add PIN'}
          </button>
          {hasPin && (
            <button type="button" className="btn-secondary" disabled={busy || currentPin.length !== 4} onClick={() => save(null)}>
              Remove PIN
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
