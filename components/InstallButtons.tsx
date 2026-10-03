'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n';
import s from './InstallButtons.module.css';

type PromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

/**
 * "Available as a Web App" badge. The site is a PWA (manifest + sw.js):
 * Chrome/Edge/Android get the native install prompt, iOS gets the
 * Share → Add to Home Screen tip, and an installed app hides the badge.
 */
export default function InstallButtons() {
  const t = useT('home');
  const [prompt, setPrompt] = useState<PromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [tip, setTip] = useState<string | null>(null);

  useEffect(() => {
    if (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone) setInstalled(true);
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
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    setTip(ios ? t('install_ios') : t('install_other'));
  };

  return (
    <div className={s.wrap}>
      <button type="button" className={s.badge} onClick={install}>
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3Z" />
        </svg>
        <span className={s.text}>
          <span className={s.small}>{t('install_kicker')}</span>
          <span className={s.big}>{t('install_label')}</span>
        </span>
      </button>
      {tip && <p className={s.tip} role="status">{tip}</p>}
    </div>
  );
}
