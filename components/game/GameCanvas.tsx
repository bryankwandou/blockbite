'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { useGameEngine, canPlace } from '@/lib/game/engine';
import { BOARD_ROWS, BOARD_COLS, CELL_SIZE, CELL_GAP, BLOCK_COLORS, MAX_GAME_LEVEL, getLevelThreshold, getLevelTier } from '@/lib/game/constants';
import {
  drawBoard, drawGhostPiece, drawScorePop, drawParticles,
  createParticlesForClear, updateParticles, Particle, roundRect,
  drawShockwave, Shockwave, drawIdleBackground, createIdleBlocks, drawTrayPiece, shakeAmount, gfxLow
} from '@/lib/game/renderer';
import { MODES, type ModeId } from '@/lib/game/modes';
import { useNumber } from './useNumber';
import { playSfx } from '@/lib/audio';
import { getStageName } from '@/lib/game/stages';
import MysteryBoxModal from './MysteryBoxModal';
import GameOverCelebration from './GameOverCelebration';
import { BoxResult } from '@/lib/game/mysteryBox';
import { reportError } from '@/lib/analytics/errorReporter';
import type { Biome } from '@/lib/game/biomes';
import { useT } from '@/lib/i18n';
import { translatePop } from './popLabel';
import styles from './GameCanvas.module.css';

// English titles of tutorial levels 1-10 in lib/game/milestones.ts, in order.
const TUTORIAL_TITLES = ['First Steps', 'Two Lines', 'Score Run', 'Locked Cells', 'Color Hunt', 'Bomb Piece', 'Ice Age', 'Combo Time', 'Gravity Flip', 'Boss: Awakener'];

const BOARD_PX = BOARD_COLS * (CELL_SIZE + CELL_GAP) - CELL_GAP;
const BOARD_PY = BOARD_ROWS * (CELL_SIZE + CELL_GAP) - CELL_GAP;
const TRAY_CELL = 28;

export default function GameCanvas({ initialLevel = 1, onBack, biome, mode = 'free' }: { initialLevel?: number; onBack?: () => void; biome?: Biome; mode?: ModeId }) {
  const rules = MODES[mode];
  const { connected, publicKey, connecting, select } = useWallet();
  const { setVisible: setWalletModalVisible } = useWalletModal();
  const t = useT('game');
  const { score: fmtScore } = useNumber();
  const openWalletPicker = useCallback(() => {
    // Same defensive pattern as the navbar button: if a previous wallet is
    // stuck connecting, clear the selection so the picker shows up instead
    // of silently waiting on a dead promise.
    if (connecting && !connected) {
      try { select(null as unknown as Parameters<typeof select>[0]); } catch { /* ignore */ }
    }
    setWalletModalVisible(true);
  }, [connecting, connected, select, setWalletModalVisible]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const particlesRef = useRef<Particle[]>([]);
  const shockwavesRef = useRef<Shockwave[]>([]);
  const clearFlashRef = useRef<{ progress: number; rows: number[]; cols: number[] } | null>(null);
  const shakeRef = useRef(0);
  const idleBlocksRef = useRef<any[]>([]);

  const [selectedTray, setSelectedTray] = useState<0 | 1 | 2 | null>(null);
  const [ghostPos, setGhostPos] = useState<{ row: number; col: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragPiece, setDragPiece] = useState<{ trayIdx: 0|1|2; mouseX: number; mouseY: number } | null>(null);

  const { state, placePiece, newGame, newGameAt, clearAnimationDone, removeScorePop, mysteryBoxPicked, levelName } = useGameEngine(initialLevel);
  // Tutorial titles are translated; generated level and boss names are proper
  // names (like the mascots) and stay as they are. The engine's "Level N"
  // fallback is dropped: the badge already shows the translated level.
  const tutIndex = TUTORIAL_TITLES.indexOf(levelName ?? '');
  const shownLevelName = tutIndex >= 0 ? t(`tut_title_${tutIndex + 1}`) : /^Level \d+$/.test(levelName ?? '') ? '' : (levelName ?? '').replace(/ — Lv \d+$/, '');
  const sessionTokenRef = useRef<string | null>(null);

  // Board origin
  const originX = 12;
  const originY = 12;

  // Tray layout
  const TRAY_Y = originY + BOARD_PY + 40;
  const CANVAS_W = BOARD_PX + 24;
  const CANVAS_H = TRAY_Y + 130;

  // Read-only snapshot for automated play tests (tests/e2e/realplay.spec.ts).
  // Only exposed when localStorage 'bb:e2e' is '1'; players never get it.
  useEffect(() => {
    try { if (localStorage.getItem('bb:e2e') !== '1') return; } catch { return; }
    const w = window as unknown as { __bbGame?: unknown };
    w.__bbGame = {
      free: state.board.map((row, r) => row.map((_, c) => canPlace(state.board, [[1]], r, c))),
      tray: state.tray.map((p) => (p ? p.shape : null)),
      score: state.score, level: state.level, placements: state.placements,
      isGameOver: state.isGameOver, pendingMysteryBox: state.pendingMysteryBox,
      geometry: { originX, originY, cell: CELL_SIZE + CELL_GAP, trayY: TRAY_Y, canvasW: CANVAS_W },
    };
  }, [state, originX, originY, TRAY_Y, CANVAS_W]);


  // ── Saving progress (Adventure board, lib/adventure/db.ts) ─────────────
  // A server session starts as soon as a wallet is connected, so its length
  // counts as play time. Each token is single use: after every submit a new
  // session starts for the play that follows. Results go up whenever a level
  // is cleared, at game over, and when the page is hidden or closed, so
  // leaving mid-run never loses cleared levels.
  const wallet = connected && publicKey ? publicKey.toBase58() : null;
  const startSession = useCallback(async (lvl: number) => {
    if (!wallet) return;
    try {
      const res = await fetch('/api/session/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress: wallet, level: lvl }),
      });
      if (res.ok) sessionTokenRef.current = (await res.json()).token ?? null;
    } catch { /* offline: the next submit starts one */ }
  }, [wallet]);

  const submitProgress = useCallback(async (lvl: number, score: number) => {
    if (!wallet) return;
    const token = sessionTokenRef.current;
    sessionTokenRef.current = null;
    if (!token) { await startSession(lvl); return; }
    try {
      await fetch('/api/session/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, score, level: lvl, walletAddress: wallet }),
      });
    } catch { /* best effort */ }
    await startSession(lvl);
  }, [wallet, startSession]);

  useEffect(() => {
    if (wallet && !sessionTokenRef.current) void startSession(state.level);
  }, [wallet]); // eslint-disable-line react-hooks/exhaustive-deps

  // A cleared level (the engine moves on to the next one) is saved right away.
  const lastLevelRef = useRef(state.level);
  useEffect(() => {
    if (state.level > lastLevelRef.current) void submitProgress(state.level, state.score);
    lastLevelRef.current = state.level;
  }, [state.level]); // eslint-disable-line react-hooks/exhaustive-deps

  // Leaving the page: send what is there without waiting for an answer.
  const liveRef = useRef({ level: state.level, score: state.score, placements: state.placements });
  liveRef.current = { level: state.level, score: state.score, placements: state.placements };
  useEffect(() => {
    if (!wallet) return;
    const flush = () => {
      const token = sessionTokenRef.current;
      const { level, score, placements } = liveRef.current;
      if (!token || placements === 0 || document.visibilityState !== 'hidden') return;
      sessionTokenRef.current = null;
      const body = JSON.stringify({ token, score, level, walletAddress: wallet });
      try { navigator.sendBeacon('/api/session/submit', new Blob([body], { type: 'application/json' })); } catch { /* ignore */ }
    };
    const onShow = () => { if (document.visibilityState === 'visible' && !sessionTokenRef.current) void startSession(liveRef.current.level); };
    document.addEventListener('visibilitychange', flush);
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', flush);
      document.removeEventListener('visibilitychange', onShow);
      window.removeEventListener('pagehide', flush);
    };
  }, [wallet, startSession]);

  const handleStartGame = async () => {
    if (initialLevel > 1) {
      newGameAt(initialLevel);
    } else {
      newGame();
    }
  };

  // Sound: place / line / combo / perfect on each placement, gameover once.
  const sfxRef = useRef({ placements: state.placements, over: state.isGameOver });
  useEffect(() => {
    const prev = sfxRef.current;
    if (state.placements > prev.placements) {
      if (!state.clearAnimation) playSfx('place');
      else if (state.board.every((row) => row.every((c) => c.type !== 'block'))) playSfx('perfect');
      else if (state.chain > 1) playSfx('combo', state.chain);
      else playSfx('line');
    }
    if (state.isGameOver && !prev.over) playSfx('gameover');
    sfxRef.current = { placements: state.placements, over: state.isGameOver };
  }, [state.placements, state.isGameOver, state.clearAnimation, state.board, state.chain]);

  // Saga map stars: localStorage.bb_stars = {"<level>": 1|2|3}. Written when the
  // level goal (score threshold) is passed; 2 stars at 1.5x, 3 stars at 2x the
  // goal. Never lowers an existing value.
  useEffect(() => {
    if (mode !== 'free' || state.level <= initialLevel) return;
    const goal = getLevelThreshold(initialLevel);
    const stars = state.score >= goal * 2 ? 3 : state.score >= goal * 1.5 ? 2 : 1;
    try {
      const raw = localStorage.getItem('bb_stars');
      const map = raw ? (JSON.parse(raw) as Record<string, number>) : {};
      const key = String(initialLevel);
      if ((map[key] ?? 0) < stars) {
        map[key] = stars;
        localStorage.setItem('bb_stars', JSON.stringify(map));
      }
    } catch { /* storage unavailable */ }
  }, [state.level, state.score, initialLevel, mode]);

  const [celebrate, setCelebrate] = useState<{ pb: boolean; rank: number | null } | null>(null);
  const gameOverHandledRef = useRef(false);
  useEffect(() => {
    if (state.isGameOver && !gameOverHandledRef.current && connected && publicKey) {
      gameOverHandledRef.current = true;
      reportError({
        severity: 'info',
        message: `Game over at ${getStageName(state.level)} — score ${state.score}`,
        level: state.level,
        sessionId: state.sessionId,
        walletAddress: publicKey.toBase58(),
        component: 'GameCanvas',
      });
      // Advance map progress: move to next map level after playing
      if (state.score > 0) {
        const prevMapLevel = parseInt(localStorage.getItem('bb_max_level') ?? '1');
        if (initialLevel >= prevMapLevel) {
          localStorage.setItem('bb_max_level', String(initialLevel + 1));
        }
        const prevGames = parseInt(localStorage.getItem('bb_games_played') ?? '0');
        localStorage.setItem('bb_games_played', String(prevGames + 1));
      }

      // Save the run: level reached and score (the session started when the wallet connected).
      const runScore = state.score;
      const saved = submitProgress(state.level, runScore);

      // Celebrate a new personal best (not the very first score), and a top-10
      // place on the free board once the run is saved. Best effort, never blocks.
      let pb = false;
      try {
        const prev = parseInt(localStorage.getItem('bb_pb_score') ?? '0', 10) || 0;
        if (runScore > prev) {
          localStorage.setItem('bb_pb_score', String(runScore));
          pb = prev > 0;
        }
      } catch { /* storage unavailable */ }
      if (pb) setCelebrate({ pb: true, rank: null });
      const w = publicKey.toBase58();
      void saved.then(() => fetch(`/api/adventure/leaderboard?wallet=${w}`, { cache: 'no-store' }))
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          const rank = d?.me?.rank;
          if (pb && typeof rank === 'number' && rank >= 1 && rank <= 10) setCelebrate({ pb: true, rank });
        })
        .catch(() => { /* best effort */ });
    }
    if (!state.isGameOver) { gameOverHandledRef.current = false; setCelebrate(null); }
  }, [state.isGameOver, connected, publicKey, state.level, state.score, state.sessionId, state.placements, submitProgress]);

  const handleMysteryBoxResult = useCallback((result: BoxResult) => {
    mysteryBoxPicked(result.halvScore, result.pointsDelta, result.nextMultiplier);
  }, [mysteryBoxPicked]);

  // Initialize idle blocks
  useEffect(() => {
    idleBlocksRef.current = createIdleBlocks(CANVAS_W, CANVAS_H);
  }, [CANVAS_W, CANVAS_H]);

  const traySlotX = (idx: number) => {
    const spacing = CANVAS_W / 3;
    return spacing * idx + spacing / 2;
  };

  function getBoardCell(mouseX: number, mouseY: number): { row: number; col: number } | null {
    const cellTotal = CELL_SIZE + CELL_GAP;
    const col = Math.floor((mouseX - originX) / cellTotal);
    const row = Math.floor((mouseY - originY) / cellTotal);
    if (row < 0 || row >= BOARD_ROWS || col < 0 || col >= BOARD_COLS) return null;
    return { row, col };
  }

  function getCanvasPos(e: any): { x: number; y: number } {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    let clientX: number, clientY: number;
    if (e.touches) {
      clientX = e.touches[0]?.clientX ?? e.changedTouches[0]?.clientX;
      clientY = e.touches[0]?.clientY ?? e.changedTouches[0]?.clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }

  function getTraySlot(x: number, y: number): 0 | 1 | 2 | null {
    if (y < TRAY_Y - 40 || y > TRAY_Y + 120) return null;
    for (let i = 0; i < 3; i++) {
      const cx = traySlotX(i);
      if (Math.abs(x - cx) < 60) return i as 0 | 1 | 2;
    }
    return null;
  }

  const handleCanvasClick = useCallback((e: any) => {
    if (state.isGameOver || state.isPaused) return;
    const { x, y } = getCanvasPos(e);
    const traySlot = getTraySlot(x, y);
    if (traySlot !== null && state.tray[traySlot] !== null) {
      setSelectedTray(traySlot);
      setGhostPos(null);
      return;
    }
    const cell = getBoardCell(x, y);
    if (cell && selectedTray !== null) {
      const piece = state.tray[selectedTray];
      if (!piece) return;
      const row = Math.max(0, Math.min(cell.row, BOARD_ROWS - piece.shape.length));
      const col = Math.max(0, Math.min(cell.col, BOARD_COLS - piece.shape[0].length));
      if (canPlace(state.board, piece.shape, row, col)) {
        placePiece(selectedTray, row, col);
        setSelectedTray(null);
        setGhostPos(null);
      }
    }
  }, [state, selectedTray, placePiece]);

  const handleMouseMove = useCallback((e: any) => {
    if (state.isGameOver || selectedTray === null) return;
    const { x, y } = getCanvasPos(e);
    const cell = getBoardCell(x, y);
    if (cell) {
      const piece = state.tray[selectedTray];
      if (piece) {
        const row = Math.max(0, Math.min(cell.row, BOARD_ROWS - piece.shape.length));
        const col = Math.max(0, Math.min(cell.col, BOARD_COLS - piece.shape[0].length));
        setGhostPos({ row, col });
      }
    } else {
      setGhostPos(null);
    }
  }, [state, selectedTray]);

  const handleMouseDown = useCallback((e: any) => {
    if (state.isGameOver) return;
    const { x, y } = getCanvasPos(e);
    const traySlot = getTraySlot(x, y);
    if (traySlot !== null && state.tray[traySlot] !== null) {
      setDragPiece({ trayIdx: traySlot, mouseX: x, mouseY: y });
      setSelectedTray(traySlot);
      setIsDragging(true);
    }
  }, [state]);

  const handleMouseUp = useCallback((e: any) => {
    if (!isDragging || !dragPiece) return;
    const { x, y } = getCanvasPos(e);
    const cell = getBoardCell(x, y);
    if (cell) {
      const piece = state.tray[dragPiece.trayIdx];
      if (piece) {
        const row = Math.max(0, Math.min(cell.row, BOARD_ROWS - piece.shape.length));
        const col = Math.max(0, Math.min(cell.col, BOARD_COLS - piece.shape[0].length));
        if (canPlace(state.board, piece.shape, row, col)) {
          placePiece(dragPiece.trayIdx, row, col);
          setSelectedTray(null);
          setGhostPos(null);
        }
      }
    }
    setIsDragging(false);
    setDragPiece(null);
  }, [isDragging, dragPiece, state, placePiece]);

  // Effects for clear animation
  useEffect(() => {
    if (state.clearAnimation) {
      const { rows, cols } = state.clearAnimation;
      particlesRef.current = [...particlesRef.current, ...createParticlesForClear(rows, cols, originX, originY)];
      
      rows.forEach(r => shockwavesRef.current.push({ x: originX + BOARD_PX / 2, y: originY + r * (CELL_SIZE + CELL_GAP) + CELL_SIZE / 2, r: 20, life: 1.0 }));
      cols.forEach(c => shockwavesRef.current.push({ x: originX + c * (CELL_SIZE + CELL_GAP) + CELL_SIZE / 2, y: originY + BOARD_PY / 2, r: 20, life: 1.0 }));

      clearFlashRef.current = { progress: 0, rows, cols };
      shakeRef.current = gfxLow() ? 0 : (rows.length + cols.length) >= 4 ? 15 : 8;
      
      const timer = setTimeout(() => {
        clearFlashRef.current = null;
        clearAnimationDone();
      }, 400);
      return () => clearTimeout(timer);
    }
  }, [state.clearAnimation, clearAnimationDone]);

  // Main render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    let lastTime = 0;

    function render(time: number) {
      const dt = time - lastTime;
      lastTime = time;
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
      drawIdleBackground(ctx, idleBlocksRef.current, time, CANVAS_W, CANVAS_H,
        biome ? { accent: biome.accent, glow: biome.glow, rock: biome.rock } : undefined);

      let shakeX = 0, shakeY = 0;
      if (shakeRef.current > 0) {
        shakeX = shakeAmount(shakeRef.current);
        shakeY = shakeAmount(shakeRef.current);
        shakeRef.current = Math.max(0, shakeRef.current - 0.6);
      }

      ctx.save();
      ctx.translate(shakeX, shakeY);
      shockwavesRef.current = shockwavesRef.current.map(s => ({ ...s, r: s.r + dt * 0.5, life: s.life - dt * 0.002 })).filter(s => s.life > 0);
      shockwavesRef.current.forEach(s => drawShockwave(ctx, s));

      let flashAlpha = 0, flashRows: number[] = [], flashCols: number[] = [];
      if (clearFlashRef.current) {
        clearFlashRef.current.progress = Math.min(1, clearFlashRef.current.progress + dt / 400);
        flashAlpha = clearFlashRef.current.progress;
        flashRows = clearFlashRef.current.rows;
        flashCols = clearFlashRef.current.cols;
      }

      drawBoard(ctx, state.board, originX, originY, flashRows, flashCols, flashAlpha);

      if (selectedTray !== null && ghostPos) {
        const piece = state.tray[selectedTray];
        if (piece) {
          const valid = canPlace(state.board, piece.shape, ghostPos.row, ghostPos.col);
          drawGhostPiece(ctx, piece.shape, piece.color, ghostPos.row, ghostPos.col, originX, originY, valid);
        }
      }

      particlesRef.current = updateParticles(particlesRef.current);
      drawParticles(ctx, particlesRef.current);

      ctx.save();
      ctx.fillStyle = 'rgba(6, 6, 20, 0.88)';
      ctx.beginPath();
      roundRect(ctx, 0, TRAY_Y - 20, CANVAS_W, 150, 20);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0, 245, 255, 0.1)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();

      for (let i = 0; i < 3; i++) {
        const piece = state.tray[i];
        const cx = traySlotX(i);
        const cy = TRAY_Y + 45;
        const isSelected = selectedTray === i;

        if (!piece) {
          ctx.save();
          ctx.globalAlpha = 0.1;
          ctx.strokeStyle = '#8888BB';
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          roundRect(ctx, cx - 30, cy - 30, 60, 60, 10);
          ctx.stroke();
          ctx.restore();
          continue;
        }

        const scale = isSelected ? 1.15 : 1.0;
        drawTrayPiece(ctx, piece, cx, cy, TRAY_CELL, isSelected, true, scale);
        
        ctx.font = `600 12px 'Orbitron'`;
        ctx.fillStyle = isSelected ? '#00F5FF' : '#444466';
        ctx.textAlign = 'center';
        ctx.fillText(`${i + 1}`, cx, TRAY_Y + 110);
      }

      const now = Date.now();
      state.scorePops.forEach(pop => {
        const progress = Math.min((now - pop.startTime) / 1500, 1);
        drawScorePop(ctx, translatePop(t, pop.label), pop.points, CANVAS_W * pop.x, CANVAS_H * pop.y, progress);
        if (progress >= 1) removeScorePop(pop.id);
      });

      if (state.isGameOver) {
        // Dim overlay
        ctx.fillStyle = 'rgba(6,6,20,0.88)';
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

        // Game-over card
        const cardW = CANVAS_W - 48, cardH = 180, cardX = 24, cardY = CANVAS_H / 2 - 110;
        ctx.fillStyle = 'rgba(255,51,102,0.08)';
        ctx.strokeStyle = 'rgba(255,51,102,0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        roundRect(ctx, cardX, cardY, cardW, cardH, 16);
        ctx.fill(); ctx.stroke();

        ctx.textAlign = 'center';

        // Title
        ctx.font = `900 32px 'Orbitron'`;
        ctx.fillStyle = '#FF3366';
        ctx.shadowBlur = 24; ctx.shadowColor = '#FF3366';
        ctx.fillText(t('game_over'), CANVAS_W / 2, cardY + 48);
        ctx.shadowBlur = 0;

        // Score
        ctx.font = `700 20px 'Orbitron'`;
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(fmtScore(state.score), CANVAS_W / 2, cardY + 84);
        ctx.font = `500 11px 'Plus Jakarta Sans'`;
        ctx.fillStyle = '#8888BB';
        ctx.fillText(t('final_score'), CANVAS_W / 2, cardY + 100);

        // Level name
        ctx.font = `600 12px 'Plus Jakarta Sans'`;
        ctx.fillStyle = '#00F5FF';
        ctx.fillText(t('reached_level', { level: state.level }), CANVAS_W / 2, cardY + 130);

        // Hint
        ctx.font = `500 11px 'Plus Jakarta Sans'`;
        ctx.fillStyle = '#555577';
        ctx.fillText(t('score_submitted'), CANVAS_W / 2, cardY + 154, cardW - 24);
      }

      ctx.restore();
      rafRef.current = requestAnimationFrame(render);
    }

    rafRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafRef.current);
  }, [state, selectedTray, ghostPos, isDragging, dragPiece, CANVAS_W, CANVAS_H, TRAY_Y, t, fmtScore]);

  const handleEsc = useCallback((e: any) => {
    if (e.key === 'Escape') setSelectedTray(null);
    if (e.key >= '1' && e.key <= '3') {
      const idx = (parseInt(e.key) - 1) as 0 | 1 | 2;
      if (state.tray[idx]) setSelectedTray(idx);
    }
  }, [state.tray]);

  useEffect(() => {
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [handleEsc]);

  // Hint (Free mode only, per lib/game/modes.ts): pick the first piece that
  // fits and show where it goes.
  const showHint = useCallback(() => {
    if (!rules.hints || state.isGameOver) return;
    for (let i = 0; i < 3; i++) {
      const piece = state.tray[i];
      if (!piece) continue;
      for (let r = 0; r + piece.shape.length <= BOARD_ROWS; r++) {
        for (let c = 0; c + piece.shape[0].length <= BOARD_COLS; c++) {
          if (canPlace(state.board, piece.shape, r, c)) {
            setSelectedTray(i as 0 | 1 | 2);
            setGhostPos({ row: r, col: c });
            return;
          }
        }
      }
    }
  }, [rules.hints, state]);

  return (
    <div className={styles.wrapper} data-mode={mode} style={{ ['--mode-accent' as string]: rules.theme.accent }}>
      {/* Mystery Box overlay — auto-shows when pendingMysteryBox=true */}
      {state.pendingMysteryBox && (
        <MysteryBoxModal
          level={state.level}
          currentScore={state.score}
          picksInSession={state.mysteryBoxPicks}
          onResult={handleMysteryBoxResult}
        />
      )}
      <div className={styles.hud}>
        <div className={styles.hudStat}>
          <span className={styles.hudLabel}>{t('score')}</span>
          <span className={styles.hudValue}>{fmtScore(state.score)}</span>
        </div>
        <div className={styles.hudCenter}>
          <span className={styles.levelBadge} title={getLevelTier(state.level)}>{t('level')} {state.level}</span>
          {shownLevelName && (
            <span className={styles.levelName}>
              {shownLevelName}
            </span>
          )}
          <div className={styles.levelProgressBar}>
            {(() => {
              const prev = state.level <= 1 ? 0 : getLevelThreshold(state.level - 1);
              const next = state.level >= MAX_GAME_LEVEL ? state.score : getLevelThreshold(state.level);
              const span = Math.max(1, next - prev);
              const pct = Math.min(100, Math.max(0, ((state.score - prev) / span) * 100));
              return <div className={styles.progressBarFill} style={{ width: `${pct}%` }} />;
            })()}
          </div>
          {state.chain > 1 && (
            <div className={styles.chainBadge}>
              <span>{t('chain_badge', { n: state.chain })}</span>
            </div>
          )}
        </div>
        <div className={`${styles.hudStat} ${styles.hudStatEnd}`}>
          <span className={styles.hudLabel}>{t('best_score')}</span>
          <span className={styles.hudValue}>{fmtScore(state.bestScore)}</span>
        </div>
      </div>

      {rules.goal === 'level' && (() => {
        const g = state.currentLevelConfig?.goals?.[0];
        const text = !g ? null
          : g.type === 'lines_n' ? t('goal_lines', { n: g.target ?? 1 })
          : g.type === 'score_n' ? t('goal_score', { n: fmtScore(g.target ?? 0) })
          : t('goal_other');
        return text ? <p className={styles.goalLine} data-testid="level-goal">{text}</p> : null;
      })()}

      <canvas
        ref={canvasRef}
        width={CANVAS_W}
        height={CANVAS_H}
        className={styles.canvas}
        onClick={handleCanvasClick}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        style={{ cursor: selectedTray !== null ? 'crosshair' : 'default' }}
      />

      {/* Controls hint until the first move; after that the board is the only thing to look at. */}
      {state.placements === 0 && !state.isGameOver && <div className={styles.hint}>
        <span><kbd className={styles.hintKey}>1-3</kbd> {t('select_piece')}</span>
        <span>{t('click_to_place')}</span>
        <span><kbd className={styles.hintKey}>{t('key_esc')}</kbd> {t('deselect')}</span>
      </div>}

      {(rules.hints || !connected) && !state.isGameOver && (
        <div className={styles.freeActions}>
          {rules.hints && (
            <button type="button" className={styles.btnGhost} onClick={showHint} data-testid="hint-btn">
              {t('hint_btn')}
            </button>
          )}
          {!connected && (
            <button type="button" className={styles.btnGhost} onClick={() => openWalletPicker()}>
              {connecting ? t('connecting') : t('free_connect_btn')}
            </button>
          )}
        </div>
      )}

      {state.isGameOver && celebrate && <GameOverCelebration personalBest={celebrate.pb} rank={celebrate.rank} />}

      {state.isGameOver && (
        <div className={styles.gameOverActions}>
          <button type="button" className={styles.btnMain} onClick={handleStartGame}>
            {t('play_again')}
          </button>
          {onBack ? (
            <button type="button" className={styles.btnGhost} onClick={onBack}>
              {t('back_to_map')}
            </button>
          ) : (
            <Link href="/leaderboard" className={styles.btnGhost}>
              {t('leaderboard')}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
