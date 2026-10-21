import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { api, type Viewer } from './api';
import { Layout } from './components/Layout';
import { AuthContext } from './hooks';
import { Display } from './pages/Display';
import { EventList } from './pages/EventList';
import { EventPage } from './pages/EventPage';
import { Login } from './pages/Login';
import { PrintSlips } from './pages/PrintSlips';
import { StaffEvent } from './pages/StaffEvent';
import { StaffHome } from './pages/StaffHome';
import './index.css';

function App() {
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
      <BrowserRouter>
        <Routes>
          <Route path="/display/:id" element={<Display />} />
          <Route path="/print/:id" element={<PrintSlips />} />
          <Route element={<Layout />}>
            <Route path="/" element={<EventList />} />
            <Route path="/login" element={<Login />} />
            <Route path="/events/:id" element={<EventPage />} />
            <Route path="/staff" element={<StaffHome />} />
            <Route path="/staff/events/:id" element={<StaffEvent />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthContext.Provider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
