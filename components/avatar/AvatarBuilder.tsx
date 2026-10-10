'use client';

import { useMemo, useState } from 'react';
import { AvatarGallery } from './AvatarGallery';
import { ChevronLeft, ChevronRight, Palette, Shuffle } from 'lucide-react';
import { useT } from '@/lib/i18n';
import {
  AVATAR_COMBOS, AVATAR_PARTS, PALETTES, PART_KEYS, avatarSvg, formatCode, parseCode, partsFromSeed, randomParts,
  type AvatarParts, type PartKey,
} from './parts';

/** One inline SVG for a block code. */
export function BlockAvatar({ parts, size = 48 }: { parts: AvatarParts; size?: number }) {
  const html = useMemo(() => avatarSvg(parts, size), [parts, size]);
  return <span aria-hidden style={{ display: 'inline-block', width: size, height: size, lineHeight: 0 }} dangerouslySetInnerHTML={{ __html: html }} />;
}

const btn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40, borderRadius: 10,
  border: '1px solid var(--ds-border, rgba(255,255,255,.15))', background: 'var(--ds-surface-2, rgba(255,255,255,.04))',
  color: 'inherit', cursor: 'pointer',
};

interface Props {
  /** Current avatar id; used as the starting point when it is a block code. */
  current: string;
  onUse: (code: string) => void;
}

export function AvatarBuilder({ current, onUse }: Props) {
  const t = useT('profile');
  const [parts, setParts] = useState<AvatarParts>(() => parseCode(current) ?? partsFromSeed(7));
  const [featured, setFeatured] = useState(36);
  const [palOpen, setPalOpen] = useState(false);
  const code = formatCode(parts);

  const step = (k: PartKey, d: number) =>
    setParts((p) => ({ ...p, [k]: (p[k] + d + AVATAR_PARTS[k].length) % AVATAR_PARTS[k].length }));

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
        <div style={{ borderRadius: 26, overflow: 'hidden', lineHeight: 0, flexShrink: 0 }}>
          <BlockAvatar parts={parts} size={140} />
        </div>
        <div style={{ flex: '1 1 220px', minWidth: 0, display: 'grid', gap: 8 }}>
          {PART_KEYS.map((k) => {
            const part = t(`part_${k}`);
            return (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 14 }}>{part}</span>
                <button type="button" style={btn} onClick={() => step(k, -1)} aria-label={t('prev', { part })}><ChevronLeft size={16} /></button>
                <span style={{ width: 52, textAlign: 'center', fontVariantNumeric: 'tabular-nums', fontSize: 13, opacity: 0.8 }}>
                  {parts[k] + 1}/{AVATAR_PARTS[k].length}
                </span>
                <button type="button" style={btn} onClick={() => step(k, 1)} aria-label={t('next', { part })}><ChevronRight size={16} /></button>
                {k === 'p' && (
                  <button type="button" style={btn} onClick={() => setPalOpen((o) => !o)} aria-expanded={palOpen} aria-controls="bb-pal-grid"
                    aria-label={t('colors_open', { n: PALETTES.length })} title={t('colors_open', { n: PALETTES.length })}>
                    <Palette size={16} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {palOpen && (
        <div id="bb-pal-grid" role="radiogroup" aria-label={t('colors_open', { n: PALETTES.length })}
          style={{ marginTop: 14, maxHeight: 190, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(30px, 1fr))', gap: 6, padding: 6, borderRadius: 12, border: '1px solid var(--ds-border, rgba(255,255,255,.15))' }}
          onKeyDown={(e) => {
            const last = PALETTES.length - 1;
            let n = parts.p;
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = Math.min(last, n + 1);
            else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = Math.max(0, n - 1);
            else if (e.key === 'Home') n = 0;
            else if (e.key === 'End') n = last;
            else return;
            e.preventDefault();
            setParts((q) => ({ ...q, p: n }));
            requestAnimationFrame(() => document.getElementById('bb-pal-' + n)?.focus());
          }}>
          {PALETTES.map((pal, i) => (
            <button key={i} id={'bb-pal-' + i} type="button" role="radio" aria-checked={parts.p === i} tabIndex={parts.p === i ? 0 : -1}
              aria-label={t('colors_pick', { n: i + 1 })} title={String(i + 1)}
              onClick={() => setParts((q) => ({ ...q, p: i }))}
              style={{ width: 30, height: 30, borderRadius: 8, cursor: 'pointer', padding: 0, background: `linear-gradient(135deg, ${pal.light} 0 35%, ${pal.main} 35% 75%, ${pal.dark} 75%)`,
                border: parts.p === i ? '2px solid var(--ds-accent, #a78bfa)' : '1px solid rgba(255,255,255,.25)' }} />
          ))}
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 16, alignItems: 'center' }}>
        <button type="button" style={{ ...btn, width: 'auto', padding: '0 14px', gap: 6 }} onClick={() => setParts(randomParts())}>
          <Shuffle size={16} /> {t('randomize')}
        </button>
        <button type="button" style={{ ...btn, width: 'auto', padding: '0 14px', background: 'var(--ds-accent, #9945FF)', color: '#fff', border: 'none' }}
          onClick={() => onUse(code)} aria-pressed={current === code}>
          {t('use_this')}
        </button>
        <span style={{ fontSize: 12, opacity: 0.6 }}>{t('combos', { n: AVATAR_COMBOS.toLocaleString('en-US') })}</span>
        <span style={{ fontSize: 12, opacity: 0.6, fontFamily: 'monospace' }}>{code}</span>
      </div>

      <h3 style={{ fontSize: 15, margin: '22px 0 10px' }}>{t('featured_title')}</h3>
      <div role="radiogroup" aria-label={t('featured_title')}
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(52px, 1fr))', gap: 10 }}>
        {Array.from({ length: featured }, (_, i) => {
          const p = partsFromSeed(i * 7919 + 1);
          const c = formatCode(p);
          return (
            <button key={c + i} type="button" role="radio" aria-checked={c === code} aria-label={c}
              onClick={() => setParts(p)}
              style={{ justifySelf: 'center', padding: 0, border: 'none', background: 'none', cursor: 'pointer', borderRadius: 12, overflow: 'hidden', lineHeight: 0, boxShadow: c === code ? '0 0 0 2px var(--ds-accent, #a78bfa)' : undefined }}>
              <BlockAvatar parts={p} size={48} />
            </button>
          );
        })}
      </div>
      {featured < 360 && (
        <button type="button" style={{ ...btn, width: 'auto', padding: '0 14px', marginTop: 12 }} onClick={() => setFeatured((n) => n + 36)}>
          {t('featured_more')}
        </button>
      )}

      <h3 style={{ fontSize: 15, margin: '26px 0 6px' }}>{t('gallery_title')}</h3>
      <AvatarGallery current={parts} onPick={setParts} />
    </div>
  );
}
