'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n';
import k from '@/components/PageKit.module.css';

interface Stats {
  total: number;
  referrers: number;
  top: { wallet: string; count: number }[];
}

/** Public referral total and top 10 referrers; one small section on the leaderboard page. */
export default function ReferralBoard() {
  const t = useT('referral');
  const [d, setD] = useState<Stats | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch('/api/referrals/stats')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: Stats) => { if (alive) setD(j); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  // No data and no error to show: keep the leaderboard clean.
  if (failed) return null;

  return (
    <section className={k.section} id="referrals">
      <h2 className={k.h2}>{t('board_title')}</h2>
      <div className={k.card}>
        <p className={k.body} style={{ color: 'var(--ds-text, #fff)', fontSize: 18 }} aria-live="polite">
          {d ? t('joined_total', { n: d.total.toLocaleString('en-US') }) : t('loading')}
        </p>
        {d && d.top.length > 0 && (
          <>
            <h3 className={k.h3} style={{ marginTop: 14 }}>{t('top_referrers')}</h3>
            <ol style={{ margin: 0, paddingInlineStart: 22, display: 'grid', gap: 6 }}>
              {d.top.map((r, i) => (
                <li key={`${r.wallet}-${i}`} style={{ fontSize: 14 }}>
                  <span style={{ display: 'inline-flex', justifyContent: 'space-between', gap: 12, width: 'calc(100% - 4px)' }}>
                    <span dir="ltr" style={{ fontFamily: 'var(--ds-mono, monospace)' }}>{r.wallet}</span>
                    <span>{t('referred_count', { n: r.count.toLocaleString('en-US') })}</span>
                  </span>
                </li>
              ))}
            </ol>
          </>
        )}
        {d && d.top.length === 0 && <p className={k.body} style={{ fontSize: 13 }}>{t('board_empty')}</p>}
      </div>
    </section>
  );
}
