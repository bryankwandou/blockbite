'use client';

import { useRef, useState, useSyncExternalStore } from 'react';
import {
  ALBUMS, ALBUM_BY_ID, getTrackDef, getPlaylists, getServerPlaylists, subscribePlayer, getNowPlaying,
  getServerNowPlaying, setPlaylist, previewTrack, stopPreview, playTrack, PLAY_CONTEXTS,
  type PlayContext, type RepeatMode,
} from '@/lib/audio';
import { useT } from '@/lib/i18n';
import st from './MusicLibrary.module.css';

const COVER: Record<string, [string, string]> = {
  classic: ['#5eead4', '#0f766e'], royal: ['#a78bfa', '#5b21b6'], calm: ['#38bdf8', '#0c4a6e'],
  tense: ['#f43f5e', '#7f1d1d'], bright: ['#fbbf24', '#b45309'],
};

/** Album cover drawn in SVG from the album's mood colours: tinted blocks plus the album's initials. */
export function AlbumCover({ mood, name, size = 64 }: { mood: string; name: string; size?: number }) {
  const [a, b] = COVER[mood] ?? COVER.classic;
  const gid = `cv-${mood}`;
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false" style={{ width: '100%', height: 'auto', borderRadius: 12, display: 'block' }}>
      <defs><linearGradient id={gid} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={a} /><stop offset="1" stopColor={b} /></linearGradient></defs>
      <rect width="64" height="64" fill={`url(#${gid})`} />
      <rect x="6" y="38" width="14" height="14" rx="3" fill="#fff" opacity=".22" />
      <rect x="22" y="30" width="14" height="22" rx="3" fill="#fff" opacity=".3" />
      <rect x="38" y="22" width="14" height="30" rx="3" fill="#fff" opacity=".4" />
      <text x="32" y="19" textAnchor="middle" fontFamily="Space Grotesk, system-ui, sans-serif" fontWeight="800" fontSize="15" fill="#fff">{initials}</text>
    </svg>
  );
}

function usePlaylists() {
  return useSyncExternalStore(subscribePlayer, getPlaylists, getServerPlaylists);
}
function useNow() {
  return useSyncExternalStore(subscribePlayer, getNowPlaying, getServerNowPlaying);
}

/** Album picker + playlist editor, one per context (menu / adventure / ranked). */
export default function MusicLibrary({ context, live = false, playLabel }: { context?: PlayContext; live?: boolean; playLabel?: (name: string) => string } = {}) {
  const t = useT('settings');
  const lists = usePlaylists();
  const now = useNow();
  const [ctxState, setCtx] = useState<PlayContext>('menu');
  const ctxId = context ?? ctxState;
  const listRef = useRef<HTMLOListElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const pl = lists[ctxId];
  const album = ALBUM_BY_ID[pl.album];

  const CTX_LABEL: Record<PlayContext, string> = { menu: t('ctx_menu'), adventure: t('ctx_adventure'), ranked: t('ctx_ranked') };
  const MODES: { id: RepeatMode; label: string }[] = [
    { id: 'all', label: t('mode_all') },
    { id: 'one', label: t('mode_one') },
    { id: 'shuffle', label: t('mode_shuffle') },
  ];
  const MOOD: Record<string, string> = {
    classic: t('mood_classic'), royal: t('mood_royal'), calm: t('mood_calm'), tense: t('mood_tense'), bright: t('mood_bright'),
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= pl.order.length || from === to) return;
    // keep keyboard focus on the moved row
    requestAnimationFrame(() => (listRef.current?.children[to] as HTMLElement | undefined)?.focus());
    const order = [...pl.order];
    const [k] = order.splice(from, 1);
    order.splice(to, 0, k);
    setPlaylist(ctxId, { order });
  };
  const toggle = (k: string) => {
    const on = !pl.off.includes(k);
    if (on && pl.order.length - pl.off.length <= 1) return; // keep at least one track
    setPlaylist(ctxId, { off: on ? [...pl.off, k] : pl.off.filter((x) => x !== k) });
  };

  return (
    <div className={st.lib}>
      {!context && <div className={st.tabs} role="tablist" aria-label={t('music_for')}>
        {PLAY_CONTEXTS.map((c) => (
          <button
            key={c}
            type="button"
            role="tab"
            aria-selected={ctxId === c}
            className={`${st.tab} ${ctxId === c ? st.tabOn : ''}`}
            onClick={() => setCtx(c)}
          >
            {CTX_LABEL[c]}
            <span className={st.tabAlbum}>{ALBUM_BY_ID[lists[c].album]?.name}</span>
          </button>
        ))}
      </div>}

      <div className={st.albums} role="radiogroup" aria-label={t('albums')}>
        {ALBUMS.map((a) => (
          <button
            key={a.id}
            type="button"
            role="radio"
            aria-checked={pl.album === a.id}
            className={`${st.album} ${st['m_' + a.mood]} ${pl.album === a.id ? st.albumOn : ''}`}
            onClick={() => setPlaylist(ctxId, { album: a.id })}
          >
            <span className={st.cover}><AlbumCover mood={a.mood} name={a.name} /></span>
            <span className={st.albumName}>{a.name}</span>
            <span className={st.albumMeta}>{MOOD[a.mood]} · {t('tracks_count', { n: Object.keys(a.tracks).length })}</span>
          </button>
        ))}
      </div>

      <div className={st.modeRow}>
        <span className={st.modeLabel} id="ml-mode">{t('play_order')}</span>
        <div className={st.seg} role="radiogroup" aria-labelledby="ml-mode">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={pl.mode === m.id}
              className={`${st.segBtn} ${pl.mode === m.id ? st.segOn : ''}`}
              onClick={() => setPlaylist(ctxId, { mode: m.id })}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <ol className={st.list} aria-label={album?.name} ref={listRef}>
        {pl.order.map((k, i) => {
          const tr = getTrackDef(k);
          if (!tr) return null;
          const on = !pl.off.includes(k);
          const isLive = now.key === k;
          return (
            <li
              key={k}
              aria-current={isLive ? 'true' : undefined}
              className={`${st.item} ${on ? '' : st.itemOff} ${isLive ? st.itemLive : ''} ${drag === i ? st.dragging : ''}`}
              draggable
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); move(i, i + (e.key === 'ArrowUp' ? -1 : 1)); }
                else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); (listRef.current?.children[i + (e.key === 'ArrowUp' ? -1 : 1)] as HTMLElement | undefined)?.focus(); }
              }}
              onDragStart={(e) => { setDrag(i); e.dataTransfer.effectAllowed = 'move'; }}
              onDragOver={(e) => { e.preventDefault(); }}
              onDrop={(e) => { e.preventDefault(); if (drag !== null) move(drag, i); setDrag(null); }}
              onDragEnd={() => setDrag(null)}
            >
              <span className={st.grip} aria-hidden="true">⋮⋮</span>
              <input
                type="checkbox"
                className={st.check}
                checked={on}
                onChange={() => toggle(k)}
                aria-label={t('track_include', { name: tr.name })}
              />
              <span className={st.trackText}>
                <span className={st.trackName}>{tr.name}</span>
                <span className={st.trackMeta}>{t('bpm', { n: tr.bpm })}{isLive ? ` · ${now.preview ? t('previewing') : t('now_playing')}` : ''}</span>
              </span>
              <button
                type="button"
                className={st.iconBtn}
                data-no-tap-sfx
                aria-label={live && playLabel ? playLabel(tr.name) : isLive && now.preview ? t('stop_preview') : t('preview_track', { name: tr.name })}
                onClick={() => (live ? playTrack(k) : isLive && now.preview ? stopPreview() : previewTrack(k))}
              >
                {live ? '▶' : isLive && now.preview ? '■' : '▶'}
              </button>
              <button type="button" className={st.iconBtn} disabled={i === 0} aria-label={t('move_up', { name: tr.name })} onClick={() => move(i, i - 1)}>↑</button>
              <button type="button" className={st.iconBtn} disabled={i === pl.order.length - 1} aria-label={t('move_down', { name: tr.name })} onClick={() => move(i, i + 1)}>↓</button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
