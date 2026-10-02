// lib/game/levels.ts - pure, cheap level API for the map (no board generation).
// levelAt(n) is O(1) and safe to call for any n in 1..TOTAL_LEVELS, so a
// virtualized map can label rows without building level boards.

import {
  TOTAL_LEVELS, LEVELS_PER_ACT, TOTAL_ACTS, clampLevel, curve, actNumberOf, themeOfAct,
  type DifficultyCurve,
} from './difficulty';
import { actOf, ACT_NAME } from './mechanics';
import { biomeForLevel, type Biome } from './biomes';

export { TOTAL_LEVELS, LEVELS_PER_ACT, TOTAL_ACTS, clampLevel, actOf, actNumberOf, themeOfAct };

export interface LevelInfo {
  /** Clamped level number 1..TOTAL_LEVELS. */
  level: number;
  /** Act number 1..TOTAL_ACTS (500 levels each). Never repeats. */
  act: number;
  /** Visual theme 1..8; repeats every 8 acts. */
  theme: number;
  themeName: string;
  /** Position inside the act, 1..LEVELS_PER_ACT. */
  indexInAct: number;
  /** Difficulty curve (t in 0..1 rises across all 500k levels). */
  difficulty: DifficultyCurve;
  biome: Biome;
}

export function levelAt(n: number): LevelInfo {
  const level = clampLevel(n);
  const act = actNumberOf(level);
  const theme = actOf(level);
  return {
    level,
    act,
    theme,
    themeName: ACT_NAME[theme] ?? '',
    indexInAct: level - (act - 1) * LEVELS_PER_ACT,
    difficulty: curve(level),
    biome: biomeForLevel(level),
  };
}

/** First and last level of an act. */
export function actRange(act: number): { first: number; last: number } {
  const a = Math.max(1, Math.min(TOTAL_ACTS, Math.floor(act) || 1));
  return { first: (a - 1) * LEVELS_PER_ACT + 1, last: a * LEVELS_PER_ACT };
}
