/**
 * Seeded runs for the for-fun modes (1 vs Bot, Challenge a friend).
 *
 * The tray sequence depends only on (seed, deal number), so two players on the
 * same seed get the exact same pieces in the same order, whatever they do with
 * them. Board rules come from lib/ranked/rules.ts (pure, deterministic), so a
 * run can be replayed on the server from its move log. No crypto, no Date:
 * safe in the browser, on the server and in node tests.
 */
import { hash32, mulberry32 } from '@/lib/game/rng';
import { applyMove, dealTray, initialState, PIECES, trayEmpty, type Move, type MoveResult, type RankedState, type Tray } from '@/lib/ranked/rules';

export type Run = RankedState;
export type { Move, Tray };

const TOTAL = PIECES.reduce((s, p) => s + p.weight, 0);

function pick(r: number): number {
  let x = r * TOTAL;
  for (let i = 0; i < PIECES.length; i++) {
    x -= PIECES[i].weight;
    if (x < 0) return i;
  }
  return PIECES.length - 1;
}

/** The n-th tray (0-based) dealt on this seed. */
export function dealFor(seed: string, n: number): Tray {
  const rng = mulberry32(hash32(`bb:vs:${seed}:${n}`));
  return [pick(rng()), pick(rng()), pick(rng())];
}

export function newRun(seed: string): Run {
  return initialState(dealFor(seed, 0));
}

/** Applies a move and deals the next tray when the current one is used up. Throws RulesError if illegal. */
export function play(seed: string, run: Run, move: Move): MoveResult {
  const res = applyMove(run, move);
  if (!res.state.over && trayEmpty(res.state.tray)) {
    res.state = dealTray(res.state, dealFor(seed, res.state.moves / 3));
  }
  return res;
}

export const SEED_RE = /^[a-z0-9]{8,32}$/;

export function randomSeed(): string {
  const a = new Uint32Array(2);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(a);
  else { a[0] = Math.random() * 2 ** 32; a[1] = Math.random() * 2 ** 32; }
  return a[0].toString(36) + a[1].toString(36).padStart(7, '0');
}

export type LogMove = [number, number, number];

/** Replays a move log. Returns null if any move is illegal. curve[i] = score after move i+1. */
export function replay(seed: string, log: LogMove[]): { run: Run; curve: number[] } | null {
  let run = newRun(seed);
  const curve: number[] = [];
  try {
    for (const [slot, row, col] of log) {
      run = play(seed, run, { slot: slot as 0 | 1 | 2, row, col }).state;
      curve.push(run.score);
    }
  } catch {
    return null;
  }
  return { run, curve };
}
