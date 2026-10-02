// lib/game/levelBridge.ts
// Adapts the 500,000-level design system (LevelConfig) to the engine's runtime types.
// Keeps both systems cleanly decoupled — engine never imports from levelGenerator directly.

import type { LevelConfig, TrayPiece } from './levelTypes';
import type { Cell, BlockColor } from './constants';
import type { Piece } from './pieces';
import { levelConfig as _levelConfig, TOTAL_LEVELS } from './levelGenerator';

// ── Color mapping: design-system palette names → engine BlockColor ───────────
// The design system uses string color names; the engine has a fixed BlockColor union.
const PALETTE_MAP: Record<string, BlockColor> = {
  cyan:     'ice',
  magenta:  'crystal',
  gold:     'thunder',
  fire:     'fire',
  ice:      'ice',
  nature:   'nature',
  thunder:  'thunder',
  shadow:   'shadow',
  crystal:  'crystal',
  void:     'void',
};

function toBlockColor(palette: string): BlockColor {
  return PALETTE_MAP[palette] ?? 'ice';
}

// ── Board conversion ─────────────────────────────────────────────────────────
/**
 * Convert a LevelConfig board grid into the engine's Cell[][] format.
 * - null grid cell          → { type: 'empty' }
 * - color string grid cell  → { type: 'block', color }
 * - cellMods entries        → { type: 'obstacle', color: 'void' } (engine renders as locked/obstacle)
 */
export function levelConfigToBoard(config: LevelConfig): Cell[][] {
  const { size, grid, cellMods } = config.board;
  const board: Cell[][] = Array.from({ length: size }, (_, r) =>
    Array.from({ length: size }, (_, c) => {
      const modKey = `${r},${c}`;
      if (cellMods[modKey]) {
        // Cell modifiers (locked, ice, stone…) → rendered as obstacles in phase 0
        return { type: 'obstacle' as const, color: 'void' as BlockColor };
      }
      const color = grid[r][c];
      if (color) {
        return { type: 'block' as const, color: toBlockColor(color) };
      }
      return { type: 'empty' as const };
    }),
  );
  return board;
}

// ── Tray conversion ──────────────────────────────────────────────────────────
/** Convert a single LevelConfig TrayPiece to an engine Piece. */
export function trayPieceToEnginePiece(tp: TrayPiece): Piece {
  const size = tp.shape.flat().filter(Boolean).length;
  return {
    id: `lc_${tp.color}_${size}`,
    shape: tp.shape,
    size,
    color: toBlockColor(tp.color),
  };
}

/** Convert all 3 tray slots from a LevelConfig. */
export function levelConfigToTray(config: LevelConfig): [Piece, Piece, Piece] {
  const tray = config.tray.slice(0, 3);
  // Pad with fallback if config has fewer than 3 pieces (shouldn't happen)
  while (tray.length < 3) tray.push(config.tray[0]);
  return tray.map(trayPieceToEnginePiece) as [Piece, Piece, Piece];
}

// ── Content-level lookup ─────────────────────────────────────────────────────
/**
 * Map a player's engine level to a content level. Since the 500,000-level
 * generator every level has its own content, so this is a clamp, not a cycle.
 */
export function contentLevelFor(engineLevel: number): number {
  return Math.max(1, Math.min(TOTAL_LEVELS, Math.floor(engineLevel) || 1));
}

/** Safe wrapper — catches any generator error and returns null. */
export function safeLevelConfig(engineLevel: number): LevelConfig | null {
  try {
    return _levelConfig(contentLevelFor(engineLevel));
  } catch {
    return null;
  }
}
