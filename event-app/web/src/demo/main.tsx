import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../App';
import '../index.css';
import { DemoBackend, installShims } from './backend';
import { DemoBar } from './DemoBar';
import { seedDemo } from './seed';

const root = createRoot(document.getElementById('root')!);

async function start() {
  let { backend, fresh } = await DemoBackend.create();
  let staffToken: string;
  if (fresh) {
    staffToken = (await seedDemo(backend)).staffToken;
    backend.token = staffToken;
    backend.db.exec(`INSERT OR REPLACE INTO settings (key, value) VALUES ('demo_staff_token', '${staffToken}')`);
    backend.save();
  } else {
    const row = backend.db.prepare("SELECT value FROM settings WHERE key = 'demo_staff_token'").get() as { value: string } | undefined;
    if (!row) {
      // Saved data from an older demo: start fresh.
      DemoBackend.clearSaved();
      ({ backend } = await DemoBackend.create());
      staffToken = (await seedDemo(backend)).staffToken;
      backend.token = staffToken;
    } else staffToken = row.value;
  }
  installShims(backend);

  root.render(
    <StrictMode>
      <App
        router={({ children }) => <MemoryRouter initialEntries={['/']}>{children}</MemoryRouter>}
        banner={<DemoBar backend={backend} staffToken={staffToken} />}
      />
    </StrictMode>,
  );
}

start().catch((e) => {
  document.getElementById('root')!.innerHTML = `<p style="padding:16px">The demo couldn't start: ${String(e?.message ?? e)}</p>`;
  console.error(e);
});
