import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: 'web',
  plugins: [react()],
  css: {
    postcss: {
      plugins: [tailwindcss({ config: path.join(here, 'tailwind.config.js') }), autoprefixer()],
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    host: true,
    proxy: { '/api': 'http://localhost:3000' },
  },
});
