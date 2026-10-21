import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import base from './vite.config';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Swap Node-only modules for browser stand-ins so the real server code runs in the demo. */
function browserServer(): Plugin {
  const dbClient = path.join(here, 'server/db/client.ts');
  return {
    name: 'event-hub-demo-server',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (source === 'node:crypto' || source === 'crypto') return path.join(here, 'web/src/demo/node-crypto.ts');
      if (!importer || !source.includes('db/client')) return null;
      const resolved = await this.resolve(source.replace(/\.js$/, '.ts'), importer, { ...options, skipSelf: true });
      return resolved?.id === dbClient ? path.join(here, 'web/src/demo/db.ts') : null;
    },
  };
}

/**
 * Browser-only demo: one self-contained HTML file with the server routes, SQLite (sql.js) and a
 * fake PayPal POS running in the page. `npm run build:demo` → web/dist-demo/demo.html.
 */
export default mergeConfig(
  base,
  defineConfig({
    mode: 'demo',
    plugins: [browserServer(), viteSingleFile()],
    build: {
      outDir: 'dist-demo',
      emptyOutDir: true,
      rollupOptions: { input: path.join(here, 'web/demo.html') },
    },
  }),
);
