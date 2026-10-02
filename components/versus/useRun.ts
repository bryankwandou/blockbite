'use client';

import { useCallback, useRef, useState } from 'react';
import { COLOR_POOL, type BlockColor } from '@/lib/game/constants';
import { PIECES } from '@/lib/ranked/rules';
import { newRun, play, type LogMove, type Move, type Run } from '@/lib/versus/deal';

export const pieceColor = (piece: number): BlockColor => COLOR_POOL[piece % COLOR_POOL.length];

export interface RunView {
  run: Run;
  /** Colour per cell (row * 8 + col), null = empty. */
  colors: (BlockColor | null)[];
  log: LogMove[];
  /** Cells cleared by the last move, for the flash. */
  flash: number[];
  lastLabel: string;
}

function fresh(seed: string): RunView {
  return { run: newRun(seed), colors: new Array(64).fill(null), log: [], flash: [], lastLabel: '' };
}

/** A seeded run with per-cell colours and a move log. */
export function useRun(seed: string) {
  const [view, setView] = useState<RunView>(() => fresh(seed));
  const ref = useRef(view);
  ref.current = view;

  const reset = useCallback((s: string) => setView(fresh(s)), []);

  /** Returns false (and changes nothing) if the move is illegal. */
  const place = useCallback((m: Move): boolean => {
    const v = ref.current;
    const piece = v.run.tray[m.slot];
    if (piece === null || v.run.over) return false;
    let res;
    try {
      res = play(seed, v.run, m);
    } catch {
      return false;
    }
    const colors = [...v.colors];
    for (const [r, c] of PIECES[piece].cells) colors[(m.row + r) * 8 + m.col + c] = pieceColor(piece);
    const flash: number[] = [];
    for (const r of res.rows) for (let c = 0; c < 8; c++) flash.push(r * 8 + c);
    for (const c of res.cols) for (let r = 0; r < 8; r++) flash.push(r * 8 + c);
    for (const i of flash) colors[i] = null;
    const next = { run: res.state, colors, log: [...v.log, [m.slot, m.row, m.col] as LogMove], flash, lastLabel: res.label };
    ref.current = next;
    setView(next);
    return true;
  }, [seed]);

  return { view, place, reset, current: ref };
}
