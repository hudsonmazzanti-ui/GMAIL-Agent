import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { ErrorNote } from '../components/ui';
import { useAction, useAuth } from '../hooks';

/**
 * Players type their name and continue: a new name becomes a new player, and a PIN is asked
 * for only if that player set one. Staff use the small link underneath.
 */
export function Login() {
  const { refresh, staffSetupNeeded } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [staff, setStaff] = useState(params.get('mode') === 'staff');
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [password, setPassword] = useState('');
  const [needsPin, setNeedsPin] = useState(false);
  const { busy, error, setError, run } = useAction();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      if (staff) await api(staffSetupNeeded ? '/api/auth/staff/setup' : '/api/auth/staff/login', { password });
      else {
        const res = await api<{ ok: boolean; needsPin?: boolean }>('/api/auth/player/login', { name, pin, createIfMissing: true });
        if (res.needsPin) {
          setNeedsPin(true);
          return;
        }
      }
      await refresh();
      navigate(params.get('next') ?? (staff ? '/staff' : '/'));
    });
  };

  return (
    <div className="mx-auto max-w-sm space-y-4 pt-4">
      <form onSubmit={submit} className="card space-y-4">
        {staff ? (
          <>
            <h1 className="text-xl font-bold">Staff</h1>
            {staffSetupNeeded && (
              <p className="text-sm text-slate-600 dark:text-slate-300">
                First run: choose the staff password. Anyone with it can run events, so keep it to your team.
              </p>
            )}
            <label className="block">
              <span className="label">{staffSetupNeeded ? 'New staff password' : 'Staff password'}</span>
              <input id="staff-password" className="input" type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold">What's your name?</h1>
            <label className="block">
              <span className="sr-only">Your name</span>
              <input
                id="player-name"
                className="input py-3 text-lg"
                autoFocus
                autoComplete="username"
                placeholder="e.g. Sam R."
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setNeedsPin(false);
                  setPin('');
                }}
              />
              <span className="mt-1 block text-xs text-slate-500">First time? Just type your name; that's your profile.</span>
            </label>
            {needsPin && (
              <label className="block">
                <span className="label">Your 4-digit PIN</span>
                <input
                  id="player-pin"
                  className="input font-mono tracking-[0.5em]"
                  inputMode="numeric"
                  pattern="\d{4}"
                  maxLength={4}
                  autoFocus
                  autoComplete="current-password"
                  type="password"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                />
                <span className="mt-1 block text-xs text-slate-500">Forgot it? Ask staff to reset it.</span>
              </label>
            )}
          </>
        )}
        <ErrorNote error={error} />
        <button className="btn-primary w-full py-3 text-base" disabled={busy || (staff ? !password : name.trim().length < 2)}>
          {staff ? (staffSetupNeeded ? 'Set password' : 'Log in') : 'Continue'}
        </button>
      </form>
      <p className="text-center text-xs text-slate-500">
        <button
          type="button"
          className="underline"
          onClick={() => {
            setStaff(!staff);
            setError(null);
          }}
        >
          {staff ? "I'm a player" : 'Staff log in'}
        </button>
      </p>
    </div>
  );
}
