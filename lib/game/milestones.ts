// lib/game/milestones.ts — tutorial 1-10 + a boss every 100 levels (5,000 bosses, built on demand).
// These OVERRIDE the generator entirely.

import { ACT_PALETTE, ACT_NAME, actOf } from './mechanics';
import { curve, TOTAL_LEVELS } from './difficulty';
import type { LevelConfig, LevelBoard, LevelGoal, TrayPiece } from './levelTypes';

const SIZE = 8;

function emptyBoard(grid?: (string | null)[][]): (string | null)[][] {
  const g = Array.from({ length: SIZE }, () =>
    Array.from({ length: SIZE }, () => null as string | null),
  );
  if (grid) {
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++) g[r][c] = grid[r][c] ?? null;
  }
  return g;
}

function bossName(act: number, slot: number): string {
  const names: Record<number, string[]> = {
    1: ['Sentinel', 'Watcher', 'Herald', 'Awakener', 'Anchor'],
    2: ['Glacierheart', 'Frostmaw', 'Rimebound', 'Permafrost King', 'Iceveil'],
    3: ['Pyreclaw', 'Cinderlord', 'Magma Throne', 'Forgekeeper', 'Solar Ash'],
    4: ['Stormcaller', 'Thunderhowl', 'Voltaic Maw', 'Squall Sovereign', 'Lightning Wraith'],
    5: ['Bramble King', 'Greenroot', 'Thornward', 'Bloomshade', 'Vinekeeper'],
    6: ['Hollowveil', 'Eclipsewraith', 'Duskbinder', 'Murmur', 'Twilight Maw'],
    7: ['Prismsworn', 'Geodelord', 'Refractor', 'Crystal Halo', 'Spectral Crown'],
    8: ['Voidherald', 'Apex', 'Unmaker', 'Last Sovereign', 'Cosmic Pyre'],
  };
  return names[act][slot % 5];
}

// ---------- Tutorial 1-10 ----------

interface TutGoalSpec {
  lines_n?: number;
  score_n?: number;
  combo_n?: number;
  collect_color?: { color: string; target: number };
}

function tut(
  id: number, name: string, mechanics: string[], goalSpec: TutGoalSpec,
  density: number, helpText: string, isBoss = false,
): LevelConfig {
  const grid = emptyBoard();
  const filled = Math.floor(SIZE * SIZE * density);
  const palette = ACT_PALETTE[1];
  let placed = 0;
  for (let r = 0; r < SIZE && placed < filled; r++) {
    for (let c = 0; c < SIZE && placed < filled; c++) {
      if ((r + c * 3 + id) % 5 === 0) {
        grid[r][c] = palette[(r + c) % 3];
        placed++;
      }
    }
  }
  const goals: LevelGoal[] = [];
  if (goalSpec.lines_n)      goals.push({ type: 'lines_n',      target: goalSpec.lines_n });
  if (goalSpec.score_n)      goals.push({ type: 'score_n',      target: goalSpec.score_n });
  if (goalSpec.combo_n)      goals.push({ type: 'combo_n',      target: goalSpec.combo_n });
  if (goalSpec.collect_color) goals.push({ type: 'collect_color', ...goalSpec.collect_color });

  const tray: TrayPiece[] = [
    { shape: [[1, 1, 1]], color: 'cyan',    mods: [] },
    { shape: [[1], [1], [1]], color: 'magenta', mods: [] },
    { shape: [[1, 1], [1, 1]], color: 'gold', mods: [] },
  ];

  return {
    id, act: 1, actName: ACT_NAME[1], seed: id, retry: 0,
    name, mechanics, palette,
    board: { size: SIZE, grid, cellMods: {} },
    tray, goals,
    constraints: { maxMoves: 30 },
    isMilestone: true, isBoss, helpText,
  };
}

const TUTORIAL: Record<number, LevelConfig> = {
  1:  tut(1,  'First Steps',    ['lines_n'],             { lines_n: 1 },  0.0,  'Drop any piece onto the board. Fill a row or column to clear it.'),
  2:  tut(2,  'Two Lines',      ['lines_n'],             { lines_n: 2 },  0.05, 'Same as before — clear two lines this time.'),
  3:  tut(3,  'Score Run',      ['score_n'],             { score_n: 500 },0.1,  'Score 500 by chaining clears. Multi-line clears are worth more.'),
  4:  tut(4,  'Locked Cells',   ['lines_n', 'locked'],   { lines_n: 3 },  0.15, 'Locked cells unlock when you clear something next to them.'),
  5:  tut(5,  'Color Hunt',     ['collect_color'],       { collect_color: { color: 'cyan', target: 6 } }, 0.1, 'Clear 6 cyan blocks. Watch the goal counter.'),
  6:  tut(6,  'Bomb Piece',     ['lines_n', 'bomb_piece'],{ lines_n: 3 }, 0.2,  'Bomb pieces clear a 3×3 area. Use them to break locked cells.'),
  7:  tut(7,  'Ice Age',        ['lines_n', 'ice'],      { lines_n: 4 },  0.2,  'Ice cells freeze pieces. Plan around them.'),
  8:  tut(8,  'Combo Time',     ['combo_n'],             { combo_n: 3 },  0.15, 'Chain three clears in three moves to make a combo of 3.'),
  9:  tut(9,  'Gravity Flip',   ['lines_n', 'gravity_flip'], { lines_n: 4 }, 0.2, 'Pieces float upward in this level. Read the board top-to-bottom.'),
  10: tut(10, 'Boss: Awakener', ['lines_n', 'score_n', 'locked'], { lines_n: 5, score_n: 1500 }, 0.25, 'Two goals at once. Welcome to the real game.', true),
};

// ---------- Boss patterns (5 templates, cycled by slot) ----------

const BOSS_PATTERNS: number[][][] = [
  // 0 — frame (throne room)
  [
    [1,1,1,1,1,1,1,1],
    [1,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,1],
    [1,0,0,2,2,0,0,1],
    [1,0,0,2,2,0,0,1],
    [1,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,1],
    [1,1,1,1,1,1,1,1],
  ],
  // 1 — diamond
  [
    [0,0,0,1,1,0,0,0],
    [0,0,1,2,2,1,0,0],
    [0,1,2,3,3,2,1,0],
    [1,2,3,0,0,3,2,1],
    [1,2,3,0,0,3,2,1],
    [0,1,2,3,3,2,1,0],
    [0,0,1,2,2,1,0,0],
    [0,0,0,1,1,0,0,0],
  ],
  // 2 — twin pillars
  [
    [1,1,0,0,0,0,1,1],
    [1,1,0,0,0,0,1,1],
    [1,1,0,2,2,0,1,1],
    [1,1,0,2,2,0,1,1],
    [1,1,0,2,2,0,1,1],
    [1,1,0,2,2,0,1,1],
    [1,1,0,0,0,0,1,1],
    [1,1,0,0,0,0,1,1],
  ],
  // 3 — checker corners
  [
    [1,2,1,0,0,1,2,1],
    [2,1,2,0,0,2,1,2],
    [1,2,1,0,0,1,2,1],
    [0,0,0,3,3,0,0,0],
    [0,0,0,3,3,0,0,0],
    [1,2,1,0,0,1,2,1],
    [2,1,2,0,0,2,1,2],
    [1,2,1,0,0,1,2,1],
  ],
  // 4 — spiral
  [
    [1,1,1,1,1,1,1,1],
    [1,0,0,0,0,0,0,1],
    [1,0,2,2,2,2,0,1],
    [1,0,2,0,0,2,0,1],
    [1,0,2,0,0,2,0,1],
    [1,0,2,2,2,2,0,1],
    [1,0,0,0,0,0,0,1],
    [1,1,1,1,1,1,1,1],
  ],
];

function bossCellMods(N: number, act: number): Record<string, string> {
  const mods: Record<string, string> = {};
  if (act >= 2) {
    ([[0,0],[0,7],[7,0],[7,7]] as [number,number][]).forEach(([r,c]) => { mods[`${r},${c}`] = 'ice'; });
  }
  if (act >= 4) {
    ([[3,3],[3,4],[4,3],[4,4]] as [number,number][]).forEach(([r,c]) => { mods[`${r},${c}`] = 'locked'; });
  }
  if (act >= 6) {
    for (let i = 0; i < SIZE; i++) mods[`0,${i}`] = mods[`0,${i}`] || 'fog';
  }
  if (act >= 7) {
    mods['2,2'] = 'portal:0';
    mods['5,5'] = 'portal:0';
  }
  return mods;
}

function makeBoss(N: number, act: number, slot: number): LevelConfig {
  const palette = ACT_PALETTE[act];
  const name = `${bossName(act, slot)} — Lv ${N}`;
  const grid = emptyBoard();
  const pattern = BOSS_PATTERNS[slot];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const v = pattern[r][c];
      if (v) grid[r][c] = palette[(v - 1) % palette.length];
    }
  }
  const k = curve(N);
  const goals: LevelGoal[] = [
    { type: 'lines_n', target: k.lineTarget + 3 },
    { type: 'score_n', target: Math.round(k.scoreTarget * 1.5) + N },
  ];
  const bossMechanics: string[] = [
    'lines_n', 'score_n', 'locked', 'move_limit',
    ...(act >= 2 ? ['ice'] : []),
    ...(act >= 3 ? ['bomb_piece', 'chain_n'] : []),
    ...(act >= 4 ? ['gravity_flip', 'time_limit'] : []),
    ...(act >= 5 ? ['regrow', 'rainbow_piece'] : []),
    ...(act >= 6 ? ['fog', 'darkness'] : []),
    ...(act >= 7 ? ['prism', 'no_clears_under_x'] : []),
    ...(act >= 8 ? ['multi_board', 'shrinking_board'] : []),
  ];
  const tray: TrayPiece[] = [
    { shape: [[1, 1, 1]],         color: palette[0],                 mods: act >= 3 ? ['bomb'] : [] },
    { shape: [[1, 1], [1, 1]],    color: palette[1 % palette.length],mods: [] },
    { shape: [[1, 1, 1, 1]],      color: palette[2 % palette.length],mods: act >= 4 ? ['line'] : [] },
  ];
  const board: LevelBoard = { size: SIZE, grid, cellMods: bossCellMods(N, act) };
  return {
    id: N, act, actName: ACT_NAME[act], seed: N, retry: 0,
    name, mechanics: bossMechanics, palette,
    board, tray, goals,
    constraints: {
      maxMoves: Math.max(15, 50 - Math.floor(k.t * 35)),
      ...(act >= 4 ? { timeLimitSec: 180 } : {}),
    },
    isMilestone: true, isBoss: true,
    helpText: `Boss fight: ${name}. Two goals, hard cap on moves.`,
  };
}

// Bosses sit on every 100th level across the full 1..500,000 range. They are
// built on demand (5,000 of them) instead of being stored.
export const MILESTONES: Record<number, LevelConfig> = { ...TUTORIAL };

export function isMilestone(N: number): boolean {
  return MILESTONES[N] != null || (N >= 100 && N <= TOTAL_LEVELS && N % 100 === 0);
}

export function milestoneConfig(N: number): LevelConfig {
  if (MILESTONES[N]) return MILESTONES[N];
  const slot = Math.floor((N - 1) / 100) % 5;
  return makeBoss(N, actOf(N), slot);
}
