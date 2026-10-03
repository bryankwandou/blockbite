/**
 * Pastel palette generator. Single source of truth for:
 *   - styles/themes.css           (lib/themes/scripts/build-css.mjs)
 *   - the contrast check           (lib/themes/scripts/contrast-check.mjs)
 *   - the in-app custom builder    (components/theme/*)
 *
 * Self-contained on purpose (no imports) so plain Node can run it with
 * type stripping.
 */

export type Mode = 'light' | 'dark';

export interface PaletteSeed {
  id: string;
  name: string;
  /** what it is named after, shown under the name */
  from: 'mascot' | 'biome' | 'pad';
  hue: number;      // background tint hue
  accent: number;   // accent hue
  sat: number;      // background saturation scale 0..1
  /** 7 block hues; omit to spread around the background hue */
  blocks?: number[];
}

export const TOKENS = [
  '--bg', '--surface', '--text', '--text-dim', '--border', '--accent', '--accent2',
  '--warn', '--danger', '--ok', '--board-bg',
  '--block-1', '--block-2', '--block-3', '--block-4', '--block-5', '--block-6', '--block-7',
] as const;
export type Token = (typeof TOKENS)[number];
export type Tokens = Record<Token, string>;

// Game palette (components/Mascot PALETTES + colour pad) as hues.
const PAD = [355, 40, 55, 140, 195, 233, 320];

export const SEEDS: PaletteSeed[] = [
  { id: 'rex',      name: 'Rex Crown Lilac',        from: 'mascot', hue: 236, accent: 236, sat: 0.9 },
  { id: 'tide',     name: 'Tide Seafoam Hush',      from: 'mascot', hue: 192, accent: 195, sat: 0.9 },
  { id: 'brawler',  name: 'Brawler Peach Punch',    from: 'mascot', hue: 356, accent: 354, sat: 0.9 },
  { id: 'sunny',    name: 'Sunny Butter Biscuit',   from: 'mascot', hue: 42,  accent: 36,  sat: 1 },
  { id: 'blaze',    name: 'Blaze Berry Marshmallow',from: 'mascot', hue: 322, accent: 320, sat: 0.9 },
  { id: 'crystal',  name: 'Crystal Cavern Haze',    from: 'biome',  hue: 262, accent: 258, sat: 0.8 },
  { id: 'frost',    name: 'Frozen Pass Milk Tea',   from: 'biome',  hue: 204, accent: 200, sat: 0.7 },
  { id: 'ember',    name: 'Ember Foundry Apricot',  from: 'biome',  hue: 22,  accent: 18,  sat: 1 },
  { id: 'verdant',  name: 'Verdant Hollow Matcha',  from: 'biome',  hue: 105, accent: 120, sat: 0.6 },
  { id: 'dunes',    name: 'Sandborn Shortbread',    from: 'biome',  hue: 34,  accent: 28,  sat: 0.55 },
  { id: 'voidline', name: 'Voidline Twilight Plum', from: 'biome',  hue: 282, accent: 290, sat: 0.6 },
  { id: 'confetti', name: 'Colour Pad Confetti',    from: 'pad',    hue: 300, accent: 268, sat: 0.35, blocks: PAD },
];

// â”€â”€ colour maths â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

export function hsl(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360; s = clamp(s, 0, 100) / 100; l = clamp(l, 0, 100) / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hx = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${hx(f(0))}${hx(f(8))}${hx(f(4))}`;
}

function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export function contrast(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Walk lightness away from bg until the colour reaches `min` contrast. */
function fit(h: number, s: number, l: number, bg: string, mode: Mode, min = 4.6): string {
  let c = hsl(h, s, l);
  for (let i = 0; i < 100 && contrast(c, bg) < min; i++) {
    l += mode === 'light' ? -1 : 1;
    c = hsl(h, s, l);
  }
  return c;
}

/**
 * softness 0..4: 0 = crisp near-white / near-ink, 4 = deepest pastel tint.
 */
export function generate(seed: Pick<PaletteSeed, 'hue' | 'accent' | 'sat' | 'blocks'>, mode: Mode, softness = 2): Tokens {
  const { hue: h, accent: a, sat } = seed;
  const soft = clamp(Math.round(softness), 0, 4);
  const hues = seed.blocks ?? Array.from({ length: 7 }, (_, i) => h + i * (360 / 7));
  if (mode === 'light') {
    const bg = hsl(h, (40 + soft * 12) * sat, 98.5 - soft * 1.2);
    const surface = hsl(h, (45 + soft * 8) * sat, 95 - soft);
    const t: Partial<Tokens> = {
      '--bg': bg,
      '--surface': surface,
      '--border': hsl(h, 35 * sat + 10, 86 - soft),
      '--board-bg': hsl(h, 50 * sat + 10, 92 - soft),
      '--text': fit(h, 30, 16, surface, mode, 11),
      '--text-dim': fit(h, 18, 40, surface, mode),
      '--accent': fit(a, 42, 46, bg, mode),
      '--accent2': fit(a + 150, 38, 36, bg, mode),
      '--warn': fit(32, 80, 34, bg, mode),
      '--danger': fit(0, 65, 40, bg, mode),
      '--ok': fit(140, 60, 28, bg, mode),
    };
    hues.forEach((bh, i) => { t[`--block-${i + 1}` as Token] = hsl(bh, 70, 80); });
    return t as Tokens;
  }
  const bg = hsl(h, (18 + soft * 3) * sat + 4, 11 + soft * 1.2);
  const t: Partial<Tokens> = {
    '--bg': bg,
    '--surface': hsl(h, 20 * sat + 4, 16 + soft),
    '--border': hsl(h, 18 * sat + 4, 27 + soft),
    '--board-bg': hsl(h, 22 * sat + 4, 17 + soft),
    '--text': fit(h, 60, 95, bg, mode, 12),
    '--text-dim': fit(h, 22, 72, bg, mode),
    '--accent': fit(a, 75, 80, bg, mode),
    '--accent2': fit(a + 150, 55, 76, bg, mode),
    '--warn': fit(42, 90, 70, bg, mode),
    '--danger': fit(0, 90, 78, bg, mode),
    '--ok': fit(140, 65, 70, bg, mode),
  };
  hues.forEach((bh, i) => { t[`--block-${i + 1}` as Token] = hsl(bh, 55, 72); });
  return t as Tokens;
}

/** Text/background pairs that must reach WCAG AA (4.5:1). */
export const CONTRAST_PAIRS: [Token, Token][] = [
  ['--text', '--bg'], ['--text-dim', '--bg'], ['--text', '--surface'], ['--text-dim', '--surface'],
  ['--accent', '--bg'], ['--bg', '--accent'], // accent text, and bg-coloured label on accent buttons
  ['--accent2', '--bg'], ['--warn', '--bg'], ['--danger', '--bg'], ['--ok', '--bg'],
  ['--text', '--board-bg'],
];

// â”€â”€ share codes: <base>-<hue>-<softness>, e.g. "tide-200-3" â”€â”€â”€â”€â”€
export interface CustomTheme { base: string; accent: number; softness: number }

/**
 * Pastel studio bases (see pastel.ts). Code "<base>-<hue>-<tier>": hue 0..359 is the colour,
 * tier 0..4 is the softness. The base picks how much colour the backgrounds carry.
 * Old preset-based codes keep working unchanged.
 */
export const PASTEL_BASES: Record<string, number> = { pastel: 1, muted: 0.45, ashen: 0.12 };

const CODE_RE = /^([a-z]{3,10})-(\d{1,3})-([0-4])$/;

export function parseCode(code: unknown): CustomTheme | null {
  if (typeof code !== 'string' || code.length > 20) return null;
  const m = CODE_RE.exec(code.trim().toLowerCase());
  if (!m) return null;
  const accent = Number(m[2]);
  if ((!SEEDS.some((s) => s.id === m[1]) && !(m[1] in PASTEL_BASES)) || accent > 359) return null;
  return { base: m[1], accent, softness: Number(m[3]) };
}

export function encodeCode(c: CustomTheme): string {
  return `${c.base}-${clamp(Math.round(c.accent), 0, 359)}-${clamp(Math.round(c.softness), 0, 4)}`;
}

export function customTokens(c: CustomTheme, mode: Mode): Tokens {
  if (c.base in PASTEL_BASES) return generate({ hue: c.accent, accent: c.accent, sat: PASTEL_BASES[c.base] }, mode, c.softness);
  const seed = SEEDS.find((s) => s.id === c.base) ?? SEEDS[0];
  return generate({ ...seed, accent: c.accent }, mode, c.softness);
}

/** Inline style string; only `--token:#rrggbb;` pairs, matched by the pre-paint script. */
export function toVarString(t: Tokens): string {
  return TOKENS.map((k) => `${k}:${t[k]};`).join('');
}
export const VAR_STRING_RE = /^(--[a-z0-9-]{2,12}:#[0-9a-f]{6};){1,24}$/;
