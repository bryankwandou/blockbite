/**
 * Pastel studio: 400+ deterministic soft colours, each one a share code
 * "<base>-<hue>-<tier>" (base in PASTEL_BASES). Colours whose generated light or
 * dark theme misses WCAG AA (4.5:1) on any CONTRAST_PAIRS entry are skipped.
 */
import { CONTRAST_PAIRS, PASTEL_BASES, contrast, customTokens, hsl, type CustomTheme } from './gen';

export type Family = 'rose' | 'peach' | 'butter' | 'mint' | 'sky' | 'lilac' | 'orchid' | 'sand' | 'neutral';
export const FAMILIES: Family[] = ['rose', 'peach', 'butter', 'mint', 'sky', 'lilac', 'orchid', 'sand', 'neutral'];

const BASES = Object.keys(PASTEL_BASES); // pastel, muted, ashen

export function familyOf(base: string, hue: number): Family {
  if (base === 'ashen') return 'neutral';
  const h = ((hue % 360) + 360) % 360;
  if (base === 'muted' && h >= 10 && h < 70) return 'sand';
  if (h >= 340 || h < 10) return 'rose';
  if (h < 35) return 'peach';
  if (h < 70) return 'butter';
  if (h < 170) return 'mint';
  if (h < 230) return 'sky';
  if (h < 290) return 'lilac';
  return 'orchid';
}

const NOUN: Record<Family, string> = {
  rose: 'Rose', peach: 'Peach', butter: 'Butter', mint: 'Mint', sky: 'Sky', lilac: 'Lilac',
  orchid: 'Orchid', sand: 'Sand', neutral: 'Cloud',
};
const MODS = [
  'Biscuit', 'Puff', 'Marshmallow', 'Bubble', 'Cookie', 'Jelly', 'Pudding', 'Cupcake', 'Macaron', 'Sprinkle',
  'Pocket', 'Quest', 'Pixel', 'Token', 'Lantern', 'Sparkle', 'Cozy', 'Dream', 'Dapper', 'Meadow',
];

/** Every colour the studio can produce, in a stable order (the grid is a subset). */
function allCodes(): CustomTheme[] {
  const out: CustomTheme[] = [];
  for (const base of BASES) for (let hue = 0; hue < 360; hue++) for (let softness = 0; softness <= 4; softness++)
    out.push({ base, accent: hue, softness });
  return out;
}

let rank: Map<string, number> | null = null;
function ranks(): Map<string, number> {
  if (rank) return rank;
  rank = new Map();
  const per: Record<string, number> = {};
  for (const c of allCodes()) {
    const f = familyOf(c.base, c.accent);
    per[f] = (per[f] ?? 0) + 1;
    rank.set(`${c.base}-${c.accent}-${c.softness}`, per[f]);
  }
  return rank;
}

/** Deterministic soft name, unique per colour: "<Family noun> <modifier> <n>", e.g. "Peach Biscuit 3". */
export function pastelName(c: CustomTheme): string {
  const k = `${c.base}-${c.accent}-${c.softness}`;
  const n = ranks().get(k) ?? 0;
  const f = familyOf(c.base, c.accent);
  const mod = MODS[(Math.floor(c.accent / 10) * 7 + c.softness * 3 + BASES.indexOf(c.base)) % MODS.length];
  return `${NOUN[f]} ${mod} ${n}`;
}

/** The pastel fill shown on a swatch. */
export function swatchColor(c: CustomTheme): string {
  const sat = PASTEL_BASES[c.base] ?? 1;
  return hsl(c.accent, 30 + 55 * sat, 91 - c.softness * 3.5);
}

/** true when both modes reach 4.5:1 on every text/background pair. */
export function passesContrast(c: CustomTheme): boolean {
  return (['light', 'dark'] as const).every((m) => {
    const t = customTokens(c, m);
    return CONTRAST_PAIRS.every(([f, b]) => contrast(t[f], t[b]) >= 4.5);
  });
}

export interface PastelColour { code: string; theme: CustomTheme; family: Family; name: string; fill: string }

const STEPS: Record<string, number> = { pastel: 10, muted: 10, ashen: 30 };

let grid: PastelColour[] | null = null;
/** The curated swatch list (contrast-checked, computed once on demand). */
export function pastelGrid(): PastelColour[] {
  if (grid) return grid;
  grid = [];
  for (const base of BASES) for (let hue = 0; hue < 360; hue += STEPS[base]) for (let softness = 0; softness <= 4; softness++) {
    const theme = { base, accent: hue, softness };
    if (!passesContrast(theme)) continue;
    grid.push({ code: `${base}-${hue}-${softness}`, theme, family: familyOf(base, hue), name: pastelName(theme), fill: swatchColor(theme) });
  }
  return grid;
}

export function pastelGroups(): { family: Family; items: PastelColour[] }[] {
  const g = pastelGrid();
  return FAMILIES.map((family) => ({
    family,
    items: g.filter((x) => x.family === family).sort((a, b) => a.theme.accent - b.theme.accent || a.theme.softness - b.theme.softness),
  })).filter((x) => x.items.length);
}

export function isPastelBase(base: string): boolean { return base in PASTEL_BASES; }

// -- saved list (this device) --
const SAVED_KEY = 'bb:pastel-saved';
export const MAX_SAVED = 24;
export function loadSaved(valid: (c: string) => boolean): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && valid(x)).slice(0, MAX_SAVED) : [];
  } catch { return []; }
}
export function storeSaved(list: string[]) {
  try { localStorage.setItem(SAVED_KEY, JSON.stringify(list.slice(0, MAX_SAVED))); } catch { /* blocked */ }
}
