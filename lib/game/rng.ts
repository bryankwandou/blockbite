// lib/game/rng.ts — deterministic seeded RNG. Same seed → same sequence on every device.

export type RNG = () => number;

export function hash32(str: string): number {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (Math.imul(h, 0x01000193) >>> 0);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): RNG {
  let a = seed >>> 0;
  return function rand(): number {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rngInt(rng: RNG, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

export function rngPick<T>(rng: RNG, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

export function rngWeighted<T>(rng: RNG, items: { value: T; weight: number }[]): T {
  const total = items.reduce((s, it) => s + it.weight, 0);
  let r = rng() * total;
  for (const it of items) {
    r -= it.weight;
    if (r <= 0) return it.value;
  }
  return items[items.length - 1].value;
}

export function rngSample<T>(rng: RNG, arr: T[], n: number): T[] {
  const copy = [...arr];
  const out: T[] = [];
  for (let i = 0; i < n && copy.length > 0; i++) {
    const idx = Math.floor(rng() * copy.length);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
}

export function rngWeightedSample<T>(rng: RNG, items: { value: T; weight: number }[], n: number): T[] {
  const pool = items.map((it) => ({ ...it }));
  const out: T[] = [];
  for (let i = 0; i < n && pool.length > 0; i++) {
    const total = pool.reduce((s, p) => s + p.weight, 0);
    let r = rng() * total;
    let chosenIdx = 0;
    for (let j = 0; j < pool.length; j++) {
      r -= pool[j].weight;
      if (r <= 0) { chosenIdx = j; break; }
    }
    out.push(pool[chosenIdx].value);
    pool.splice(chosenIdx, 1);
  }
  return out;
}
