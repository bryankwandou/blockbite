'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useWallet } from '@solana/wallet-adapter-react';
import Navbar from '@/components/Navbar';
import PoolBalance from '@/components/PoolBalance';
import ResetClock from '@/components/ResetClock';
import { PlayerAvatar } from '@/components/CssAvatars';
import { MONTHLY_BEST_DAYS, PAYOUT_CURVE_BPS } from '@/lib/ranked/config';
import { useT } from '@/lib/i18n';
import k from '@/components/PageKit.module.css';
import s from './leaderboard.module.css';

interface RankedRow {
  wallet: string;
  score: number;
  avatarId: string | null;
}

type Period = 'day' | 'month';
const PERIODS: readonly Period[] = ['day', 'month'];

function shortWallet(addr: string) {
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

/** Accepts the API's row shape (avatarId, or avatar_id from older builds). */
function toRow(x: unknown): RankedRow | null {
  if (!x || typeof x !== 'object') return null;
  const r = x as Record<string, unknown>;
  if (typeof r.wallet !== 'string' || typeof r.score !== 'number' || !Number.isFinite(r.score)) return null;
  const avatar = r.avatarId ?? r.avatar_id;
  return { wallet: r.wallet, score: r.score, avatarId: typeof avatar === 'string' ? avatar : null };
}

/** An L-piece and a line on an otherwise empty 8×8 board, for the empty state. */
const GHOST = new Set([18, 26, 34, 35, 44, 45, 46, 47]);

export default function LeaderboardPage() {
  const t = useT('leaderboard');
  const { publicKey } = useWallet();
  const me = publicKey?.toBase58() ?? null;
  const [period, setPeriod] = useState<Period>('day');
  const [rows, setRows] = useState<RankedRow[]>([]);
  const [day, setDay] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);
    fetch(`/api/ranked/leaderboard?period=${period}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => {
        if (!alive) return;
        const list: unknown[] = Array.isArray(data?.rows) ? data.rows : [];
        setRows(list.map(toRow).filter((x): x is RankedRow => x !== null));
        if (typeof data?.day === 'string') setDay(data.day);
      })
      .catch(() => {
        if (!alive) return;
        setRows([]);
        setFailed(true);
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [period, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const daysLabel = (n: number) => t('days_short', { n });

  // Tabs pattern: arrows / Home / End move between tabs and select them.
  const onTabKey = (e: React.KeyboardEvent, i: number) => {
    let n = i;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const rtl = document.documentElement.dir === 'rtl';
      const fwd = (e.key === 'ArrowRight') !== rtl;
      n = (i + (fwd ? 1 : PERIODS.length - 1)) % PERIODS.length;
    } else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = PERIODS.length - 1;
    else return;
    e.preventDefault();
    setPeriod(PERIODS[n]);
    tabRefs.current[n]?.focus();
  };

  const mineIdx = me ? rows.findIndex((r) => r.wallet === me) : -1;

  return (
    <>
      <Navbar />
      <main className={k.page}>
        <header className={k.head}>
          <div className={`${k.wrap} ${k.headInner}`}>
            <div className={k.kicker}><span className={k.pips} aria-hidden><i /><i /><i /></span>{t('header_tag')}</div>
            <h1 className={k.title}>{t('title')}</h1>
            <p className={k.lede}>{t('subtitle')}</p>
            <div className={k.stats}>
              <div className={`${k.card} ${k.stat}`}>
                <span className={k.statK}>{t('pool_label')}</span>
                <PoolBalance className={k.statV} />
                <span className={k.statNote}>{t('pool_note')}</span>
              </div>
              <div className={`${k.card} ${k.stat}`}>
                <span className={k.statK}>{period === 'day' ? t('closes_in') : t('closes_in_month')}</span>
                <ResetClock key={period} kind={period} className={k.statV} daysLabel={daysLabel} />
              </div>
              {mineIdx >= 0 && (
                <div className={`${k.card} ${k.stat}`}>
                  <span className={k.statK}>{t('your_rank')}</span>
                  <span className={k.statV} dir="ltr">#{mineIdx + 1}</span>
                </div>
              )}
            </div>
          </div>
        </header>

        <div className={k.wrap}>
          <section className={k.section}>
            <div className={s.tabs} role="tablist" aria-label={t('title')}>
              {PERIODS.map((p, i) => (
                <button
                  key={p}
                  ref={(el) => { tabRefs.current[i] = el; }}
                  id={`lb-tab-${p}`}
                  type="button"
                  role="tab"
                  aria-selected={period === p}
                  aria-controls="lb-panel"
                  tabIndex={period === p ? 0 : -1}
                  onClick={() => setPeriod(p)}
                  onKeyDown={(e) => onTabKey(e, i)}
                  className={`${s.tab} ${period === p ? s.tabOn : ''}`}
                >
                  {p === 'day' ? t('period_daily') : t('period_monthly')}
                </button>
              ))}
            </div>

            <div
              id="lb-panel"
              role="tabpanel"
              aria-labelledby={`lb-tab-${period}`}
              aria-busy={loading}
              className={`${k.card} ${s.board}`}
            >
              <div className={s.rowHead}>
                <span>{t('col_rank')}</span>
                <span>{t('col_player')}</span>
                <span className={s.shareHead}>{t('col_share')}</span>
                <span style={{ textAlign: 'end' }}>{t('col_score')}</span>
              </div>

              {loading && (
                <div className={s.skeleton} role="status" aria-label={t('loading')}>
                  {Array.from({ length: 5 }, (_, i) => (
                    <div key={i} className={s.skelRow} style={{ animationDelay: `${i * 90}ms` }}>
                      <i /><i /><i />
                    </div>
                  ))}
                </div>
              )}

              {!loading && failed && (
                <div className={s.state} role="status">
                  <p className={s.stateTitle}>{t('error')}</p>
                  <button type="button" className={k.btnGhost} onClick={retry}>{t('retry')}</button>
                </div>
              )}

              {!loading && !failed && rows.length === 0 && (
                <div className={s.state}>
                  <div className={s.ghostGrid} aria-hidden>
                    {Array.from({ length: 64 }, (_, i) => <i key={i} className={GHOST.has(i) ? s.on : undefined} />)}
                  </div>
                  <span className={`${k.tag} ${k.tagAccent}`}>{t('empty_tag')}</span>
                  <p className={s.stateTitle}>{period === 'day' ? t('empty_daily') : t('empty_monthly')}</p>
                  <p className={k.body} style={{ maxWidth: 380 }}>{t('empty_desc')}</p>
                  <Link href="/game" className={k.btn}>{t('empty_cta')}</Link>
                </div>
              )}

              {!loading && !failed && rows.length > 0 && (
                <ol className={s.list} key={period}>
                  {rows.map((row, i) => {
                    const mine = row.wallet === me;
                    const cls = [s.row];
                    if (i < 3) cls.push(s.top3);
                    if (i === 10) cls.push(s.cut);
                    if (mine) cls.push(s.mine);
                    return (
                      <li key={row.wallet} className={cls.join(' ')} style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}>
                        <span className={s.rank}>{i + 1}</span>
                        <span className={s.player}>
                          <PlayerAvatar id={row.avatarId} size={32} className={s.avatar} />
                          <span className={s.wallet} dir="ltr" title={row.wallet}>{shortWallet(row.wallet)}</span>
                          {mine && <span className={s.you}>{t('you')}</span>}
                        </span>
                        <span className={s.share} dir="ltr">
                          {i < PAYOUT_CURVE_BPS.length ? `${PAYOUT_CURVE_BPS[i] / 100}%` : ''}
                        </span>
                        <span className={s.score}>{row.score.toLocaleString('en-US')}</span>
                      </li>
                    );
                  })}
                </ol>
              )}

              {!loading && !failed && (
                <div className={s.foot}>
                  <span>{period === 'day' ? t('footer_daily') : t('footer_monthly', { n: MONTHLY_BEST_DAYS })}</span>
                  {period === 'day' && day && (
                    <a href={`/api/ranked/day?d=${day}`} target="_blank" rel="noopener noreferrer">{t('verify_link')}</a>
                  )}
                  {period === 'month' && <Link href="/how-to-play#prizes-title">{t('prizes_link')}</Link>}
                </div>
              )}
            </div>
          </section>

          <section className={k.section}>
            <h2 className={k.h2}>{t('how_it_works')}</h2>
            <div className={`${k.grid} ${s.steps}`}>
              {([1, 2, 3] as const).map((n) => (
                <div key={n} className={`${k.card} ${k.lift}`}>
                  <span className={s.stepNo}>{n}</span>
                  <h3 className={k.h3}>{t(`step${n}_title`)}</h3>
                  <p className={k.body}>{t(`step${n}_desc`)}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
