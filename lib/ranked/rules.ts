/**
 * Ranked rules — pure and deterministic.
 *
 * The browser, the server and the public verifier all run this same code, so
 * a run replayed from its move log always produces the same board and score.
 * No Math.random, no Date, no floating-point state carried between moves.
 *
 * Classic block-puzzle rules: an empty 8×8 board, a tray of three pieces,
 * the tray is refilled only after all three are placed, full rows and
 * columns clear, and the run ends when no remaining piece fits. Which pieces
 * are dealt is decided by the server (see seed.ts), never by this file.
 */

import { PIECE_DEFINITIONS } from '@/lib/game/pieces';
import { calculateScore } from '@/lib/game/scoring';

export const SIZE = 8;

/** Piece catalogue, indexed by position in PIECE_DEFINITIONS. */
export const PIECES = PIECE_DEFINITIONS.map((d) => ({
  id: d.id,
  shape: d.shape,
  size: d.size,
  weight: d.weight,
  cells: d.shape.flatMap((row, r) => row.flatMap((v, c) => (v === 1 ? [[r, c] as const] : []))),
  rows: d.shape.length,
  cols: d.shape[0].length,
}));

export type Tray = [number | null, number | null, number | null];

export interface RankedState {
  /** 64-bit occupancy, bit (row * 8 + col); 16 lowercase hex chars. */
  board: string;
  tray: Tray;
  score: number;
  chain: number;
  /** The previous placement emptied the board: next clear uses ×10. */
  perfectNext: boolean;
  /** Placements made so far. */
  moves: number;
  over: boolean;
}

export interface Move {
  slot: 0 | 1 | 2;
  row: number;
  col: number;
}

export interface MoveResult {
  state: RankedState;
  rows: number[];
  cols: number[];
  points: number;
  label: string;
  perfect: boolean;
}

export class RulesError extends Error {}

const FULL = (1n << 64n) - 1n;
const ROW_MASK = Array.from({ length: SIZE }, (_, r) => 0xffn << BigInt(r * SIZE));
const COL_MASK = Array.from({ length: SIZE }, (_, c) => {
  let m = 0n;
  for (let r = 0; r < SIZE; r++) m |= 1n << BigInt(r * SIZE + c);
  return m;
});

export function boardFromHex(hex: string): bigint {
  if (!/^[0-9a-f]{16}$/.test(hex)) throw new RulesError('bad board');
  return BigInt('0x' + hex);
}

export function boardToHex(b: bigint): string {
  return (b & FULL).toString(16).padStart(16, '0');
}

export function isFilled(board: bigint, row: number, col: number): boolean {
  return ((board >> BigInt(row * SIZE + col)) & 1n) === 1n;
}

/** Mask of `piece` with its top-left at (row, col), or null if out of bounds. */
export function pieceMask(piece: number, row: number, col: number): bigint | null {
  const p = PIECES[piece];
  if (!p || !Number.isInteger(row) || !Number.isInteger(col)) return null;
  if (row < 0 || col < 0 || row + p.rows > SIZE || col + p.cols > SIZE) return null;
  let m = 0n;
  for (const [r, c] of p.cells) m |= 1n << BigInt((row + r) * SIZE + (col + c));
  return m;
}

export function fits(board: bigint, piece: number, row: number, col: number): boolean {
  const m = pieceMask(piece, row, col);
  return m !== null && (board & m) === 0n;
}

export function fitsAnywhere(board: bigint, piece: number): boolean {
  const p = PIECES[piece];
  for (let r = 0; r + p.rows <= SIZE; r++) {
    for (let c = 0; c + p.cols <= SIZE; c++) {
      if (fits(board, piece, r, c)) return true;
    }
  }
  return false;
}

/** True when no piece left in the tray can be placed. An empty tray is not stuck. */
export function isStuck(board: bigint, tray: Tray): boolean {
  const left = tray.filter((p): p is number => p !== null);
  return left.length > 0 && left.every((p) => !fitsAnywhere(board, p));
}

export function trayEmpty(tray: Tray): boolean {
  return tray[0] === null && tray[1] === null && tray[2] === null;
}

export function initialState(tray: Tray): RankedState {
  const state: RankedState = {
    board: boardToHex(0n),
    tray,
    score: 0,
    chain: 0,
    perfectNext: false,
    moves: 0,
    over: false,
  };
  return state;
}

/** Places one piece. Throws RulesError on an illegal move. */
export function applyMove(state: RankedState, move: Move): MoveResult {
  if (state.over) throw new RulesError('run is over');
  if (move.slot !== 0 && move.slot !== 1 && move.slot !== 2) throw new RulesError('bad slot');
  const piece = state.tray[move.slot];
  if (piece === null) throw new RulesError('empty slot');
  let board = boardFromHex(state.board);
  const m = pieceMask(piece, move.row, move.col);
  if (m === null || (board & m) !== 0n) throw new RulesError('piece does not fit');
  board |= m;

  const rows: number[] = [];
  const cols: number[] = [];
  for (let i = 0; i < SIZE; i++) {
    if ((board & ROW_MASK[i]) === ROW_MASK[i]) rows.push(i);
    if ((board & COL_MASK[i]) === COL_MASK[i]) cols.push(i);
  }
  for (const r of rows) board &= ~ROW_MASK[r];
  for (const c of cols) board &= ~COL_MASK[c];
  board &= FULL;

  const perfect = board === 0n;
  const s = calculateScore(rows.length + cols.length, PIECES[piece].size, state.chain, perfect, state.perfectNext ? 10 : undefined);

  const tray = [...state.tray] as Tray;
  tray[move.slot] = null;
  const next: RankedState = {
    board: boardToHex(board),
    tray,
    score: state.score + s.pointsEarned,
    chain: s.newChain,
    perfectNext: perfect,
    moves: state.moves + 1,
    over: false,
  };
  next.over = isStuck(board, tray);
  return { state: next, rows, cols, points: s.pointsEarned, label: s.label, perfect };
}

/** Deals a new tray into an emptied tray and checks whether the run can go on. */
export function dealTray(state: RankedState, tray: Tray): RankedState {
  if (!trayEmpty(state.tray)) throw new RulesError('tray not empty');
  const next = { ...state, tray };
  next.over = isStuck(boardFromHex(state.board), tray);
  return next;
}
