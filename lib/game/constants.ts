// ═══════════════════════════════════════════════════════════════
// BLOCKBLAST — GAME CONSTANTS & CONFIGURATION
// ═══════════════════════════════════════════════════════════════

export const BOARD_COLS = 8;
export const BOARD_ROWS = 8;
export const CELL_SIZE = 60; // pixels per cell (desktop)
export const CELL_GAP = 3;   // gap between cells

export type BlockColor = 'fire' | 'ice' | 'nature' | 'thunder' | 'shadow' | 'crystal' | 'void';
export type CellType = 'empty' | 'block' | 'obstacle';

export interface Cell {
  type: CellType;
  color?: BlockColor;
}

// ── 7 Block Color Themes ─────────────────────────────────────────
export const BLOCK_COLORS: Record<BlockColor, {
  gradStart: string;
  gradEnd: string;
  glow: string;
  highlight: string;
  name: string;
}> = {
  fire: {
    gradStart: '#FF6B00',
    gradEnd: '#FF0040',
    glow: 'rgba(255, 107, 0, 0.7)',
    highlight: 'rgba(255, 200, 100, 0.4)',
    name: 'FIRE',
  },
  ice: {
    gradStart: '#00C3FF',
    gradEnd: '#0040FF',
    glow: 'rgba(0, 195, 255, 0.7)',
    highlight: 'rgba(180, 240, 255, 0.4)',
    name: 'ICE',
  },
  nature: {
    gradStart: '#00FF88',
    gradEnd: '#00AA44',
    glow: 'rgba(0, 255, 136, 0.7)',
    highlight: 'rgba(160, 255, 200, 0.4)',
    name: 'NATURE',
  },
  thunder: {
    gradStart: '#FFD700',
    gradEnd: '#FF8C00',
    glow: 'rgba(255, 215, 0, 0.7)',
    highlight: 'rgba(255, 245, 150, 0.4)',
    name: 'THUNDER',
  },
  shadow: {
    gradStart: '#AA00FF',
    gradEnd: '#5500AA',
    glow: 'rgba(170, 0, 255, 0.7)',
    highlight: 'rgba(220, 150, 255, 0.4)',
    name: 'SHADOW',
  },
  crystal: {
    gradStart: '#FF00FF',
    gradEnd: '#AA0066',
    glow: 'rgba(255, 0, 255, 0.7)',
    highlight: 'rgba(255, 180, 255, 0.4)',
    name: 'CRYSTAL',
  },
  void: {
    gradStart: '#FFFFFF',
    gradEnd: '#8888AA',
    glow: 'rgba(200, 200, 255, 0.6)',
    highlight: 'rgba(255, 255, 255, 0.5)',
    name: 'VOID',
  },
};

export const COLOR_POOL: BlockColor[] = ['fire', 'ice', 'nature', 'thunder', 'shadow', 'crystal', 'void'];

// ── Scoring Constants ────────────────────────────────────────────
export const POINTS_PER_BLOCK = 10;
export const BLOCKS_PER_LINE = 8; // 8×8 board

export const LINE_MULTIPLIERS: Record<number, number> = {
  1: 1.0,
  2: 1.5,
  3: 2.0,
  4: 3.0,
};
export const PENTA_MULTIPLIER = 5.0;    // 5+ simultaneous clears
export const PERFECT_BOARD_BONUS = 5000;
export const PERFECT_NEXT_MULTIPLIER = 10;
export const LARGE_PIECE_BONUS = 25;    // per block, for pieces with 5+ blocks

export const CHAIN_BONUSES: { threshold: number; multiplier: number }[] = [
  { threshold: 5, multiplier: 2.0 },
  { threshold: 3, multiplier: 1.5 },
  { threshold: 2, multiplier: 1.2 },
];

// ── Level System (MOU V3: 4,000 LEVELS — TIGHTER PROGRESSION CURVE) ──
// Revised 2026-05-16 from 40,000 → 4,000 levels (8 acts × 500/act). Matches
// the BLOCKBITE_AGENT_MEGAPROMPT spec and keeps the map continuous instead
// of looping the same biome scenery indefinitely.
//
// Difficulty mode triggers stay at their original level numbers — they fall
// naturally inside the 1-4000 range now and align with act boundaries:
//   OBSTACLE  (L6)    : intro level 6
//   CURSED    (L21)   : end of opening levels
//   HARD      (L500)  : Act 2 boundary (Frozen Pass)
//   NIGHTMARE (L2500) : Act 6 boundary (Sandborn Dunes)
//   COSMIC/SING.      : un-reachable; kept for forward-compat with old saves
// Raised 2026-10-01 to 500,000 generated levels (lib/game/difficulty.ts).
export const MAX_GAME_LEVEL = 500_000;
export const LEGACY_MAX_LEVEL = 954;         // grandfather reference (was 9540)
export const OBSTACLE_SPAWN_LEVEL = 6;
export const CURSED_MODE_LEVEL = 21;
export const CURSED_PLACEMENT_TRIGGER = 5;
export const HARD_MODE_LEVEL = 500;
export const NIGHTMARE_MODE_LEVEL = 2500;
export const COSMIC_MODE_LEVEL = 10000;
export const SINGULARITY_LEVEL = 25000;

/**
 * Cumulative score threshold needed to REACH `level`.
 * Curve stages:
 *   1‒5     :  very gentle (onboarding)
 *   6‒20    :  classic arcade ramp
 *   21‒500  :  cursed-mode ramp (quadratic)
 *   501‒2500:  hard mode (quadratic w/ log softener)
 *   2501‒10000: nightmare mode
 *   10001‒25000: cosmic mode
 *   25001‒40000: singularity (mastery curve)
 *
 * Verified strictly monotonic across every tier boundary.
 * Cumulative checkpoints: L500≈608k · L2500≈3.66M · L10000≈21M · L25000≈79M · L40000≈166M
 * — demanding but reachable for elite long-session play, matching the MOU endgame target.
 */
export function getLevelThreshold(level: number): number {
  if (level <= 1) return 500;
  if (level <= 5) return 500 + (level - 1) * 625;                 // 500 → 3000
  if (level <= 10) return 3000 + (level - 5) * 1000;              // 3000 → 8000
  if (level <= 20) return 8000 + (level - 10) * 1700;             // 8000 → 25000

  if (level <= 500) {
    // +1200 per level with log smoothing → ~600k at L500
    const d = level - 20;
    return 25000 + d * 1200 + Math.floor(Math.log2(d + 1) * 800);
  }

  if (level <= 2500) {
    // quadratic ramp: +1500 per level + (d*d)/80
    const d = level - 500;
    const base = getLevelThreshold(500);
    return base + d * 1500 + Math.floor((d * d) / 80);
  }

  if (level <= 10000) {
    // nightmare: +2200 per level + cubic softener
    const d = level - 2500;
    const base = getLevelThreshold(2500);
    return base + d * 2200 + Math.floor((d * d) / 60);
  }

  if (level <= 25000) {
    // cosmic: +3500 per level + quadratic
    const d = level - 10000;
    const base = getLevelThreshold(10000);
    return base + d * 3500 + Math.floor((d * d) / 40);
  }

  // singularity mastery curve (25001 → 40000)
  const d = level - 25000;
  const base = getLevelThreshold(25000);
  return base + d * 5200 + Math.floor((d * d) / 25);
}

/**
 * Target reward-pool contribution multiplier for a given level,
 * used by leaderboard & session analytics. Logarithmic, soft-capped at 10×.
 */
export function getLevelRewardMultiplier(level: number): number {
  if (level <= 1) return 1.0;
  const mult = 1 + Math.log10(level) * 0.8;
  return Math.min(10, Number(mult.toFixed(3)));
}

/**
 * Obstacle count for a level. Capped at 24/64 cells (≈37.5%) to keep
 * the board solvable; variant shifts come from `getObstacleVariant()`.
 */
export function getObstacleCountForLevel(level: number): number {
  if (level < OBSTACLE_SPAWN_LEVEL) return 0;
  if (level <= 10) return 10 + (level - 6);                             // 10 → 14
  if (level <= 100) return 15 + Math.floor((level - 10) / 10);          // 15 → 24
  if (level <= 500) return Math.min(20, 15 + Math.floor((level - 100) / 50));
  if (level <= 2500) return Math.min(22, 20 + Math.floor((level - 500) / 500));
  if (level <= 10000) return Math.min(23, 22 + Math.floor((level - 2500) / 2500));
  // cosmic + singularity: approach the 24 cap
  return Math.min(24, 23 + Math.floor((level - 10000) / 10000));
}

/**
 * Obstacle variant tier. Determines visual + behavior on the renderer:
 *   0 = static stone  (L6+)
 *   1 = shifting shadow (L21+ cursed)
 *   2 = pulsing core   (L500+ hard)
 *   3 = unstable void  (L2500+ nightmare)
 *   4 = cosmic rift    (L10000+)
 *   5 = singularity    (L25000+)
 */
export function getObstacleVariant(level: number): 0 | 1 | 2 | 3 | 4 | 5 {
  if (level >= SINGULARITY_LEVEL) return 5;
  if (level >= COSMIC_MODE_LEVEL) return 4;
  if (level >= NIGHTMARE_MODE_LEVEL) return 3;
  if (level >= HARD_MODE_LEVEL) return 2;
  if (level >= CURSED_MODE_LEVEL) return 1;
  return 0;
}

/** Named tier for UI badges / telemetry. */
export function getLevelTier(level: number): 'Rookie' | 'Arcade' | 'Cursed' | 'Hard' | 'Nightmare' | 'Cosmic' | 'Singularity' {
  if (level >= SINGULARITY_LEVEL) return 'Singularity';
  if (level >= COSMIC_MODE_LEVEL) return 'Cosmic';
  if (level >= NIGHTMARE_MODE_LEVEL) return 'Nightmare';
  if (level >= HARD_MODE_LEVEL) return 'Hard';
  if (level >= CURSED_MODE_LEVEL) return 'Cursed';
  if (level >= OBSTACLE_SPAWN_LEVEL) return 'Arcade';
  return 'Rookie';
}

// ── Game Timing ──────────────────────────────────────────────────
export const ANIMATION_PLACE_MS = 120;
export const ANIMATION_CLEAR_MS = 400;
export const ANIMATION_SCORE_POP_MS = 1500;
export const GAME_LOOP_TARGET_FPS = 60;

// Production Game Constants
export const GRID_SIZE = 8;
export const BOARD_WIDTH = 8;
export const BOARD_HEIGHT = 8;

export const TICKET_COST_USDC = 1.0;
export const PRIZE_POOL_PERCENTAGE = 0.70;
export const TEAM_REVENUE_PERCENTAGE = 0.15;
export const DEV_FUND_PERCENTAGE = 0.10;
export const REFERRAL_PERCENTAGE = 0.05;

// ── Prize Distribution (MOU V3: Top-10 + Participation) ──
// Rationale: limiting payouts to 10 known ranks + a single participation bucket
// keeps each monthly payout batch small, and
// eliminates the "long-tail sybil" exploit class (where attackers spam cheap
// accounts to farm micro-rewards from rank 51-100 tiers).
//
// Total of the "prize pool" (= 70% of monthly ticket sales) is split:
//   Rank 1        → 30%
//   Rank 2        → 20%
//   Rank 3        → 10%        (top-3 combined = 60%)
//   Rank 4-10     → 25% pool,  split evenly across 7 seats
//   Participation → 15%        split by ticket-weighted entries among ALL players
export interface PrizeTier {
  rank: number | [number, number];   // single rank or inclusive range
  pct: number;                       // % of the total prize pool
  split: 'single' | 'even' | 'ticket-weighted';
  label: string;
}

export const PRIZE_DISTRIBUTION: PrizeTier[] = [
  { rank: 1,        pct: 30, split: 'single',          label: 'Gold'         },
  { rank: 2,        pct: 20, split: 'single',          label: 'Silver'       },
  { rank: 3,        pct: 10, split: 'single',          label: 'Bronze'       },
  { rank: [4, 10],  pct: 25, split: 'even',            label: 'Top 10'       },
  { rank: [11, -1], pct: 15, split: 'ticket-weighted', label: 'Participation'},
];

/** Total payout seats (excluding the participation bucket). */
export const PAYOUT_SEATS = 10;

// ── Prize Token Configuration ─────────────────────────────────────
// Pool can be denominated in USDC (default, price stable) OR any configured
// SPL token, chosen per period.
export type PrizeToken = 'USDC' | 'USDT' | 'BONK' | 'JUP' | 'WIF' | 'SOL';
export interface PrizeTokenConfig {
  symbol: PrizeToken;
  mint: string;          // SPL mint address (mainnet)
  decimals: number;
  stable: boolean;       // true = USD-pegged stablecoin
}

export const PRIZE_TOKENS: Record<PrizeToken, PrizeTokenConfig> = {
  USDC: { symbol: 'USDC', mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6, stable: true  },
  USDT: { symbol: 'USDT', mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6, stable: true  },
  BONK: { symbol: 'BONK', mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', decimals: 5, stable: false },
  JUP:  { symbol: 'JUP',  mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',  decimals: 6, stable: false },
  WIF:  { symbol: 'WIF',  mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', decimals: 6, stable: false },
  SOL:  { symbol: 'SOL',  mint: 'So11111111111111111111111111111111111111112',  decimals: 9, stable: false },
};

/** Active prize token for the current period. Default USDC, admin-switchable. */
export const DEFAULT_PRIZE_TOKEN: PrizeToken = 'USDC';

// ── Monthly Period Duration (V3: switched from weekly → monthly) ───
// Why monthly: accumulates a meaningfully larger prize pool per cycle,
// reduces on-chain distribution cost from 52→12 events/year, and matches
// the cadence most Solana reward programs use (Drift, Kamino, etc).
export const PERIOD_CADENCE: 'weekly' | 'monthly' = 'monthly';
export const PERIOD_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // ~30 days

/** First day of next month, 00:00 UTC — the monthly distribution tick. */
function nextMonthStartUTC(): Date {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0));
  return next;
}

export const PERIOD_END = nextMonthStartUTC();

// ── Shop Packages ($1 = 5 tickets base rate) ─────────────────────
// Base rate: $0.20 per ticket (5 tickets per $1 USDC).
// Larger bundles offer deeper discounts + bonus perks.
export const TICKET_COST_PER_TICKET_BASE = 0.20;   // $1 / 5 tickets
// Ranked tickets: 1 USDC each, no bundle discounts (the server verifies the exact split).
export const TICKET_PACKAGES = [
  { id: 'starter',  name: 'Single', tickets: 1,  price: 1,  pricePerTicket: 1, discount: 0, bonuses: ['One ranked attempt'] },
  { id: 'explorer', name: 'Daily',  tickets: 3,  price: 3,  pricePerTicket: 1, discount: 0, bonuses: ['All 3 attempts today'] },
  { id: 'warrior',  name: 'Week',   tickets: 21, price: 21, pricePerTicket: 1, discount: 0, bonuses: ['3 attempts × 7 days'] },
  { id: 'champion', name: 'Month',  tickets: 30, price: 30, pricePerTicket: 1, discount: 0, bonuses: ['Max per purchase'] },
];
