import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../hooks';

export function Layout() {
  const { viewer, refresh } = useAuth();
  const navigate = useNavigate();
  const logout = async () => {
    await api('/api/auth/logout', {});
    await refresh();
    navigate('/');
  };
  const nav = ({ isActive }: { isActive: boolean }) => `tab ${isActive ? 'tab-active' : ''}`;

  return (
    <div className="min-h-screen">
      <header className="no-print sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-2.5">
          <Link to="/" className="mr-2 flex items-center gap-2 font-bold">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-indigo-600 text-sm text-white">EH</span>
            <span className="hidden sm:inline">Event Hub</span>
          </Link>
          <nav className="flex gap-1">
            <NavLink to="/" end className={nav}>
              Events
            </NavLink>
            {viewer.kind === 'staff' && (
              <NavLink to="/staff" className={nav}>
                Staff
              </NavLink>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-2 text-sm">
            {viewer.kind === 'anon' ? (
              <Link to="/login" className="btn-primary btn-sm">
                Log in
              </Link>
            ) : (
              <>
                <span className="max-w-[9rem] truncate text-slate-600 dark:text-slate-300">
                  {viewer.kind === 'staff' ? 'Staff' : viewer.name}
                </span>
                <button className="btn-secondary btn-sm" onClick={logout}>
                  Log out
                </button>
              </>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-5">
        <Outlet />
      </main>
    </div>
  );
}
