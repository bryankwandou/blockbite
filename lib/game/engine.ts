// ═══════════════════════════════════════════════════════════════
// BLOCKBLAST — GAME ENGINE (State Machine + useReducer)
// Board logic: placement, line detection, obstacle, game over
// ═══════════════════════════════════════════════════════════════

import { useReducer, useCallback } from 'react';
import {
  BOARD_ROWS,
  BOARD_COLS,
  Cell,
  BlockColor,
  CURSED_MODE_LEVEL,
  CURSED_PLACEMENT_TRIGGER,
  MAX_GAME_LEVEL,
  getLevelThreshold,
} from './constants';
import { isMysteryBoxLevel } from './stages';
import { Piece, generateInitialTray, generateRandomPiece, getPieceCells } from './pieces';
import { calculateScore, isBoardEmpty } from './scoring';
import { safeLevelConfig, levelConfigToBoard, levelConfigToTray, contentLevelFor } from './levelBridge';
import type { LevelConfig } from './levelTypes';

// ── State Definition ─────────────────────────────────────────────

export interface ClearAnimation {
  rows: number[];
  cols: number[];
  startTime: number;
}

export interface ScorePopAnimation {
  id: number;
  label: string;
  points: number;
  x: number;
  y: number;
  startTime: number;
}

export interface GameState {
  board: Cell[][];
  /** The 3 pieces in the tray. null means that slot was used and needs refresh. */
  tray: [Piece | null, Piece | null, Piece | null];
  score: number;
  bestScore: number;
  level: number;
  chain: number;
  /** Count of placements without a clear (for cursed mode) */
  noClears: number;
  isGameOver: boolean;
  isPaused: boolean;
  /** Perfect board bonus multiplier for NEXT placement */
  nextMultiplierOverride?: number;
  /** Pending animation data for line clear */
  clearAnimation: ClearAnimation | null;
  /** Floating score pop data */
  scorePops: ScorePopAnimation[];
  /** Session ID */
  sessionId: string;
  /** Total placements in this session */
  placements: number;
  /** Pending mystery-box event (level % 5 === 0) — cleared after player picks */
  pendingMysteryBox: boolean;
  /** How many mystery-box picks have been made this session */
  mysteryBoxPicks: number;
  /** Active multiplier from a mystery-box MULTIPLIER result */
  mysteryMultiplier: number;
  /** Current level config from the 4,000-level system (null = not yet loaded) */
  currentLevelConfig: LevelConfig | null;
  /** Display name for the current level (e.g. "Quiet Steps") */
  levelName: string;
  /** Active mechanic IDs for the current level */
  activeMechanics: string[];
}

// ── Actions ──────────────────────────────────────────────────────

type Action =
  | { type: 'PLACE_PIECE'; trayIndex: 0 | 1 | 2; row: number; col: number }
  | { type: 'CLEAR_ANIMATION_DONE' }
  | { type: 'REMOVE_SCORE_POP'; id: number }
  | { type: 'TOGGLE_PAUSE' }
  | { type: 'NEW_GAME' }
  | { type: 'NEW_GAME_AT'; level: number }
  | { type: 'NEXT_LEVEL' }
  | { type: 'MYSTERY_BOX_PICKED'; halvScore: boolean; pointsDelta: number; multiplier: number };

// ── Helpers ──────────────────────────────────────────────────────

function createEmptyBoard(): Cell[][] {
  return Array.from({ length: BOARD_ROWS }, () =>
    Array.from({ length: BOARD_COLS }, () => ({ type: 'empty' as const }))
  );
}

/**
 * Build the initial board for `level` using the 4,000-level content system.
 * Falls back to an empty board if the config cannot be generated.
 */
function createLevelBoard(level: number): Cell[][] {
  const config = safeLevelConfig(level);
  if (config) return levelConfigToBoard(config);
  return createEmptyBoard();
}

function createLevelTray(level: number): [Piece, Piece, Piece] {
  const config = safeLevelConfig(level);
  if (config) return levelConfigToTray(config);
  return generateInitialTray();
}

/** Check if a piece can be placed at (row, col) on the board */
export function canPlace(board: Cell[][], shape: number[][], row: number, col: number): boolean {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (shape[r][c] === 1) {
        const br = row + r;
        const bc = col + c;
        if (br < 0 || br >= BOARD_ROWS || bc < 0 || bc >= BOARD_COLS) return false;
        if (board[br][bc].type !== 'empty') return false;
      }
    }
  }
  return true;
}

/** Check if a piece can be placed ANYWHERE on the board */
export function canPlaceAnywhere(board: Cell[][], shape: number[][]): boolean {
  for (let r = 0; r <= BOARD_ROWS - shape.length; r++) {
    for (let c = 0; c <= BOARD_COLS - shape[0].length; c++) {
      if (canPlace(board, shape, r, c)) return true;
    }
  }
  return false;
}

/** Check if any of the 3 tray pieces can still be placed */
function hasAnyLegalMove(board: Cell[][], tray: (Piece | null)[]): boolean {
  return tray.some(piece => piece !== null && canPlaceAnywhere(board, piece.shape));
}

/** Find which rows are completely filled */
function findFullRows(board: Cell[][]): number[] {
  const full: number[] = [];
  for (let r = 0; r < BOARD_ROWS; r++) {
    if (board[r].every(cell => cell.type !== 'empty')) {
      full.push(r);
    }
  }
  return full;
}

/** Find which columns are completely filled */
function findFullCols(board: Cell[][]): number[] {
  const full: number[] = [];
  for (let c = 0; c < BOARD_COLS; c++) {
    if (board.every(row => row[c].type !== 'empty')) {
      full.push(c);
    }
  }
  return full;
}

/** Clear specified rows and columns, return new board */
function clearLinesFromBoard(board: Cell[][], rows: number[], cols: number[]): Cell[][] {
  const newBoard = board.map(row => [...row]);
  for (const r of rows) {
    for (let c = 0; c < BOARD_COLS; c++) {
      newBoard[r][c] = { type: 'empty' };
    }
  }
  for (const c of cols) {
    for (let r = 0; r < BOARD_ROWS; r++) {
      newBoard[r][c] = { type: 'empty' };
    }
  }
  return newBoard;
}

/** Add a cursed obstacle row */
function addCursedRow(board: Cell[][]): Cell[][] {
  const newBoard = board.map(row => [...row]);
  const randomRow = Math.floor(Math.random() * BOARD_ROWS);
  // Only fill empty cells
  for (let c = 0; c < BOARD_COLS; c++) {
    if (newBoard[randomRow][c].type === 'empty') {
      newBoard[randomRow][c] = { type: 'obstacle', color: 'shadow' as BlockColor };
    }
  }
  return newBoard;
}

let scorePosId = 0;

// ── Reducer ──────────────────────────────────────────────────────

function reducer(state: GameState, action: Action): GameState {
  switch (action.type) {
    case 'PLACE_PIECE': {
      const { trayIndex, row, col } = action;
      const piece = state.tray[trayIndex];
      if (!piece || state.isGameOver || state.isPaused) return state;

      // Validate placement
      if (!canPlace(state.board, piece.shape, row, col)) return state;

      // Place piece onto board
      let newBoard = state.board.map(r => [...r]);
      const cells = getPieceCells(piece.shape, row, col);
      for (const [br, bc] of cells) {
        newBoard[br][bc] = { type: 'block', color: piece.color };
      }

      // Detect lines
      const fullRows = findFullRows(newBoard);
      const fullCols = findFullCols(newBoard);
      const totalLines = fullRows.length + fullCols.length;

      // Clear lines
      if (totalLines > 0) {
        newBoard = clearLinesFromBoard(newBoard, fullRows, fullCols);
      }

      // Check perfect board
      const perfect = isBoardEmpty(newBoard);

      // Score
      const scoreResult = calculateScore(
        totalLines,
        piece.size,
        state.chain,
        perfect,
        state.nextMultiplierOverride,
      );

      // Apply mystery-box multiplier FIRST so level-up loop uses the correct final score
      const rawScore = state.score + scoreResult.pointsEarned;
      const appliedScore = state.mysteryMultiplier > 1
        ? state.score + Math.floor(scoreResult.pointsEarned * state.mysteryMultiplier)
        : rawScore;

      // Cursed mode
      let noClears = totalLines > 0 ? 0 : state.noClears + 1;
      if (state.level >= CURSED_MODE_LEVEL && noClears >= CURSED_PLACEMENT_TRIGGER) {
        newBoard = addCursedRow(newBoard);
        noClears = 0;
      }

      // Update tray — replace used slot
      const newTray: [Piece | null, Piece | null, Piece | null] = [...state.tray] as [Piece | null, Piece | null, Piece | null];
      newTray[trayIndex] = generateRandomPiece();

      // Check game over
      const isGameOver = !hasAnyLegalMove(newBoard, newTray);

      // Score pop animation
      const newPops: ScorePopAnimation[] = [...state.scorePops];
      if (scoreResult.pointsEarned > 0 && scoreResult.label) {
        newPops.push({
          id: ++scorePosId,
          label: scoreResult.label,
          points: scoreResult.pointsEarned,
          x: 0.5,
          y: 0.4,
          startTime: Date.now(),
        });
      }

      // Level-up loop — uses appliedScore so the invariant (score < threshold[level])
      // is maintained correctly even when a mystery-box multiplier boosted the score
      let newLevel = state.level;
      let triggeredMysteryBox = false;
      while (newLevel < MAX_GAME_LEVEL && appliedScore >= getLevelThreshold(newLevel)) {
        newLevel++;
        newPops.push({
          id: ++scorePosId,
          label: `LEVEL UP: ${newLevel}`,
          points: 0,
          x: 0.5,
          y: Math.max(0.05, 0.3 - (newLevel - state.level) * 0.05),
          startTime: Date.now(),
        });
        if (isMysteryBoxLevel(newLevel)) triggeredMysteryBox = true;
      }

      // Persist stats on game over (after newLevel is finalised)
      if (isGameOver && typeof window !== 'undefined') {
        const prevMax = parseInt(localStorage.getItem('bb_max_level') ?? '1');
        if (newLevel > prevMax) localStorage.setItem('bb_max_level', newLevel.toString());
        const prevGames = parseInt(localStorage.getItem('bb_games_played') ?? '0');
        localStorage.setItem('bb_games_played', (prevGames + 1).toString());
      }

      return {
        ...state,
        board: newBoard,
        tray: newTray,
        score: appliedScore,
        bestScore: Math.max(state.bestScore, appliedScore),
        level: newLevel,
        chain: scoreResult.newChain,
        noClears,
        isGameOver,
        nextMultiplierOverride: perfect ? 10 : undefined,
        clearAnimation: totalLines > 0
          ? { rows: fullRows, cols: fullCols, startTime: Date.now() }
          : null,
        scorePops: newPops,
        placements: state.placements + 1,
        pendingMysteryBox: state.pendingMysteryBox || triggeredMysteryBox,
        mysteryMultiplier: 1,   // consumed after one placement
      };
    }

    case 'MYSTERY_BOX_PICKED': {
      const { halvScore, pointsDelta, multiplier } = action;
      const base = halvScore ? Math.floor(state.score / 2) : state.score;
      const newScore = Math.max(0, base + pointsDelta);
      return {
        ...state,
        score: newScore,
        bestScore: Math.max(state.bestScore, newScore),
        pendingMysteryBox: false,
        mysteryBoxPicks: state.mysteryBoxPicks + 1,
        mysteryMultiplier: multiplier,
      };
    }

    case 'CLEAR_ANIMATION_DONE': {
      return { ...state, clearAnimation: null };
    }

    case 'REMOVE_SCORE_POP': {
      return { ...state, scorePops: state.scorePops.filter(p => p.id !== action.id) };
    }

    case 'TOGGLE_PAUSE': {
      return { ...state, isPaused: !state.isPaused };
    }

    case 'NEW_GAME_AT':
    case 'NEW_GAME': {
      const level = action.type === 'NEW_GAME_AT'
        ? Math.max(1, Math.min(MAX_GAME_LEVEL, action.level))
        : 1;
      const cfg = safeLevelConfig(level);
      return {
        board: createLevelBoard(level),
        tray: createLevelTray(level),
        score: 0,
        bestScore: state.bestScore,
        level,
        chain: 0,
        noClears: 0,
        isGameOver: false,
        isPaused: false,
        nextMultiplierOverride: undefined,
        clearAnimation: null,
        scorePops: [],
        sessionId: `session_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        placements: 0,
        pendingMysteryBox: false,
        mysteryBoxPicks: action.type === 'NEW_GAME_AT' ? 0 : state.mysteryBoxPicks,
        mysteryMultiplier: 1,
        currentLevelConfig: cfg,
        levelName: cfg?.name ?? `Level ${level}`,
        activeMechanics: cfg?.mechanics ?? [],
      };
    }

    case 'NEXT_LEVEL': {
      const level = state.level + 1;
      const cfg = safeLevelConfig(level);
      return {
        ...state,
        board: createLevelBoard(level),
        tray: createLevelTray(level),
        level,
        chain: 0,
        noClears: 0,
        isGameOver: false,
        clearAnimation: null,
        scorePops: [],
        currentLevelConfig: cfg,
        levelName: cfg?.name ?? `Level ${contentLevelFor(level)}`,
        activeMechanics: cfg?.mechanics ?? [],
      };
    }

    default:
      return state;
  }
}

// ── Initial State ────────────────────────────────────────────────

function createInitialState(level = 1): GameState {
  const lvl = Math.max(1, Math.min(MAX_GAME_LEVEL, level));
  const cfg = safeLevelConfig(lvl);
  return {
    board: createLevelBoard(lvl),
    tray: createLevelTray(lvl),
    score: 0,
    bestScore: 0,
    level: lvl,
    chain: 0,
    noClears: 0,
    isGameOver: false,
    isPaused: false,
    nextMultiplierOverride: undefined,
    clearAnimation: null,
    scorePops: [],
    sessionId: `session_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    placements: 0,
    pendingMysteryBox: false,
    mysteryBoxPicks: 0,
    mysteryMultiplier: 1,
    currentLevelConfig: cfg,
    levelName: cfg?.name ?? `Level ${lvl}`,
    activeMechanics: cfg?.mechanics ?? [],
  };
}

// ── Hook ─────────────────────────────────────────────────────────

export function useGameEngine(initialLevel = 1) {
  const [state, dispatch] = useReducer(reducer, initialLevel, createInitialState);

  const placePiece = useCallback((trayIndex: 0 | 1 | 2, row: number, col: number) => {
    dispatch({ type: 'PLACE_PIECE', trayIndex, row, col });
  }, []);

  const clearAnimationDone = useCallback(() => {
    dispatch({ type: 'CLEAR_ANIMATION_DONE' });
  }, []);

  const removeScorePop = useCallback((id: number) => {
    dispatch({ type: 'REMOVE_SCORE_POP', id });
  }, []);

  const togglePause = useCallback(() => {
    dispatch({ type: 'TOGGLE_PAUSE' });
  }, []);

  const newGame = useCallback(() => {
    dispatch({ type: 'NEW_GAME' });
  }, []);

  const newGameAt = useCallback((level: number) => {
    dispatch({ type: 'NEW_GAME_AT', level });
  }, []);

  const nextLevel = useCallback(() => {
    dispatch({ type: 'NEXT_LEVEL' });
  }, []);

  const mysteryBoxPicked = useCallback((halvScore: boolean, pointsDelta: number, multiplier: number) => {
    dispatch({ type: 'MYSTERY_BOX_PICKED', halvScore, pointsDelta, multiplier });
  }, []);

  return {
    state,
    placePiece,
    clearAnimationDone,
    removeScorePop,
    togglePause,
    newGame,
    newGameAt,
    nextLevel,
    mysteryBoxPicked,
    canPlace,
    canPlaceAnywhere,
    levelName: state.levelName,
    activeMechanics: state.activeMechanics,
  };
}
