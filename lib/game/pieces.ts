// ═══════════════════════════════════════════════════════════════
// BLOCKBLAST — ALL PIECE SHAPES (20+ types)
// Shape is a 2D array: 1 = block, 0 = empty
// Origin is top-left of bounding box
// ═══════════════════════════════════════════════════════════════

import { BlockColor, COLOR_POOL } from './constants';

export interface PieceDefinition {
  id: string;
  shape: number[][];
  /** block count = sum of all 1s */
  size: number;
  /** rarity weight (higher = more common) */
  weight: number;
}

export interface Piece {
  id: string;
  shape: number[][];
  size: number;
  color: BlockColor;
}

export const PIECE_DEFINITIONS: PieceDefinition[] = [
  // ── 1 block ─────────────────────────────────────────────────────
  {
    id: 'mono',
    shape: [[1]],
    size: 1,
    weight: 3,  // rare
  },

  // ── 2 blocks ─────────────────────────────────────────────────────
  {
    id: 'domino_h',
    shape: [[1, 1]],
    size: 2,
    weight: 8,
  },
  {
    id: 'domino_v',
    shape: [[1], [1]],
    size: 2,
    weight: 8,
  },

  // ── 3 blocks ─────────────────────────────────────────────────────
  {
    id: 'tromino_i',
    shape: [[1, 1, 1]],
    size: 3,
    weight: 10,
  },
  {
    id: 'tromino_i_v',
    shape: [[1], [1], [1]],
    size: 3,
    weight: 10,
  },
  {
    id: 'tromino_l',
    shape: [
      [1, 0],
      [1, 1],
    ],
    size: 3,
    weight: 10,
  },
  {
    id: 'tromino_j',
    shape: [
      [0, 1],
      [1, 1],
    ],
    size: 3,
    weight: 10,
  },
  {
    id: 'corner',
    shape: [
      [1, 1],
      [1, 0],
    ],
    size: 3,
    weight: 10,
  },

  // ── 4 blocks — Tetrominoes ────────────────────────────────────────
  {
    id: 'tetro_o', // 2×2 square
    shape: [
      [1, 1],
      [1, 1],
    ],
    size: 4,
    weight: 12,
  },
  {
    id: 'tetro_i_h', // horizontal bar
    shape: [[1, 1, 1, 1]],
    size: 4,
    weight: 8,
  },
  {
    id: 'tetro_i_v', // vertical bar
    shape: [[1], [1], [1], [1]],
    size: 4,
    weight: 8,
  },
  {
    id: 'tetro_l',
    shape: [
      [1, 0],
      [1, 0],
      [1, 1],
    ],
    size: 4,
    weight: 10,
  },
  {
    id: 'tetro_j',
    shape: [
      [0, 1],
      [0, 1],
      [1, 1],
    ],
    size: 4,
    weight: 10,
  },
  {
    id: 'tetro_t',
    shape: [
      [1, 1, 1],
      [0, 1, 0],
    ],
    size: 4,
    weight: 10,
  },
  {
    id: 'tetro_s',
    shape: [
      [0, 1, 1],
      [1, 1, 0],
    ],
    size: 4,
    weight: 8,
  },
  {
    id: 'tetro_z',
    shape: [
      [1, 1, 0],
      [0, 1, 1],
    ],
    size: 4,
    weight: 8,
  },
  {
    id: 'big_l',
    shape: [
      [1, 0, 0],
      [1, 0, 0],
      [1, 1, 1],
    ],
    size: 5,
    weight: 6,
  },
  {
    id: 'big_t',
    shape: [
      [1, 1, 1],
      [0, 1, 0],
      [0, 1, 0],
    ],
    size: 5,
    weight: 6,
  },

  // ── 5 blocks — Pentominoes ────────────────────────────────────────
  {
    id: 'pento_plus', // + cross
    shape: [
      [0, 1, 0],
      [1, 1, 1],
      [0, 1, 0],
    ],
    size: 5,
    weight: 5,
  },
  {
    id: 'pento_p',
    shape: [
      [1, 1],
      [1, 1],
      [1, 0],
    ],
    size: 5,
    weight: 5,
  },
  {
    id: 'pento_f',
    shape: [
      [0, 1, 1],
      [1, 1, 0],
      [0, 1, 0],
    ],
    size: 5,
    weight: 4,
  },

  // ── 6 blocks — Rectangles ────────────────────────────────────────
  {
    id: 'rect_3x2',
    shape: [
      [1, 1, 1],
      [1, 1, 1],
    ],
    size: 6,
    weight: 5,
  },
  {
    id: 'rect_2x3',
    shape: [
      [1, 1],
      [1, 1],
      [1, 1],
    ],
    size: 6,
    weight: 5,
  },
];

// Total weight pool for weighted random
const TOTAL_WEIGHT = PIECE_DEFINITIONS.reduce((sum, p) => sum + p.weight, 0);

/** Pick a random piece definition using weighted probability */
function pickRandomPieceDef(): PieceDefinition {
  let rand = Math.random() * TOTAL_WEIGHT;
  for (const def of PIECE_DEFINITIONS) {
    rand -= def.weight;
    if (rand <= 0) return def;
  }
  return PIECE_DEFINITIONS[Math.floor(Math.random() * PIECE_DEFINITIONS.length)];
}

/** Pick a random block color */
function pickRandomColor(): BlockColor {
  return COLOR_POOL[Math.floor(Math.random() * COLOR_POOL.length)];
}

/** Generate a random piece with shape + color */
export function generateRandomPiece(): Piece {
  const def = pickRandomPieceDef();
  return {
    id: def.id,
    shape: def.shape,
    size: def.size,
    color: pickRandomColor(),
  };
}

/** Generate the initial tray of 3 pieces */
export function generateInitialTray(): [Piece, Piece, Piece] {
  return [generateRandomPiece(), generateRandomPiece(), generateRandomPiece()];
}

/** Get all cells of a piece as [row, col] relative to placement origin */
export function getPieceCells(shape: number[][], originRow: number, originCol: number): [number, number][] {
  const cells: [number, number][] = [];
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (shape[r][c] === 1) {
        cells.push([originRow + r, originCol + c]);
      }
    }
  }
  return cells;
}

/** Get bounding box size of a piece */
export function getPieceSize(shape: number[][]): { rows: number; cols: number } {
  return { rows: shape.length, cols: shape[0].length };
}
