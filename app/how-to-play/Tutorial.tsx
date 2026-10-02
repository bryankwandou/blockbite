'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '@/lib/i18n';
import { calculateScore } from '@/lib/game/scoring';
import k from '@/components/PageKit.module.css';
import s from './tutorial.module.css';

/* A three-step practice board: place a piece, clear a row, clear a row and a
   column at once. Mouse, touch (drag or tap) and keyboard (arrows + Enter).
   Points come from the same scoring code the real game uses. */

type Off = readonly [number, number]; // [row, col] offset from the anchor block

interface Step {
  id: 'a' | 'b' | 'c';
  /** Lines the move must clear to pass (0 = any placement). */
  goal: number;
  color: number;
  cells: readonly Off[];
  board: readonly number[];
  mascot: string;
}

// The PNG names pre-date the final art: mascot-tide.png is the yellow cube,
// mascot-sunny.png the teal one, mascot-brawler.png the crowned purple king.
const STEPS: readonly Step[] = [
  {
    id: 'a', goal: 0, color: 1, mascot: '/mascots/mascot-tide.png',
    cells: [[0, 0], [0, 1], [1, 0], [1, 1]],
    board: [
      0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0,
      2, 0, 0, 0, 0, 0, 5, 5,
      2, 2, 0, 0, 0, 0, 5, 5,
      2, 2, 2, 0, 0, 6, 6, 6,
    ],
  },
  {
    id: 'b', goal: 1, color: 3, mascot: '/mascots/mascot-sunny.png',
    cells: [[0, 0], [0, 1], [0, 2]],
    board: [
      0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 2, 0,
      4, 0, 0, 0, 0, 0, 2, 0,
      4, 4, 6, 0, 0, 0, 2, 2,
    ],
  },
  {
    id: 'c', goal: 2, color: 4, mascot: '/mascots/mascot-brawler.png',
    cells: [[0, 0], [0, -1], [0, -2], [-1, 0], [-2, 0]],
    board: [
      0, 0, 0, 0, 0, 0, 0, 1,
      0, 0, 0, 0, 0, 0, 0, 1,
      0, 0, 5, 5, 0, 0, 0, 3,
      0, 0, 5, 0, 0, 0, 0, 3,
      0, 0, 0, 0, 0, 0, 0, 2,
      0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0,
      3, 3, 6, 6, 2, 0, 0, 0,
    ],
  },
];

const at = (r: number, c: number) => r * 8 + c;

function footprint(anchor: number, cells: readonly Off[]) {
  const r0 = Math.floor(anchor / 8);
  const c0 = anchor % 8;
  const out: number[] = [];
  let inside = true;
  for (const [dr, dc] of cells) {
    const r = r0 + dr;
    const c = c0 + dc;
    if (r < 0 || r > 7 || c < 0 || c > 7) { inside = false; continue; }
    out.push(at(r, c));
  }
  return { out, inside };
}

function fits(board: readonly number[], anchor: number, cells: readonly Off[]) {
  const { out, inside } = footprint(anchor, cells);
  return inside && out.every((i) => !board[i]);
}

function fullLines(b: readonly number[]) {
  const hit = new Set<number>();
  let lines = 0;
  for (let r = 0; r < 8; r++) {
    if ([0, 1, 2, 3, 4, 5, 6, 7].every((c) => b[at(r, c)] > 0)) { lines++; for (let c = 0; c < 8; c++) hit.add(at(r, c)); }
  }
  for (let c = 0; c < 8; c++) {
    if ([0, 1, 2, 3, 4, 5, 6, 7].every((r) => b[at(r, c)] > 0)) { lines++; for (let r = 0; r < 8; r++) hit.add(at(r, c)); }
  }
  return { hit, lines };
}

function box(cells: readonly Off[]) {
  const rs = cells.map((x) => x[0]);
  const cs = cells.map((x) => x[1]);
  return { minR: Math.min(...rs), maxR: Math.max(...rs), minC: Math.min(...cs), maxC: Math.max(...cs) };
}

function Shape({ cells, color, cellPx, className, style }: {
  cells: readonly Off[]; color: number; cellPx?: number; className?: string; style?: React.CSSProperties;
}) {
  const b = box(cells);
  const cols = b.maxC - b.minC + 1;
  const rows = b.maxR - b.minR + 1;
  const on = new Set(cells.map(([r, c]) => (r - b.minR) * cols + (c - b.minC)));
  return (
    <div
      className={className}
      style={{ ...style, display: 'grid', gridTemplateColumns: `repeat(${cols}, ${cellPx ? `${cellPx}px` : 'auto'})`, ['--c' as string]: `var(--ds-block-${color})` }}
    >
      {Array.from({ length: rows * cols }, (_, i) => (
        <span key={i} className={`${s.pieceCell} ${on.has(i) ? s.on : ''}`} />
      ))}
    </div>
  );
}

function reducedMotion() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    || document.documentElement.dataset.reduceMotion === 'true';
}

type Phase = 'play' | 'done' | 'miss';
interface Drag { x: number; y: number; moved: boolean; lift: number }

export default function Tutorial() {
  const t = useT('guide');
  const [stepIdx, setStepIdx] = useState(0);
  const step = STEPS[stepIdx];
  const [board, setBoard] = useState<number[]>(() => [...STEPS[0].board]);
  const [clearing, setClearing] = useState<Set<number>>(() => new Set());
  const [phase, setPhase] = useState<Phase>('play');
  const [noFit, setNoFit] = useState(false);
  const [react, setReact] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const [cursor, setCursor] = useState(at(3, 3));
  const [kbd, setKbd] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [cellPx, setCellPx] = useState(32);
  const [earned, setEarned] = useState<number[]>(() => STEPS.map(() => 0));
  const [pop, setPop] = useState<{ n: number; id: number } | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const popTimer = useRef<number | undefined>(undefined);
  const start = useRef<{ x: number; y: number } | null>(null);
  const dragged = useRef(false);

  useEffect(() => () => {
    window.clearTimeout(timer.current);
    window.clearTimeout(popTimer.current);
  }, []);

  const load = useCallback((i: number) => {
    window.clearTimeout(timer.current);
    window.clearTimeout(popTimer.current);
    setStepIdx(i);
    setBoard([...STEPS[i].board]);
    setClearing(new Set());
    setPhase('play');
    setNoFit(false);
    setHover(null);
    setDrag(null);
    setPop(null);
    // Starting over wipes every step; retrying or moving on only resets this one.
    setEarned((e) => e.map((v, j) => (i === 0 || j === i ? 0 : v)));
  }, []);

  const place = useCallback((anchor: number) => {
    if (phase !== 'play' || clearing.size) return;
    if (!fits(board, anchor, step.cells)) {
      setNoFit(true);
      setReact((n) => n + 1);
      return;
    }
    const next = board.slice();
    for (const i of footprint(anchor, step.cells).out) next[i] = step.color;
    const { hit, lines } = fullLines(next);
    const pts = calculateScore(lines, step.cells.length, 0, false).pointsEarned;
    setBoard(next);
    setNoFit(false);
    setHover(null);
    setPhase(lines >= step.goal ? 'done' : 'miss');
    setReact((n) => n + 1);
    setEarned((e) => e.map((v, j) => (j === stepIdx ? pts : v)));
    if (pts > 0) {
      setPop({ n: pts, id: Date.now() });
      window.clearTimeout(popTimer.current);
      popTimer.current = window.setTimeout(() => setPop(null), 1100);
    }
    if (lines) {
      setClearing(hit);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        setBoard((b) => b.map((v, i) => (hit.has(i) ? 0 : v)));
        setClearing(new Set());
      }, reducedMotion() ? 0 : 380);
    }
  }, [phase, clearing, board, step, stepIdx]);

  /** Board cell under a screen point, or null when outside the grid. */
  const cellAt = useCallback((x: number, y: number): number | null => {
    const el = boardRef.current;
    const first = el?.firstElementChild?.getBoundingClientRect();
    const last = el?.lastElementChild?.getBoundingClientRect();
    if (!first || !last) return null;
    const w = last.right - first.left;
    const h = last.bottom - first.top;
    const cx = x - first.left;
    const cy = y - first.top;
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) return null;
    return at(Math.floor((cy / h) * 8), Math.floor((cx / w) * 8));
  }, []);

  /* ── Board: hover (mouse), tap/click, keyboard ─────────────── */
  const onBoardMove = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && !drag) setHover(cellAt(e.clientX, e.clientY));
  };
  const onBoardClick = (e: React.MouseEvent) => {
    const c = cellAt(e.clientX, e.clientY);
    if (c !== null) { setCursor(c); place(c); }
  };
  const onBoardKey = (e: React.KeyboardEvent) => {
    const r = Math.floor(cursor / 8);
    const c = cursor % 8;
    let n = cursor;
    switch (e.key) {
      case 'ArrowUp': n = at(Math.max(0, r - 1), c); break;
      case 'ArrowDown': n = at(Math.min(7, r + 1), c); break;
      case 'ArrowLeft': n = at(r, Math.max(0, c - 1)); break;
      case 'ArrowRight': n = at(r, Math.min(7, c + 1)); break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        setKbd(true);
        place(cursor);
        return;
      default:
        return;
    }
    e.preventDefault();
    setKbd(true);
    setCursor(n);
  };

  /* ── Tray piece: drag (mouse/touch/pen) or tap ─────────────── */
  const onPieceDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (phase !== 'play') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const first = boardRef.current?.firstElementChild?.getBoundingClientRect();
    if (first) setCellPx(first.width);
    start.current = { x: e.clientX, y: e.clientY };
    dragged.current = false;
    setDrag({ x: e.clientX, y: e.clientY, moved: false, lift: e.pointerType === 'touch' ? 56 : 0 });
  };
  const onPieceMove = (e: React.PointerEvent) => {
    if (!drag || !start.current) return;
    const moved = drag.moved || Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 6;
    setDrag({ ...drag, x: e.clientX, y: e.clientY, moved });
    setHover(moved ? cellAt(e.clientX, e.clientY - drag.lift) : null);
  };
  const onPieceUp = (e: React.PointerEvent) => {
    if (!drag) return;
    const target = drag.moved ? cellAt(e.clientX, e.clientY - drag.lift) : null;
    dragged.current = drag.moved;
    setDrag(null);
    setHover(null);
    start.current = null;
    if (target !== null) place(target);
  };
  const onPieceCancel = () => { setDrag(null); setHover(null); start.current = null; };
  const onPieceClick = () => {
    // A tap or Enter on the piece hands over to the board (tap a spot, or arrows + Enter).
    if (dragged.current) { dragged.current = false; return; }
    if (phase !== 'play') return;
    setKbd(true);
    boardRef.current?.focus({ preventScroll: true });
  };

  /* ── Ghost preview ─────────────────────────────────────────── */
  const anchor = phase !== 'play' ? null : drag ? (drag.moved ? hover : null) : hover ?? (kbd ? cursor : null);
  const ghost = new Set<number>();
  let ghostOk = false;
  if (anchor !== null) {
    footprint(anchor, step.cells).out.forEach((i) => ghost.add(i));
    ghostOk = fits(board, anchor, step.cells);
  }

  /* ── Coach message ─────────────────────────────────────────── */
  const last = stepIdx === STEPS.length - 1;
  const tone = phase === 'done' ? s.good : phase === 'miss' || noFit ? s.bad : '';
  const mascotAnim = react === 0 ? s.idle : phase === 'done' ? s.hop : phase === 'miss' || noFit ? s.shake : s.idle;
  const total = earned.reduce((a, v) => a + v, 0);
  let msg: React.ReactNode;
  if (phase === 'done') {
    msg = (
      <>
        <span className={s.cheer}>{t(`tut_${step.id}_cheer`)}</span>
        {t(`tut_${step.id}_done`)}{last ? ` ${t('tut_end')}` : ''}
      </>
    );
  } else if (phase === 'miss') {
    msg = t(`tut_${step.id}_miss`);
  } else if (noFit) {
    msg = t('tut_no_fit');
  } else {
    msg = t(`tut_${step.id}_hint`);
  }

  const b = box(step.cells);
  const pitch = cellPx + 3;
  const float = drag?.moved ? (
    <Shape
      cells={step.cells}
      color={step.color}
      cellPx={cellPx}
      className={s.float}
      style={{
        left: drag.x - (0 - b.minC) * pitch - cellPx / 2,
        top: drag.y - drag.lift - (0 - b.minR) * pitch - cellPx / 2,
      }}
    />
  ) : null;

  return (
    <div className={`${k.card} ${s.tut}`}>
      <div className={s.side}>
        <div className={s.steps} aria-hidden>
          {STEPS.map((x, i) => (
            <span key={x.id} className={`${s.stepChip} ${i < stepIdx || (i === stepIdx && phase === 'done') ? s.stepDone : i === stepIdx ? s.stepOn : ''}`} />
          ))}
        </div>
        <div className={s.stepRow}>
          <span className={s.stepLabel}>{t('tut_step', { n: stepIdx + 1 })}</span>
          <span className={s.score} dir="ltr">{t('tut_score', { n: total.toLocaleString('en-US') })}</span>
        </div>

        <div className={s.coach}>
          <span key={`${stepIdx}-${react}`} className={`${s.mascotWrap} ${mascotAnim}`} aria-hidden="true">
            <Image src={step.mascot} alt="" width={64} height={64} className={s.mascot} />
          </span>
          <div className={`${s.bubble} ${tone}`} aria-live="polite">{msg}</div>
        </div>

        <div className={s.trayRow}>
          <div className={s.tray}>
            {phase === 'play' ? (
              <button
                type="button"
                className={`${s.pieceBtn} ${drag?.moved ? s.pieceLifted : ''}`}
                aria-label={t('tut_piece_label')}
                onPointerDown={onPieceDown}
                onPointerMove={onPieceMove}
                onPointerUp={onPieceUp}
                onPointerCancel={onPieceCancel}
                onClick={onPieceClick}
              >
                <Shape cells={step.cells} color={step.color} className={s.pieceGrid} />
              </button>
            ) : (
              <span className={s.trayEmpty}>{t('tut_tray_used')}</span>
            )}
          </div>
        </div>

        <div className={s.controls}>
          {phase === 'done' && !last && (
            <button type="button" className={k.btn} onClick={() => load(stepIdx + 1)}>{t('tut_next')}</button>
          )}
          {phase === 'done' && last ? (
            <>
              <Link href="/game" className={k.btn}>{t('cta_play')}</Link>
              <button type="button" className={k.btnGhost} onClick={() => load(0)}>{t('tut_restart')}</button>
            </>
          ) : (
            <button type="button" className={k.btnGhost} onClick={() => load(stepIdx)}>{t('tut_retry')}</button>
          )}
        </div>
      </div>

      <div className={s.boardCol}>
        <div
          ref={boardRef}
          className={s.board}
          dir="ltr"
          role="application"
          tabIndex={0}
          aria-label={t('tut_board_label')}
          aria-describedby="tut-keys"
          onPointerMove={onBoardMove}
          onPointerLeave={() => { if (!drag) setHover(null); }}
          onClick={onBoardClick}
          onKeyDown={onBoardKey}
          onFocus={(e) => { if (e.currentTarget.matches(':focus-visible')) setKbd(true); }}
          onBlur={() => setKbd(false)}
        >
          {board.map((v, i) => {
            const g = ghost.has(i);
            const cls = [s.cell];
            if (v) cls.push(s.filled);
            if (clearing.has(i)) cls.push(s.clearing);
            if (g && !v) cls.push(s.ghost);
            if (g && !ghostOk) cls.push(s.ghostBad);
            if (kbd && phase === 'play' && i === cursor) cls.push(s.cursor);
            return (
              <span
                key={i}
                className={cls.join(' ')}
                style={{ ['--c' as string]: `var(--ds-block-${v || step.color})`, animationDelay: clearing.has(i) ? `${(i % 8) * 18}ms` : undefined }}
              />
            );
          })}
        </div>
        {pop && <span key={pop.id} className={s.pop} dir="ltr" aria-hidden="true">+{pop.n}</span>}
        <p id="tut-keys" className={s.keys}>{t('tut_keys')}</p>
      </div>

      {float && typeof document !== 'undefined' ? createPortal(float, document.body) : null}
    </div>
  );
}
