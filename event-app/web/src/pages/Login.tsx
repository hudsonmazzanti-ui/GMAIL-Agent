import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { ErrorNote, Tabs } from '../components/ui';
import { useAction, useAuth } from '../hooks';

type Mode = 'login' | 'signup' | 'staff';

export function Login() {
  const { refresh, staffSetupNeeded } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>((params.get('mode') as Mode) ?? 'login');
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [gameId, setGameId] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, run } = useAction();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      if (mode === 'login') await api('/api/auth/player/login', { name, pin });
      else if (mode === 'signup') await api('/api/auth/player/signup', { name, pin, gameId });
      else await api(staffSetupNeeded ? '/api/auth/staff/setup' : '/api/auth/staff/login', { password });
      await refresh();
      navigate(params.get('next') ?? (mode === 'staff' ? '/staff' : '/'));
    });
  };

  return (
    <div className="mx-auto max-w-sm space-y-4">
      <Tabs<Mode>
        tabs={[
          ['login', 'Player log in'],
          ['signup', 'New player'],
          ['staff', 'Staff'],
        ]}
        value={mode}
        onChange={setMode}
      />
      <form onSubmit={submit} className="card space-y-4">
        {mode === 'staff' ? (
          <>
            {staffSetupNeeded && (
              <p className="text-sm text-slate-600 dark:text-slate-300">
                First run: choose the staff password. Anyone with it can run events, so keep it to your team.
              </p>
            )}
            <label className="block">
              <span className="label">{staffSetupNeeded ? 'New staff password' : 'Staff password'}</span>
              <input className="input" type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
          </>
        ) : (
          <>
            <label className="block">
              <span className="label">Name</span>
              <input
                className="input"
                autoFocus
                autoComplete="username"
                placeholder="e.g. Sam R."
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="label">{mode === 'signup' ? 'Choose a 4-digit PIN' : '4-digit PIN'}</span>
              <input
                className="input font-mono tracking-[0.5em]"
                inputMode="numeric"
                pattern="\d{4}"
                maxLength={4}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                type="password"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              />
            </label>
            {mode === 'signup' && (
              <label className="block">
                <span className="label">Game ID (optional)</span>
                <input className="input" placeholder="Player number for your game" value={gameId} onChange={(e) => setGameId(e.target.value)} />
              </label>
            )}
          </>
        )}
        <ErrorNote error={error} />
        <button className="btn-primary w-full" disabled={busy}>
          {mode === 'login' ? 'Log in' : mode === 'signup' ? 'Create profile' : staffSetupNeeded ? 'Set password' : 'Log in as staff'}
        </button>
        {mode === 'login' && <p className="text-center text-xs text-slate-500">Forgot your PIN? Ask staff to reset it.</p>}
      </form>
    </div>
  );
}
