/**
 * Deterministic saga-map geometry. Nothing is stored: a node's position is a
 * pure function of its global level number, so the path is continuous across
 * acts and any of the 500,000 levels can be located without a lookup table.
 */

export const NODE_DY_MOBILE = 92;   // px between consecutive levels
export const NODE_DY_WIDE = 108;
export const EDGE_MARGIN = 150;     // px above the last / below the first node
export const CHUNK = 6;             // virtual window moves in steps of this many nodes

/** Horizontal position in px for global level L across a stage `w` px wide. */
export function nodeX(level: number, w: number): number {
  const half = w / 2;
  const amp = Math.max(40, Math.min(half - 52, 260));
  const p = level * 0.62;
  return half + amp * (0.8 * Math.sin(p) + 0.2 * Math.sin(level * 1.87 + 1.3));
}

/** Vertical position in the act's world: first level of the act at the bottom. */
export function nodeY(idx: number, total: number, dy: number): number {
  return EDGE_MARGIN + (total - 1 - idx) * dy;
}

export const worldHeight = (total: number, dy: number) => (total - 1) * dy + EDGE_MARGIN * 2;

export type NodeKind = 'boss' | 'chest' | 'sign' | 'plain';
export function nodeKind(level: number): NodeKind {
  if (level % 50 === 0) return 'boss';
  if (level % 25 === 0) return 'chest';
  if (level % 10 === 0) return 'sign';
  return 'plain';
}

/* Biome scenery lives in ./biomeArt (drawn at the stage's real width). */
export { TILE, biomeLayers, decoUri, mix, palette } from './biomeArt';

/** Seasonal sky dressing from the calendar month (0-11). */
export type Season = 'harvest' | 'snow' | null;
export const seasonFor = (month: number): Season =>
  month === 9 || month === 10 ? 'harvest' : month === 11 || month === 0 ? 'snow' : null;
