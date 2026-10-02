'use client';

import { useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { MascotSVG } from './Mascot';
import { avatarSvg } from './avatar/parts';
import {
  AVATAR_EVENT, AVATAR_KEY, DEFAULT_AVATAR_ID, GEM_CONFIGS, fetchAvatar, getAvatar,
  readLocalAvatar, writeLocalAvatar, type GemConfig,
} from '@/lib/avatars';

/**
 * CSS-Generated Avatar System — 12 unique designs, zero images needed.
 * Each avatar is built from pure SVG primitives + CSS gradients.
 */

export type AvatarConfig = GemConfig;
/** The 12 gem badges. Kept under the old name for existing callers. */
export const AVATAR_CONFIGS: AvatarConfig[] = GEM_CONFIGS;

interface CssAvatarProps {
  config: AvatarConfig;
  size?: number;
  selected?: boolean;
  walletInitial?: string;
}

export function CssAvatar({ config, size = 40, selected = false, walletInitial }: CssAvatarProps) {
  const fontSize = Math.max(12, size * 0.4);
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: config.bg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize,
        color: config.symbolColor,
        flexShrink: 0,
        position: 'relative',
        boxShadow: selected
          ? `0 0 0 2px ${config.glowColor}, 0 0 20px ${config.glowColor}80`
          : `0 2px 8px rgba(0,0,0,0.4)`,
        transition: 'box-shadow 0.2s',
        fontFamily: 'system-ui, sans-serif',
        lineHeight: 1,
      }}
    >
      <span style={{ userSelect: 'none' }}>
        {walletInitial || config.symbol}
      </span>
      {selected && (
        <div
          style={{
            position: 'absolute',
            inset: -3,
            borderRadius: '50%',
            border: `2px solid ${config.glowColor}`,
            animation: 'spin 3s linear infinite',
            opacity: 0.7,
          }}
        />
      )}
    </div>
  );
}

/** Quick avatar picker grid used in profile + wallet dropdown */
interface AvatarPickerProps {
  selected: number;
  onSelect: (id: number) => void;
  size?: number;
}

export function AvatarPicker({ selected, onSelect, size = 52 }: AvatarPickerProps) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(6, ${size}px)`,
      gap: 10,
      justifyContent: 'center',
    }}>
      {AVATAR_CONFIGS.map((cfg) => (
        <button
          key={cfg.id}
          onClick={() => onSelect(cfg.id)}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            borderRadius: '50%',
            transition: 'transform 0.15s',
            transform: selected === cfg.id ? 'scale(1.15)' : 'scale(1)',
          }}
          title={cfg.name}
        >
          <CssAvatar config={cfg} size={size} selected={selected === cfg.id} />
        </button>
      ))}
    </div>
  );
}

/* ── PlayerAvatar: renders any registry avatar by slug ────────────── */

interface PlayerAvatarProps {
  id?: string | null;
  size?: number;
  selected?: boolean;
  className?: string;
  /** Accessible name. Omit for decorative use (aria-hidden). */
  label?: string;
}

export function PlayerAvatar({ id, size = 40, selected = false, className, label }: PlayerAvatarProps) {
  const a = getAvatar(id);
  const ring = selected ? '0 0 0 2px var(--ds-accent, #a78bfa)' : undefined;
  const a11y = label ? { role: 'img' as const, 'aria-label': label } : { 'aria-hidden': true as const };

  if (a.kind === 'gem') {
    return <span className={className} {...a11y} style={{ display: 'inline-flex' }}><CssAvatar config={a.gem} size={size} selected={selected} /></span>;
  }

  const box: React.CSSProperties = {
    width: size, height: size, borderRadius: size * 0.24, overflow: 'hidden', flexShrink: 0,
    display: 'inline-block', boxShadow: ring, background: 'var(--ds-surface-2, #14121f)', lineHeight: 0,
  };

  if (a.kind === 'block') {
    return <span className={className} {...a11y} style={box} dangerouslySetInnerHTML={{ __html: avatarSvg(a.parts, size) }} />;
  }
  if (a.kind === 'mascot') {
    return <span className={className} {...a11y} style={box}><MascotSVG cfg={a.mascot} size={size} /></span>;
  }
  if (a.kind === 'sprite') {
    // 3x3 sheet, 1024px square, each portrait ~310px with ~20px margins.
    const cell = 310 / 1024;
    const offs = [20, 357, 695].map((o) => (o / (1024 - 310)) * 100);
    return (
      <span
        className={className}
        {...a11y}
        style={{
          ...box,
          backgroundImage: `url(${a.src})`,
          backgroundSize: `${100 / cell}% ${100 / cell}%`,
          backgroundPosition: `${offs[a.col]}% ${offs[a.row]}%`,
        }}
      />
    );
  }
  return (
    <span className={className} {...a11y} style={box}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={a.src} alt="" width={size} height={size} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    </span>
  );
}

/**
 * The current player's avatar slug. Starts from localStorage, then takes the
 * server copy once a wallet is connected. Stays in sync across components.
 */
export function useMyAvatar(): string {
  const { publicKey } = useWallet();
  const [id, setId] = useState(DEFAULT_AVATAR_ID);

  useEffect(() => {
    setId(readLocalAvatar());
    const onPick = (e: Event) => setId(getAvatar((e as CustomEvent<string>).detail).id);
    const onStorage = (e: StorageEvent) => { if (!e.key || e.key === AVATAR_KEY) setId(readLocalAvatar()); };
    window.addEventListener(AVATAR_EVENT, onPick);
    window.addEventListener('storage', onStorage);
    return () => { window.removeEventListener(AVATAR_EVENT, onPick); window.removeEventListener('storage', onStorage); };
  }, []);

  const wallet = publicKey?.toBase58();
  useEffect(() => {
    if (!wallet) return;
    let live = true;
    fetchAvatar(wallet).then((server) => { if (live && server) writeLocalAvatar(server); });
    return () => { live = false; };
  }, [wallet]);

  return id;
}
