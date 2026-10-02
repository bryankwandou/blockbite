'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { setTrack, unlockAudio, playSfx, type TrackId, getAudioSettings, getServerAudioSettings, subscribeAudio, type AudioSettings } from '@/lib/audio';
import { initGfx } from '@/lib/gfx';

export function pickTrack(pathname: string, board: string | null, htmlMode: string | undefined): TrackId {
  if (board === 'monthly' || htmlMode === 'monthly') return 'monthly';
  if (pathname.startsWith('/ranked')) return 'ranked';
  if (pathname.startsWith('/game') || pathname.startsWith('/play')) return 'adventure';
  return 'menu';
}

export function useAudioSettings(): AudioSettings {
  return useSyncExternalStore(subscribeAudio, getAudioSettings, getServerAudioSettings);
}

/** Global: picks the music by route, unlocks audio on the first gesture, adds a tap sound to buttons. */
export default function MusicController() {
  const pathname = usePathname() || '/';
  const params = useSearchParams();
  const board = params?.get('board') ?? null;

  useEffect(() => { initGfx(); }, []);

  useEffect(() => {
    const html = document.documentElement;
    const update = () => setTrack(pickTrack(pathname, board, html.dataset.mode));
    update();
    const mo = new MutationObserver(update);
    mo.observe(html, { attributes: true, attributeFilter: ['data-mode'] });
    return () => mo.disconnect();
  }, [pathname, board]);

  useEffect(() => {
    const unlock = () => { void unlockAudio(); };
    const onClick = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.('button, a, [role="button"], [role="radio"], [role="switch"]');
      if (el && !el.closest('[data-no-tap-sfx]')) playSfx('tap');
    };
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    window.addEventListener('touchend', unlock, true);
    window.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
      window.removeEventListener('touchend', unlock, true);
      window.removeEventListener('click', onClick, true);
    };
  }, []);

  return null;
}
