'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import ThemePicker, { Swatch } from '@/components/theme/ThemePicker';
import { SEEDS, customTokens, encodeCode, parseCode, setPalette, useMode, type CustomTheme } from '@/lib/themes/store';
import { useThemesT } from '@/lib/themes/useThemesT';
import s from '@/components/theme/theme.module.css';

export default function ThemesPage() {
  const t = useThemesT();
  const mode = useMode();
  // ?t=<code> share link. Read after mount (no Suspense boundary needed); strictly validated.
  const [shared, setShared] = useState<CustomTheme | null | 'invalid' | undefined>(undefined);
  const [used, setUsed] = useState(false);
  useEffect(() => {
    const raw = new URLSearchParams(location.search).get('t');
    if (raw !== null) setShared(parseCode(raw) ?? 'invalid');
  }, []);

  const sharedCode = shared && shared !== 'invalid' ? encodeCode(shared) : '';
  return (
    <>
      <Navbar />
      <main style={{ maxWidth: 880, margin: '0 auto', padding: '24px 16px 64px', boxSizing: 'border-box' }}>
        <h1 style={{ margin: '0 0 6px' }}>{t('title')}</h1>
        <p className={s.note} style={{ marginBottom: 18 }}>{t('intro')}</p>

        {shared === 'invalid' && <div className={s.banner} role="alert"><p className={s.note}>{t('shared_invalid')}</p></div>}
        {shared && shared !== 'invalid' && (
          <section className={s.banner} aria-labelledby="shared-title">
            <h2 id="shared-title" style={{ margin: 0, fontSize: 18 }}>{t('shared_title')}</h2>
            <p className={s.note}>{t('shared_preview')}</p>
            <div style={{ maxWidth: 220 }}>
              <Swatch tokens={customTokens(shared, mode)} name={SEEDS.find((x) => x.id === shared.base)?.name ?? ''}
                sub={sharedCode} on={used} badge={t('selected')} onClick={() => { setPalette(`c:${sharedCode}`); setUsed(true); }} />
            </div>
            <div className={s.actions}>
              <button type="button" className={`${s.action} ${s.primary}`}
                onClick={() => { setPalette(`c:${sharedCode}`); setUsed(true); }}>
                {used ? t('selected') : t('use_theme')}
              </button>
            </div>
          </section>
        )}

        <h2 style={{ fontSize: 18 }}>{t('picker_title')}</h2>
        <ThemePicker builder />
        <p style={{ marginTop: 24 }}><Link className={s.link} href="/settings">{t('back_settings')}</Link></p>
      </main>
    </>
  );
}
