import { shuffle, type MatchResult, type Pairing, type Rng } from './types.js';

export interface SwissInput {
  /** Active (not dropped) players, ordered best-first by current standings. */
  players: { id: number; matchPoints: number }[];
  /** Every previous match in the event (Swiss only). */
  history: MatchResult[];
  rng: Rng;
}

export interface SwissResult {
  pairings: Pairing[];
  /** True if no rematch-free pairing existed and a rematch had to be allowed. */
  rematchesAllowed: boolean;
}

/** Recommended number of Swiss rounds for a player count. */
export function recommendedRounds(playerCount: number): number {
  if (playerCount <= 2) return 1;
  if (playerCount <= 4) return 2;
  if (playerCount <= 8) return 3;
  if (playerCount <= 16) return 4;
  if (playerCount <= 32) return 5;
  if (playerCount <= 64) return 6;
  if (playerCount <= 128) return 7;
  if (playerCount <= 226) return 8;
  return 9;
}

const pairKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

/**
 * Pair a Swiss round.
 * - Round 1: random.
 * - Later rounds: players sorted by match points (random within a point group), each
 *   player is paired with the closest-ranked opponent they haven't played, pairing down
 *   when a group is odd. Backtracking guarantees no rematches whenever that is possible.
 * - Odd player count: the bye goes to the lowest-ranked player without a previous bye.
 */
export function pairSwissRound({ players, history, rng }: SwissInput): SwissResult {
  const played = new Set<string>();
  const hadBye = new Set<number>();
  for (const m of history) {
    if (m.p2 === null) hadBye.add(m.p1);
    else played.add(pairKey(m.p1, m.p2));
  }

  let order: number[];
  if (history.length === 0) {
    order = shuffle(players.map((p) => p.id), rng);
  } else {
    const groups = new Map<number, number[]>();
    for (const p of players) {
      if (!groups.has(p.matchPoints)) groups.set(p.matchPoints, []);
      groups.get(p.matchPoints)!.push(p.id);
    }
    order = [...groups.keys()].sort((a, b) => b - a).flatMap((pts) => shuffle(groups.get(pts)!, rng));
  }

  const attempt = (allowRematch: boolean): Pairing[] | null => {
    if (order.length % 2 === 0) {
      const pairs = pairAll(order, played, allowRematch);
      return pairs;
    }
    // Bye candidates: lowest-ranked first, preferring players who have not had a bye.
    const fromBottom = order.slice().reverse();
    const candidates = [...fromBottom.filter((id) => !hadBye.has(id)), ...fromBottom.filter((id) => hadBye.has(id))];
    for (const byeId of candidates) {
      const pairs = pairAll(order.filter((id) => id !== byeId), played, allowRematch);
      if (pairs) return [...pairs, { p1: byeId, p2: null }];
    }
    return null;
  };

  const strict = attempt(false);
  if (strict) return { pairings: strict, rematchesAllowed: false };
  return { pairings: attempt(true)!, rematchesAllowed: true };
}

/** Backtracking matcher: always pairs the highest remaining player with the nearest legal opponent. */
function pairAll(order: number[], played: Set<string>, allowRematch: boolean): Pairing[] | null {
  const used = new Array(order.length).fill(false);
  const result: Pairing[] = [];
  let budget = 500_000;

  const solve = (): boolean => {
    if (--budget < 0) return false;
    const i = used.indexOf(false);
    if (i === -1) return true;
    used[i] = true;
    for (let j = i + 1; j < order.length; j++) {
      if (used[j]) continue;
      if (!allowRematch && played.has(pairKey(order[i], order[j]))) continue;
      used[j] = true;
      result.push({ p1: order[i], p2: order[j] });
      if (solve()) return true;
      result.pop();
      used[j] = false;
    }
    used[i] = false;
    return false;
  };

  return solve() ? result : null;
}
