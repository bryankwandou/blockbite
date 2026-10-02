/**
 * Achievement catalog, generated from templates.
 *
 * Every entry is "<category>-<threshold>", reached when the player's stat for
 * that category is >= threshold. Thresholds per category are spread roughly
 * geometrically from 1 to the category max, so early ones come quickly and
 * the last ones take years.
 *
 * Storage: only reached ids + timestamp live in Neon (table ach_unlocks).
 * They are NOT written on-chain: one transaction per achievement would cost
 * the player fees for a record nobody else needs to verify, and the inputs
 * (levels, lines, ranked runs) already live off-chain on our servers.
 */

export type Category =
  | 'level' | 'lines' | 'combos' | 'perfect' | 'ranked_days'
  | 'top10' | 'streak' | 'games' | 'score' | 'avatars';

export const TIERS = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'mythic'] as const;
export type Tier = (typeof TIERS)[number];

export const TIER_COLORS: Record<Tier, { fill: string; edge: string; text: string }> = {
  bronze:   { fill: '#C9824A', edge: '#7A4620', text: '#2A1406' },
  silver:   { fill: '#C9D1E0', edge: '#6F7891', text: '#1C2030' },
  gold:     { fill: '#FFC83D', edge: '#A77700', text: '#3A2900' },
  platinum: { fill: '#7FE7DC', edge: '#2E8F86', text: '#0A2E2A' },
  diamond:  { fill: '#8FB7FF', edge: '#3155C4', text: '#0B1A45' },
  mythic:   { fill: '#E07BFF', edge: '#7A1FA8', text: '#2A0638' },
};

interface Template { cat: Category; count: number; max: number }

/** count × categories ≥ 5,000. max must be ≥ count so thresholds stay distinct. */
export const TEMPLATES: Template[] = [
  { cat: 'level', count: 1000, max: 500_000 },
  { cat: 'lines', count: 800, max: 10_000_000 },
  { cat: 'combos', count: 500, max: 1_000_000 },
  { cat: 'perfect', count: 400, max: 100_000 },
  { cat: 'ranked_days', count: 400, max: 3_650 },
  { cat: 'top10', count: 400, max: 5_000 },
  { cat: 'streak', count: 400, max: 3_650 },
  { cat: 'games', count: 500, max: 1_000_000 },
  { cat: 'score', count: 600, max: 1_000_000_000 },
  { cat: 'avatars', count: 300, max: 100_000 },
];

export const CATEGORIES: Category[] = TEMPLATES.map((t) => t.cat);

export interface Achievement {
  id: string;
  cat: Category;
  threshold: number;
  tier: Tier;
  /** 0-based position within its category. */
  rank: number;
  emblem: Emblem;
}

export interface Emblem { shape: number; frame: number; icon: Category; tier: Tier; numeral: string }

export const SHAPE_COUNT = 6;
export const FRAME_COUNT = 5;

/** Distinct, increasing integers from 1 to max, roughly geometric. */
export function thresholds(count: number, max: number): number[] {
  const out: number[] = [];
  const lg = Math.log(max);
  for (let i = 0; i < count; i++) {
    const raw = Math.round(Math.exp((lg * i) / (count - 1)));
    const prev = out.length ? out[out.length - 1] : 0;
    out.push(Math.max(prev + 1, raw));
  }
  // Never exceed max; pull the tail back down if the +1 floor pushed it over.
  out[count - 1] = max;
  for (let i = count - 2; i >= 0; i--) if (out[i] >= out[i + 1]) out[i] = out[i + 1] - 1;
  return out;
}

/** Compact label: 950, 12K, 1.2M, 500K. */
export function numeral(n: number): string {
  if (n < 1000) return String(n);
  const units: [number, string][] = [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
  for (const [u, s] of units) {
    if (n >= u) {
      const v = n / u;
      const txt = v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
      return txt + s;
    }
  }
  return String(n);
}

function build(): Achievement[] {
  const out: Achievement[] = [];
  for (const t of TEMPLATES) {
    const th = thresholds(t.count, t.max);
    th.forEach((v, i) => {
      const tier = TIERS[Math.min(TIERS.length - 1, Math.floor((i / t.count) * TIERS.length))];
      out.push({
        id: `${t.cat}-${v}`,
        cat: t.cat,
        threshold: v,
        tier,
        rank: i,
        // Exact number on the numeral so badges with a rounded label (e.g. two
        // "1.2K") still differ: shape/frame cycle with the index.
        emblem: { shape: i % SHAPE_COUNT, frame: Math.floor(i / SHAPE_COUNT) % FRAME_COUNT, icon: t.cat, tier, numeral: numeral(v) },
      });
    });
  }
  return out;
}

export const ACHIEVEMENTS: Achievement[] = build();
export const ACH_BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));

export const emblemSignature = (e: Emblem) => `${e.shape}|${e.frame}|${e.icon}|${e.tier}|${e.numeral}`;

/** Player stats the catalog is evaluated against. Missing fields count as 0. */
export type Stats = Partial<Record<Category, number>>;

/** Pure: every achievement id reached by `stats`. */
export function evaluate(stats: Stats): string[] {
  const out: string[] = [];
  for (const a of ACHIEVEMENTS) {
    const v = stats[a.cat];
    if (typeof v === 'number' && Number.isFinite(v) && v >= a.threshold) out.push(a.id);
  }
  return out;
}
