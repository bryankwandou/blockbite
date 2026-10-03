'use client';

import { useEffect, useState } from 'react';
import { PlayerAvatar } from '@/components/CssAvatars';
import { useT } from '@/lib/i18n';
import BlockBurst from './BlockBurst';
import s from './Podium.module.css';

export interface PodiumRow { wallet: string; score: number; avatarId: string | null }

function shortWallet(addr: string) {
  return addr.length < 12 ? addr : `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

/** Visual order left to right: 2nd, 1st, 3rd. */
const ORDER = [1, 0, 2] as const;

/**
 * Animated top-3 podium. Blocks rise in, 1st wears a crown, and a block
 * burst plays once per session per `tabKey`. Static under reduced motion or
 * low graphics (handled in CSS and by BlockBurst).
 */
export default function Podium({ rows, tabKey, unit, me }: {
  rows: PodiumRow[]; tabKey: string; unit: string; me: string | null;
}) {
  const t = useT('leaderboard');
  const [burst, setBurst] = useState(false);

  useEffect(() => {
    setBurst(false);
    if (rows.length === 0) return;
    try {
      const key = `bb_podium_${tabKey}`;
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch { /* storage blocked: just play it */ }
    // Wait for the blocks to rise before the burst.
    const id = window.setTimeout(() => setBurst(true), 700);
    return () => window.clearTimeout(id);
  }, [tabKey, rows.length]);

  if (rows.length === 0) return null;
  return (
    <div className={s.podium} role="group" aria-label={t('podium_label')} key={tabKey}>
      {ORDER.map((i) => {
        const r = rows[i];
        return (
          <div key={i} className={`${s.col} ${s[`p${i + 1}`]} ${r && r.wallet === me ? s.me : ''}`}>
            {r ? (
              <div className={s.who}>
                {i === 0 && <span className={s.crown} role="img" aria-label={t('crown_label')}>♛</span>}
                <PlayerAvatar id={r.avatarId} size={i === 0 ? 52 : 44} className={s.avatar} />
                <span className={s.name} dir="ltr" title={r.wallet}>{shortWallet(r.wallet)}</span>
                <span className={s.score}>{r.score.toLocaleString('en-US')} <small>{unit}</small></span>
              </div>
            ) : <div className={s.who} />}
            <div className={s.block} aria-hidden>
              <span className={s.place}>{i + 1}</span>
            </div>
          </div>
        );
      })}
      {burst && <BlockBurst onDone={() => setBurst(false)} />}
    </div>
  );
}
