// lib/game/levelGenerator.ts — deterministic level generator for levels 1..500,000.
// levelConfig(N) returns the same config on every device, every call. Nothing
// is stored: each level comes from (LEVEL_SEED, N) and the curve in difficulty.ts.

import { hash32, mulberry32, rngPick, rngSample, rngWeightedSample, type RNG } from './rng';
import {
  MECHANICS, ACT_POOL, ACT_PALETTE, ACT_NAME,
  actOf, poolTierOf, mechanicCount,
} from './mechanics';
import { milestoneConfig, isMilestone } from './milestones';
import { curve, TOTAL_LEVELS, BOARD_SIZE } from './difficulty';
import type {
  LevelBoard, TrayPiece, LevelGoal, LevelConstraints, LevelConfig,
} from './levelTypes';

export type { LevelBoard, TrayPiece, LevelGoal, LevelConstraints, LevelConfig };

export const LEVEL_SEED = 0xB10CB1A5; // "BLOCBLAS"
export { TOTAL_LEVELS, BOARD_SIZE };

// ── Public API ──────────────────────────────────────────────────────

export function levelConfig(N: number): LevelConfig {
  if (N < 1 || N > TOTAL_LEVELS) {
    throw new Error(`Level ${N} out of range (1..${TOTAL_LEVELS})`);
  }
  if (isMilestone(N)) { const m = milestoneConfig(N); ensureOpeningMove(m); return m; }
  return generate(N, 0);
}

export function levelHash(cfg: LevelConfig): number {
  const meaningful = JSON.stringify({
    mechanics: [...cfg.mechanics].sort(),
    board: cfg.board,
    tray: cfg.tray,
    goals: cfg.goals,
    constraints: cfg.constraints,
    palette: cfg.palette,
  });
  return hash32(meaningful);
}

// ── Internal ────────────────────────────────────────────────────────

function generate(N: number, retry: number): LevelConfig {
  const seed = hash32(String(LEVEL_SEED ^ N ^ (retry * 0x9E3779B1)));
  const rng = mulberry32(seed);
  const act = actOf(N);
  const pool = ACT_POOL[poolTierOf(N)];
  const count = mechanicCount(N);
  const palette = ACT_PALETTE[act];

  const picked = pickMechanics(rng, pool, count);
  const constraints = generateConstraints(rng, picked, N);
  const board = generateBoard(rng, picked, N, palette);
  const tray = generateTray(rng, picked, N, palette);
  const goals = generateGoals(rng, picked, N, palette);
  const name = generateName(rng, act, picked);

  const cfg: LevelConfig = {
    id: N, act, actName: ACT_NAME[act], seed, retry,
    name, mechanics: picked, board, tray, goals, constraints,
    palette, isBoss: false, isMilestone: false,
  };

  if (retry < 8 && !solverHeuristic(cfg)) {
    return generate(N, retry + 1);
  }
  ensureOpeningMove(cfg);
  return cfg;
}

function pickMechanics(rng: RNG, pool: string[], count: number): string[] {
  const goalsInPool = pool.filter((id) => MECHANICS[id]?.cat === 'goal');
  const nonGoals    = pool.filter((id) => MECHANICS[id]?.cat !== 'goal');

  const goalChoice = rngWeightedSample(
    rng,
    goalsInPool.map((id) => ({ value: id, weight: MECHANICS[id].weight })),
    1,
  );
  const remainder = rngWeightedSample(
    rng,
    nonGoals.map((id) => ({ value: id, weight: MECHANICS[id].weight })),
    Math.max(0, count - 1),
  );

  const picked = [...goalChoice, ...remainder];

  // Only one gravity_* allowed.
  const grav = picked.filter((id) => id.startsWith('gravity_'));
  if (grav.length > 1) {
    for (let i = 1; i < grav.length; i++) {
      picked.splice(picked.indexOf(grav[i]), 1);
    }
  }
  return picked;
}

function generateConstraints(rng: RNG, picked: string[], N: number): LevelConstraints {
  const c: LevelConstraints = {};
  if (picked.includes('move_limit'))    c.maxMoves      = Math.max(8, 30 - Math.floor(curve(N).t * 22));
  if (picked.includes('time_limit'))    c.timeLimitSec  = rngPick(rng, [60, 90, 120, 180]);
  if (picked.includes('survive_turns')) c.surviveTurns  = 10 + Math.floor(curve(N).t * 50);
  if (picked.includes('shrinking_board'))c.shrinkEvery  = rngPick(rng, [10, 12, 15]);
  if (picked.includes('darkness'))      c.silhouetteOnly= true;
  if (picked.includes('fog_of_war'))    c.visibleRadius = 3;
  return c;
}

function generateBoard(rng: RNG, picked: string[], N: number, palette: string[]): LevelBoard {
  const size = BOARD_SIZE;
  const grid: (string | null)[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => null),
  );
  const cellMods: Record<string, string> = {};

  const k = curve(N);
  // Open square shrinks 8 → 7 → 6 as levels rise; cells outside it start blocked.
  const off = Math.floor((size - k.playSize) / 2);
  const inside = (r: number, c: number) => r >= off && r < off + k.playSize && c >= off && c < off + k.playSize;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
    if (!inside(r, c)) cellMods[`${r},${c}`] = 'void';
  }
  const filled = Math.floor(k.playSize * k.playSize * k.prefill);
  const positions = shuffledPositions(rng, size).filter(([r, c]) => inside(r, c));
  for (let i = 0; i < filled; i++) {
    const [r, c] = positions[i];
    grid[r][c] = rngPick(rng, palette);
  }

  const modMechanics = ['locked', 'ice', 'stone', 'steel', 'fog', 'regrow', 'mirror', 'void', 'prism'];
  for (const mod of picked.filter((id) => modMechanics.includes(id))) {
    const count = Math.max(2, Math.floor(size * size * (0.02 + k.t * 0.06)));
    const cells = rngSample(rng, allCells(size), count);
    for (const [r, c] of cells) {
      const key = `${r},${c}`;
      if (!cellMods[key]) cellMods[key] = mod;
    }
  }

  if (picked.includes('portal')) {
    const portals = rngSample(rng, allCells(size), 4);
    for (let i = 0; i < portals.length; i += 2) {
      if (portals[i + 1]) {
        const a = `${portals[i][0]},${portals[i][1]}`;
        const b = `${portals[i + 1][0]},${portals[i + 1][1]}`;
        cellMods[a] = `portal:${i / 2}`;
        cellMods[b] = `portal:${i / 2}`;
      }
    }
  }

  return { size, grid, cellMods };
}

function generateTray(rng: RNG, picked: string[], N: number, palette: string[]): TrayPiece[] {
  const weights = trayShapeWeights(N);
  const tray: TrayPiece[] = [];

  for (let i = 0; i < 3; i++) {
    const shape = rngWeightedSample(
      rng,
      TRAY_SHAPES.map((s, idx) => ({ value: s, weight: weights[idx] })),
      1,
    )[0];
    const color = rngPick(rng, palette);
    const mods: string[] = [];
    if (picked.includes('bomb_piece')    && rng() < 0.18) mods.push('bomb');
    if (picked.includes('line_piece')    && rng() < 0.15) mods.push('line');
    if (picked.includes('column_piece')  && rng() < 0.15) mods.push('column');
    if (picked.includes('rainbow_piece') && rng() < 0.12) mods.push('rainbow');
    if (picked.includes('timed_piece')   && rng() < 0.20) mods.push('timed');
    if (picked.includes('giant_piece')   && rng() < 0.10) mods.push('giant');
    if (picked.includes('fragile_piece') && rng() < 0.15) mods.push('fragile');
    if (picked.includes('heavy_piece')   && rng() < 0.20) mods.push('heavy');
    tray.push({ shape, color, mods });
  }
  return tray;
}

function generateGoals(rng: RNG, picked: string[], N: number, palette: string[]): LevelGoal[] {
  const k = curve(N);
  const tough = 1 + Math.floor(k.t * 20);
  const goals: LevelGoal[] = [];
  if (picked.includes('lines_n'))          goals.push({ type: 'lines_n',       target: k.lineTarget });
  if (picked.includes('score_n'))          goals.push({ type: 'score_n',       target: k.scoreTarget });
  if (picked.includes('combo_n'))          goals.push({ type: 'combo_n',       target: Math.min(12, 2 + Math.floor(tough / 2)) });
  if (picked.includes('collect_color'))    goals.push({ type: 'collect_color', color: rngPick(rng, palette), target: 8 + tough * 2 });
  if (picked.includes('collect_gems'))     goals.push({ type: 'collect_gems',  target: 3 + Math.floor(tough / 2) });
  if (picked.includes('chain_n'))          goals.push({ type: 'chain_n',       target: 2 + Math.min(6, Math.floor(tough / 3)) });
  if (picked.includes('survive_turns'))    goals.push({ type: 'survive_turns', target: 10 + tough });
  if (picked.includes('no_clears_under_x'))goals.push({ type: 'no_clears_under_x', minSize: 4 });
  if (picked.includes('multi_goal') && goals.length >= 2) goals.push({ type: 'multi_goal', combine: 'AND' });
  if (goals.length === 0)                  goals.push({ type: 'lines_n',       target: k.lineTarget });
  return goals;
}

function generateName(rng: RNG, act: number, picked: string[]): string {
  const p = rngPick(rng, NAME_PREFIXES[act]);
  const s = rngPick(rng, NAME_SUFFIXES[act]);
  return `${p} ${s}`;
}

// ── Tray shapes ─────────────────────────────────────────────────────

export const TRAY_SHAPES: number[][][] = [
  [[1]],
  [[1,1]], [[1],[1]],
  [[1,1,1]], [[1],[1],[1]], [[1,1],[1,0]], [[1,1],[0,1]], [[1,0],[1,1]], [[0,1],[1,1]],
  [[1,0],[1,0],[1,1]], [[0,1],[0,1],[1,1]], [[1,1,1],[1,0,0]], [[1,1,1],[0,0,1]],
  [[1,1,1,1]], [[1],[1],[1],[1]],
  [[0,1,1],[1,1,0]], [[1,1,0],[0,1,1]],
  [[1,1,1],[0,1,0]],
  [[1,1],[1,1]],
  [[1,1],[1,1],[1,0]], [[1,1],[1,1],[0,1]],
  [[1,0,1],[1,1,1]], [[0,1,0],[1,1,1],[0,1,0]],
  [[1,0,0],[0,1,0],[0,0,1]], [[0,0,1],[0,1,0],[1,0,0]],
  [[1,0],[1,0],[1,0],[1,1]],
];

function trayShapeWeights(N: number): number[] {
  const t = curve(N).pieceBias;
  return TRAY_SHAPES.map((shape) => {
    const cells = shape.flat().filter(Boolean).length;
    const easy = Math.max(0, 5 - cells);
    const hard = Math.max(0, cells - 2);
    return Math.max(0.1, easy * (1 - t) + hard * t * 1.5);
  });
}

// ── Name tables ─────────────────────────────────────────────────────

const NAME_PREFIXES: Record<number, string[]> = {
  1: ['First', 'Quiet', 'Open', 'Calm', 'Bright', 'Soft', 'New', 'Plain', 'Clear', 'Easy'],
  2: ['Frozen', 'Glacial', 'Crystal', 'Hoarfrost', 'Cold', 'Polar', 'Frostbound', 'Iceveined', 'Sleet', 'Permafrost'],
  3: ['Burning', 'Cinder', 'Magma', 'Pyre', 'Ember', 'Smolder', 'Forge', 'Inferno', 'Charcoal', 'Solar'],
  4: ['Stormy', 'Thunder', 'Tempest', 'Voltaic', 'Charged', 'Squall', 'Cyclonic', 'Galvanic', 'Lightning', 'Roaring'],
  5: ['Verdant', 'Mossbound', 'Wild', 'Bloom', 'Thicket', 'Greenwood', 'Sapling', 'Overgrown', 'Tendril', 'Briar'],
  6: ['Shadow', 'Eclipse', 'Dusk', 'Twilight', 'Veiled', 'Hollow', 'Wraithbound', 'Umbral', 'Murky', 'Hush'],
  7: ['Prismatic', 'Crystalline', 'Refracted', 'Faceted', 'Chromatic', 'Iridescent', 'Lustrous', 'Glassine', 'Brilliant', 'Spectral'],
  8: ['Voidborn', 'Final', 'Ruinous', 'Endless', 'Apocryphal', 'Unmade', 'Terminal', 'Cosmic', 'Apex', 'Last'],
};

const NAME_SUFFIXES: Record<number, string[]> = {
  1: ['Steps', 'Path', 'Field', 'Garden', 'Yard', 'Walk', 'Bench', 'Run', 'Court', 'Square'],
  2: ['Tundra', 'Glacier', 'Cavern', 'Shelf', 'Drift', 'Plateau', 'Basin', 'Hollow', 'Reach', 'Spire'],
  3: ['Pit', 'Forge', 'Maw', 'Furnace', 'Crater', 'Vault', 'Chamber', 'Crucible', 'Ridge', 'Throne'],
  4: ['Front', 'Spire', 'Wake', 'Surge', 'Coil', 'Eye', 'Vein', 'Reach', 'Vault', 'Tide'],
  5: ['Grove', 'Thorn', 'Tangle', 'Hollow', 'Bramble', 'Loam', 'Glen', 'Canopy', 'Root', 'Bough'],
  6: ['Veil', 'Hollow', 'Pall', 'Maze', 'Reach', 'Hush', 'Mire', 'Threshold', 'Gate', 'Tomb'],
  7: ['Lattice', 'Prism', 'Halo', 'Shard', 'Mirror', 'Geode', 'Cluster', 'Edge', 'Web', 'Bloom'],
  8: ['Brink', 'Edge', 'Wake', 'Knell', 'Reach', 'Maw', 'Pyre', 'Crown', 'Grave', 'Horizon'],
};

// ── Helpers ──────────────────────────────────────────────────────────

function shuffledPositions(rng: RNG, size: number): [number, number][] {
  const out: [number, number][] = [];
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) out.push([r, c]);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function allCells(size: number): [number, number][] {
  const out: [number, number][] = [];
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) out.push([r, c]);
  return out;
}

// ── Opening move guarantee ───────────────────────────────────────────
// Every level must have at least one legal placement on the first turn.
// Blocked cells are cellMods (except portal markers) or filled grid cells.

function isBlocked(cfg: LevelConfig, r: number, c: number): boolean {
  const mod = cfg.board.cellMods[`${r},${c}`];
  return cfg.board.grid[r][c] !== null || (mod != null && !mod.startsWith('portal'));
}

export function hasOpeningMove(cfg: LevelConfig): boolean {
  const size = cfg.board.size;
  for (const p of cfg.tray) {
    for (let r = 0; r + p.shape.length <= size; r++) {
      for (let c = 0; c + p.shape[0].length <= size; c++) {
        let ok = true;
        for (let dr = 0; dr < p.shape.length && ok; dr++)
          for (let dc = 0; dc < p.shape[0].length && ok; dc++)
            if (p.shape[dr][dc] && isBlocked(cfg, r + dr, c + dc)) ok = false;
        if (ok) return true;
      }
    }
  }
  return false;
}

function ensureOpeningMove(cfg: LevelConfig): void {
  if (hasOpeningMove(cfg)) return;
  // Deterministic repair: open the centre 3x3 so any 1-3 cell piece fits.
  const mid = Math.floor(cfg.board.size / 2) - 1;
  for (let r = mid; r < mid + 3; r++) for (let c = mid; c < mid + 3; c++) {
    cfg.board.grid[r][c] = null;
    delete cfg.board.cellMods[`${r},${c}`];
  }
  if (!hasOpeningMove(cfg)) cfg.tray[0] = { shape: [[1]], color: cfg.tray[0].color, mods: [] };
}

/** Content signature: what the player sees and must do (excludes id/seed/name). */
export function levelSignature(cfg: LevelConfig): number {
  return levelHash(cfg);
}

// ── Solver heuristic ─────────────────────────────────────────────────
// Monte-carlo: randomly place pieces and count clears. Filters obviously
// unsolvable configs before they reach the player.

export function solverHeuristic(cfg: LevelConfig): boolean {
  const trials = 6;
  const movesPerTrial = 30;
  let best = 0;
  for (let t = 0; t < trials; t++) {
    const trialSeed = hash32(String(cfg.seed ^ (t * 0x100193)));
    const rng = mulberry32(trialSeed);
    const score = simulateRandom(cfg, rng, movesPerTrial);
    if (score > best) best = score;
  }
  const minGoal = cfg.goals.reduce((m, g) => {
    const target = g.target ?? 1;
    return Math.min(m, target);
  }, Infinity);
  const threshold = isFinite(minGoal) ? Math.min(300, Math.max(1, minGoal * 0.4)) : 1;
  return best >= threshold;
}

function simulateRandom(cfg: LevelConfig, rng: RNG, moves: number): number {
  const size = cfg.board.size;
  const grid = cfg.board.grid.map((row) => row.slice());
  let clears = 0;
  for (let m = 0; m < moves; m++) {
    const piece = cfg.tray[Math.floor(rng() * cfg.tray.length)];
    if (tryPlaceRandom(grid, piece.shape, rng, size)) {
      clears += clearLines(grid, size);
    }
  }
  return clears * 100;
}

function tryPlaceRandom(grid: (string | null)[][], shape: number[][], rng: RNG, size: number): boolean {
  const cells: [number, number][] = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (canPlace(grid, shape, r, c, size)) cells.push([r, c]);
    }
  }
  if (cells.length === 0) return false;
  const [r, c] = cells[Math.floor(rng() * cells.length)];
  for (let dr = 0; dr < shape.length; dr++) {
    for (let dc = 0; dc < shape[0].length; dc++) {
      if (shape[dr][dc]) grid[r + dr][c + dc] = 'x';
    }
  }
  return true;
}

function canPlace(grid: (string | null)[][], shape: number[][], r: number, c: number, size: number): boolean {
  for (let dr = 0; dr < shape.length; dr++) {
    for (let dc = 0; dc < shape[0].length; dc++) {
      if (!shape[dr][dc]) continue;
      const rr = r + dr, cc = c + dc;
      if (rr >= size || cc >= size) return false;
      if (grid[rr][cc] !== null) return false;
    }
  }
  return true;
}

function clearLines(grid: (string | null)[][], size: number): number {
  let count = 0;
  for (let r = 0; r < size; r++) {
    if (grid[r].every((cell) => cell !== null)) {
      for (let c = 0; c < size; c++) grid[r][c] = null;
      count++;
    }
  }
  for (let c = 0; c < size; c++) {
    let full = true;
    for (let r = 0; r < size; r++) { if (grid[r][c] === null) { full = false; break; } }
    if (full) { for (let r = 0; r < size; r++) grid[r][c] = null; count++; }
  }
  return count;
}
