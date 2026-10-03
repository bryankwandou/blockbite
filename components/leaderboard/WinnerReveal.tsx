'use client';

import { useEffect, useState } from 'react';
import { PlayerAvatar } from '@/components/CssAvatars';
import { PAYOUT_CURVE_BPS } from '@/lib/ranked/config';
import { useT } from '@/lib/i18n';
import BlockBurst from './BlockBurst';
import s from './WinnerReveal.module.css';

interface Winner { wallet: string; score: number; avatarId: string | null }

function shortWallet(addr: string) {
  return addr.length < 12 ? addr : `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

/** UTC YYYY-MM-DD / YYYY-MM of the period before the current one. */
function lastPeriod(kind: 'day' | 'month'): string {
  const d = new Date();
  if (kind === 'day') { d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); }
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}

/**
 * Reveal card for the winner of the last finished ranked day or month.
 * Shows a calm empty state until a finished round has a winner (for example
 * while ticket sales are closed).
 */
export default function WinnerReveal({ kind }: { kind: 'day' | 'month' }) {
  const t = useT('leaderboard');
  const [winner, setWinner] = useState<Winner | null>(null);
  const [done, setDone] = useState(false);
  const [burst, setBurst] = useState(false);

  useEffect(() => {
    let alive = true;
    setWinner(null); setDone(false); setBurst(false);
    const q = kind === 'day' ? `period=day&d=${lastPeriod('day')}` : `period=month&m=${lastPeriod('month')}`;
    fetch(`/api/ranked/leaderboard?${q}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => {
        if (!alive) return;
        const r = Array.isArray(data?.rows) ? data.rows[0] : null;
        if (r && typeof r.wallet === 'string' && typeof r.score === 'number' && r.score > 0) {
          setWinner({ wallet: r.wallet, score: r.score, avatarId: typeof r.avatarId === 'string' ? r.avatarId : null });
          setBurst(true);
        }
      })
      .catch(() => { /* treated as no result */ })
      .finally(() => { if (alive) setDone(true); });
    return () => { alive = false; };
  }, [kind]);

  if (!done) return null;
  const title = kind === 'day' ? t('winner_day_title') : t('winner_month_title');

  if (!winner) {
    return (
      <div className={`${s.card} ${s.empty}`} role="status">
        <span className={s.trophy} aria-hidden>♛</span>
        <div>
          <p className={s.title}>{t('winner_empty')}</p>
          <p className={s.desc}>{t('winner_empty_desc')}</p>
        </div>
      </div>
    );
  }
  return (
    <div className={`${s.card} ${s.win}`}>
      <div className={s.flip}>
        <PlayerAvatar id={winner.avatarId} size={56} className={s.avatar} />
      </div>
      <div className={s.text}>
        <p className={s.kicker}>{title}</p>
        <p className={s.name} dir="ltr" title={winner.wallet}>{shortWallet(winner.wallet)}</p>
        <p className={s.meta}>
          <span dir="ltr">{winner.score.toLocaleString('en-US')}</span>
          <span aria-hidden>·</span>
          <span dir="ltr">{t('winner_share', { share: PAYOUT_CURVE_BPS[0] / 100 })}</span>
        </p>
      </div>
      <span className={s.trophy} aria-hidden>♛</span>
      {burst && <BlockBurst onDone={() => setBurst(false)} />}
    </div>
  );
}
