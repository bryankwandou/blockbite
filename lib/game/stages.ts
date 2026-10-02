/**
 * Stage naming system — gives every level a unique human-readable identifier.
 * Format: <TierName>-<paddedLevel>  e.g. "Rookie-001", "Cursed-021", "Cosmic-10000"
 *
 * Used by: error reports (know exactly which stage crashed), HUD level badge,
 * leaderboard filters, achievement triggers.
 */

import { getLevelTier, MAX_GAME_LEVEL } from './constants';

/** Unique stage ID string for any level 1-40000. */
export function getStageName(level: number): string {
  const tier = getLevelTier(level);
  return `${tier}-${String(level).padStart(5, '0')}`;
}

/** Short 3-letter tier code used in analytics keys. */
export function getTierCode(level: number): string {
  const tier = getLevelTier(level);
  const MAP: Record<string, string> = {
    Rookie:      'RKY',
    Arcade:      'ARC',
    Cursed:      'CRS',
    Hard:        'HRD',
    Nightmare:   'NMR',
    Cosmic:      'CSM',
    Singularity: 'SNG',
  };
  return MAP[tier] ?? 'UNK';
}

/** Tier color for UI badges. */
export const TIER_COLORS: Record<string, string> = {
  Rookie:      '#88BBFF',
  Arcade:      '#00F5FF',
  Cursed:      '#CC44FF',
  Hard:        '#FF8800',
  Nightmare:   '#FF2244',
  Cosmic:      '#FFD700',
  Singularity: '#FFFFFF',
};

/** True if this level is a mystery-box trigger (every multiple of 5). */
export function isMysteryBoxLevel(level: number): boolean {
  return level > 0 && level % 5 === 0;
}

/** How many boxes at a mystery-box level:  first occurrence 3, then 4 every subsequent time. */
export function getBoxCount(level: number): number {
  // after level 10, always 4 boxes; first milestone (level 5) = 3 boxes
  return level <= 5 ? 3 : 4;
}

/** Maximum level (sanity guard). */
export { MAX_GAME_LEVEL };
