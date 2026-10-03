'use client';

import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { encodeCode, parseCode, setPalette, usePalette, type CustomTheme } from '@/lib/themes/store';
import {
  MAX_SAVED, loadSaved, pastelGroups, pastelName, storeSaved, swatchColor, isPastelBase, type PastelColour,
} from '@/lib/themes/pastel';
import { useThemesT } from '@/lib/themes/useThemesT';
import s from './theme.module.css';

const Group = memo(function Group({ items, label, active, tab, onPick, onHover }: {
  items: PastelColour[]; label: string; active: string; tab: string;
  onPick: (c: PastelColour) => void; onHover: (c: PastelColour | null) => void;
}) {
  return (
    <section className={s.pgroup} aria-label={label}>
      <h4 className={s.ptitle}>{label} <span>{items.length}</span></h4>
      <div className={s.pgrid}>
        {items.map((c) => (
          <button key={c.code} type="button" className={s.pdot} data-code={c.code} style={{ background: c.fill }}
            title={c.name} aria-label={c.name} aria-pressed={active === c.code} tabIndex={tab === c.code ? 0 : -1}
            onClick={() => onPick(c)} onMouseEnter={() => onHover(c)} onMouseLeave={() => onHover(null)}
            onFocus={() => onHover(c)} onBlur={() => onHover(null)} />
        ))}
      </div>
    </section>
  );
});

export default function PastelStudio() {
  const t = useThemesT();
  const palette = usePalette();
  const groups = useMemo(() => pastelGroups(), []);
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const current = palette.startsWith('c:') ? parseCode(palette.slice(2)) : null;
  const activeCode = current && isPastelBase(current.base) ? encodeCode(current) : '';
  const [draft, setDraft] = useState<CustomTheme | null>(null);
  const [hover, setHover] = useState<PastelColour | null>(null);
  const [tab, setTab] = useState('');
  const [saved, setSaved] = useState<string[]>([]);
  const [full, setFull] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => { setSaved(loadSaved((c) => !!parseCode(c) && isPastelBase(c.split('-')[0]))); }, []);

  const shown = draft ?? (current && isPastelBase(current.base) ? current : null);
  const tabCode = tab || activeCode || flat[0]?.code || '';

  const apply = (c: CustomTheme) => { setDraft(c); setPalette(`c:${encodeCode(c)}`); };
  const pick = (c: PastelColour) => { setTab(c.code); apply(c.theme); };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const el = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-code]');
    if (!el || !root.current) return;
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const all = [...root.current.querySelectorAll<HTMLButtonElement>('button[data-code]')];
    const i = all.indexOf(el);
    const rtl = getComputedStyle(el).direction === 'rtl';
    let next = el;
    if (e.key === 'Home') next = all[0];
    else if (e.key === 'End') next = all[all.length - 1];
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const step = (e.key === 'ArrowRight') !== rtl ? 1 : -1;
      next = all[Math.min(all.length - 1, Math.max(0, i + step))];
    } else {
      const r = el.getBoundingClientRect();
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      let best: { b: HTMLButtonElement; d: number; dy: number } | null = null;
      for (const b of all) {
        const q = b.getBoundingClientRect();
        const dy = (q.top - r.top) * dir;
        if (dy < r.height / 2) continue;
        const d = Math.abs(q.left - r.left);
        if (!best || dy < best.dy - 2 || (Math.abs(dy - best.dy) <= 2 && d < best.d)) best = { b, d, dy };
      }
      if (best) next = best.b;
    }
    setTab(next.dataset.code ?? '');
    next.focus();
  };

  const code = shown ? encodeCode(shown) : '';
  const save = () => {
    if (!code || saved.includes(code)) return;
    if (saved.length >= MAX_SAVED) { setFull(true); return; }
    setFull(false);
    const n = [code, ...saved];
    setSaved(n); storeSaved(n);
  };
  const remove = (c: string) => { const n = saved.filter((x) => x !== c); setSaved(n); storeSaved(n); setFull(false); };
  const copy = async (c: string) => {
    const url = `${location.origin}/themes?t=${c}`;
    try { await navigator.clipboard.writeText(url); } catch { window.prompt(t('copy_link'), url); }
  };

  return (
    <section className={s.builder} aria-labelledby="pastel-studio">
      <h3 id="pastel-studio" style={{ margin: 0 }}>{t('studio_title')}</h3>
      <p className={s.note}>{t('studio_intro')} ({flat.length})</p>
      <div ref={root} onKeyDown={onKey}>
        {groups.map((g) => (
          <Group key={g.family} items={g.items} label={t(`family_${g.family}`)} active={activeCode} tab={tabCode}
            onPick={pick} onHover={setHover} />
        ))}
      </div>
      <p className={s.pstatus} aria-live="polite">
        {hover ? hover.name : shown ? `${t('studio_picked')}: ${pastelName(shown)}` : t('studio_hint')}
      </p>
      {shown && (
        <div className={s.builder} style={{ marginTop: 0 }}>
          <label className={s.field}>
            {t('studio_hue')}
            <input className={s.hue} type="range" min={0} max={359} value={shown.accent}
              style={{ background: 'linear-gradient(90deg,#f9a8a8,#fde68a,#bbf7d0,#a5f3fc,#c7d2fe,#f5d0fe,#f9a8a8)', borderRadius: 999 }}
              onChange={(e) => apply({ ...shown, accent: Number(e.target.value) })} />
          </label>
          <label className={s.field}>
            {t('studio_light')}
            <input type="range" min={0} max={4} step={1} value={shown.softness}
              onChange={(e) => apply({ ...shown, softness: Number(e.target.value) })} />
            <span className={s.ends}><span>{t('soft_low')}</span><span>{t('soft_high')}</span></span>
          </label>
          <div className={s.field}>
            {t('code')}
            <span className={s.code}><i className={s.chip} style={{ background: swatchColor(shown) }} />{pastelName(shown)} · {code}</span>
          </div>
          <div className={s.actions}>
            <button type="button" className={`${s.action} ${s.primary}`} onClick={save} disabled={saved.includes(code)}>{t('studio_save')}</button>
            <button type="button" className={s.action} onClick={() => copy(code)}>{t('copy_link')}</button>
          </div>
          {full && <p className={s.note} role="status">{t('studio_full')}</p>}
        </div>
      )}
      <h4 className={s.ptitle}>{t('studio_saved')}</h4>
      {saved.length === 0 ? <p className={s.note}>{t('studio_saved_empty')}</p> : (
        <ul className={s.saved}>
          {saved.map((c) => {
            const th = parseCode(c);
            if (!th) return null;
            const nm = pastelName(th);
            return (
              <li key={c} className={s.savedItem}>
                <button type="button" className={s.savedUse} aria-pressed={activeCode === c} onClick={() => { setTab(c); apply(th); }}>
                  <i className={s.chip} style={{ background: swatchColor(th) }} />
                  <span>{nm}</span>
                </button>
                <button type="button" className={s.savedDel} aria-label={`${t('studio_remove')}: ${nm}`} onClick={() => remove(c)}>×</button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
