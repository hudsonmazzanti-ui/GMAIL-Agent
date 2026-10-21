/** True in the browser-only demo build (`npm run build:demo`), which has no real server. */
export const DEMO = import.meta.env.MODE === 'demo';
