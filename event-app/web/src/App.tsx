import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Route, Routes } from 'react-router-dom';
import { api, type Viewer } from './api';
import { DialogHost } from './components/Dialog';
import { Layout } from './components/Layout';
import { AuthContext } from './hooks';
import { Display } from './pages/Display';
import { EventList } from './pages/EventList';
import { EventPage } from './pages/EventPage';
import { Join } from './pages/Join';
import { Login } from './pages/Login';
import { PrintSlips } from './pages/PrintSlips';
import { Profile } from './pages/Profile';
import { StaffEvent } from './pages/StaffEvent';
import { StaffHome } from './pages/StaffHome';

/** The whole app, minus the router (the store install uses URLs; the demo keeps routes in memory). */
export function App({ router: Router, banner }: { router: (p: { children: ReactNode }) => ReactNode; banner?: ReactNode }) {
  const [auth, setAuth] = useState<{ viewer: Viewer; staffSetupNeeded: boolean } | null>(null);
  const refresh = useCallback(async () => {
    setAuth(await api('/api/auth/me'));
  }, []);
  useEffect(() => {
    refresh().catch(() => setAuth({ viewer: { kind: 'anon' }, staffSetupNeeded: false }));
  }, [refresh]);
  if (!auth) return null;

  return (
    <AuthContext.Provider value={{ ...auth, refresh }}>
      <Router>
        {banner}
        <Routes>
          <Route path="/display/:id" element={<Display />} />
          <Route path="/print/:id" element={<PrintSlips />} />
          <Route element={<Layout />}>
            <Route path="/" element={<EventList />} />
            <Route path="/login" element={<Login />} />
            <Route path="/me" element={<Profile />} />
            <Route path="/join/:code" element={<Join />} />
            <Route path="/events/:id" element={<EventPage />} />
            <Route path="/staff" element={<StaffHome />} />
            <Route path="/staff/events/:id" element={<StaffEvent />} />
          </Route>
        </Routes>
      </Router>
      <DialogHost />
    </AuthContext.Provider>
  );
}
