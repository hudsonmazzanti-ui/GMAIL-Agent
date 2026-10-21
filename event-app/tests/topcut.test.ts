import { describe, expect, it } from 'vitest';
import { bracketOrder, matchWinner, nextTopCutRound, seedTopCut } from '../server/engine/topcut.js';
import * as timer from '../server/engine/timer.js';

describe('top cut', () => {
  it('seeds a top 8 so 1 and 2 meet only in the final', () => {
    expect(bracketOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    const ids = [101, 102, 103, 104, 105, 106, 107, 108];
    expect(seedTopCut(ids, 8)).toEqual([
      { p1: 101, p2: 108 },
      { p1: 104, p2: 105 },
      { p1: 102, p2: 107 },
      { p1: 103, p2: 106 },
    ]);
  });

  it('gives top seeds byes when fewer players are eligible than the cut', () => {
    const pairings = seedTopCut([1, 2, 3, 4, 5], 8);
    expect(pairings).toEqual([
      { p1: 1, p2: null },
      { p1: 4, p2: 5 },
      { p1: 2, p2: null },
      { p1: 3, p2: null },
    ]);
  });

  it('runs a full top 8 to a champion', () => {
    let round = seedTopCut([1, 2, 3, 4, 5, 6, 7, 8], 8);
    // Higher seed (lower id) always wins, except 7 upsets 2 in the quarterfinals.
    const play = (ps: typeof round) =>
      ps.map((p) => {
        const upset = p.p1 === 2 && p.p2 === 7;
        return matchWinner({ p1: p.p1, p2: p.p2, p1Games: upset ? 1 : 2, p2Games: upset ? 2 : 0 });
      });
    let winners = play(round);
    expect(winners).toEqual([1, 4, 7, 3]);
    round = nextTopCutRound(winners);
    expect(round).toEqual([{ p1: 1, p2: 4 }, { p1: 7, p2: 3 }]);
    winners = play(round);
    round = nextTopCutRound(winners);
    expect(round).toEqual([{ p1: 1, p2: 7 }]);
    expect(nextTopCutRound(play(round))).toEqual([]);
  });

  it('rejects draws in elimination rounds', () => {
    expect(() => matchWinner({ p1: 1, p2: 2, p1Games: 1, p2Games: 1 })).toThrow();
  });
});

describe('timer', () => {
  it('starts, pauses, resumes and adds time', () => {
    let t = timer.newTimer(50 * 60_000);
    expect(timer.remaining(t, 0)).toBe(3_000_000);
    t = timer.start(t, 1000);
    expect(timer.remaining(t, 61_000)).toBe(3_000_000 - 60_000);
    t = timer.pause(t, 61_000);
    expect(timer.isRunning(t)).toBe(false);
    expect(timer.remaining(t, 999_999)).toBe(2_940_000);
    t = timer.addTime(t, 60_000, 0);
    t = timer.start(t, 100_000);
    expect(timer.remaining(t, 100_000)).toBe(3_000_000);
    expect(timer.remaining(t, 10_000_000)).toBe(0);
  });
});
