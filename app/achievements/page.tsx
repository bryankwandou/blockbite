'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import Navbar from '@/components/Navbar';
import { useT } from '@/lib/i18n';
import { ACHIEVEMENTS, CATEGORIES, TIERS, numeral, type Achievement, type Category, type Tier } from '@/lib/achievements/catalog';
import { emblemSvg } from '@/lib/achievements/emblem';
import { loadUnlocks } from '@/lib/achievements/client';
import k from '@/components/PageKit.module.css';

const CELL_W = 150;
const ROW_H = 176;
const GAP = 10;
const OVERSCAN = 3;

const useIso = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function Badge({ a, got, at, t }: { a: Achievement; got: boolean; at: string | null | undefined; t: ReturnType<typeof useT> }) {
  const html = useMemo(() => emblemSvg(a.emblem, 64), [a]);
  const goal = t(`goal_${a.cat}`, { n: numeral(a.threshold) });
  return (
    <div
      className={k.card}
      style={{
        height: ROW_H - GAP, padding: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
        textAlign: 'center', opacity: got ? 1 : 0.45, filter: got ? undefined : 'grayscale(1)', overflow: 'hidden',
      }}
    >
      <span aria-hidden style={{ lineHeight: 0 }} dangerouslySetInnerHTML={{ __html: html }} />
      <span style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.25 }}>{goal}</span>
      <span style={{ fontSize: 11, opacity: 0.75 }}>
        {t(`tier_${a.tier}`)} · {got ? (at ? t('reached_on', { date: at.slice(0, 10) }) : t('reached_here')) : t('locked')}
      </span>
    </div>
  );
}

function Chips<T extends string>({ label, value, options, onPick, name }: {
  label: string; value: T | 'all'; options: (T | 'all')[]; onPick: (v: T | 'all') => void; name: (v: T | 'all') => string;
}) {
  return (
    <div role="group" aria-label={label} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      <span style={{ fontSize: 12, opacity: 0.7, marginRight: 4 }}>{label}</span>
      {options.map((o) => (
        <button key={o} type="button" aria-pressed={value === o} className={k.btn}
          style={{ padding: '5px 10px', fontSize: 12, opacity: value === o ? 1 : 0.55 }} onClick={() => onPick(o)}>
          {name(o)}
        </button>
      ))}
    </div>
  );
}

export default function AchievementsPage() {
  const t = useT('achievements');
  const { publicKey } = useWallet();
  const wallet = publicKey?.toBase58();
  const [unlocked, setUnlocked] = useState<Map<string, string | null>>(new Map());
  const [server, setServer] = useState(false);
  const [cat, setCat] = useState<Category | 'all'>('all');
  const [tier, setTier] = useState<Tier | 'all'>('all');
  const [state, setState] = useState<'all' | 'got' | 'locked'>('all');

  useEffect(() => {
    let live = true;
    loadUnlocks(wallet).then((r) => { if (live) { setUnlocked(r.unlocked); setServer(r.server); } });
    return () => { live = false; };
  }, [wallet]);

  const list = useMemo(() => ACHIEVEMENTS.filter((a) =>
    (cat === 'all' || a.cat === cat) && (tier === 'all' || a.tier === tier)
    && (state === 'all' || (state === 'got') === unlocked.has(a.id))), [cat, tier, state, unlocked]);

  // Window-scrolled virtual grid: only the rows near the viewport are in the DOM.
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ cols: 2, top: 0, h: 800 });
  useIso(() => {
    const measure = () => {
      const el = box.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const cols = Math.max(1, Math.floor((r.width + GAP) / (CELL_W + GAP)));
      setView((v) => (v.cols === cols && v.top === r.top && v.h === window.innerHeight ? v : { cols, top: r.top, h: window.innerHeight }));
    };
    measure();
    let raf = 0;
    const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure); };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); };
  }, []);

  const rows = Math.ceil(list.length / view.cols);
  const first = Math.max(0, Math.floor(-view.top / ROW_H) - OVERSCAN);
  const last = Math.min(rows, Math.ceil((view.h - view.top) / ROW_H) + OVERSCAN);
  const cells: Achievement[] = list.slice(first * view.cols, last * view.cols);

  const total = ACHIEVEMENTS.length;
  const got = unlocked.size;

  return (
    <>
      <Navbar />
      <main className={k.page}>
        <header className={k.head}>
          <div className={`${k.wrap} ${k.headInner}`}>
            <div className={k.kicker}><span className={k.pips} aria-hidden><i /><i /><i /></span>{t('title')}</div>
            <h1 className={k.h2} style={{ marginTop: 12 }}>{t('progress', { got: got.toLocaleString('en-US'), total: total.toLocaleString('en-US') })}</h1>
            <p className={k.body}>{t('intro')}</p>
            <p className={k.body} style={{ fontSize: 13 }}>{server ? t('synced') : t('local_only')}</p>
            <div aria-hidden style={{ height: 8, borderRadius: 4, background: 'var(--ds-surface-2, rgba(127,127,127,.2))', marginTop: 10, overflow: 'hidden' }}>
              <div style={{ width: `${(got / total) * 100}%`, height: '100%', background: 'var(--ds-accent, #9945FF)' }} />
            </div>
          </div>
        </header>
        <div className={k.wrap}>
          <section className={k.section} style={{ display: 'grid', gap: 10 }}>
            <Chips label={t('filter_cat')} value={cat} options={['all', ...CATEGORIES]} onPick={setCat} name={(o) => (o === 'all' ? t('all') : t(`cat_${o}`))} />
            <Chips label={t('filter_tier')} value={tier} options={['all', ...TIERS]} onPick={setTier} name={(o) => (o === 'all' ? t('all') : t(`tier_${o}`))} />
            <Chips label={t('filter_state')} value={state} options={['all', 'got', 'locked']} onPick={(v) => setState(v)} name={(o) => (o === 'all' ? t('all') : o === 'got' ? t('state_got') : t('state_locked'))} />
            <p className={k.body} style={{ fontSize: 13 }} aria-live="polite">{t('shown', { n: list.length.toLocaleString('en-US') })}</p>
          </section>
          <div ref={box} role="list" aria-label={t('title')} style={{ position: 'relative', height: rows * ROW_H, marginBottom: 40 }}>
            <div style={{
              position: 'absolute', top: first * ROW_H, left: 0, right: 0, display: 'grid',
              gridTemplateColumns: `repeat(${view.cols}, minmax(0, 1fr))`, columnGap: GAP, gridAutoRows: ROW_H,
            }}>
              {cells.map((a) => (
                <div role="listitem" key={a.id}><Badge a={a} got={unlocked.has(a.id)} at={unlocked.get(a.id)} t={t} /></div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
