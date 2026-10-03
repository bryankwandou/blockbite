'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useT } from '@/lib/i18n';
import k from '@/components/PageKit.module.css';

interface Mine {
  total: number;
  played: number;
  recent: { wallet: string; at: string; played: boolean }[];
}

/** The player's own referral numbers, shown under the link on the profile page. */
export default function ReferralStats({ wallet }: { wallet: string }) {
  const t = useT('referral');
  const [d, setD] = useState<Mine | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!wallet) return;
    let alive = true;
    setD(null);
    setFailed(false);
    fetch(`/api/referrals?wallet=${encodeURIComponent(wallet)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: Mine) => { if (alive) setD(j); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [wallet]);

  if (!wallet) return null;
  const date = (iso: string) => {
    const x = new Date(iso.replace(' ', 'T'));
    return Number.isNaN(x.getTime()) ? '' : x.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  };

  return (
    <div style={{ marginTop: 18 }} aria-live="polite">
      {failed && <p className={k.body} style={{ fontSize: 13 }}>{t('error')}</p>}
      {!failed && !d && <p className={k.body} style={{ fontSize: 13 }}>{t('loading')}</p>}
      {d && (
        <>
          <div className={k.stats} style={{ marginTop: 0 }}>
            <div className={`${k.card} ${k.stat}`}>
              <span className={k.statK}>{t('signed_up')}</span>
              <span className={k.statV}>{d.total.toLocaleString('en-US')}</span>
              <span className={k.statNote}>{t('signed_up_note')}</span>
            </div>
            <div className={`${k.card} ${k.stat}`}>
              <span className={k.statK}>{t('played')}</span>
              <span className={k.statV}>{d.played.toLocaleString('en-US')}</span>
              <span className={k.statNote}>{t('played_note')}</span>
            </div>
          </div>
          <h3 className={k.h3} style={{ marginTop: 16 }}>{t('recent')}</h3>
          {d.recent.length === 0 ? (
            <p className={k.body} style={{ fontSize: 13 }}>{t('none_yet')}</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
              {d.recent.map((r, i) => (
                <li key={`${r.wallet}-${i}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 14 }}>
                  <span dir="ltr" style={{ fontFamily: 'var(--ds-mono, monospace)' }}>{r.wallet}</span>
                  <span>{r.played ? t('status_played') : t('status_joined')} · {date(r.at)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className={k.body} style={{ marginTop: 12, fontSize: 13 }}>
            <Link href="/leaderboard#referrals" className={k.btnGhost}>{t('see_board')}</Link>
          </p>
        </>
      )}
    </div>
  );
}
