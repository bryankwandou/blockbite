import { Biome, LEVELS_PER_ACT, biomeForLevel } from './biomes';

export interface LevelConfig {
  level: number;
  biome: Biome;
  board: Array<Array<{ kind: string }>>;
  diff: number;
  isBoss: boolean;
  isActFinal: boolean;
  isMystery: boolean;
  rarity: 'COMMON' | 'EPIC' | 'ELITE' | 'BOSS' | 'MYTHIC';
  reward: number;
  goal: number;
  moves: number;
  targetType: string;
  title: string;
  phase: number;
}

// LEVELS_PER_ACT is imported from biomes.ts (currently 500). The previous
// local copy was hardcoded to 5000 — after the level-cap revision it
// returned the wrong biome for any level > 500 (everything mapped to act 1,
// which then crashed downstream because `localIdx = level - biome.range[0]`
// went negative and `biome.blocks[level % len]` indexed beyond the array).
function levelToBiome(level: number): Biome {
  return biomeForLevel(level);
}

function rngFromSeed(seedHex: string) {
  let x = 0;
  for (let i = 0; i < seedHex.length; i++) x = ((x << 5) - x + seedHex.charCodeAt(i)) | 0;
  return () => {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    return (x >>> 0) / 0xffffffff;
  };
}

export function levelConfig(level: number, seedHex?: string): LevelConfig {
  const biome = levelToBiome(level);
  const localIdx = level - biome.range[0];
  const phase = localIdx / (LEVELS_PER_ACT - 1);
  const rng = rngFromSeed(seedHex ?? String(level * 2654435761));

  const diff = +(Math.log2(biome.act + 1) * 3 + phase * 1.4).toFixed(2);
  const isBoss = level % 50 === 0;
  const isActFinal = level === biome.range[1];
  const isMystery = level % 5 === 0 && !isBoss;
  const rarity: LevelConfig['rarity'] =
    isActFinal ? 'MYTHIC' : isBoss ? 'BOSS' :
    level % 250 === 0 ? 'ELITE' : level % 100 === 0 ? 'EPIC' : 'COMMON';
  const baseReward = 5 + Math.round(Math.log2(biome.act + 1) * 12) + Math.floor(phase * 60);
  const reward = Math.round(
    isActFinal ? baseReward * 8 : isBoss ? baseReward * 3 : isMystery ? baseReward * 1.5 : baseReward,
  );
  const goal = 18 + Math.floor(phase * 32) + (isBoss ? 30 : 0);
  const moves = 22 + Math.floor(phase * 18) + (isBoss ? 0 : 4);
  const targetType = biome.blocks[level % biome.blocks.length];

  const board: LevelConfig['board'] = [];
  for (let y = 0; y < 8; y++) {
    const row: { kind: string }[] = [];
    for (let x = 0; x < 8; x++) {
      const r = rng();
      row.push({ kind: r < 0.06 ? 'empty' : biome.blocks[Math.floor(rng() * biome.blocks.length)] });
    }
    board.push(row);
  }

  const titles: Record<string, string[]> = {
    crystal: ['Echo Chamber', 'Crystal Heart', 'Shard Storm', 'Geode Vault', 'Rune Awakening'],
    frost:   ['Aurora Run', 'Glacier Path', 'Frost Bite', 'Ice Break', 'Snowfall'],
    ember:   ['Forge Trial', 'Magma Rush', 'Cinder Rain', 'Phoenix Rise', 'Inferno'],
    verdant: ['Bloom Field', 'Vine Tangle', 'Pollen Burst', 'Mushroom Ring', 'Overgrowth'],
    tidewave:['Pearl Dive', 'Kraken Deep', 'Tide Pull', 'Coral Reef', 'Bubble Chain'],
    dunes:   ['Sand Veil', 'Scarab March', 'Mirage Hunt', 'Glyph Trial', 'Sun Forge'],
    voidline:['Rift Walk', 'Sigil Burn', 'Eclipse Gate', 'Singularity', 'Void Storm'],
    apex:    ['Covenant', 'Halo Judgement', 'Ascension', 'Final Light', 'Apex Trial'],
  };
  const titlePool = titles[biome.id] ?? ['Level'];
  const title = isBoss ? `BOSS: ${titlePool[(biome.act - 1) % titlePool.length] ?? 'Trial'}`
    : isActFinal ? `FINAL: ${biome.name}`
    : titlePool[level % titlePool.length];

  return { level, biome, board, diff, isBoss, isActFinal, isMystery, rarity, reward, goal, moves, targetType, title, phase };
}
