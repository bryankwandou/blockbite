export interface Biome {
  id: string;
  act: number;
  name: string;
  range: [number, number];
  cohort: string;
  sky: string;
  fog: string;
  accent: string;
  glow: string;
  path: string;
  rock: string;
  blocks: string[];
  fx: string[];
  ambient: string;
}

// 1,000 acts × 500 levels = 500,000 levels (MAX_GAME_LEVEL). The 8 themes
// below repeat every 8 acts; level numbers and difficulty never repeat.
// BIOMES[i].range is the range of the theme's FIRST appearance (acts 1-8);
// use biomeForAct / biomeForLevel for the real act and range.
// History: 8 acts × 500 levels = 4,000 total levels until 2026-10-01.
// Revised down from 5,000/act on 2026-05-16 per product spec:
//   - matches BLOCKBITE_AGENT_MEGAPROMPT Phase-0 alignment (4,000 levels)
//   - keeps the per-act SVG short enough that the path stays continuous
//     instead of looping through repeated biome tiles
//   - each act now feels like a hand-crafted journey, not infinite grinding
export const LEVELS_PER_ACT = 500;
export const TOTAL_ACTS = 1000;

/** Theme + real act number + real level range for act 1..1000. */
export function biomeForAct(act: number): Biome {
  const a = Math.max(1, Math.min(TOTAL_ACTS, Math.floor(act) || 1));
  const theme = BIOMES[(a - 1) % BIOMES.length];
  return { ...theme, act: a, range: [(a - 1) * LEVELS_PER_ACT + 1, a * LEVELS_PER_ACT] };
}

/** The act (with theme) that contains level N. */
export function biomeForLevel(level: number): Biome {
  return biomeForAct(Math.ceil(Math.max(1, level) / LEVELS_PER_ACT));
}

export const BIOMES: Biome[] = [
  {
    id: 'crystal', act: 1, name: 'Crystal Caverns', range: [1, 500], cohort: 'ROOKIE',
    sky: 'radial-gradient(ellipse at 50% 30%, #2b3a6b 0%, #161830 55%, #08081a 100%)',
    fog: 'rgba(167, 139, 250, 0.18)', accent: '#a78bfa', glow: '#7dd3fc', path: '#5eead4', rock: '#1f1d3a',
    blocks: ['shard', 'geode', 'amethyst', 'echo', 'rune'],
    fx: ['shimmer', 'shatter', 'resonance'], ambient: 'crystal-spires',
  },
  {
    id: 'frost', act: 2, name: 'Frozen Pass', range: [501, 1000], cohort: 'ROOKIE',
    sky: 'linear-gradient(180deg, #0a1628 0%, #133a55 35%, #2a6b8c 70%, #5fb3d4 100%)',
    fog: 'rgba(94, 234, 212, 0.14)', accent: '#7dd3fc', glow: '#bae6fd', path: '#e0f2fe', rock: '#1e3a5f',
    blocks: ['ice', 'frost', 'glacier', 'aurora', 'snowflake'],
    fx: ['freeze', 'crack', 'aurora-pulse'], ambient: 'aurora',
  },
  {
    id: 'ember', act: 3, name: 'Ember Foundry', range: [1001, 1500], cohort: 'ARCADE',
    sky: 'radial-gradient(ellipse at 50% 70%, #f97316 0%, #7c2d12 40%, #1c0a08 100%)',
    fog: 'rgba(251, 146, 60, 0.16)', accent: '#fb923c', glow: '#fbbf24', path: '#fde68a', rock: '#3d1f15',
    blocks: ['ember', 'magma', 'cinder', 'forge', 'phoenix'],
    fx: ['ignite', 'meltdown', 'ash-burst'], ambient: 'lava-pools',
  },
  {
    id: 'verdant', act: 4, name: 'Verdant Hollow', range: [1501, 2000], cohort: 'ARCADE',
    sky: 'radial-gradient(ellipse at 50% 40%, #4ade80 0%, #166534 45%, #052e16 100%)',
    fog: 'rgba(134, 239, 172, 0.14)', accent: '#86efac', glow: '#fef08a', path: '#fde68a', rock: '#14352a',
    blocks: ['leaf', 'mushroom', 'pollen', 'vine', 'bloom'],
    fx: ['sprout', 'spore-burst', 'overgrowth'], ambient: 'fireflies',
  },
  {
    id: 'tidewave', act: 5, name: 'Abyss Tide', range: [2001, 2500], cohort: 'WARRIOR',
    sky: 'radial-gradient(ellipse at 50% 20%, #38bdf8 0%, #075985 40%, #0c1f3a 80%, #050b1a 100%)',
    fog: 'rgba(56, 189, 248, 0.18)', accent: '#22d3ee', glow: '#67e8f9', path: '#a5f3fc', rock: '#0c2540',
    blocks: ['pearl', 'coral', 'tide', 'kraken', 'bubble'],
    fx: ['tidal', 'whirlpool', 'pressure'], ambient: 'bioluminescence',
  },
  {
    id: 'dunes', act: 6, name: 'Sandborn Dunes', range: [2501, 3000], cohort: 'WARRIOR',
    sky: 'linear-gradient(180deg, #f59e0b 0%, #b45309 40%, #78350f 70%, #1c1917 100%)',
    fog: 'rgba(252, 211, 77, 0.14)', accent: '#fcd34d', glow: '#fde68a', path: '#fef3c7', rock: '#3f2613',
    blocks: ['sand', 'glyph', 'scarab', 'mirage', 'sunstone'],
    fx: ['sandstorm', 'mirage', 'glyph-flash'], ambient: 'dust-motes',
  },
  {
    id: 'voidline', act: 7, name: 'Voidline Citadel', range: [3001, 3500], cohort: 'LEGEND',
    sky: 'radial-gradient(ellipse at 50% 50%, #a855f7 0%, #4c1d95 30%, #1e1b4b 60%, #030014 100%)',
    fog: 'rgba(192, 132, 252, 0.20)', accent: '#c084fc', glow: '#f0abfc', path: '#e9d5ff', rock: '#1a0f3a',
    blocks: ['void', 'singularity', 'rift', 'sigil', 'eclipse'],
    fx: ['rift-tear', 'gravity-pulse', 'eclipse-flash'], ambient: 'starfield',
  },
  {
    id: 'apex', act: 8, name: 'Apex Sanctum', range: [3501, 4000], cohort: 'LEGEND',
    sky: 'radial-gradient(ellipse at 50% 30%, #fbbf24 0%, #c2410c 30%, #4a044e 65%, #020617 100%)',
    fog: 'rgba(251, 191, 36, 0.16)', accent: '#fbbf24', glow: '#ffffff', path: '#fef3c7', rock: '#2a0e3a',
    blocks: ['apex', 'halo', 'judgement', 'covenant', 'ascend'],
    fx: ['ascension', 'divine-burst', 'apex-flare'], ambient: 'ember-rain',
  },
];
