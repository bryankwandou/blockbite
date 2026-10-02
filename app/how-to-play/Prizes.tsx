'use client';

import { useId, useState } from 'react';
import { useT } from '@/lib/i18n';
import {
  DAILY_POOL_BPS,
  MONTHLY_BEST_DAYS,
  PAYOUT_CURVE_BPS,
  TICKET_PRICE,
  VAULT_SHARE,
} from '@/lib/ranked/config';
import k from '@/components/PageKit.module.css';
import s from './prizes.module.css';

/* The numbers below come from lib/ranked/config.ts, the same constants the
   payout code uses, so this page can't drift from what the program pays. */

const VAULT_PER_TICKET = VAULT_SHARE / TICKET_PRICE; // 0.70 USDC
const DAILY_PCT = DAILY_POOL_BPS / 100; // 40
const MONTHLY_PCT = 100 - DAILY_PCT; // 60
const CURVE = PAYOUT_CURVE_BPS.map((b) => b / 100); // 25, 18, 13, ...
const TALLEST = Math.max(...CURVE);
const DAYS_IN_EXAMPLE_MONTH = 30;

const usdc = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const whole = (n: number) => n.toLocaleString('en-US');

/** A sample month: 13 days played. Only the 10 best count. */
const SAMPLE_DAYS: readonly { day: number; score: number }[] = [
  { day: 2, score: 1240 }, { day: 3, score: 860 }, { day: 5, score: 2310 },
  { day: 8, score: 1580 }, { day: 9, score: 640 }, { day: 11, score: 1920 },
  { day: 14, score: 1105 }, { day: 16, score: 2780 }, { day: 19, score: 990 },
  { day: 21, score: 1460 }, { day: 24, score: 720 }, { day: 27, score: 1675 },
  { day: 30, score: 2050 },
];
/** Rank of each sample day among the month's best (1 = best), or 0 when it drops out. */
const SAMPLE_RANK = (() => {
  const order = SAMPLE_DAYS.map((d, i) => ({ i, score: d.score })).sort((a, b) => b.score - a.score);
  const rank = SAMPLE_DAYS.map(() => 0);
  order.slice(0, MONTHLY_BEST_DAYS).forEach((x, r) => { rank[x.i] = r + 1; });
  return rank;
})();
const SAMPLE_TOTAL = SAMPLE_DAYS.reduce((sum, d, i) => sum + (SAMPLE_RANK[i] ? d.score : 0), 0);

type Pot = 'day' | 'month';

export default function Prizes({ children }: { children?: React.ReactNode }) {
  const t = useT('guide');
  const [tickets, setTickets] = useState(300);
  const [pot, setPot] = useState<Pot>('day');
  const [sel, setSel] = useState(0);
  const sliderId = useId();

  const vaultPerDay = tickets * VAULT_PER_TICKET;
  const dailyPot = vaultPerDay * (DAILY_PCT / 100);
  const monthlyPot = vaultPerDay * (MONTHLY_PCT / 100) * DAYS_IN_EXAMPLE_MONTH;
  const potSize = pot === 'day' ? dailyPot : monthlyPot;
  const share = (i: number) => (potSize * PAYOUT_CURVE_BPS[i]) / 10_000;

  return (
    <section className={k.section} aria-labelledby="prizes-title">
      <h2 id="prizes-title" className={k.h2}>{t('prizes_title')}</h2>

      {/* 40 / 60 */}
      <div className={k.card}>
        <p className={k.body}>{t('prizes_intro')}</p>
        <div className={s.split} dir="ltr" aria-hidden>
          <span className={s.splitDaily} style={{ flexGrow: DAILY_PCT }}>{DAILY_PCT}%</span>
          <span className={s.splitMonthly} style={{ flexGrow: MONTHLY_PCT }}>{MONTHLY_PCT}%</span>
        </div>
        <div className={s.potRows}>
          <div className={s.potRow}>
            <span className={`${s.potPct} ${s.cDaily}`}>{DAILY_PCT}%</span>
            <div>
              <h3 className={k.h3}>{t('prizes_daily_label')}</h3>
              <p className={k.body}>{t('prizes_daily_desc')}</p>
            </div>
          </div>
          <div className={s.potRow}>
            <span className={`${s.potPct} ${s.cMonthly}`}>{MONTHLY_PCT}%</span>
            <div>
              <h3 className={k.h3}>{t('prizes_monthly_label')}</h3>
              <p className={k.body}>{t('prizes_monthly_desc')}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Payout curve + calculator */}
      <div className={`${k.card} ${s.curveCard}`}>
        <div className={s.curveHead}>
          <div>
            <h3 className={k.h3}>{t('prizes_curve_title')}</h3>
            <p className={k.body}>{t('prizes_curve_desc')}</p>
          </div>
          <div className={s.seg} role="group" aria-label={t('prizes_curve_title')}>
            {(['day', 'month'] as const).map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={pot === p}
                className={`${s.segBtn} ${pot === p ? s.segOn : ''}`}
                onClick={() => setPot(p)}
              >
                {p === 'day' ? t('prizes_show_daily') : t('prizes_show_monthly')}
              </button>
            ))}
          </div>
        </div>

        <div className={s.calc}>
          <label htmlFor={sliderId} className={s.calcLabel}>{t('prizes_calc_label')}</label>
          <input
            id={sliderId}
            type="range"
            min={30}
            max={3000}
            step={30}
            value={tickets}
            onChange={(e) => setTickets(Number(e.target.value))}
            className={s.range}
            style={{ ['--fill' as string]: `${((tickets - 30) / (3000 - 30)) * 100}%` }}
            aria-valuetext={t('prizes_calc_value', { n: whole(tickets) })}
          />
          <output htmlFor={sliderId} className={s.calcValue} dir="ltr">{whole(tickets)}</output>
        </div>

        <p className={s.readout} aria-live="polite">
          <span className={s.readRank}>{t('prizes_rank', { n: sel + 1 })}</span>
          <span className={s.readPct} dir="ltr">{CURVE[sel]}%</span>
          <span className={s.readAmt} dir="ltr">{usdc(share(sel))} USDC</span>
        </p>

        <div className={`${s.chart} ${pot === 'month' ? s.chartMonth : ''}`} dir="ltr">
          {CURVE.map((pct, i) => (
            <button
              key={i}
              type="button"
              className={`${s.col} ${sel === i ? s.colOn : ''}`}
              onClick={() => setSel(i)}
              onMouseEnter={() => setSel(i)}
              onFocus={() => setSel(i)}
              aria-pressed={sel === i}
              aria-label={`${t('prizes_rank', { n: i + 1 })}: ${pct}%, ${usdc(share(i))} USDC`}
            >
              <span className={s.colPct}>{pct}%</span>
              <span className={s.stack} style={{ height: `${(pct / TALLEST) * 100}%` }}>
                {Array.from({ length: pct }, (_, b) => (
                  <i key={b} style={{ animationDelay: `${i * 40 + b * 12}ms` }} />
                ))}
              </span>
              <span className={s.colRank}>{t('prizes_rank', { n: i + 1 })}</span>
              <span className={s.colAmt}>{usdc(share(i))}</span>
            </button>
          ))}
        </div>

        <p className={s.calcText}>
          {t('prizes_calc_daily', { tickets: whole(tickets), vault: usdc(vaultPerDay), pot: usdc(dailyPot) })}{' '}
          {t('prizes_calc_monthly', { pot: usdc(monthlyPot) })}
        </p>
        <p className={s.note}>{t('prizes_blocks_note')} {t('prizes_example_note')}</p>
      </div>

      {/* Monthly score */}
      <div className={`${k.card} ${s.monthCard}`}>
        <h3 className={k.h3}>{t('prizes_month_title')}</h3>
        <p className={k.body}>{t('prizes_month_desc')}</p>
        <p className={s.monthEx}>{t('prizes_month_example')}</p>
        <ol className={s.days}>
          {SAMPLE_DAYS.map((d, i) => {
            const rank = SAMPLE_RANK[i];
            return (
              <li
                key={d.day}
                className={`${s.dayTile} ${rank ? s.dayIn : s.dayOut}`}
                style={{ animationDelay: `${i * 35}ms` }}
              >
                <span className={s.dayName}>{t('prizes_month_day', { n: d.day })}</span>
                <span className={s.dayScore} dir="ltr">{whole(d.score)}</span>
                {rank ? (
                  <span className={s.dayRank} dir="ltr" aria-label={t('prizes_rank', { n: rank })}>{rank}</span>
                ) : (
                  <span className={s.dayDrop}>{t('prizes_month_dropped')}</span>
                )}
              </li>
            );
          })}
        </ol>
        <div className={s.total}>
          <span className={s.totalLabel}>{t('prizes_month_total')}</span>
          <span className={s.totalValue} dir="ltr">{whole(SAMPLE_TOTAL)}</span>
        </div>
      </div>

      {children}
    </section>
  );
}
