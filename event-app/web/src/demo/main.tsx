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
  const { backend, fresh } = await DemoBackend.create();
  if (fresh) {
    backend.token = (await seedDemo(backend)).staffToken;
    backend.save();
  }
  installShims(backend);

  root.render(
    <StrictMode>
      <App
        router={({ children }) => <MemoryRouter initialEntries={['/']}>{children}</MemoryRouter>}
        banner={<DemoBar backend={backend} />}
      />
    </StrictMode>,
  );
}

start().catch((e) => {
  document.getElementById('root')!.innerHTML = `<p style="padding:16px">The demo couldn't start: ${String(e?.message ?? e)}</p>`;
  console.error(e);
});
