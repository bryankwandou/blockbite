'use client';

import { useState } from 'react';
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
    <span className={s.mini} style={{ gridTemplateColumns: `repeat(${p.cols}, 1fr)`, aspectRatio: `${p.cols} / ${p.rows}`, opacity: dim ? 0.35 : 1 }}>
      {p.shape.flat().map((v, i) => (
        <span key={i} style={v ? { background: grad(pieceColor(piece)) } : undefined} />
      ))}
    </span>
  );
}

/**
 * One 8×8 board with its tray. Interactive boards: tap a piece, then tap a
 * cell — the piece is centred on that cell. Arrow keys are not needed: every
 * cell is a button, so keyboard users can Tab and press Enter.
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

  return (
    <div className={`${s.boardWrap} ${compact ? s.compact : ''}`}>
      <div className={s.grid} role="grid" aria-label={label} onMouseLeave={() => setHover(null)}>
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
              onMouseEnter={() => setHover(i)}
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
              className={`${s.slot} ${sel === i ? s.slotSel : ''}`}
              aria-pressed={sel === i}
              aria-label={t('piece', { n: i + 1 })}
              onClick={() => setSel(sel === i ? null : (i as 0 | 1 | 2))}
            >
              <Mini piece={p} />
            </button>
          ) : (
            <span key={i} className={s.slot}><Mini piece={p} dim={run.over} /></span>
          )
        ))}
      </div>
    </div>
  );
}
