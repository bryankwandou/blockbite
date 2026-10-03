'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  ALBUM_BY_ID, getTrackDef, getPlaylists, getServerPlaylists, subscribePlayer, getNowPlaying, getServerNowPlaying,
  getWantedContext, setPlaylist, setPaused, skipTrack, unlockAudio, type PlayContext,
} from '@/lib/audio';
import { useT } from '@/lib/i18n';
import MusicLibrary from './MusicLibrary';
import { pickTrack } from './MusicController';
import st from './MusicPanel.module.css';

export function MusicIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" fill="currentColor" /><circle cx="17" cy="16" r="3" fill="currentColor" />
    </svg>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/** Global music sheet: album shelf, playlist order, transport. Opened from the navbar on every page. */
export default function MusicPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT('nav');
  const ts = useT('settings');
  const pathname = usePathname() || '/';
  const params = useSearchParams();
  const lists = useSyncExternalStore(subscribePlayer, getPlaylists, getServerPlaylists);
  const now = useSyncExternalStore(subscribePlayer, getNowPlaying, getServerNowPlaying);
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  const ctx: PlayContext = getWantedContext() ?? ((): PlayContext => {
    const id = pickTrack(pathname, params?.get('board') ?? null, undefined);
    return id === 'monthly' ? 'ranked' : id;
  })();
  const pl = lists[ctx];
  const album = ALBUM_BY_ID[pl.album];
  const track = now.key ? getTrackDef(now.key) : null;
  const playing = !!track && !now.paused;
  const CTX_LABEL: Record<PlayContext, string> = { menu: ts('ctx_menu'), adventure: ts('ctx_adventure'), ranked: ts('ctx_ranked') };

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    const node = ref.current;
    node?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab' || !node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      const active = document.activeElement;
      if (!node.contains(active)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  const toggleMode = (m: 'shuffle' | 'one') => setPlaylist(ctx, { mode: pl.mode === m ? 'all' : m });
  const onPlayPause = () => {
    void unlockAudio();
    if (playing) setPaused(true);
    else if (now.paused) setPaused(false);
    else skipTrack(1);
  };

  return createPortal(
    <div className={st.backdrop} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={st.sheet} role="dialog" aria-modal="true" aria-labelledby="bb-music-title" ref={ref}>
        <header className={st.head}>
          <div className={st.headText}>
            <h2 id="bb-music-title" className={st.title}>{t('music')}</h2>
            <p className={st.now} aria-live="polite">
              {track ? `${album?.name ?? ''} · ${track.name}${now.paused ? ` · ${t('music_paused')}` : ''}` : t('music_nothing')}
            </p>
            <p className={st.ctx}>{t('music_playlist_for', { ctx: CTX_LABEL[ctx] })}</p>
          </div>
          <button type="button" className={st.close} onClick={onClose} aria-label={t('music_close')} title={t('music_close')} data-autofocus>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </header>

        <div className={st.transport} role="group" aria-label={t('music')}>
          <button type="button" className={`${st.tbtn} ${pl.mode === 'shuffle' ? st.tOn : ''}`} aria-pressed={pl.mode === 'shuffle'} aria-label={t('music_shuffle')} title={t('music_shuffle')} onClick={() => toggleMode('shuffle')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" /></svg>
          </button>
          <button type="button" className={st.tbtn} aria-label={t('music_prev')} title={t('music_prev')} onClick={() => { void unlockAudio(); skipTrack(-1); }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h2v14H6zM20 5v14L9 12z" /></svg>
          </button>
          <button type="button" className={`${st.tbtn} ${st.big}`} aria-label={playing ? t('music_pause') : t('music_play')} title={playing ? t('music_pause') : t('music_play')} onClick={onPlayPause}>
            {playing
              ? <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
              : <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4v16l13-8z" /></svg>}
          </button>
          <button type="button" className={st.tbtn} aria-label={t('music_next')} title={t('music_next')} onClick={() => { void unlockAudio(); skipTrack(1); }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16 5h2v14h-2zM4 5v14l11-7z" /></svg>
          </button>
          <button type="button" className={`${st.tbtn} ${pl.mode === 'one' ? st.tOn : ''}`} aria-pressed={pl.mode === 'one'} aria-label={t('music_repeat')} title={t('music_repeat')} onClick={() => toggleMode('one')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3M11 10h1v4" /></svg>
          </button>
        </div>

        <div className={st.body}>
          <MusicLibrary context={ctx} live playLabel={(name) => t('music_play_track', { name })} />
          <p className={st.hint}>{t('music_hint')}</p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
