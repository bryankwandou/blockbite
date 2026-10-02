'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import { MascotSVG, BRAND_MASCOTS } from '@/components/Mascot';
import { useT } from '@/lib/i18n';
import k from '@/components/PageKit.module.css';
import s from './waitlist.module.css';

const LS_DONE  = 'bb_wl_done';
const LS_EMAIL = 'bb_wl_email';

export default function WaitlistPage() {
  const t = useT('waitlist');
  const [email, setEmail] = useState('');
  const [done, setDone]   = useState(false);
  const [busy, setBusy]   = useState(false);
  const [err, setErr]             = useState(false);
  const [rateLimited, setRateLimited] = useState(false);
  const [serverErr, setServerErr] = useState(false);
  const [count, setCount]     = useState<number>(0);

  // Server is the single source of truth. Migrate-out any stale local count.
  useEffect(() => {
    try {
      if (localStorage.getItem(LS_DONE) === '1') setDone(true);
      const saved = localStorage.getItem(LS_EMAIL);
      if (saved) setEmail(saved);
      // Purge legacy stale count cache that caused cross-browser inconsistency.
      localStorage.removeItem('bb_wl_count');
    } catch { /* ignore */ }

    let cancelled = false;
    const refresh = () =>
      fetch('/api/waitlist/count', { cache: 'no-store' })
        .then(r => r.json())
        .then(d => {
          if (cancelled) return;
          if (typeof d?.count === 'number') setCount(d.count);
        })
        .catch(() => { /* keep prior value */ });

    refresh();
    // Poll every 20s so every browser converges on the same number.
    const id = setInterval(refresh, 20_000);
    // Snap-refresh when tab regains focus.
    const onVis = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  async function submit() {
    if (!email || !email.includes('@')) {
      setErr(true);
      setTimeout(() => setErr(false), 2500);
      return;
    }
    setBusy(true);
    setRateLimited(false);
    setServerErr(false);
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (res.status === 429) {
        setRateLimited(true);
      } else if (res.status === 502) {
        // Storage backend rejected the row — DO NOT pretend success.
        setServerErr(true);
        setTimeout(() => setServerErr(false), 6000);
      } else if (res.ok || res.status === 409) {
        setDone(true);
        try {
          localStorage.setItem(LS_DONE, '1');
          localStorage.setItem(LS_EMAIL, email);
        } catch { /* ignore */ }
        // Re-fetch authoritative count from server (never trust optimistic local +1).
        try {
          const cRes = await fetch('/api/waitlist/count', { cache: 'no-store' });
          const cData = await cRes.json();
          if (typeof cData?.count === 'number') setCount(cData.count);
        } catch { /* keep prior value */ }
      } else {
        setServerErr(true);
        setTimeout(() => setServerErr(false), 4000);
      }
    } catch {
      setServerErr(true);
      setTimeout(() => setServerErr(false), 6000);
    }
    setBusy(false);
  }

  return (
    <>
      <Navbar />
      <main className={k.page}>
        <header className={k.head}>
          <div className={`${k.wrap} ${k.headInner}`}>
            <div className={k.kicker}><span className={k.pips} aria-hidden><i /><i /><i /></span>{t('kicker')}</div>
            <h1 className={k.title} style={{ fontSize: 'clamp(30px, 6.4vw, 54px)', maxWidth: '18ch' }}>{t('title')}</h1>
            <p className={k.lede}>{t('sub')}</p>
          </div>
        </header>

        <div className={k.wrap}>
          <div className={`${s.layout} ${k.section}`} style={{ marginTop: 64 }}>
            <div className={`${k.card} ${s.formCard}`}>
              <div className={s.mascot} aria-hidden>
                <MascotSVG cfg={BRAND_MASCOTS[1]} size={64} />
              </div>
              {!done ? (
                <form
                  onSubmit={(e) => { e.preventDefault(); if (!busy) submit(); }}
                  noValidate
                >
                  <label htmlFor="wl-email" className={s.label}>{t('email_label')}</label>
                  <div className={s.formRow}>
                    <input
                      id="wl-email"
                      type="email"
                      autoComplete="email"
                      dir="ltr"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder={t('email_placeholder')}
                      className={`${s.input} ${err ? s.inputBad : ''}`}
                      aria-invalid={err}
                    />
                    <button type="submit" className={k.btn} disabled={busy}>
                      {busy ? t('submitting') : t('submit')}
                    </button>
                  </div>
                  <div aria-live="polite">
                    {err && <p className={s.err}>{t('err_email')}</p>}
                    {rateLimited && <p className={s.err}>{t('err_rate')}</p>}
                    {serverErr && <p className={s.err}>{t('err_server')}</p>}
                  </div>
                </form>
              ) : (
                <div className={s.done} role="status">{t('done')}</div>
              )}
              {count > 0 && <div className={s.count}>{t('count', { n: count })}</div>}
            </div>

            <div>
              <h2 className={k.h2}>{t('facts_title')}</h2>
              <ul className={s.facts}>
                <li>{t('fact_1')}</li>
                <li>{t('fact_2')}</li>
                <li>{t('fact_3')}</li>
                <li>{t('fact_4')}</li>
              </ul>
            </div>
          </div>

          <div className={k.notice} style={{ marginTop: 44, borderColor: 'var(--ds-ok, #22c55e)' }}>
            <p className={k.noticeText}>{t('meanwhile')}</p>
            <div className={k.row}>
              <Link href="/game" className={k.btn}>{t('cta_play')}</Link>
              <Link href="/how-to-play" className={k.btnGhost}>{t('cta_guide')}</Link>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
