'use client';

import { toggleMute, unlockAudio } from '@/lib/audio';
import { useT } from '@/lib/i18n';
import { useAudioSettings } from './MusicController';

export function SpeakerIcon({ off }: { off?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 5 6 9H3v6h3l5 4V5Z" fill="currentColor" />
      {off ? <path d="m16 9 5 6M21 9l-5 6" /> : <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />}
    </svg>
  );
}

export default function MuteToggle({ className }: { className?: string }) {
  const t = useT('settings');
  const { muted } = useAudioSettings();
  const label = muted ? t('sound_unmute') : t('sound_mute');
  return (
    <button
      type="button"
      className={className}
      aria-label={label}
      title={label}
      aria-pressed={muted}
      onClick={() => { void unlockAudio(); toggleMute(); }}
    >
      <SpeakerIcon off={muted} />
    </button>
  );
}
