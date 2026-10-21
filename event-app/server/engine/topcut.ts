import type { Pairing } from './types.js';

/**
 * Seed positions for a single-elimination bracket of `size` (a power of two), in bracket
 * order, so that seeds 1 and 2 can only meet in the final. For 8: [1,8,4,5,2,7,3,6].
 */
export function bracketOrder(size: number): number[] {
  let seeds = [1];
  while (seeds.length < size) {
    const n = seeds.length * 2 + 1;
    seeds = seeds.flatMap((s) => [s, n - s]);
  }
  return seeds;
}

/**
 * First round of the top cut. `seededPlayerIds` is ordered by final Swiss standing.
 * If fewer players than `cutSize` are eligible, the bracket shrinks to the next power of
 * two and the top seeds receive byes (p2 = null).
 */
export function seedTopCut(seededPlayerIds: number[], cutSize: number): Pairing[] {
  const count = Math.min(seededPlayerIds.length, cutSize);
  if (count < 2) throw new Error('Top cut needs at least 2 players');
  let size = 1;
  while (size < count) size *= 2;
  const order = bracketOrder(size);
  const pairings: Pairing[] = [];
  for (let i = 0; i < order.length; i += 2) {
    const a = order[i] <= count ? seededPlayerIds[order[i] - 1] : null;
    const b = order[i + 1] <= count ? seededPlayerIds[order[i + 1] - 1] : null;
    // The higher seed is always p1; the lower seed slot may be a bye.
    pairings.push({ p1: a!, p2: b });
  }
  return pairings;
}

/** Next bracket round from the winners of the previous round, in bracket (table) order. */
export function nextTopCutRound(winnersInBracketOrder: number[]): Pairing[] {
  if (winnersInBracketOrder.length < 2) return [];
  const pairings: Pairing[] = [];
  for (let i = 0; i < winnersInBracketOrder.length; i += 2) {
    pairings.push({ p1: winnersInBracketOrder[i], p2: winnersInBracketOrder[i + 1] });
  }
  return pairings;
}

/** Winner of a top-cut match; draws are not allowed in elimination rounds. */
export function matchWinner(m: { p1: number; p2: number | null; p1Games: number; p2Games: number }): number {
  if (m.p2 === null) return m.p1;
  if (m.p1Games === m.p2Games) throw new Error('Top cut matches need a winner');
  return m.p1Games > m.p2Games ? m.p1 : m.p2;
}
