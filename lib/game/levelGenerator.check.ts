// Run: npx tsx lib/game/levelGenerator.check.ts
// Samples 2,000 levels across 1..500,000 and asserts:
//   1. every sampled level has a distinct content signature (no repeats/cycling)
//   2. difficulty rises: bucket means of a difficulty score never drop
//   3. every level has at least one legal placement at the start
//   4. same N → same config (deterministic)
import { levelConfig, levelSignature, hasOpeningMove, TOTAL_LEVELS } from './levelGenerator';
import { curve } from './difficulty';
import { biomeForLevel } from './biomes';
import type { LevelConfig } from './levelTypes';

const SAMPLES = 2000;
const fails: string[] = [];

// Sample: fixed anchors (1..20, act edges, top end) + log-spread + linear-spread.
const set = new Set<number>([1, 2, 3, 10, 11, 99, 100, 101, 500, 501, 4000, 4001, 4100, TOTAL_LEVELS - 1, TOTAL_LEVELS]);
let i = 0;
while (set.size < SAMPLES) {
  const u = (i + 0.5) / SAMPLES;
  set.add(i % 2 ? Math.max(1, Math.round(Math.pow(TOTAL_LEVELS, u))) : Math.max(1, Math.round(u * TOTAL_LEVELS)));
  set.add(1 + ((i * 2654435761) >>> 0) % TOTAL_LEVELS);
  i++;
}
const levels = [...set].slice(0, SAMPLES).sort((a, b) => a - b);

function score(cfg: LevelConfig, N: number): number {
  const size = cfg.board.size;
  let blocked = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
    const m = cfg.board.cellMods[`${r},${c}`];
    if (cfg.board.grid[r][c] !== null || (m && !m.startsWith('portal'))) blocked++;
  }
  const avgPiece = cfg.tray.reduce((s, p) => s + p.shape.flat().filter(Boolean).length, 0) / cfg.tray.length;
  const k = curve(N);
  // blocked share + curve terms (target, piece bias, open square)
  return blocked / (size * size) + k.lineTarget / 60 + avgPiece / 10 + (8 - k.playSize) * 0.1;
}

const sigs = new Map<number, number>();
const scores: number[] = [];
const t0 = Date.now();
for (const N of levels) {
  let cfg: LevelConfig;
  try { cfg = levelConfig(N); } catch (e) { fails.push(`L${N}: throws ${(e as Error).message}`); continue; }
  const sig = levelSignature(cfg);
  if (sigs.has(sig)) fails.push(`L${N}: same signature as L${sigs.get(sig)}`);
  sigs.set(sig, N);
  if (!hasOpeningMove(cfg)) fails.push(`L${N}: no legal placement at start`);
  if (levelSignature(levelConfig(N)) !== sig) fails.push(`L${N}: not deterministic`);
  const b = biomeForLevel(N);
  if (N < b.range[0] || N > b.range[1]) fails.push(`L${N}: act range ${b.range} wrong`);
  scores.push(score(cfg, N));
}
const ms = Date.now() - t0;

// Monotone-ish: 20 buckets in sample order; each bucket mean >= previous - 0.02.
const B = 20;
const means: number[] = [];
for (let b = 0; b < B; b++) {
  const part = scores.slice(Math.floor((b * scores.length) / B), Math.floor(((b + 1) * scores.length) / B));
  means.push(part.reduce((s, x) => s + x, 0) / part.length);
}
for (let b = 1; b < B; b++) if (means[b] < means[b - 1] - 0.02) fails.push(`difficulty drops in bucket ${b}: ${means[b - 1].toFixed(3)} -> ${means[b].toFixed(3)}`);
// Curve itself must be non-decreasing in every term on every sample.
for (let j = 1; j < levels.length; j++) {
  const a = curve(levels[j - 1]), c = curve(levels[j]);
  if (c.t <= a.t || c.prefill < a.prefill || c.lineTarget < a.lineTarget || c.playSize > a.playSize || c.mechanicCount < a.mechanicCount)
    fails.push(`curve not monotone between L${levels[j - 1]} and L${levels[j]}`);
}
if (means[B - 1] <= means[0] + 0.5) fails.push(`difficulty barely rises: ${means[0].toFixed(3)} -> ${means[B - 1].toFixed(3)}`);

console.log(`levels sampled: ${levels.length} (L${levels[0]}..L${levels[levels.length - 1]}), generated in ${ms} ms`);
console.log(`unique signatures: ${sigs.size}/${levels.length}`);
console.log(`difficulty bucket means: ${means.map((m) => m.toFixed(2)).join(' ')}`);
const show = [1, 100, 4000, 50000, 500000].map((N) => { const k = curve(N); return `L${N}: open ${k.playSize}x${k.playSize}, prefill ${(k.prefill * 100).toFixed(0)}%, lines ${k.lineTarget}, mechanics ${k.mechanicCount}`; });
console.log(show.join('\n'));
if (fails.length) {
  console.log(`FAIL (${fails.length})\n` + fails.slice(0, 30).join('\n'));
  process.exit(1);
}
console.log('PASS');
