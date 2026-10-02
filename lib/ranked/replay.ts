/**
 * Replays a ranked run from its seed and move log, exactly as
 * /api/ranked/start and /api/ranked/play build it.
 */
import { applyMove, boardToHex, dealTray, initialState, trayEmpty, type RankedState } from './rules';
import { trayFor } from './seed';

export type Step = { t?: number; m: [number, number, number][] };

export function replayRun(seedHex: string, log: Step[]): RankedState {
  let s = initialState(trayFor(seedHex, boardToHex(0n), 0));
  for (const step of log) {
    for (const [slot, row, col] of step.m) {
      s = applyMove(s, { slot: slot as 0 | 1 | 2, row, col }).state;
    }
    if (!s.over && trayEmpty(s.tray)) s = dealTray(s, trayFor(seedHex, s.board, s.moves));
  }
  return s;
}
