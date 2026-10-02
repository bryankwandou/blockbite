/**
 * 1 vs Bot opponent. Greedy placement search over the same rules the player uses.
 *
 * Each candidate (slot, row, col) is scored on: lines cleared and points,
 * holes (empty cells boxed in on all four sides), bumpiness (filled/empty
 * edges between neighbours), open space, combo potential (rows/cols one or two
 * cells from full) and whether the rest of the tray still fits. Master and
 * Legend look one placement ahead. Lower levels sometimes pick a worse move.
 *
 * Pure and synchronous per move; the UI yields between moves (see thinkMs).
 */
import { fitsAnywhere, isFilled, PIECES, SIZE, type Move } from '@/lib/ranked/rules';
import { mulberry32, type RNG } from '@/lib/game/rng';
import { play, type Run } from './deal';

export type BotLevel = 'rookie' | 'pro' | 'master' | 'legend';
export const BOT_LEVELS: BotLevel[] = ['rookie', 'pro', 'master', 'legend'];

interface LevelCfg { mistake: number; sloppy: number; lookahead: boolean; fitCheck: boolean; thinkMs: [number, number] }
const CFG: Record<BotLevel, LevelCfg> = {
  rookie: { mistake: 0.3, sloppy: 0.35, lookahead: false, fitCheck: false, thinkMs: [1300, 2200] },
  pro: { mistake: 0.12, sloppy: 0.15, lookahead: false, fitCheck: true, thinkMs: [900, 1500] },
  master: { mistake: 0.04, sloppy: 0.05, lookahead: true, fitCheck: true, thinkMs: [650, 1100] },
  legend: { mistake: 0, sloppy: 0, lookahead: true, fitCheck: true, thinkMs: [420, 750] },
};

export function thinkMs(level: BotLevel, rng: RNG): number {
  const [a, b] = CFG[level].thinkMs;
  return a + rng() * (b - a);
}

interface Cand { move: Move; next: Run; value: number }

function cells(run: Run): boolean[] {
  const b = BigInt('0x' + run.board);
  const out: boolean[] = new Array(SIZE * SIZE);
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) out[r * SIZE + c] = isFilled(b, r, c);
  return out;
}

function evaluate(before: Run, after: Run, lines: number, cfg: LevelCfg): number {
  const g = cells(after);
  const at = (r: number, c: number) => r < 0 || c < 0 || r >= SIZE || c >= SIZE || g[r * SIZE + c];
  let holes = 0, bump = 0, filled = 0, near = 0;
  for (let r = 0; r < SIZE; r++) {
    let rowFill = 0, colFill = 0;
    for (let c = 0; c < SIZE; c++) {
      const v = g[r * SIZE + c];
      if (v) filled++, rowFill++;
      if (g[c * SIZE + r]) colFill++;
      if (!v && at(r - 1, c) && at(r + 1, c) && at(r, c - 1) && at(r, c + 1)) holes++;
      if (c < SIZE - 1 && v !== g[r * SIZE + c + 1]) bump++;
      if (r < SIZE - 1 && v !== g[(r + 1) * SIZE + c]) bump++;
    }
    if (rowFill >= 6 && rowFill < 8) near += rowFill - 5;
    if (colFill >= 6 && colFill < 8) near += colFill - 5;
  }
  let v = lines * 60 + (after.score - before.score) * 0.02 - holes * 22 - bump * 2.2 - filled * 1.2 + near * 3;
  if (after.over) v -= 5000;
  if (cfg.fitCheck) {
    const b = BigInt('0x' + after.board);
    // Rest of the tray must still fit, and keep room for big pieces.
    for (const p of after.tray) if (p !== null && !fitsAnywhere(b, p)) v -= 400;
    for (const big of BIG) if (!fitsAnywhere(b, big)) v -= 18;
  }
  return v;
}

const BIG = PIECES.map((p, i) => [p, i] as const).filter(([p]) => p.size >= 5 || p.rows >= 3 && p.cols >= 3).map(([, i]) => i);

function candidates(seed: string, run: Run, cfg: LevelCfg): Cand[] {
  const out: Cand[] = [];
  const b = BigInt('0x' + run.board);
  const seen = new Set<number>();
  for (const slot of [0, 1, 2] as const) {
    const piece = run.tray[slot];
    if (piece === null || seen.has(piece)) continue;
    seen.add(piece);
    const p = PIECES[piece];
    for (let row = 0; row + p.rows <= SIZE; row++) {
      for (let col = 0; col + p.cols <= SIZE; col++) {
        let ok = true;
        for (const [r, c] of p.cells) if (isFilled(b, row + r, col + c)) { ok = false; break; }
        if (!ok) continue;
        const move = { slot, row, col };
        const res = play(seed, run, move);
        out.push({ move, next: res.state, value: evaluate(run, res.state, res.rows.length + res.cols.length, cfg) });
      }
    }
  }
  return out;
}

/** Picks the bot's next move, or null if the run is over. Always legal. */
export function chooseMove(seed: string, run: Run, level: BotLevel, rng: RNG): Move | null {
  if (run.over) return null;
  const cfg = CFG[level];
  const list = candidates(seed, run, cfg);
  if (list.length === 0) return null;
  if (rng() < cfg.mistake) return list[Math.floor(rng() * list.length)].move;
  list.sort((a, b) => b.value - a.value);
  if (cfg.lookahead && run.tray.filter((p) => p !== null).length > 1) {
    const top = list.slice(0, 6);
    for (const c of top) {
      if (c.next.over) continue;
      const follow = candidates(seed, c.next, cfg);
      if (follow.length) c.value = c.value * 0.6 + Math.max(...follow.map((f) => f.value)) * 0.4 + 5;
      else c.value -= 1000;
    }
    top.sort((a, b) => b.value - a.value);
    list.splice(0, top.length, ...top);
  }
  if (cfg.sloppy && rng() < cfg.sloppy) return list[Math.min(list.length - 1, 1 + Math.floor(rng() * 3))].move;
  return list[0].move;
}

export function botRng(seed: string, level: BotLevel): RNG {
  let h = 0;
  for (const ch of seed + level) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0;
  return mulberry32(h);
}
