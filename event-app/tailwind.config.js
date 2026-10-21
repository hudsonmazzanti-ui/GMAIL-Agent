import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('tailwindcss').Config} */
export default {
  content: [path.join(here, 'web/index.html'), path.join(here, 'web/src/**/*.{ts,tsx}')],
  // Follow the OS theme unless the page sets data-theme="light"/"dark" on <html> (the demo's host does),
  // and force dark inside any `.dark` element (the projector view).
  darkMode: [
    'variant',
    [
      '@media (prefers-color-scheme: dark) { &:not(:where([data-theme="light"], [data-theme="light"] *)) }',
      '&:where([data-theme="dark"], [data-theme="dark"] *)',
      '&:where(.dark, .dark *)',
    ],
  ],
  theme: { extend: {} },
  plugins: [],
};
