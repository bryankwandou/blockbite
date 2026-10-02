/**
 * Procedural badge for an achievement: shape × frame × icon × tier colour ×
 * numeral, as one SVG string (viewBox 0 0 64 64). No images.
 */
import { TIER_COLORS, type Category, type Emblem } from './catalog';

const SHAPES: string[] = [
  'M32 3 L57 17 V47 L32 61 L7 47 V17Z',                        // hexagon
  'M32 3 L58 11 V32 Q58 52 32 61 Q6 52 6 32 V11Z',              // shield
  'M32 3 A29 29 0 1 1 31.9 3Z',                                // disc
  'M10 4 H54 Q60 4 60 10 V54 Q60 60 54 60 H10 Q4 60 4 54 V10 Q4 4 10 4Z', // block
  'M32 2 L62 32 L32 62 L2 32Z',                                 // diamond
  'M32 2 L40 22 L62 24 L45 38 L51 60 L32 48 L13 60 L19 38 L2 24 L24 22Z', // star
];

const FRAMES = [
  (e: string) => `stroke="${e}" stroke-width="3"`,
  (e: string) => `stroke="${e}" stroke-width="3" stroke-dasharray="5 3"`,
  (e: string) => `stroke="${e}" stroke-width="5" stroke-opacity=".55"`,
  (e: string) => `stroke="${e}" stroke-width="2" stroke-dasharray="1 3" stroke-linecap="round"`,
  (e: string) => `stroke="${e}" stroke-width="4" stroke-linejoin="bevel"`,
];

/** Small icons, drawn in a 0..20 box centred at (32, 25). */
const ICONS: Record<Category, string> = {
  level: '<path d="M2 18 L10 4 L18 18Z"/><rect x="8" y="12" width="4" height="6"/>',
  lines: '<rect x="1" y="4" width="18" height="4" rx="1"/><rect x="1" y="12" width="18" height="4" rx="1"/>',
  combos: '<path d="M11 1 L4 11 H10 L8 19 L16 8 H10Z"/>',
  perfect: '<rect x="2" y="2" width="7" height="7" rx="1"/><rect x="11" y="2" width="7" height="7" rx="1"/><rect x="2" y="11" width="7" height="7" rx="1"/><rect x="11" y="11" width="7" height="7" rx="1"/>',
  ranked_days: '<rect x="2" y="4" width="16" height="14" rx="2"/><rect x="5" y="1" width="2" height="5"/><rect x="13" y="1" width="2" height="5"/>',
  top10: '<path d="M3 3 H17 V8 Q17 14 10 14 Q3 14 3 8Z"/><rect x="8" y="14" width="4" height="3"/><rect x="5" y="17" width="10" height="2"/>',
  streak: '<path d="M10 1 Q17 8 15 14 Q13 19 10 19 Q5 19 5 14 Q5 10 9 7 Q9 11 11 11 Q12 6 10 1Z"/>',
  games: '<rect x="1" y="6" width="18" height="10" rx="5"/>',
  score: '<path d="M10 1 L12.5 7 L19 7.5 L14 11.5 L15.5 18 L10 14.5 L4.5 18 L6 11.5 L1 7.5 L7.5 7Z"/>',
  avatars: '<rect x="3" y="3" width="14" height="14" rx="3"/><circle cx="7.5" cy="9" r="1.6" fill="#fff"/><circle cx="12.5" cy="9" r="1.6" fill="#fff"/>',
};

export function emblemSvg(e: Emblem, size = 64): string {
  const c = TIER_COLORS[e.tier];
  const shape = SHAPES[e.shape];
  const fs = e.numeral.length > 4 ? 10 : 12;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">`
    + `<path d="${shape}" fill="${c.fill}" ${FRAMES[e.frame](c.edge)}/>`
    + `<path d="${shape}" fill="#fff" opacity=".18" transform="translate(32 32) scale(.7) translate(-32 -32)"/>`
    + `<g transform="translate(22 14)" fill="${c.text}">${ICONS[e.icon]}</g>`
    + `<text x="32" y="50" text-anchor="middle" font-family="system-ui,sans-serif" font-weight="800" font-size="${fs}" fill="${c.text}">${e.numeral}</text>`
    + '</svg>';
}
