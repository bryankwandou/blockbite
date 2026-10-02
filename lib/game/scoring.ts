// ═══════════════════════════════════════════════════════════════
// BLOCKBLAST — SCORING SYSTEM
// Multipliers, chain bonuses, perfect board, large piece bonus
// ═══════════════════════════════════════════════════════════════

import {
  POINTS_PER_BLOCK,
  BLOCKS_PER_LINE,
  LINE_MULTIPLIERS,
  PENTA_MULTIPLIER,
  PERFECT_BOARD_BONUS,
  LARGE_PIECE_BONUS,
  CHAIN_BONUSES,
} from './constants';

export interface ScoreResult {
  /** Points earned this placement */
  pointsEarned: number;
  /** Lines + columns cleared */
  linesCleared: number;
  /** Whether the board is completely empty */
  perfectBoard: boolean;
  /** Multiplier applied */
  multiplier: number;
  /** Chain streak count after this move */
  newChain: number;
  /** Description for score popup */
  label: string;
}

/**
 * Calculate score for a single piece placement.
 *
 * @param linesCleared  Number of rows + columns cleared simultaneously
 * @param pieceSize     Number of blocks in the piece placed
 * @param chainStreak   Current consecutive-clear streak BEFORE this move
 * @param perfectBoard  Whether the board is empty after clearing
 * @param nextMultiplierOverride  If set (perfect board next-move bonus), overrides multiplier
 */
export function calculateScore(
  linesCleared: number,
  pieceSize: number,
  chainStreak: number,
  perfectBoard: boolean,
  nextMultiplierOverride?: number,
): ScoreResult {
  let basePoints = 0;
  let multiplier = 1.0;
  let label = '';
  let newChain = chainStreak;

  // ── Large piece placement bonus (always applied) ──────────────
  const largePieceBonus = pieceSize >= 5 ? pieceSize * LARGE_PIECE_BONUS : 0;
  basePoints += largePieceBonus;

  if (linesCleared > 0) {
    // ── Base line-clear points ────────────────────────────────────
    const blocksCleared = linesCleared * BLOCKS_PER_LINE;
    basePoints += blocksCleared * POINTS_PER_BLOCK;

    // ── Line multiplier ───────────────────────────────────────────
    if (nextMultiplierOverride !== undefined) {
      multiplier = nextMultiplierOverride;
    } else if (linesCleared >= 5) {
      multiplier = PENTA_MULTIPLIER;
      label = 'PENTA CLEAR!';
    } else if (linesCleared === 4) {
      multiplier = LINE_MULTIPLIERS[4] ?? 3.0;
      label = 'QUAD CLEAR!';
    } else if (linesCleared === 3) {
      multiplier = LINE_MULTIPLIERS[3] ?? 2.0;
      label = 'TRIPLE CLEAR!';
    } else if (linesCleared === 2) {
      multiplier = LINE_MULTIPLIERS[2] ?? 1.5;
      label = 'DOUBLE CLEAR!';
    } else {
      multiplier = LINE_MULTIPLIERS[1] ?? 1.0;
      label = 'CLEAR';
    }

    // ── Chain / streak bonus ──────────────────────────────────────
    newChain = chainStreak + 1;
    let chainMultiplierBonus = 0;
    for (const bonus of CHAIN_BONUSES) {
      if (newChain >= bonus.threshold) {
        chainMultiplierBonus = bonus.multiplier - 1; // additive bonus
        break;
      }
    }
    if (chainMultiplierBonus > 0) {
      multiplier *= (1 + chainMultiplierBonus);
      if (newChain >= 5) label = `x${newChain} CHAIN! ` + label;
      else if (newChain >= 2) label = `x${newChain} CHAIN ` + label;
    }
  } else {
    // No clear — reset chain
    newChain = 0;
    if (largePieceBonus > 0) {
      label = `+${largePieceBonus} LARGE PIECE`;
    }
  }

  // ── Apply multiplier ──────────────────────────────────────────
  const earnedFromClears = basePoints - largePieceBonus;
  const multipliedClears = Math.round(earnedFromClears * multiplier);
  let pointsEarned = largePieceBonus + multipliedClears;

  // ── Perfect board bonus ───────────────────────────────────────
  if (perfectBoard) {
    pointsEarned += PERFECT_BOARD_BONUS;
    label = 'PERFECT BOARD! +5000';
  }

  return {
    pointsEarned,
    linesCleared,
    perfectBoard,
    multiplier,
    newChain,
    label: label || '',
  };
}

/**
 * Format a score number for display
 */
export function formatScore(score: number): string {
  if (score >= 1_000_000) return (score / 1_000_000).toFixed(2) + 'M';
  if (score >= 10_000) return (score / 1_000).toFixed(1) + 'K';
  return score.toLocaleString();
}

/**
 * Check if a board is completely empty
 */
export function isBoardEmpty(board: { type: string }[][]): boolean {
  return board.every(row => row.every(cell => cell.type === 'empty'));
}
