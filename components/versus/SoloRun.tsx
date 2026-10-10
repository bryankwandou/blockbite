'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n';
import { translatePop } from '@/components/game/popLabel';
import type { LogMove } from '@/lib/versus/deal';
import Board from './Board';
import { useRun } from './useRun';
import s from './versus.module.css';

/** A solo seeded run. With `ghost`, a thin bar shows the challenger's score at the same move. */
export default function SoloRun({ seed, ghost, ghostName, onDone }: {
  seed: string;
  ghost?: number[];
  ghostName?: string;
  onDone: (log: LogMove[], score: number) => void;
}) {
  const t = useT('challenge');
  const tg = useT('game');
  const r = useRun(seed);
  const [done, setDone] = useState(false);
  const { run, log } = r.view;

  const finish = () => {
    if (done || log.length === 0) return;
    setDone(true);
    onDone(log, run.score);
  };
  useEffect(() => {
    if (run.over) finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.over]);

  let ghostNow = 0, ghostEnd = 0;
  if (ghost && ghost.length) {
    ghostEnd = ghost[ghost.length - 1];
    ghostNow = run.moves === 0 ? 0 : ghost[Math.min(run.moves, ghost.length) - 1];
  }
  const max = Math.max(ghostEnd, run.score, 1);

  return (
    <section className={s.card}>
      {ghost && (
        <div className={s.ghost} aria-label={t('ghost_label')}>
          <div className={s.ghostBar}>
            <div className={s.ghostFill} style={{ width: `${(100 * run.score) / max}%` }} />
            <div className={s.ghostMark} style={{ left: `calc(${(100 * ghostNow) / max}% - 1px)` }} />
          </div>
          <div className={s.ghostText}>
            <span>{t('you_now', { n: run.score.toLocaleString() })}</span>
            <span>{t('ghost_now', { name: ghostName ?? '', n: ghostNow.toLocaleString() })}</span>
          </div>
        </div>
      )}
      <div className={s.sideHead}><strong>{t('score')}</strong><span className={s.score}>{run.score.toLocaleString()}</span></div>
      <Board view={r.view} label={t('board_label')} onMove={done ? undefined : (m) => r.place(m)} />
      <p className={r.view.lastLabel ? `${s.note} ${s.clearNote}` : s.note}>{r.view.lastLabel ? translatePop(tg, r.view.lastLabel) : t('how_to')}</p>
      {!done && (
        <button type="button" className={s.btnGhost} onClick={finish} disabled={log.length === 0}>{t('finish')}</button>
      )}
    </section>
  );
}
