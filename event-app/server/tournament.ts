import crypto from 'node:crypto';
import type { DB, EventRow, MatchRow, RegistrationStatus, RoundRow } from './db/client.js';
import { computeStandings, type StandingRow } from './engine/standings.js';
import { pairSwissRound, recommendedRounds } from './engine/swiss.js';
import { matchWinner, nextTopCutRound, seedTopCut } from './engine/topcut.js';
import * as timer from './engine/timer.js';
import { paidPayment, paymentState } from './pos/payments.js';
import { makeRng, type MatchResult, type Pairing } from './engine/types.js';

export class HttpError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

const bad = (msg: string) => new HttpError(400, msg);

export function getEvent(db: DB, eventId: number): EventRow {
  const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId) as EventRow | undefined;
  if (!ev) throw new HttpError(404, 'Event not found');
  return ev;
}

function rounds(db: DB, eventId: number): RoundRow[] {
  return db
    .prepare("SELECT * FROM rounds WHERE event_id = ? ORDER BY CASE phase WHEN 'swiss' THEN 0 ELSE 1 END, number")
    .all(eventId) as RoundRow[];
}

function matchesForRound(db: DB, roundId: number): MatchRow[] {
  return db.prepare('SELECT * FROM matches WHERE round_id = ? ORDER BY table_number').all(roundId) as MatchRow[];
}

function currentRound(db: DB, eventId: number): RoundRow | undefined {
  const all = rounds(db, eventId);
  return all[all.length - 1];
}

const toResult = (m: MatchRow): MatchResult => ({
  p1: m.p1_id,
  p2: m.p2_id,
  p1Games: m.p1_games,
  p2Games: m.p2_games,
  draws: m.draws,
});

/** Confirmed Swiss results, used for standings and pairing history. */
function swissResults(db: DB, eventId: number): MatchResult[] {
  return (
    db
      .prepare(
        `SELECT m.* FROM matches m JOIN rounds r ON r.id = m.round_id
         WHERE r.event_id = ? AND r.phase = 'swiss' AND m.result_status = 'confirmed'`,
      )
      .all(eventId) as MatchRow[]
  ).map(toResult);
}

/** All Swiss pairings so far (any status), so a re-pair never repeats an earlier matchup. */
function swissHistory(db: DB, eventId: number, excludeRoundId?: number): MatchResult[] {
  return (
    db
      .prepare(
        `SELECT m.* FROM matches m JOIN rounds r ON r.id = m.round_id
         WHERE r.event_id = ? AND r.phase = 'swiss' AND r.id != ?`,
      )
      .all(eventId, excludeRoundId ?? -1) as MatchRow[]
  ).map(toResult);
}

/** Players who are part of the tournament once it has started. */
function tournamentPlayers(db: DB, eventId: number) {
  return db
    .prepare(
      `SELECT p.id, p.name, r.status FROM registrations r JOIN players p ON p.id = r.player_id
       WHERE r.event_id = ? AND r.status IN ('checked_in', 'dropped')`,
    )
    .all(eventId) as { id: number; name: string; status: RegistrationStatus }[];
}

export function standings(db: DB, eventId: number): StandingRow[] {
  const ev = getEvent(db, eventId);
  const players = tournamentPlayers(db, eventId).map((p) => ({ id: p.id, name: p.name, dropped: p.status === 'dropped' }));
  return computeStandings(players, swissResults(db, eventId), { win: ev.win_points, draw: ev.draw_points });
}

function insertRound(db: DB, ev: EventRow, phase: 'swiss' | 'topcut', number: number, pairings: Pairing[]) {
  const roundId = Number(
    db
      .prepare('INSERT INTO rounds (event_id, phase, number, timer_remaining_ms) VALUES (?, ?, ?, ?)')
      .run(ev.id, phase, number, ev.round_minutes * 60_000).lastInsertRowid,
  );
  insertMatches(db, ev, roundId, pairings);
  return roundId;
}

function insertMatches(db: DB, ev: EventRow, roundId: number, pairings: Pairing[]) {
  const stmt = db.prepare(
    `INSERT INTO matches (round_id, table_number, p1_id, p2_id, p1_games, p2_games, result_status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const byeWins = Math.ceil(ev.best_of / 2);
  // Byes are listed after the real tables.
  const ordered = [...pairings.filter((p) => p.p2 !== null), ...pairings.filter((p) => p.p2 === null)];
  ordered.forEach((p, i) => {
    const bye = p.p2 === null;
    stmt.run(roundId, i + 1, p.p1, p.p2, bye ? byeWins : 0, 0, bye ? 'confirmed' : 'pending');
  });
}

function pairSwiss(db: DB, ev: EventRow, excludeRoundId?: number): Pairing[] {
  const table = standings(db, ev.id).filter((s) => !s.dropped);
  if (table.length < 2) throw bad('Need at least 2 active players to pair a round');
  const { pairings } = pairSwissRound({
    players: table.map((s) => ({ id: s.playerId, matchPoints: s.matchPoints })),
    history: swissHistory(db, ev.id, excludeRoundId),
    rng: makeRng(crypto.randomInt(2 ** 31)),
  });
  return pairings;
}

function assertRoundFinished(db: DB, round: RoundRow) {
  const open = matchesForRound(db, round.id).filter((m) => m.result_status !== 'confirmed');
  if (open.length) throw bad(`${open.length} match(es) still need a confirmed result`);
}

/**
 * The single "advance" action staff press to move an event forward:
 * start Swiss → next Swiss round → top cut → next bracket round → complete.
 */
export function advance(db: DB, eventId: number): void {
  db.transaction(() => {
    const ev = getEvent(db, eventId);
    if (ev.status === 'draft' || ev.status === 'registration' || ev.status === 'checkin') {
      const count = (
        db.prepare("SELECT COUNT(*) AS n FROM registrations WHERE event_id = ? AND status = 'checked_in'").get(eventId) as {
          n: number;
        }
      ).n;
      if (count < 2) throw bad('Check in at least 2 players before starting');
      const swissRounds = ev.swiss_rounds ?? recommendedRounds(count);
      db.prepare("UPDATE events SET status = 'swiss', swiss_rounds = ? WHERE id = ?").run(swissRounds, eventId);
      const started = getEvent(db, eventId);
      insertRound(db, started, 'swiss', 1, pairSwiss(db, started));
      return;
    }

    const round = currentRound(db, eventId);
    if (!round) throw bad('No round in progress');
    assertRoundFinished(db, round);
    db.prepare("UPDATE rounds SET status = 'complete', timer_ends_at = NULL WHERE id = ?").run(round.id);

    if (ev.status === 'swiss') {
      if (round.number < (ev.swiss_rounds ?? 0)) {
        insertRound(db, ev, 'swiss', round.number + 1, pairSwiss(db, ev));
        return;
      }
      const eligible = standings(db, eventId).filter((s) => !s.dropped);
      if (ev.top_cut_size > 0 && eligible.length >= 2) {
        db.prepare("UPDATE events SET status = 'topcut' WHERE id = ?").run(eventId);
        const seeds = eligible.slice(0, ev.top_cut_size).map((s) => s.playerId);
        insertRound(db, ev, 'topcut', 1, seedTopCut(seeds, ev.top_cut_size));
        return;
      }
      db.prepare("UPDATE events SET status = 'complete' WHERE id = ?").run(eventId);
      return;
    }

    if (ev.status === 'topcut') {
      const winners = matchesForRound(db, round.id).map((m) =>
        matchWinner({ p1: m.p1_id, p2: m.p2_id, p1Games: m.p1_games, p2Games: m.p2_games }),
      );
      const next = nextTopCutRound(winners);
      if (next.length === 0) {
        db.prepare("UPDATE events SET status = 'complete' WHERE id = ?").run(eventId);
        return;
      }
      insertRound(db, ev, 'topcut', round.number + 1, next);
      return;
    }

    throw bad('Event is already complete');
  })();
}

/** Throw away and redo the pairings of a Swiss round that hasn't started yet. */
export function repairRound(db: DB, roundId: number): number {
  return db.transaction(() => {
    const round = db.prepare('SELECT * FROM rounds WHERE id = ?').get(roundId) as RoundRow | undefined;
    if (!round) throw new HttpError(404, 'Round not found');
    const latest = currentRound(db, round.event_id);
    if (round.phase !== 'swiss' || latest?.id !== round.id) throw bad('Only the current Swiss round can be re-paired');
    if (round.status !== 'pending' || round.timer_ends_at !== null) throw bad('Round already started');
    const reported = matchesForRound(db, roundId).some((m) => m.p2_id !== null && m.result_status !== 'pending');
    if (reported) throw bad('Results already reported for this round');
    const ev = getEvent(db, round.event_id);
    db.prepare('DELETE FROM matches WHERE round_id = ?').run(roundId);
    insertMatches(db, ev, roundId, pairSwiss(db, ev, roundId));
    return round.event_id;
  })();
}

export type TimerAction = 'start' | 'pause' | 'add';

export function updateTimer(db: DB, roundId: number, action: TimerAction, minutes = 0): number {
  const round = db.prepare('SELECT * FROM rounds WHERE id = ?').get(roundId) as RoundRow | undefined;
  if (!round) throw new HttpError(404, 'Round not found');
  if (round.status === 'complete') throw bad('Round is complete');
  const now = Date.now();
  let t: timer.TimerState = { endsAt: round.timer_ends_at, remainingMs: round.timer_remaining_ms };
  if (action === 'start') t = timer.start(t, now);
  else if (action === 'pause') t = timer.pause(t, now);
  else t = timer.addTime(t, minutes * 60_000, now);
  db.prepare("UPDATE rounds SET timer_ends_at = ?, timer_remaining_ms = ?, status = 'active' WHERE id = ?").run(
    t.endsAt,
    t.remainingMs,
    roundId,
  );
  return round.event_id;
}

// ---------- Results ----------

export interface ResultInput {
  p1Games: number;
  p2Games: number;
  draws?: number;
}

function loadMatch(db: DB, matchId: number) {
  const m = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId) as MatchRow | undefined;
  if (!m) throw new HttpError(404, 'Match not found');
  const round = db.prepare('SELECT * FROM rounds WHERE id = ?').get(m.round_id) as RoundRow;
  const ev = getEvent(db, round.event_id);
  return { m, round, ev };
}

function validateResult(ev: EventRow, round: RoundRow, r: ResultInput) {
  const draws = r.draws ?? 0;
  const max = Math.ceil(ev.best_of / 2);
  for (const n of [r.p1Games, r.p2Games, draws]) {
    if (!Number.isInteger(n) || n < 0) throw bad('Game counts must be whole numbers');
  }
  if (r.p1Games > max || r.p2Games > max) throw bad(`Best of ${ev.best_of}: nobody can win more than ${max} games`);
  if (r.p1Games + r.p2Games + draws > ev.best_of) throw bad(`Too many games for a best-of-${ev.best_of}`);
  if (round.phase === 'topcut' && r.p1Games === r.p2Games) throw bad('Top cut matches need a winner');
  return { p1Games: r.p1Games, p2Games: r.p2Games, draws };
}

function assertEditable(db: DB, round: RoundRow, ev: EventRow, staff: boolean) {
  const latest = currentRound(db, ev.id);
  if (latest?.id === round.id && round.status !== 'complete') return;
  // Staff may correct earlier Swiss results while Swiss is still running (standings recompute).
  if (staff && round.phase === 'swiss' && ev.status === 'swiss') return;
  throw bad('This round is closed');
}

export function staffSetResult(db: DB, matchId: number, input: ResultInput): number {
  const { m, round, ev } = loadMatch(db, matchId);
  if (m.p2_id === null) throw bad('Byes have no result to enter');
  assertEditable(db, round, ev, true);
  const r = validateResult(ev, round, input);
  db.prepare(
    "UPDATE matches SET p1_games = ?, p2_games = ?, draws = ?, result_status = 'confirmed', reported_by = NULL WHERE id = ?",
  ).run(r.p1Games, r.p2Games, r.draws, matchId);
  if (round.status === 'pending') db.prepare("UPDATE rounds SET status = 'active' WHERE id = ?").run(round.id);
  return ev.id;
}

export function playerReport(db: DB, matchId: number, playerId: number, input: ResultInput): number {
  const { m, round, ev } = loadMatch(db, matchId);
  if (m.p1_id !== playerId && m.p2_id !== playerId) throw new HttpError(403, 'Not your match');
  if (m.p2_id === null) throw bad('Byes have no result to report');
  assertEditable(db, round, ev, false);
  if (m.result_status === 'confirmed') throw bad('Result already confirmed — ask a judge to change it');
  const r = validateResult(ev, round, input);
  const sameAsOpponent =
    m.result_status === 'reported' &&
    m.reported_by !== playerId &&
    m.p1_games === r.p1Games &&
    m.p2_games === r.p2Games &&
    m.draws === r.draws;
  db.prepare('UPDATE matches SET p1_games = ?, p2_games = ?, draws = ?, result_status = ?, reported_by = ? WHERE id = ?').run(
    r.p1Games,
    r.p2Games,
    r.draws,
    sameAsOpponent ? 'confirmed' : 'reported',
    playerId,
    matchId,
  );
  if (round.status === 'pending') db.prepare("UPDATE rounds SET status = 'active' WHERE id = ?").run(round.id);
  return ev.id;
}

export function playerRespond(db: DB, matchId: number, playerId: number, accept: boolean): number {
  const { m, round, ev } = loadMatch(db, matchId);
  if (m.p1_id !== playerId && m.p2_id !== playerId) throw new HttpError(403, 'Not your match');
  assertEditable(db, round, ev, false);
  if (m.result_status !== 'reported') throw bad('Nothing to confirm');
  if (m.reported_by === playerId) throw bad('Your opponent needs to confirm this result');
  db.prepare('UPDATE matches SET result_status = ? WHERE id = ?').run(accept ? 'confirmed' : 'disputed', matchId);
  return ev.id;
}

// ---------- Registration ----------

export function register(db: DB, eventId: number, playerId: number, asStaff: boolean): RegistrationStatus {
  return db.transaction(() => {
    const ev = getEvent(db, eventId);
    const open = ev.status === 'registration' || (asStaff && ev.status !== 'complete');
    if (!open) throw bad('Registration is closed');
    const existing = db
      .prepare('SELECT status FROM registrations WHERE event_id = ? AND player_id = ?')
      .get(eventId, playerId) as { status: RegistrationStatus } | undefined;
    if (existing && existing.status !== 'dropped') return existing.status;
    if (existing && ev.status !== 'registration' && ev.status !== 'checkin') throw bad('Dropped players cannot rejoin mid-event');
    const taken = (
      db
        .prepare("SELECT COUNT(*) AS n FROM registrations WHERE event_id = ? AND status IN ('registered', 'checked_in')")
        .get(eventId) as { n: number }
    ).n;
    let status: RegistrationStatus = ev.capacity !== null && taken >= ev.capacity && !asStaff ? 'waitlist' : 'registered';
    // Walk-ins added by staff after Swiss starts must be checked in to be paired next round.
    if (asStaff && (ev.status === 'swiss' || ev.status === 'checkin')) status = 'checked_in';
    db.prepare(
      `INSERT INTO registrations (event_id, player_id, status) VALUES (?, ?, ?)
       ON CONFLICT (event_id, player_id) DO UPDATE SET status = excluded.status, dropped_after_round = NULL`,
    ).run(eventId, playerId, status);
    return status;
  })();
}

export function unregister(db: DB, eventId: number, playerId: number): void {
  db.transaction(() => {
    const ev = getEvent(db, eventId);
    if (!['draft', 'registration', 'checkin'].includes(ev.status)) throw bad('Event has started — drop instead');
    const res = db.prepare('DELETE FROM registrations WHERE event_id = ? AND player_id = ?').run(eventId, playerId);
    if (res.changes && ev.capacity !== null) promoteWaitlist(db, ev);
  })();
}

function promoteWaitlist(db: DB, ev: EventRow) {
  const taken = (
    db
      .prepare("SELECT COUNT(*) AS n FROM registrations WHERE event_id = ? AND status IN ('registered', 'checked_in')")
      .get(ev.id) as { n: number }
  ).n;
  if (ev.capacity === null || taken >= ev.capacity) return;
  db.prepare(
    `UPDATE registrations SET status = 'registered' WHERE id IN (
       SELECT id FROM registrations WHERE event_id = ? AND status = 'waitlist' ORDER BY created_at, id LIMIT ?)`,
  ).run(ev.id, ev.capacity - taken);
}

export function setCheckIn(db: DB, eventId: number, playerId: number, checkedIn: boolean): void {
  const ev = getEvent(db, eventId);
  if (ev.status === 'complete' || ev.status === 'topcut') throw bad('Check-in is closed');
  const reg = db
    .prepare('SELECT status FROM registrations WHERE event_id = ? AND player_id = ?')
    .get(eventId, playerId) as { status: RegistrationStatus } | undefined;
  if (!reg) throw bad('Player is not registered');
  if (ev.status === 'swiss' && !checkedIn) throw bad('Event has started — drop the player instead');
  if (checkedIn && ev.require_payment && ev.entry_fee_cents > 0 && !paidPayment(db, eventId, playerId)) {
    throw bad('Entry fee not paid yet — collect it on the POS or mark it paid first');
  }
  db.prepare('UPDATE registrations SET status = ? WHERE event_id = ? AND player_id = ?').run(
    checkedIn ? 'checked_in' : 'registered',
    eventId,
    playerId,
  );
}

export function drop(db: DB, eventId: number, playerId: number): void {
  const ev = getEvent(db, eventId);
  if (ev.status !== 'swiss' && ev.status !== 'topcut') throw bad('Only possible while the event is running');
  const round = currentRound(db, eventId);
  const res = db
    .prepare("UPDATE registrations SET status = 'dropped', dropped_after_round = ? WHERE event_id = ? AND player_id = ? AND status = 'checked_in'")
    .run(round?.phase === 'swiss' ? round.number : ev.swiss_rounds, eventId, playerId);
  if (!res.changes) throw bad('Player is not active in this event');
}

// ---------- Read model ----------

const ROUND_LABELS: Record<number, string> = { 1: 'Finals', 2: 'Semifinals', 4: 'Quarterfinals' };

/** Who is looking: staff see every payment and the POS tray; a player sees only their own payment. */
export interface StateViewer {
  staff: boolean;
  playerId?: number;
}

export function eventState(db: DB, eventId: number, viewer: StateViewer = { staff: false }) {
  const ev = getEvent(db, eventId);
  const pay = paymentState(db, eventId);
  const canSeePayment = (playerId: number) => viewer.staff || viewer.playerId === playerId;
  const names = new Map<number, string>();
  const registrations = (
    db
      .prepare(
        `SELECT r.player_id, r.status, r.dropped_after_round, p.name, p.game_id
         FROM registrations r JOIN players p ON p.id = r.player_id
         WHERE r.event_id = ? ORDER BY p.name COLLATE NOCASE`,
      )
      .all(eventId) as { player_id: number; status: RegistrationStatus; dropped_after_round: number | null; name: string; game_id: string | null }[]
  ).map((r) => {
    names.set(r.player_id, r.name);
    return {
      playerId: r.player_id,
      name: r.name,
      gameId: r.game_id,
      status: r.status,
      droppedAfterRound: r.dropped_after_round,
      payment: canSeePayment(r.player_id) ? (pay.byPlayer.get(r.player_id) ?? null) : null,
      waitingForPosSince: viewer.staff ? (pay.waiting.get(r.player_id) ?? null) : null,
    };
  });
  const owing = registrations.filter(
    (r) => (r.status === 'registered' || r.status === 'checked_in') && !(pay.byPlayer.get(r.playerId)?.status === 'paid'),
  ).length;
  const player = (id: number | null) => (id === null ? null : { id, name: names.get(id) ?? `Player #${id}` });

  const roundList = rounds(db, eventId).map((r) => {
    const ms = matchesForRound(db, r.id);
    const label =
      r.phase === 'swiss' ? `Round ${r.number}` : ROUND_LABELS[ms.length] ?? `Top ${ms.length * 2}`;
    return {
      id: r.id,
      phase: r.phase,
      number: r.number,
      label,
      status: r.status,
      timer: { endsAt: r.timer_ends_at, remainingMs: r.timer_remaining_ms },
      matches: ms.map((m) => ({
        id: m.id,
        table: m.table_number,
        p1: player(m.p1_id)!,
        p2: player(m.p2_id),
        p1Games: m.p1_games,
        p2Games: m.p2_games,
        draws: m.draws,
        resultStatus: m.result_status,
        reportedBy: m.reported_by,
      })),
    };
  });

  let champion: { id: number; name: string } | null = null;
  if (ev.status === 'complete') {
    const last = roundList[roundList.length - 1];
    if (last?.phase === 'topcut' && last.matches.length === 1) {
      const f = last.matches[0];
      champion = f.p2 === null || f.p1Games > f.p2Games ? f.p1 : f.p2;
    }
  }
  const table = ev.status === 'draft' || ev.status === 'registration' || ev.status === 'checkin' ? [] : standings(db, eventId);
  if (ev.status === 'complete' && !champion && table[0]) champion = { id: table[0].playerId, name: table[0].name };

  return {
    event: ev,
    registrations,
    counts: {
      registered: registrations.filter((r) => r.status !== 'waitlist').length,
      waitlist: registrations.filter((r) => r.status === 'waitlist').length,
      checkedIn: registrations.filter((r) => r.status === 'checked_in').length,
    },
    recommendedRounds: recommendedRounds(Math.max(2, registrations.filter((r) => r.status === 'checked_in').length)),
    rounds: roundList,
    standings: table,
    champion,
    payments: {
      feeCents: ev.entry_fee_cents,
      currency: ev.currency,
      requirePayment: !!ev.require_payment,
      onPos: !!ev.pos_product_uuid,
      paidCount: pay.paidCount,
      owing: ev.entry_fee_cents > 0 ? owing : 0,
      ...(viewer.staff ? { totals: pay.totals, refunded: pay.refunded, unassigned: pay.unassigned } : {}),
    },
    serverNow: Date.now(),
  };
}

export type EventState = ReturnType<typeof eventState>;

export function standingsCsv(db: DB, eventId: number): string {
  const pct = (n: number) => (n * 100).toFixed(2);
  const rows = standings(db, eventId);
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return [
    'Rank,Player,Points,Record,OMW%,GW%,OGW%,Dropped',
    ...rows.map((r) =>
      [r.rank, esc(r.name), r.matchPoints, `${r.wins}-${r.losses}-${r.draws}`, pct(r.omw), pct(r.gwp), pct(r.ogw), r.dropped ? 'yes' : ''].join(','),
    ),
  ].join('\n');
}
