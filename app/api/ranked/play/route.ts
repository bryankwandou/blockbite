/**
 * POST /api/ranked/play { runId, fromMoves, moves: [{ slot, row, col }] }
 *
 * The server replays the placements with the ranked rules and computes the
 * score itself. When the tray is empty it deals the next tray, so the
 * browser never sees a piece before it is dealt. `fromMoves` must equal the
 * run's current placement count: a run has exactly one history.
 */
import { advanceRun, getRun } from '@/lib/ranked/db';
import { body, fail, json, rankedConfigured, requireWallet } from '@/lib/ranked/http';
import { applyMove, dealTray, RulesError, trayEmpty, type Move, type RankedState } from '@/lib/ranked/rules';
import { dailySeed, dayOf, trayFor } from '@/lib/ranked/seed';

export const dynamic = 'force-dynamic';

/** Placements faster than this (server-side, per placement) mark the step for review. */
const MIN_MS_PER_MOVE = 250;

function parseMoves(v: unknown): Move[] | null {
  if (!Array.isArray(v) || v.length < 1 || v.length > 3) return null;
  const out: Move[] = [];
  for (const m of v) {
    const { slot, row, col } = (m ?? {}) as Record<string, unknown>;
    if (![0, 1, 2].includes(slot as number)) return null;
    if (!Number.isInteger(row) || !Number.isInteger(col)) return null;
    out.push({ slot: slot as 0 | 1 | 2, row: row as number, col: col as number });
  }
  return out;
}

export async function POST(req: Request) {
  if (!rankedConfigured()) return fail(503, 'ranked is not available');
  const wallet = requireWallet(req);
  if (typeof wallet !== 'string') return wallet;
  const b = await body(req);
  const moves = parseMoves(b?.moves);
  if (!b || typeof b.runId !== 'string' || !Number.isInteger(b.fromMoves) || !moves) return fail(400, 'bad request');

  const run = await getRun(b.runId);
  if (!run || run.wallet !== wallet) return fail(404, 'run not found');
  if (run.over) return fail(409, 'run is over', { state: run.state });
  const now = Date.now();
  if (run.day !== dayOf(now)) return fail(409, 'this day has ended; the score stands', { state: run.state });
  if (run.moves !== b.fromMoves) return fail(409, 'out of sync', { state: run.state });

  let state: RankedState = run.state;
  try {
    for (const m of moves) {
      if (state.over) throw new RulesError('run is over');
      state = applyMove(state, m).state;
    }
  } catch (e) {
    if (e instanceof RulesError) return fail(422, `illegal move: ${e.message}`, { state: run.state });
    throw e;
  }
  if (!state.over && trayEmpty(state.tray)) {
    state = dealTray(state, trayFor(dailySeed(run.day), state.board, state.moves));
  }

  const flag = now - run.last_step_ms < moves.length * MIN_MS_PER_MOVE;
  const ok = await advanceRun({
    id: run.id, wallet, day: run.day, fromMoves: run.moves, state, flag,
    step: { t: now, m: moves.map((m) => [m.slot, m.row, m.col]) },
  });
  if (!ok) {
    const fresh = await getRun(run.id);
    return fail(409, 'out of sync', { state: fresh?.state ?? run.state });
  }
  return json({ state });
}
