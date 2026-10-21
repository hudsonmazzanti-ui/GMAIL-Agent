import { DEFAULT_POINTS, type EnginePlayer, type MatchResult, type PointsConfig } from './types.js';

/** Tiebreaker percentages never drop below this floor (standard TCG rule). */
export const PERCENT_FLOOR = 1 / 3;

export interface StandingRow {
  rank: number;
  playerId: number;
  name: string;
  dropped: boolean;
  matchPoints: number;
  wins: number;
  losses: number;
  draws: number;
  byes: number;
  matchesPlayed: number;
  /** Match-win percentage (floored), used by opponents' OMW. */
  mwp: number;
  /** Opponents' match-win percentage. */
  omw: number;
  /** Game-win percentage (floored). */
  gwp: number;
  /** Opponents' game-win percentage. */
  ogw: number;
  opponents: number[];
}

interface Tally {
  matchPoints: number;
  wins: number;
  losses: number;
  draws: number;
  byes: number;
  matchesPlayed: number;
  gamePoints: number;
  gamesPlayed: number;
  opponents: number[];
}

function emptyTally(): Tally {
  return { matchPoints: 0, wins: 0, losses: 0, draws: 0, byes: 0, matchesPlayed: 0, gamePoints: 0, gamesPlayed: 0, opponents: [] };
}

function recordSide(t: Tally, mine: number, theirs: number, draws: number, points: PointsConfig) {
  t.matchesPlayed++;
  if (mine > theirs) {
    t.wins++;
    t.matchPoints += points.win;
  } else if (mine < theirs) {
    t.losses++;
  } else {
    t.draws++;
    t.matchPoints += points.draw;
  }
  t.gamePoints += mine * points.win + draws * points.draw;
  t.gamesPlayed += mine + theirs + draws;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/**
 * Compute Swiss standings. Order: match points, OMW%, GW%, OGW%, then name.
 * Byes count as a 2-0 match win but are not included in opponents' percentages.
 * Dropped players still count in their past opponents' tiebreakers.
 */
export function computeStandings(
  players: EnginePlayer[],
  matches: MatchResult[],
  points: PointsConfig = DEFAULT_POINTS,
): StandingRow[] {
  const tallies = new Map<number, Tally>();
  for (const p of players) tallies.set(p.id, emptyTally());
  const tallyFor = (id: number) => {
    let t = tallies.get(id);
    if (!t) tallies.set(id, (t = emptyTally()));
    return t;
  };

  for (const m of matches) {
    const t1 = tallyFor(m.p1);
    if (m.p2 === null) {
      t1.byes++;
      recordSide(t1, 2, 0, 0, points);
      continue;
    }
    const t2 = tallyFor(m.p2);
    recordSide(t1, m.p1Games, m.p2Games, m.draws, points);
    recordSide(t2, m.p2Games, m.p1Games, m.draws, points);
    t1.opponents.push(m.p2);
    t2.opponents.push(m.p1);
  }

  const mwp = new Map<number, number>();
  const gwp = new Map<number, number>();
  for (const [id, t] of tallies) {
    mwp.set(id, t.matchesPlayed ? Math.max(PERCENT_FLOOR, t.matchPoints / (t.matchesPlayed * points.win)) : PERCENT_FLOOR);
    gwp.set(id, t.gamesPlayed ? Math.max(PERCENT_FLOOR, t.gamePoints / (t.gamesPlayed * points.win)) : PERCENT_FLOOR);
  }

  const rows: StandingRow[] = players.map((p) => {
    const t = tallyFor(p.id);
    return {
      rank: 0,
      playerId: p.id,
      name: p.name,
      dropped: p.dropped,
      matchPoints: t.matchPoints,
      wins: t.wins,
      losses: t.losses,
      draws: t.draws,
      byes: t.byes,
      matchesPlayed: t.matchesPlayed,
      mwp: mwp.get(p.id)!,
      omw: avg(t.opponents.map((o) => mwp.get(o) ?? PERCENT_FLOOR)),
      gwp: gwp.get(p.id)!,
      ogw: avg(t.opponents.map((o) => gwp.get(o) ?? PERCENT_FLOOR)),
      opponents: t.opponents,
    };
  });

  rows.sort(compareStandings);
  rows.forEach((r, i) => (r.rank = i + 1));
  return rows;
}

const EPS = 1e-9;

export function compareStandings(a: StandingRow, b: StandingRow): number {
  if (a.matchPoints !== b.matchPoints) return b.matchPoints - a.matchPoints;
  if (Math.abs(a.omw - b.omw) > EPS) return b.omw - a.omw;
  if (Math.abs(a.gwp - b.gwp) > EPS) return b.gwp - a.gwp;
  if (Math.abs(a.ogw - b.ogw) > EPS) return b.ogw - a.ogw;
  return a.name.localeCompare(b.name) || a.playerId - b.playerId;
}
