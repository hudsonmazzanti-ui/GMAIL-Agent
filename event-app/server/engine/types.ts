/** A finished match as the engine sees it. `p2 === null` means p1 received a bye. */
export interface MatchResult {
  p1: number;
  p2: number | null;
  p1Games: number;
  p2Games: number;
  draws: number;
}

export interface EnginePlayer {
  id: number;
  name: string;
  dropped: boolean;
}

export interface PointsConfig {
  win: number;
  draw: number;
}

export const DEFAULT_POINTS: PointsConfig = { win: 3, draw: 1 };

export interface Pairing {
  p1: number;
  p2: number | null;
}

/** Deterministic, seedable RNG (mulberry32) so pairings can be reproduced in tests. */
export type Rng = () => number;

export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: T[], rng: Rng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
