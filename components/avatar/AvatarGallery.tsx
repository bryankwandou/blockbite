'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Shuffle } from 'lucide-react';
import { useT } from '@/lib/i18n';
import {
  AVATAR_COMBOS, BODIES, GALLERY_SIZE, PALETTES, avatarSvg, formatCode, galleryParts,
  type AvatarParts, type PalFamily,
} from './parts';

const PAGE = 60;
const FAMILIES: PalFamily[] = ['warm', 'mint', 'cool', 'lilac', 'neutral'];

const CSS = `
.bb-gal-item{transition:transform .18s ease,box-shadow .18s ease}
.bb-gal-item:hover,.bb-gal-item:focus-visible{transform:translateY(-4px) scale(1.12) rotate(-2deg);box-shadow:0 8px 18px rgba(0,0,0,.35);z-index:1;position:relative}
@media (prefers-reduced-motion:reduce){.bb-gal-item{transition:none}.bb-gal-item:hover,.bb-gal-item:focus-visible{transform:none}}
html[data-gfx='low'] .bb-gal-item{transition:none}
html[data-gfx='low'] .bb-gal-item:hover,html[data-gfx='low'] .bb-gal-item:focus-visible{transform:none;box-shadow:none}
`;

const btn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', height: 34, borderRadius: 10, padding: '0 12px', gap: 6,
  border: '1px solid var(--ds-border, rgba(255,255,255,.15))', background: 'var(--ds-surface-2, rgba(255,255,255,.04))',
  color: 'inherit', cursor: 'pointer', fontSize: 13,
};
const sel: React.CSSProperties = { ...btn, padding: '0 8px' };

/** Seeded Fisher-Yates so "Surprise me" is a stable shuffle until pressed again. */
function shuffled<T>(src: T[], seed: number): T[] {
  const a = src.slice();
  let x = (seed >>> 0) || 1;
  for (let i = a.length - 1; i > 0; i--) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    const j = x % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

interface Props {
  current: AvatarParts;
  onPick: (p: AvatarParts) => void;
}

export function AvatarGallery({ current, onPick }: Props) {
  const t = useT('profile');
  const [fam, setFam] = useState<PalFamily | ''>('');
  const [body, setBody] = useState(-1);
  const [page, setPage] = useState(0);
  const [seed, setSeed] = useState(0);

  const all = useMemo(() => Array.from({ length: GALLERY_SIZE }, (_, i) => galleryParts(i)), []);
  const list = useMemo(() => {
    const f = all.filter((p) => (!fam || PALETTES[p.p].fam === fam) && (body < 0 || p.b === body));
    return seed ? shuffled(f, seed) : f;
  }, [all, fam, body, seed]);

  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  const cur = Math.min(page, pages - 1);
  const slice = list.slice(cur * PAGE, cur * PAGE + PAGE);
  const curCode = formatCode(current);

  return (
    <div>
      <style>{CSS}</style>
      <p style={{ fontSize: 13, opacity: 0.75, margin: '0 0 10px' }}>
        {t('gallery_count', { n: GALLERY_SIZE.toLocaleString('en-US') + '+', combos: AVATAR_COMBOS.toLocaleString('en-US') })}
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <label style={{ fontSize: 13 }}>
          {t('gallery_family')}{' '}
          <select style={sel} value={fam} onChange={(e) => { setFam(e.target.value as PalFamily | ''); setPage(0); }}>
            <option value="">{t('gallery_all')}</option>
            {FAMILIES.map((f) => <option key={f} value={f}>{t(`fam_${f}`)}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 13 }}>
          {t('part_b')}{' '}
          <select style={sel} value={body} onChange={(e) => { setBody(Number(e.target.value)); setPage(0); }}>
            <option value={-1}>{t('gallery_all')}</option>
            {BODIES.map((_, i) => <option key={i} value={i}>{i + 1}</option>)}
          </select>
        </label>
        <button type="button" style={btn} onClick={() => { setSeed(Math.floor(Math.random() * 2 ** 31) + 1); setPage(0); }}>
          <Shuffle size={15} /> {t('gallery_surprise')}
        </button>
      </div>

      <div role="radiogroup" aria-label={t('gallery_title')}
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(60px, 1fr))', gap: 10, padding: 4 }}>
        {slice.map((p) => {
          const c = formatCode(p);
          const on = c === curCode;
          return (
            <button key={c} type="button" role="radio" aria-checked={on} aria-label={c} className="bb-gal-item"
              onClick={() => onPick(p)}
              style={{ justifySelf: 'center', padding: 0, border: 'none', background: 'none', cursor: 'pointer', borderRadius: 14, overflow: 'hidden', lineHeight: 0, boxShadow: on ? '0 0 0 2px var(--ds-accent, #a78bfa)' : undefined }}>
              <span aria-hidden style={{ display: 'inline-block', width: 56, height: 56 }} dangerouslySetInnerHTML={{ __html: avatarSvg(p, 56) }} />
            </button>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'center', marginTop: 12 }}>
        <button type="button" style={btn} disabled={cur === 0} onClick={() => setPage(cur - 1)} aria-label={t('gallery_prev')}>
          <ChevronLeft size={16} />
        </button>
        <span style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums' }} aria-live="polite">
          {t('gallery_page', { n: cur + 1, total: pages })}
        </span>
        <button type="button" style={btn} disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)} aria-label={t('gallery_next')}>
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
