'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n';
import s from './InstallButtons.module.css';

type PromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

/**
 * App badges: Android APK and Windows EXE downloads (built from apps/android
 * and apps/windows, served from /downloads), plus the PWA install for iPhone,
 * iPad and Mac: Chrome/Edge get the native install prompt, Safari gets the
 * Add to Home Screen / Add to Dock tip. Hidden inside any installed app.
 */
export default function InstallButtons() {
  const t = useT('home');
  const [prompt, setPrompt] = useState<PromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [tip, setTip] = useState<string | null>(null);

  useEffect(() => {
    const inApp = /BlockBiteApp/.test(navigator.userAgent) || /[?&]source=(android|windows)\b/.test(location.search);
    if (inApp || window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone) setInstalled(true);
    const onPrompt = (e: Event) => { e.preventDefault(); setPrompt(e as PromptEvent); };
    const onInstalled = () => { setInstalled(true); setPrompt(null); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => { window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onInstalled); };
  }, []);

  if (installed) return null;

  const install = async () => {
    if (prompt) {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (outcome === 'accepted') setInstalled(true);
      setPrompt(null);
      return;
    }
    const ua = navigator.userAgent;
    setTip(/iphone|ipad|ipod/i.test(ua) ? t('install_ios') : /macintosh/i.test(ua) ? t('install_mac') : t('install_other'));
  };

  return (
    <div className={s.wrap}>
      <div className={s.row}>
        <a className={s.badge} href="/downloads/blockbite.apk" download>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M6 18c0 .55.45 1 1 1h1v3.5a1.5 1.5 0 0 0 3 0V19h2v3.5a1.5 1.5 0 0 0 3 0V19h1c.55 0 1-.45 1-1V8H6v10ZM3.5 8A1.5 1.5 0 0 0 2 9.5v7a1.5 1.5 0 0 0 3 0v-7A1.5 1.5 0 0 0 3.5 8Zm17 0A1.5 1.5 0 0 0 19 9.5v7a1.5 1.5 0 0 0 3 0v-7A1.5 1.5 0 0 0 20.5 8Zm-4.97-5.84 1.3-1.3a.5.5 0 0 0-.7-.71l-1.48 1.48A5.96 5.96 0 0 0 12 1c-.96 0-1.86.23-2.66.63L7.85.15a.5.5 0 0 0-.7.7l1.31 1.31A5.97 5.97 0 0 0 6 7h12a5.97 5.97 0 0 0-2.47-4.84ZM10 5H9V4h1v1Zm5 0h-1V4h1v1Z" />
          </svg>
          <span className={s.text}>
            <span className={s.small}>{t('download_kicker')}</span>
            <span className={s.big}>Android</span>
          </span>
        </a>
        <a className={s.badge} href="/downloads/BlockBite.exe" download>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M2 4.5 10 3.4v7.8H2V4.5Zm9-1.2L22 2v9.2H11V3.3ZM2 12.2h8V20l-8-1.1v-6.7Zm9 0h11V22l-11-1.5v-8.3Z" />
          </svg>
          <span className={s.text}>
            <span className={s.small}>{t('download_kicker')}</span>
            <span className={s.big}>Windows</span>
          </span>
        </a>
        <button type="button" className={s.badge} onClick={install}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
            <circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3Z" />
          </svg>
          <span className={s.text}>
            <span className={s.small}>{t('install_kicker')}</span>
            <span className={s.big}>{t('install_label')}</span>
          </span>
        </button>
      </div>
      {tip && <p className={s.tip} role="status">{tip}</p>}
    </div>
  );
}
