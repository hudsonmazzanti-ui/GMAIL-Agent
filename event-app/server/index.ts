import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import qrcode from 'qrcode-terminal';
import { buildApp } from './app.js';
import { broadcast } from './live.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const DB_PATH = process.env.DB_PATH ?? path.join(here, '..', 'data', 'events.db');

function lanAddresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i): i is os.NetworkInterfaceInfo => !!i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

const urls = lanAddresses().map((ip) => `http://${ip}:${PORT}`);
const publicUrls = process.env.PUBLIC_URL ? [process.env.PUBLIC_URL.replace(/\/$/, ''), ...urls] : urls;
const { app, pos } = await buildApp({ dbPath: DB_PATH, publicUrls, publicUrlConfigured: !!process.env.PUBLIC_URL });
await app.listen({ port: PORT, host: '0.0.0.0' });
// Pull PayPal POS sales in the background (no-op until a POS API key is saved).
pos.startPolling((eventIds) => eventIds.forEach(broadcast));

console.log(`\n  Event app running.  Database: ${DB_PATH}\n`);
console.log(`  On this computer:   http://localhost:${PORT}`);
for (const url of urls) console.log(`  On the store Wi-Fi: ${url}`);
if (process.env.PUBLIC_URL) console.log(`  Public address:     ${publicUrls[0]}`);
if (publicUrls[0]) {
  console.log('\n  Players can scan this to open the app:\n');
  qrcode.generate(publicUrls[0], { small: true });
}
console.log(`  Staff dashboard:    http://localhost:${PORT}/staff\n`);
