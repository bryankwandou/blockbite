/**
 * Deterministic saga-map geometry. Nothing is stored: a node's position is a
 * pure function of its global level number, so the path is continuous across
 * acts and any of the 500,000 levels can be located without a lookup table.
 */
import type { Biome } from '@/lib/game/biomes';

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

/* ── Biome art as tiny inline SVG (data URIs, no image files) ────────── */

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);
const uri = (svg: string) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

export const TILE = 640; // px height of every repeating art tile

type Shape = 'spire' | 'pine' | 'rock' | 'coral' | 'pillar';
const SHAPE: Record<string, Shape> = {
  crystal: 'spire', frost: 'pine', ember: 'rock', verdant: 'pine',
  tidewave: 'coral', dunes: 'rock', voidline: 'spire', apex: 'pillar',
};

function prop(shape: Shape, x: number, base: number, s: number, fill: string, hi: string): string {
  switch (shape) {
    case 'spire':
      return `<path d="M${x} ${base}l${s * 0.35} ${-s * 1.6} ${s * 0.35} ${s * 1.6}z" fill="${fill}"/>`
        + `<path d="M${x + s * 0.35} ${base - s * 1.6}l${s * 0.35} ${s * 1.6}h${-s * 0.2}z" fill="${hi}" opacity=".45"/>`;
    case 'pine':
      return `<path d="M${x} ${base}l${s * 0.5} ${-s * 1.5} ${s * 0.5} ${s * 1.5}z" fill="${fill}"/>`
        + `<path d="M${x + s * 0.15} ${base - s * 0.75}l${s * 0.35} ${-s * 1.1} ${s * 0.35} ${s * 1.1}z" fill="${fill}"/>`
        + `<path d="M${x + s * 0.5} ${base - s * 1.85}l${s * 0.18} ${s * 0.55}h${-s * 0.36}z" fill="${hi}" opacity=".7"/>`;
    case 'rock':
      return `<path d="M${x} ${base}q${s * 0.1} ${-s * 0.9} ${s * 0.6} ${-s} ${s * 0.6} ${s * 0.2} ${s * 0.7} ${s}z" fill="${fill}"/>`
        + `<path d="M${x + s * 0.4} ${base - s * 0.95}q${s * 0.3} 0 ${s * 0.5} ${s * 0.25}" stroke="${hi}" stroke-width="3" fill="none" opacity=".5"/>`;
    case 'coral':
      return `<path d="M${x + s * 0.5} ${base}v${-s}m0 ${s * 0.45}q${-s * 0.4} 0 ${-s * 0.4} ${-s * 0.6}m${s * 0.4} ${s * 0.3}q${s * 0.45} 0 ${s * 0.45} ${-s * 0.7}" stroke="${fill}" stroke-width="${s * 0.14}" stroke-linecap="round" fill="none"/>`
        + `<circle cx="${x + s * 0.5}" cy="${base - s}" r="${s * 0.09}" fill="${hi}"/>`;
    case 'pillar':
      return `<rect x="${x}" y="${base - s * 1.4}" width="${s * 0.38}" height="${s * 1.4}" fill="${fill}"/>`
        + `<rect x="${x - s * 0.08}" y="${base - s * 1.5}" width="${s * 0.54}" height="${s * 0.12}" fill="${hi}" opacity=".6"/>`;
  }
}

/** Far mountains, mid floating islands and near edge props for one biome. */
export function biomeLayers(b: Biome): { far: string; mid: string; fore: string } {
  const r = rng(hash(b.id));
  const shape = SHAPE[b.id] ?? 'spire';
  const W = 400;

  let far = '';
  for (let band = 0; band < 2; band++) {
    const base = band === 0 ? 300 : 620;
    let d = `M0 ${base}`;
    for (let x = 0; x <= W; x += 40) d += `L${x} ${base - 60 - r() * 140}`;
    d += `L${W} ${base}Z`;
    far += `<path d="${d}" fill="${b.rock}" opacity=".55"/>`;
  }

  let mid = '';
  for (let i = 0; i < 3; i++) {
    const cx = 30 + r() * 340, cy = 80 + i * 200 + r() * 60, w = 60 + r() * 50;
    mid += `<ellipse cx="${cx}" cy="${cy + 10}" rx="${w * 0.42}" ry="${w * 0.32}" fill="${b.rock}"/>`
      + `<ellipse cx="${cx}" cy="${cy}" rx="${w * 0.55}" ry="${w * 0.14}" fill="${b.accent}" opacity=".55"/>`
      + prop(shape, cx - w * 0.2, cy, w * 0.35, b.rock, b.glow);
  }

  let fore = '';
  for (let i = 0; i < 4; i++) {
    const left = i % 2 === 0;
    const s = 70 + r() * 60;
    const x = left ? -s * 0.2 + r() * 10 : W - s * 0.8 - r() * 10;
    fore += prop(shape, x, 140 + i * 160, s, '#05060f', b.accent);
  }

  const wrap = (body: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${TILE}" preserveAspectRatio="none">${body}</svg>`;
  return { far: uri(wrap(far)), mid: uri(wrap(mid)), fore: uri(wrap(fore)) };
}

/** Seasonal sky dressing from the calendar month (0-11). */
export type Season = 'harvest' | 'snow' | null;
export const seasonFor = (month: number): Season =>
  month === 9 || month === 10 ? 'harvest' : month === 11 || month === 0 ? 'snow' : null;
