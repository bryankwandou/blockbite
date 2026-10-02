'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useT } from '@/lib/i18n';
import { botRng, chooseMove, thinkMs, type BotLevel } from '@/lib/versus/bot';
import Board from './Board';
import { useRun } from './useRun';
import s from './versus.module.css';

export const MATCH_MS = 180_000;

type End = { why: 'time' | 'you_stuck' | 'bot_stuck'; you: number; bot: number };

/** Yield to the browser before the bot's search so taps and paints go first. */
function idle(fn: () => void): () => void {
  const w = window as Window & { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void };
  if (w.requestIdleCallback) {
    const h = w.requestIdleCallback(fn, { timeout: 300 });
    return () => w.cancelIdleCallback?.(h);
  }
  const h = setTimeout(fn, 0);
  return () => clearTimeout(h);
}

export default function VersusMatch({ seed, level, onRematch, onLevels }: {
  seed: string;
  level: BotLevel;
  onRematch: () => void;
  onLevels: () => void;
}) {
  const t = useT('versus');
  const you = useRun(seed);
  const bot = useRun(seed);
  const rng = useMemo(() => botRng(seed, level), [seed, level]);
  const [startAt] = useState(() => Date.now());
  const [now, setNow] = useState(startAt);
  const [end, setEnd] = useState<End | null>(null);
  const endRef = useRef(end);
  endRef.current = end;

  const left = Math.max(0, MATCH_MS - (now - startAt));

  useEffect(() => {
    if (end) return;
    const h = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(h);
  }, [end]);

  // End conditions: time up, or either board stuck.
  useEffect(() => {
    if (end) return;
    const y = you.view.run, b = bot.view.run;
    const why = left <= 0 ? 'time' : y.over ? 'you_stuck' : b.over ? 'bot_stuck' : null;
    if (why) setEnd({ why, you: y.score, bot: b.score });
  }, [left, you.view.run, bot.view.run, end]);

  // Bot loop: think delay, then one move computed in an idle slot. One move per turn.
  const botMoves = bot.view.log.length;
  useEffect(() => {
    if (end || bot.current.current.run.over) return;
    const low = document.documentElement.dataset.gfx === 'low';
    let cancelIdle: (() => void) | null = null;
    const h = setTimeout(() => {
      cancelIdle = idle(() => {
        if (endRef.current) return;
        const run = bot.current.current.run;
        const m = chooseMove(seed, run, level, rng);
        if (m) bot.place(m);
      });
    }, thinkMs(level, rng) + (low ? 250 : 0));
    return () => { clearTimeout(h); cancelIdle?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botMoves, end, seed, level]);

  const mm = Math.floor(left / 60000), ss = Math.floor((left % 60000) / 1000);
  const levelName = t(`level_${level}`);

  if (end) {
    const res = end.you > end.bot ? 'win' : end.you < end.bot ? 'lose' : 'draw';
    return (
      <section className={`${s.card} ${s.result}`} aria-live="polite">
        <p className={s.note}>{t(`end_${end.why}`)}</p>
        <h2 className={s.resultTitle}>{t(`result_${res}`)}</h2>
        <div className={s.versusScores}>
          <div><strong>{t('you')}</strong><div className={s.score}>{end.you.toLocaleString()}</div></div>
          <div><strong>{t('bot_named', { level: levelName })}</strong><div className={s.score}>{end.bot.toLocaleString()}</div></div>
        </div>
        <div className={s.row} style={{ justifyContent: 'center' }}>
          <button type="button" className={s.btn} onClick={onRematch}>{t('rematch')}</button>
          <button type="button" className={s.btnGhost} onClick={onLevels}>{t('change_level')}</button>
          <Link href="/challenge" className={s.btnGhost}>{t('challenge_cta')}</Link>
        </div>
        <p className={s.note}>{t('for_fun')}</p>
      </section>
    );
  }

  return (
    <>
      <div className={s.hud}>
        <span className={s.timer} aria-label={t('time_left')}>{mm}:{String(ss).padStart(2, '0')}</span>
        <span className={s.note}>{t('same_pieces')}</span>
      </div>
      <div className={s.arena}>
        <div className={s.side}>
          <div className={s.sideHead}><strong>{t('you')}</strong><span className={s.score}>{you.view.run.score.toLocaleString()}</span></div>
          <Board view={you.view} label={t('your_board')} onMove={(m) => you.place(m)} />
          <p className={s.note}>{you.view.lastLabel || t('how_to')}</p>
        </div>
        <div className={`${s.side} ${s.bot}`}>
          <div className={s.sideHead}><strong>{t('bot_named', { level: levelName })}</strong><span className={s.score}>{bot.view.run.score.toLocaleString()}</span></div>
          <Board view={bot.view} label={t('bot_board')} compact />
          <p className={s.note}>{bot.view.lastLabel || t('thinking')}</p>
        </div>
      </div>
    </>
  );
}
