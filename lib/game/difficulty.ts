// lib/game/difficulty.ts — one smooth difficulty curve for levels 1..500,000.
// Every level is generated from (LEVEL_SEED, N); nothing is stored. The curve
// is logarithmic so early levels ramp quickly and late levels keep creeping up
// without ever repeating or cycling.

export const TOTAL_LEVELS = 500_000;
export const LEVELS_PER_ACT = 500;
export const TOTAL_ACTS = TOTAL_LEVELS / LEVELS_PER_ACT; // 1,000
export const BOARD_SIZE = 8;

export function clampLevel(N: number): number {
  return Math.max(1, Math.min(TOTAL_LEVELS, Math.floor(N) || 1));
}

/** 0 at level 1, 1 at level 500,000. Strictly increasing. */
export function difficultyT(N: number): number {
  const n = clampLevel(N);
  return Math.log(n) / Math.log(TOTAL_LEVELS);
}

export interface DifficultyCurve {
  t: number;
  /** Side of the open square at the start (rest is blocked). 8 → 7 → 6. */
  playSize: number;
  /** Share of the open square pre-filled at the start. */
  prefill: number;
  /** Lines to clear for the level goal. */
  lineTarget: number;
  /** Score goal. */
  scoreTarget: number;
  /** 0 = small pieces favoured, 1 = large pieces favoured. */
  pieceBias: number;
  /** Mechanic pool tier 1..8. */
  mechanicTier: number;
  /** Mechanics picked per level 1..6. */
  mechanicCount: number;
}

export function curve(N: number): DifficultyCurve {
  const t = difficultyT(N);
  return {
    t,
    playSize: t < 0.6 ? 8 : t < 0.85 ? 7 : 6,
    prefill: 0.04 + 0.26 * t,
    lineTarget: 3 + Math.floor(57 * Math.pow(t, 1.3)),
    scoreTarget: 500 + Math.floor(29_500 * Math.pow(t, 1.3)),
    pieceBias: t,
    mechanicTier: 1 + Math.min(7, Math.floor(t * 8)),
    mechanicCount: 1 + Math.min(5, Math.floor(t * 6)),
  };
}

/** Act number (1..1000). Each act is 500 levels. */
export function actNumberOf(N: number): number {
  return Math.ceil(clampLevel(N) / LEVELS_PER_ACT);
}

/** Visual theme 1..8 — repeats every 8 acts; level numbers and difficulty do not. */
export function themeOfAct(act: number): number {
  return ((Math.max(1, act) - 1) % 8) + 1;
}
