import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../server/app.js';
import { Client, DEMO_NAMES, runDemoEvent } from './demo.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH ?? path.join(here, '..', 'data', 'events.db');
const password = process.env.STAFF_PASSWORD ?? 'changeme';

const { app } = await buildApp({ dbPath });
const { eventId, state, staff } = await runDemoEvent(app, { staffPassword: password });
console.log(`✔ Completed demo event #${eventId}: ${state.rounds.length} rounds, champion ${state.champion.name}`);

// A second event left open for registration so you can try the UI.
const { id: openId } = await staff.post('/api/events', {
  name: 'Saturday Open',
  game: 'Any TCG',
  format: 'Sealed',
  date: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
  startTime: '12:00',
  capacity: 32,
  topCutSize: 4,
});
await staff.post(`/api/events/${openId}/status`, { status: 'registration' });
for (const name of DEMO_NAMES.slice(0, 7)) {
  const c = new Client(app);
  await c.post('/api/auth/player/login', { name, pin: '1234' });
  await c.post(`/api/events/${openId}/register`);
}
console.log(`✔ Created "Saturday Open" (#${openId}) with 7 registered players`);
console.log(`\nStaff password: ${password}   Demo player PIN: 1234 (e.g. "${DEMO_NAMES[0]}")`);
await app.close();
