import { describe, expect, it } from 'vitest';
import { computeStandings } from '../server/engine/standings.js';
import { pairSwissRound, recommendedRounds } from '../server/engine/swiss.js';
import { makeRng, type MatchResult } from '../server/engine/types.js';

function simulate(count: number, rounds: number, seed: number, drops: Record<number, number[]> = {}) {
  const rng = makeRng(seed);
  const players = Array.from({ length: count }, (_, i) => ({ id: i + 1, name: `P${i + 1}`, dropped: false }));
  const history: MatchResult[] = [];
  const perRound: MatchResult[][] = [];
  let rematches = false;
  for (let r = 1; r <= rounds; r++) {
    for (const id of drops[r] ?? []) players.find((p) => p.id === id)!.dropped = true;
    const standings = computeStandings(players, history);
    const active = standings.filter((s) => !s.dropped).map((s) => ({ id: s.playerId, matchPoints: s.matchPoints }));
    const { pairings, rematchesAllowed } = pairSwissRound({ players: active, history, rng });
    rematches ||= rematchesAllowed;
    const results = pairings.map((p): MatchResult => {
      if (p.p2 === null) return { p1: p.p1, p2: null, p1Games: 2, p2Games: 0, draws: 0 };
      const roll = rng();
      if (roll < 0.1) return { p1: p.p1, p2: p.p2, p1Games: 1, p2Games: 1, draws: 1 };
      return roll < 0.55
        ? { p1: p.p1, p2: p.p2, p1Games: 2, p2Games: rng() < 0.5 ? 0 : 1, draws: 0 }
        : { p1: p.p1, p2: p.p2, p1Games: rng() < 0.5 ? 0 : 1, p2Games: 2, draws: 0 };
    });
    perRound.push(results);
    history.push(...results);
  }
  return { history, perRound, rematches, players };
}

const key = (a: number, b: number) => [a, b].sort((x, y) => x - y).join('-');

describe('pairSwissRound', () => {
  for (const [count, rounds] of [[8, 5], [13, 5], [32, 6], [9, 4]] as const) {
    it(`never rematches with ${count} players over ${rounds} rounds`, () => {
      for (let seed = 1; seed <= 25; seed++) {
        const { history, perRound, rematches } = simulate(count, rounds, seed);
        expect(rematches).toBe(false);
        const seen = new Set<string>();
        for (const m of history) {
          if (m.p2 === null) continue;
          const k = key(m.p1, m.p2);
          expect(seen.has(k)).toBe(false);
          seen.add(k);
        }
        for (const round of perRound) {
          const ids = round.flatMap((m) => (m.p2 === null ? [m.p1] : [m.p1, m.p2]));
          expect(new Set(ids).size).toBe(count);
        }
      }
    });
  }

  it('gives at most one bye per player and the bye goes to a low scorer', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const { perRound } = simulate(13, 5, seed);
      const byes = perRound.flatMap((r) => r.filter((m) => m.p2 === null).map((m) => m.p1));
      expect(byes).toHaveLength(5);
      expect(new Set(byes).size).toBe(5);
    }
  });

  it('awards the round-2 bye to someone on the lowest score', () => {
    const rng = makeRng(7);
    const players = [1, 2, 3, 4, 5].map((id) => ({ id, name: `P${id}`, dropped: false }));
    const history: MatchResult[] = [
      { p1: 1, p2: 2, p1Games: 2, p2Games: 0, draws: 0 },
      { p1: 3, p2: 4, p1Games: 2, p2Games: 0, draws: 0 },
      { p1: 5, p2: null, p1Games: 2, p2Games: 0, draws: 0 },
    ];
    const standings = computeStandings(players, history);
    const { pairings } = pairSwissRound({
      players: standings.map((s) => ({ id: s.playerId, matchPoints: s.matchPoints })),
      history,
      rng,
    });
    const bye = pairings.find((p) => p.p2 === null)!;
    expect([2, 4]).toContain(bye.p1);
  });

  it('pairs players with equal points together when possible', () => {
    const rng = makeRng(3);
    const history: MatchResult[] = [
      { p1: 1, p2: 2, p1Games: 2, p2Games: 0, draws: 0 },
      { p1: 3, p2: 4, p1Games: 2, p2Games: 0, draws: 0 },
      { p1: 5, p2: 6, p1Games: 2, p2Games: 0, draws: 0 },
      { p1: 7, p2: 8, p1Games: 2, p2Games: 0, draws: 0 },
    ];
    const players = [1, 3, 5, 7, 2, 4, 6, 8].map((id) => ({ id, matchPoints: id % 2 ? 3 : 0 }));
    const { pairings } = pairSwissRound({ players, history, rng });
    for (const p of pairings) expect((p.p1 % 2) === (p.p2! % 2)).toBe(true);
  });

  it('skips dropped players', () => {
    const { perRound } = simulate(10, 4, 11, { 2: [3], 3: [7, 8] });
    const ids = (r: MatchResult[]) => r.flatMap((m) => (m.p2 === null ? [m.p1] : [m.p1, m.p2]));
    expect(ids(perRound[1])).not.toContain(3);
    expect(ids(perRound[1])).toHaveLength(9);
    expect(ids(perRound[2])).toHaveLength(7);
    expect(ids(perRound[3])).not.toContain(8);
  });

  it('falls back to a rematch only when unavoidable', () => {
    const history: MatchResult[] = [{ p1: 1, p2: 2, p1Games: 2, p2Games: 0, draws: 0 }];
    const res = pairSwissRound({ players: [{ id: 1, matchPoints: 3 }, { id: 2, matchPoints: 0 }], history, rng: makeRng(1) });
    expect(res.rematchesAllowed).toBe(true);
    expect(res.pairings).toEqual([{ p1: 1, p2: 2 }]);
  });

  it('recommends rounds by player count', () => {
    expect(recommendedRounds(8)).toBe(3);
    expect(recommendedRounds(13)).toBe(4);
    expect(recommendedRounds(32)).toBe(5);
    expect(recommendedRounds(64)).toBe(6);
  });
});
