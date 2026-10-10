'use client';

import { useRef, useState } from 'react';
import { BLOCK_COLORS } from '@/lib/game/constants';
import { fits, PIECES } from '@/lib/ranked/rules';
import type { Move } from '@/lib/versus/deal';
import { useT } from '@/lib/i18n';
import { pieceColor, type RunView } from './useRun';
import s from './versus.module.css';

const grad = (c: keyof typeof BLOCK_COLORS) => `linear-gradient(135deg, ${BLOCK_COLORS[c].gradStart}, ${BLOCK_COLORS[c].gradEnd})`;

function Mini({ piece, dim }: { piece: number; dim?: boolean }) {
  const p = PIECES[piece];
  return (
    <span className={s.mini} style={{ gridTemplateColumns: `repeat(${p.cols}, var(--mc))`, opacity: dim ? 0.35 : 1 }}>
      {p.shape.flat().map((v, i) => (
        <span key={i} style={v ? { background: grad(pieceColor(piece)) } : undefined} />
      ))}
    </span>
  );
}

/** Pointer must travel this far (px) before a press on a tray piece becomes a drag. */
const DRAG_START_PX = 6;

/**
 * One 8×8 board with its tray. Interactive boards take either input:
 * drag a piece onto the board (mouse, pen or touch), or tap a piece, then tap
 * a cell. Either way the piece is centred on the cell under it. Arrow keys
 * are not needed: every cell is a button, so keyboard users can Tab and press Enter.
 */
export default function Board({ view, label, onMove, compact }: {
  view: RunView;
  label: string;
  onMove?: (m: Move) => void;
  compact?: boolean;
}) {
  const t = useT('versus');
  const [sel, setSel] = useState<0 | 1 | 2 | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ slot: 0 | 1 | 2; x: number; y: number; cell: number; lift: number } | null>(null);
  const press = useRef<{ slot: 0 | 1 | 2; x: number; y: number; id: number; touch: boolean } | null>(null);
  const dragged = useRef(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const { run, colors, flash } = view;
  const board = BigInt('0x' + run.board);
  const selPiece = sel !== null ? run.tray[sel] : null;
  const live = !!onMove && !run.over;

  const originFor = (cell: number): Move | null => {
    if (sel === null || selPiece === null) return null;
    const p = PIECES[selPiece];
    const row = Math.min(8 - p.rows, Math.max(0, Math.floor(cell / 8) - Math.floor((p.rows - 1) / 2)));
    const col = Math.min(8 - p.cols, Math.max(0, (cell % 8) - Math.floor((p.cols - 1) / 2)));
    return { slot: sel, row, col };
  };

  const preview = new Set<number>();
  let previewOk = false;
  if (live && hover !== null && selPiece !== null) {
    const m = originFor(hover)!;
    previewOk = fits(board, selPiece, m.row, m.col);
    for (const [r, c] of PIECES[selPiece].cells) preview.add((m.row + r) * 8 + m.col + c);
  }

  const tap = (cell: number) => {
    if (!live) return;
    const m = originFor(cell);
    if (!m || !fits(board, selPiece!, m.row, m.col)) return;
    onMove!(m);
    setSel(null);
    setHover(null);
  };

  // ── Drag and drop ──────────────────────────────────────────────────
  const cellSize = () => {
    const g = gridRef.current?.getBoundingClientRect();
    return g ? g.width / 8 : 40;
  };
  /**
   * Cell that makes the piece land where the ghost is drawn. The ghost is centred
   * on the pointer, so the origin is the nearest whole cell to (pointer - half the
   * piece); taking the cell under the pointer instead put even-sized pieces up to
   * a cell away from the ghost. Returns the anchor cell originFor() maps back to it.
   */
  const dragCell = (x: number, y: number, slot: 0 | 1 | 2): number | null => {
    const piece = run.tray[slot];
    const g = gridRef.current?.getBoundingClientRect();
    if (piece === null || !g || x < g.left || y < g.top || x >= g.right || y >= g.bottom) return null;
    const p = PIECES[piece];
    const size = g.width / 8;
    const row = Math.min(8 - p.rows, Math.max(0, Math.round((y - g.top) / size - p.rows / 2)));
    const col = Math.min(8 - p.cols, Math.max(0, Math.round((x - g.left) / size - p.cols / 2)));
    return (row + Math.floor((p.rows - 1) / 2)) * 8 + col + Math.floor((p.cols - 1) / 2);
  };

  const onSlotDown = (e: React.PointerEvent, slot: 0 | 1 | 2) => {
    if (!live || (e.pointerType === 'mouse' && e.button !== 0)) return;
    press.current = { slot, x: e.clientX, y: e.clientY, id: e.pointerId, touch: e.pointerType !== 'mouse' };
    dragged.current = false;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onSlotMove = (e: React.PointerEvent) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    if (!dragged.current && Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_START_PX) return;
    if (!dragged.current) { dragged.current = true; setSel(p.slot); }
    // On touch the piece rides above the finger so the finger does not hide it.
    const lift = p.touch ? cellSize() * 1.6 : 0;
    const cell = dragCell(e.clientX, e.clientY - lift, p.slot);
    setDrag({ slot: p.slot, x: e.clientX, y: e.clientY - lift, cell: cell ?? -1, lift });
    setHover(cell);
  };
  const onSlotUp = (e: React.PointerEvent) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    press.current = null;
    if (!dragged.current) return; // a plain tap: onClick toggles selection
    const cell = drag?.cell ?? -1;
    setDrag(null);
    if (cell >= 0) {
      const piece = run.tray[p.slot];
      if (piece !== null) {
        const pc = PIECES[piece];
        const row = Math.min(8 - pc.rows, Math.max(0, Math.floor(cell / 8) - Math.floor((pc.rows - 1) / 2)));
        const col = Math.min(8 - pc.cols, Math.max(0, (cell % 8) - Math.floor((pc.cols - 1) / 2)));
        if (fits(board, piece, row, col)) {
          onMove!({ slot: p.slot, row, col });
          setSel(null);
          setHover(null);
          return;
        }
      }
    }
    // Dropped off the board or where it does not fit: keep it selected for a tap.
    setHover(null);
  };
  const onSlotCancel = () => { press.current = null; setDrag(null); setHover(null); };

  const ghostPiece = drag ? run.tray[drag.slot] : null;
  const ghost = drag && ghostPiece !== null && (() => {
    const p = PIECES[ghostPiece];
    const size = cellSize();
    return (
      <span
        aria-hidden
        className={s.dragGhost}
        style={{
          left: drag.x - (p.cols * size) / 2,
          top: drag.y - (p.rows * size) / 2,
          width: p.cols * size,
          height: p.rows * size,
          gridTemplateColumns: `repeat(${p.cols}, 1fr)`,
          gridTemplateRows: `repeat(${p.rows}, 1fr)`,
        }}
      >
        {p.shape.flat().map((v, i) => <span key={i} style={v ? { background: grad(pieceColor(ghostPiece)) } : undefined} />)}
      </span>
    );
  })();

  return (
    <div className={`${s.boardWrap} ${compact ? s.compact : ''}`}>
      {ghost}
      <div ref={gridRef} className={s.grid} role="group" aria-label={label} onMouseLeave={() => { if (!drag) setHover(null); }}>
        {colors.map((c, i) => {
          const pv = preview.has(i);
          const style = c ? { background: grad(c) } : undefined;
          const cls = `${s.cell} ${c ? s.filled : ''} ${pv ? (previewOk ? s.pvOk : s.pvBad) : ''} ${flash.includes(i) ? s.flash : ''}`;
          return live ? (
            <button
              key={flash.includes(i) ? `${i}-${view.log.length}` : i}
              type="button"
              className={cls}
              style={style}
              aria-label={t('cell', { row: Math.floor(i / 8) + 1, col: (i % 8) + 1 })}
              onMouseEnter={() => { if (!drag) setHover(i); }}
              onFocus={() => setHover(i)}
              onClick={() => tap(i)}
            />
          ) : (
            <span key={flash.includes(i) ? `${i}-${view.log.length}` : i} className={cls} style={style} />
          );
        })}
      </div>
      <div className={s.tray} aria-label={t('tray_label')}>
        {run.tray.map((p, i) => (
          p === null ? <span key={i} className={s.slot} /> : live ? (
            <button
              key={i}
              type="button"
              className={`${s.slot} ${s.slotDrag} ${sel === i ? s.slotSel : ''}`}
              aria-pressed={sel === i}
              aria-label={t('piece', { n: i + 1 })}
              onPointerDown={(e) => onSlotDown(e, i as 0 | 1 | 2)}
              onPointerMove={onSlotMove}
              onPointerUp={onSlotUp}
              onPointerCancel={onSlotCancel}
              onClick={() => {
                if (dragged.current) { dragged.current = false; return; }
                setSel(sel === i ? null : (i as 0 | 1 | 2));
              }}
            >
              <Mini piece={p} dim={drag?.slot === i} />
            </button>
          ) : (
            <span key={i} className={s.slot}><Mini piece={p} dim={run.over} /></span>
          )
        ))}
      </div>
    </div>
  );
}
