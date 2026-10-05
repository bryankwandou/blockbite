'use client';

import Image from 'next/image';
import Link from 'next/link';
import { RANKED_SALES_OPEN } from '@/lib/ranked/config';
import Navbar, { SunIcon, MoonIcon, SystemIcon } from '@/components/Navbar';
import { useApp, type Theme } from '@/lib/useApp';
import { useT, LOCALES, type Locale } from '@/lib/i18n';
import { useSyncExternalStore } from 'react';
import { setAudioSettings, unlockAudio, playSfx } from '@/lib/audio';
import { useAudioSettings } from '@/components/audio/MusicController';
import { getGfxPref, getGfxLevel, setGfxPref, subscribeGfx, type GfxPref } from '@/lib/gfx';
import MusicLibrary from '@/components/audio/MusicLibrary';
import styles from './settings.module.css';
import ThemePicker from '@/components/theme/ThemePicker';

export default function SettingsPage() {
  const t = useT('settings');
  const { lang, setLang, themePref, setTheme, reduceMotion, setReduceMotion } = useApp();

  const THEMES: { id: Theme; label: string; icon: React.ReactNode }[] = [
    { id: 'system', label: t('system'), icon: <SystemIcon /> },
    { id: 'light', label: t('light'), icon: <SunIcon /> },
    { id: 'dark', label: t('dark'), icon: <MoonIcon /> },
  ];

  const audio = useAudioSettings();
  const gfxPref = useSyncExternalStore(subscribeGfx, getGfxPref, () => 'auto' as GfxPref);
  const gfxLevel = useSyncExternalStore(subscribeGfx, getGfxLevel, () => 'balanced');
  const GFX: { id: GfxPref; label: string }[] = [
    { id: 'low', label: t('gfx_low') },
    { id: 'balanced', label: t('gfx_balanced') },
    { id: 'high', label: t('gfx_high') },
    { id: 'auto', label: t('gfx_auto') },
  ];
  const gfxName = gfxLevel === 'low' ? t('gfx_low') : gfxLevel === 'high' ? t('gfx_high') : t('gfx_balanced');

  const ABOUT: [string, string, 'ok' | 'wait' | 'plain'][] = [
    [t('adventure'), t('adventure_value'), 'ok'],
    [t('network'), t('network_value'), 'plain'],
    [t('ticket_sales'), RANKED_SALES_OPEN ? t('ticket_sales_open') : t('ticket_sales_value'), RANKED_SALES_OPEN ? 'ok' : 'wait'],
    [t('audit'), t('audit_value'), 'wait'],
  ];

  return (
    <>
      <Navbar />
      <main className={styles.page}>
        <header className={styles.head}>
          <div className={styles.headText}>
            <h1 className={styles.title}>{t('title')}</h1>
            <p className={styles.sub}>{t('subtitle')}</p>
          </div>
          <div className={styles.mascot} aria-hidden="true">
            <Image src="/mascots/mascot-tide.png" alt="" width={112} height={112} priority />
          </div>
        </header>

        <section className={styles.card} aria-labelledby="set-display">
          <h2 id="set-display" className={styles.cardTitle}>{t('display')}</h2>

          <div className={styles.row}>
            <div className={styles.rowText}>
              <label htmlFor="set-lang" className={styles.rowLabel}>{t('language')}</label>
              <p className={styles.rowDesc}>{t('language_desc')}</p>
            </div>
            <select
              id="set-lang"
              className={styles.select}
              value={lang}
              onChange={(e) => setLang(e.target.value as Locale)}
            >
              {LOCALES.map((l) => (
                <option key={l.code} value={l.code}>{l.name}</option>
              ))}
            </select>
          </div>

          <div className={styles.row}>
            <div className={styles.rowText}>
              <span id="set-theme" className={styles.rowLabel}>{t('theme')}</span>
              <p className={styles.rowDesc}>{t('theme_desc')}</p>
            </div>
            <div className={styles.seg} role="radiogroup" aria-labelledby="set-theme">
              {THEMES.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  role="radio"
                  aria-checked={themePref === o.id}
                  className={`${styles.segBtn} ${themePref === o.id ? styles.segOn : ''}`}
                  onClick={() => setTheme(o.id)}
                >
                  {o.icon}
                  <span>{o.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className={styles.row}>
            <div className={styles.rowText}>
              <span id="set-gfx" className={styles.rowLabel}>{t('graphics')}</span>
              <p className={styles.rowDesc}>
                {t('graphics_desc')}
                {gfxPref === 'auto' && <> {t('gfx_auto_now', { level: gfxName })}</>}
              </p>
            </div>
            <div className={styles.seg} role="radiogroup" aria-labelledby="set-gfx">
              {GFX.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  role="radio"
                  aria-checked={gfxPref === o.id}
                  className={`${styles.segBtn} ${gfxPref === o.id ? styles.segOn : ''}`}
                  onClick={() => setGfxPref(o.id)}
                >
                  <span>{o.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className={styles.row}>
            <div className={styles.rowText}>
              <span id="set-motion" className={styles.rowLabel}>{t('reduce_motion')}</span>
              <p className={styles.rowDesc}>{t('reduce_motion_desc')}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={reduceMotion}
              aria-labelledby="set-motion"
              className={`${styles.switch} ${reduceMotion ? styles.switchOn : ''}`}
              onClick={() => setReduceMotion(!reduceMotion)}
            >
              <span className={styles.knob} />
            </button>
          </div>
        </section>

        <section className={styles.card}><ThemePicker /></section>

        <section className={styles.card} aria-labelledby="set-sound">
          <h2 id="set-sound" className={styles.cardTitle}>{t('sound')}</h2>

          <div className={styles.row}>
            <div className={styles.rowText}>
              <span id="set-mute" className={styles.rowLabel}>{t('sound_on')}</span>
              <p className={styles.rowDesc}>{t('sound_on_desc')}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={!audio.muted}
              aria-labelledby="set-mute"
              className={`${styles.switch} ${!audio.muted ? styles.switchOn : ''}`}
              onClick={() => { void unlockAudio(); setAudioSettings({ muted: !audio.muted }); }}
            >
              <span className={styles.knob} />
            </button>
          </div>

          <div className={styles.row}>
            <div className={styles.rowText}>
              <label htmlFor="set-music" className={styles.rowLabel}>{t('music_volume')}</label>
              <p className={styles.rowDesc}>{t('music_volume_desc')}</p>
            </div>
            <div className={styles.sliderWrap}>
              <input
                id="set-music"
                type="range"
                min={0}
                max={100}
                step={5}
                className={styles.slider}
                value={Math.round(audio.music * 100)}
                onChange={(e) => { void unlockAudio(); setAudioSettings({ music: Number(e.target.value) / 100 }); }}
              />
              <output htmlFor="set-music" className={styles.sliderVal}>{Math.round(audio.music * 100)}</output>
            </div>
          </div>

          <div className={styles.row}>
            <div className={styles.rowText}>
              <label htmlFor="set-sfx" className={styles.rowLabel}>{t('sfx_volume')}</label>
              <p className={styles.rowDesc}>{t('sfx_volume_desc')}</p>
            </div>
            <div className={styles.sliderWrap}>
              <input
                id="set-sfx"
                type="range"
                min={0}
                max={100}
                step={5}
                className={styles.slider}
                value={Math.round(audio.sfx * 100)}
                onChange={(e) => { void unlockAudio(); setAudioSettings({ sfx: Number(e.target.value) / 100 }); }}
                onPointerUp={() => playSfx('line')}
                onKeyUp={() => playSfx('place')}
              />
              <output htmlFor="set-sfx" className={styles.sliderVal}>{Math.round(audio.sfx * 100)}</output>
            </div>
          </div>
        </section>

        <section className={styles.card} aria-labelledby="set-music-lib">
          <h2 id="set-music-lib" className={styles.cardTitle}>{t('music_library')}</h2>
          <p className={styles.rowDesc}>{t('music_library_desc')}</p>
          <MusicLibrary />
        </section>

        <section className={styles.card} aria-labelledby="set-about">
          <h2 id="set-about" className={styles.cardTitle}>{t('about')}</h2>
          <dl className={styles.facts}>
            {ABOUT.map(([k, v, tone]) => (
              <div key={k} className={styles.fact}>
                <dt>{k}</dt>
                <dd className={tone === 'ok' ? styles.ok : tone === 'wait' ? styles.wait : undefined}>{v}</dd>
              </div>
            ))}
            <div className={styles.fact}>
              <dt>{t('source')}</dt>
              <dd>
                <a href="https://github.com/bryankwandou/blockbite" target="_blank" rel="noopener noreferrer" className={styles.link}>
                  {t('source_value')}
                </a>
              </dd>
            </div>
          </dl>
        </section>

        <Link href="/" className={styles.back}>
          <span aria-hidden="true" className={styles.backArrow}>←</span>
          {t('back_home')}
        </Link>
      </main>
    </>
  );
}
