'use client';
/**
 * Route-level error boundary for /map/[act].
 *
 * Without this, any uncaught throw in MapScreen propagates up and Next.js
 * renders its opaque "Application error" page. This fallback explains what
 * happened, offers a retry, a "turn off 3D backdrop and reload" switch
 * (localStorage.bb_3d_disabled = '1'), and links to /game and /.
 */

import { useEffect } from 'react';
import Link from 'next/link';
import { useT } from '@/lib/i18n';
import ui from '@/components/game/GameCanvas.module.css';

export default function MapActError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useT('map');
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('[map/[act]] route error:', error);
  }, [error]);

  const disable3DAndReload = () => {
    try { localStorage.setItem('bb_3d_disabled', '1'); } catch { /* ignore */ }
    if (typeof window !== 'undefined') window.location.reload();
  };

  return (
    <div style={{
      minHeight: '100vh', width: '100%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--ds-bg, #08081a)', color: 'var(--ds-text, #fff)',
      padding: 16,
    }}>
      <div className={ui.overlay} style={{ gap: 10 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/mascots/mascot-brawler.png" alt="" aria-hidden width={96} height={96} style={{ objectFit: 'contain' }} />
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.16em', color: 'var(--ds-danger, #ef4444)' }}>
          {t('err_kicker')}
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>{t('err_title')}</h1>
        <p style={{ fontSize: 14, color: 'var(--ds-text-dim, #94a3b8)', lineHeight: 1.6, margin: '0 0 8px' }}>
          {t('err_body')}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
          <button type="button" onClick={reset} className={ui.btnMain}>{t('err_try_again')}</button>
          <button type="button" onClick={disable3DAndReload} className={ui.btnGhost}>{t('err_disable_3d')}</button>
          <Link href="/game" className={ui.btnGhost}>{t('err_play_adventure')}</Link>
          <Link href="/" style={{ color: 'var(--ds-text-dim, #94a3b8)', fontSize: 12, marginTop: 6 }}>
            {t('err_back_home')}
          </Link>
        </div>
        {error?.digest && (
          <div style={{ marginTop: 12, fontSize: 10, color: 'var(--ds-text-dim, #94a3b8)', fontFamily: 'monospace', opacity: 0.7 }}>
            {t('err_digest', { id: error.digest })}
          </div>
        )}
      </div>
    </div>
  );
}
