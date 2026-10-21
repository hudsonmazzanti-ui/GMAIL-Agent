import { describe, expect, it } from 'vitest';
import { computeStandings } from '../server/engine/standings.js';

const players = [
  { id: 1, name: 'Alice', dropped: false },
  { id: 2, name: 'Bob', dropped: false },
  { id: 3, name: 'Cara', dropped: false },
  { id: 4, name: 'Dev', dropped: true },
];

describe('computeStandings', () => {
  // R1: Alice 2-0 Bob, Cara 2-1 Dev. R2: Alice 2-1 Cara, Bob 1-1 Dev (drawn match).
  const matches = [
    { p1: 1, p2: 2, p1Games: 2, p2Games: 0, draws: 0 },
    { p1: 3, p2: 4, p1Games: 2, p2Games: 1, draws: 0 },
    { p1: 1, p2: 3, p1Games: 2, p2Games: 1, draws: 0 },
    { p1: 2, p2: 4, p1Games: 1, p2Games: 1, draws: 0 },
  ];

  it('matches hand-computed tiebreakers', () => {
    const rows = computeStandings(players, matches);
    const byId = Object.fromEntries(rows.map((r) => [r.playerId, r]));

    expect(byId[1]).toMatchObject({ matchPoints: 6, wins: 2, losses: 0, draws: 0 });
    expect(byId[1].mwp).toBeCloseTo(1);
    expect(byId[1].gwp).toBeCloseTo(12 / 15);
    expect(byId[1].omw).toBeCloseTo((1 / 3 + 0.5) / 2);

    expect(byId[2].matchPoints).toBe(1);
    expect(byId[2].mwp).toBeCloseTo(1 / 3); // 1/6 floored to 33%
    expect(byId[2].gwp).toBeCloseTo(1 / 3); // 3/12 floored
    expect(byId[2].omw).toBeCloseTo((1 + 1 / 3) / 2);

    expect(byId[3].gwp).toBeCloseTo(0.5);
    expect(byId[3].omw).toBeCloseTo((1 / 3 + 1) / 2);
    expect(byId[4].gwp).toBeCloseTo(6 / 15);
    expect(byId[4].ogw).toBeCloseTo((0.5 + 1 / 3) / 2);
  });

  it('orders by points then OMW, and keeps dropped players ranked', () => {
    const rows = computeStandings(players, matches);
    expect(rows.map((r) => r.name)).toEqual(['Alice', 'Cara', 'Bob', 'Dev']);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
    expect(rows[3].dropped).toBe(true);
  });

  it('counts a bye as a 2-0 win that does not affect opponents', () => {
    const rows = computeStandings(players.slice(0, 3), [
      { p1: 1, p2: null, p1Games: 2, p2Games: 0, draws: 0 },
      { p1: 2, p2: 3, p1Games: 0, p2Games: 2, draws: 0 },
    ]);
    const alice = rows.find((r) => r.playerId === 1)!;
    expect(alice).toMatchObject({ matchPoints: 3, wins: 1, byes: 1, opponents: [] });
    expect(alice.gwp).toBeCloseTo(1);
    expect(alice.omw).toBe(0);
    // Cara (beat Bob) outranks Alice (bye) on OMW.
    expect(rows.map((r) => r.name)).toEqual(['Cara', 'Alice', 'Bob']);
  });

  it('gives everyone the floor before any matches', () => {
    const rows = computeStandings(players, []);
    expect(rows.every((r) => r.matchPoints === 0 && r.mwp === 1 / 3)).toBe(true);
  });
});
