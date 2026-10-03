'use client';

import { useMemo, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import {
  SEEDS, customTokens, encodeCode, generate, parseCode, setPalette, useMode, usePalette,
  type CustomTheme, type Tokens,
} from '@/lib/themes/store';
import { useThemesT } from '@/lib/themes/useThemesT';
import PastelStudio from './PastelStudio';
import { isPastelBase, pastelName } from '@/lib/themes/pastel';
import s from './theme.module.css';

// Classic look (app/globals.css) for the "default" swatch preview.
const CLASSIC: Record<'light' | 'dark', Partial<Tokens>> = {
  dark: { '--bg': '#08081a', '--surface': '#14142a', '--text': '#ffffff', '--text-dim': '#94a3b8', '--border': '#1f1f3a',
    '--accent': '#a78bfa', '--board-bg': '#12122a', '--block-1': '#f87171', '--block-2': '#fbbf24', '--block-3': '#facc15',
    '--block-4': '#4ade80', '--block-5': '#22d3ee', '--block-6': '#818cf8', '--block-7': '#e879f9' },
  light: { '--bg': '#f7f7fb', '--surface': '#ececf2', '--text': '#0a0a14', '--text-dim': '#475569', '--border': '#e2e8f0',
    '--accent': '#6d28d9', '--board-bg': '#ececf6', '--block-1': '#f87171', '--block-2': '#fbbf24', '--block-3': '#facc15',
    '--block-4': '#4ade80', '--block-5': '#22d3ee', '--block-6': '#818cf8', '--block-7': '#e879f9' },
};

function vars(t: Partial<Tokens>): CSSProperties {
  return {
    '--p-bg': t['--bg'], '--p-surface': t['--surface'], '--p-text': t['--text'], '--p-dim': t['--text-dim'],
    '--p-border': t['--border'], '--p-accent': t['--accent'], '--p-board': t['--board-bg'],
  } as CSSProperties;
}

const BOARD = [1, 0, 3, 3, 0, 5, 6, 2, 2, 0, 4, 7, 0, 6, 0, 1, 4, 4, 0, 5, 7];

export function Swatch({ tokens, name, sub, on, onClick, badge }: {
  tokens: Partial<Tokens>; name: string; sub: string; on: boolean; onClick: () => void; badge?: string;
}) {
  const t = useThemesT();
  return (
    <button type="button" className={s.swatch} style={vars(tokens)} aria-pressed={on} onClick={onClick}>
      {on && badge && <span className={s.tick}>{badge}</span>}
      <span className={s.board} aria-hidden="true">
        {BOARD.map((b, i) => (
          <span key={i} style={{ background: b ? tokens[`--block-${b}` as keyof Tokens] : 'transparent' }} />
        ))}
      </span>
      <span className={s.row} aria-hidden="true">
        <span className={s.btn}>{t('sample_button')}</span>
        <span className={s.mini}>{t('sample_card')}</span>
      </span>
      <span className={s.name}>{name}</span>
      <span className={s.from}>{sub}</span>
    </button>
  );
}

export default function ThemePicker({ builder = false }: { builder?: boolean }) {
  const t = useThemesT();
  const mode = useMode();
  const palette = usePalette();
  const current = palette.startsWith('c:') ? parseCode(palette.slice(2)) : null;

  return (
    <div>
      {!builder && <h2 style={{ margin: '0 0 12px', fontSize: 18 }}>{t('picker_title')}</h2>}
      <div className={s.grid} role="group" aria-label={t('picker_title')}>
        <Swatch tokens={CLASSIC[mode]} name={t('default_name')} sub={t('default_note')} on={palette === ''}
          badge={t('selected')} onClick={() => setPalette('')} />
        {SEEDS.map((seed) => (
          <Swatch key={seed.id} tokens={generate(seed, mode)} name={seed.name} sub={t(`from_${seed.from}`)}
            on={palette === seed.id} badge={t('selected')} onClick={() => setPalette(seed.id)} />
        ))}
      </div>
      {current && <p className={s.note} style={{ marginTop: 10 }}>{t('using_custom')}: <code>{encodeCode(current)}</code>{isPastelBase(current.base) ? ` (${pastelName(current)})` : ''}</p>}
      <PastelStudio />
      {builder ? <ThemeBuilder initial={current && !isPastelBase(current.base) ? current : undefined} /> : (
        <p style={{ marginTop: 12 }}><Link className={s.link} href="/themes">{t('more_themes')}</Link></p>
      )}
    </div>
  );
}

export function ThemeBuilder({ initial }: { initial?: CustomTheme }) {
  const t = useThemesT();
  const mode = useMode();
  const [c, setC] = useState<CustomTheme>(initial ?? { base: 'tide', accent: 200, softness: 2 });
  const [copied, setCopied] = useState(false);
  const code = encodeCode(c);
  const tokens = useMemo(() => customTokens(c, mode), [c, mode]);
  const base = SEEDS.find((x) => x.id === c.base) ?? SEEDS[0];

  const copy = async () => {
    const url = `${location.origin}/themes?t=${code}`;
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    catch { window.prompt(t('copy_link'), url); }
  };

  return (
    <section className={s.builder} aria-labelledby="theme-builder">
      <h3 id="theme-builder" style={{ margin: 0 }}>{t('builder_title')}</h3>
      <p className={s.note}>{t('builder_intro')}</p>
      <label className={s.field}>
        {t('base')}
        <select value={c.base} onChange={(e) => setC({ ...c, base: e.target.value })}>
          {SEEDS.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </label>
      <label className={s.field}>
        {t('accent')}
        <input className={s.hue} type="range" min={0} max={359} value={c.accent}
          style={{ background: 'linear-gradient(90deg,#f9a8a8,#fde68a,#bbf7d0,#a5f3fc,#c7d2fe,#f5d0fe,#f9a8a8)', borderRadius: 999 }}
          onChange={(e) => setC({ ...c, accent: Number(e.target.value) })} />
      </label>
      <label className={s.field}>
        {t('softness')}
        <input type="range" min={0} max={4} step={1} value={c.softness}
          onChange={(e) => setC({ ...c, softness: Number(e.target.value) })} />
        <span className={s.ends}><span>{t('soft_low')}</span><span>{t('soft_high')}</span></span>
      </label>
      <div style={{ maxWidth: 220 }}>
        <Swatch tokens={tokens} name={base.name} sub={code} on={false} onClick={() => setPalette(`c:${code}`)} />
      </div>
      <div className={s.field}>
        {t('code')}
        <span className={s.code}>{code}</span>
      </div>
      <div className={s.actions}>
        <button type="button" className={`${s.action} ${s.primary}`} onClick={() => setPalette(`c:${code}`)}>{t('use_theme')}</button>
        <button type="button" className={s.action} onClick={copy} aria-live="polite">{copied ? t('copied') : t('copy_link')}</button>
      </div>
    </section>
  );
}
