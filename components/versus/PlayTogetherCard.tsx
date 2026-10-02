'use client';

import Link from 'next/link';
import { useT } from '@/lib/i18n';
import s from './versus.module.css';

/** Small home-page card linking 1 vs Bot and Challenge a friend. Drop-in, no props. */
export default function PlayTogetherCard() {
  const t = useT('versus');
  return (
    <aside className={s.card} aria-labelledby="pt-title">
      <span className={s.badge}>{t('for_fun')}</span>
      <h3 id="pt-title" className={s.cardTitle}>{t('card_title')}</h3>
      <p className={s.sub}>{t('card_body')}</p>
      <div className={s.row}>
        <Link href="/versus" className={s.btn}>{t('title')}</Link>
        <Link href="/challenge" className={s.btnGhost}>{t('challenge_cta')}</Link>
      </div>
    </aside>
  );
}
