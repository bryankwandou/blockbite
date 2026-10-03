'use client';

/**
 * Saga-style world map for one act (500 levels of the 500,000).
 *
 * Scrolling is native (a tall spacer inside an overflow container) but every
 * visual moves by transform only: a sticky "stage" holds the sky, three
 * parallax art layers and a tilted ground plane; the plane's world div is
 * translated by -scrollTop. Only nodes within about one screen of the
 * viewport are mounted, in chunks of CHUNK, so the DOM stays small at any
 * level. Positions are a pure function of the level number (sagaLayout).
 *
 * Quality: html[data-gfx='low'] → flat, no parallax, no looping animation.
 * prefers-reduced-motion → no looping animation, no walk, instant jumps.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Biome } from '@/lib/game/biomes';
import { TOTAL_ACTS, biomeForLevel } from '@/lib/game/biomes';
import { useT } from '@/lib/i18n';
import { useNumber } from '@/components/game/useNumber';
import {
  CHUNK, NODE_DY_MOBILE, NODE_DY_WIDE, TILE,
  biomeLayers, decoUri, mix, nodeKind, nodeX, nodeY, seasonFor, worldHeight, type Season,
} from './sagaLayout';
import { PlayerAvatar, useMyAvatar } from '@/components/CssAvatars';
import css from './SagaMap.module.css';

interface Props {
  biome: Biome;
  /** The player's real highest open level (may lie outside this act). */
  playerLevel: number;
  compact: boolean;
  onEnterLevel: (level: number) => void;
  titleFor: (level: number) => string;
}

const SEEN_KEY = 'bb_map_seen_level';
const STARS_KEY = 'bb_stars'; // JSON { "<level>": 1|2|3 } — written by the play screen when available

function readStars(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(STARS_KEY) ?? '{}') ?? {}; } catch { return {}; }
}

const isLowGfx = () => typeof document !== 'undefined' && document.documentElement.dataset.gfx === 'low';
const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export default function SagaMap({ biome, playerLevel, compact, onEnterLevel, titleFor }: Props) {
  const t = useT('map');
  const { num } = useNumber();
  const router = useRouter();
  const myAvatar = useMyAvatar();

  const first = biome.range[0];
  const total = biome.range[1] - first + 1;
  const dy = compact ? NODE_DY_MOBILE : NODE_DY_WIDE;
  const H = worldHeight(total, dy);
  const curIdx = Math.max(-1, Math.min(total, playerLevel - first)); // -1: act not reached, total: act done
  const inAct = curIdx >= 0 && curIdx < total;

  const scrollRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const farRef = useRef<HTMLDivElement>(null);
  const midRef = useRef<HTMLDivElement>(null);
  const foreRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [win, setWin] = useState({ start: Math.max(0, curIdx - 12), end: Math.min(total, curIdx + 18) });
  const [stars, setStars] = useState<Record<string, number>>({});
  const [season, setSeason] = useState<Season>(null);
  const [mascotIdx, setMascotIdx] = useState(Math.max(0, Math.min(total - 1, curIdx)));
  const [jump, setJump] = useState(String(biome.act));

  // Scenery is drawn for the real stage width (rounded so resizing does not
  // redraw every pixel), so props keep their shape on any screen.
  const artW = Math.round((size.w || 360) / 40) * 40;
  const layers = useMemo(() => biomeLayers(biome, artW), [biome, artW]);

  useEffect(() => {
    setStars(readStars());
    setSeason(seasonFor(new Date().getMonth()));
  }, []);

  // Measure the viewport (stage = scroll container's box).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setSize((p) => (p.w === el.clientWidth && p.h === el.clientHeight ? p : { w: el.clientWidth, h: el.clientHeight }));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // One frame-coalesced scroll handler: transforms + (rarely) the node window.
  const apply = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !size.h) return;
    const s = el.scrollTop;
    if (worldRef.current) worldRef.current.style.transform = `translate3d(0,${-s}px,0)`;
    if (!isLowGfx()) {
      const lay = (n: HTMLDivElement | null, f: number) => {
        if (n) n.style.transform = `translate3d(0,${((H - s) * f) % TILE}px,0)`;
      };
      lay(farRef.current, 0.12);
      lay(midRef.current, 0.35);
      lay(foreRef.current, 1.25);
    }
    // Index range visible: y in [s - h (tilt shows further up), s + h + 200].
    const iTop = Math.ceil((H - 150 - (s - size.h * 1.1)) / dy);
    const iBot = Math.floor((H - 150 - (s + size.h + 200)) / dy);
    const start = Math.max(0, Math.floor(iBot / CHUNK) * CHUNK);
    const end = Math.min(total, Math.ceil((iTop + 1) / CHUNK) * CHUNK);
    setWin((p) => (p.start === start && p.end === end ? p : { start, end }));
  }, [H, dy, size.h, total]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const on = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; apply(); }); };
    el.addEventListener('scroll', on, { passive: true });
    apply();
    return () => { el.removeEventListener('scroll', on); cancelAnimationFrame(raf); };
  }, [apply]);

  const scrollToIdx = useCallback((idx: number, smooth: boolean) => {
    const el = scrollRef.current;
    if (!el || !size.h) return;
    const top = Math.max(0, nodeY(idx, total, dy) - size.h * 0.62);
    el.scrollTo({ top, behavior: smooth && !reducedMotion() ? 'smooth' : 'auto' });
    apply();
  }, [apply, dy, size.h, total]);

  // Park the camera on the player once the stage has a size; then walk the mascot.
  const parked = useRef(false);
  useEffect(() => {
    if (!size.h || parked.current) return;
    parked.current = true;
    const target = Math.max(0, Math.min(total - 1, curIdx));
    scrollToIdx(target, false);
    let seen = NaN;
    try { seen = parseInt(localStorage.getItem(SEEN_KEY) ?? '', 10); } catch { /* blocked */ }
    const from = seen - first;
    if (inAct && Number.isFinite(from) && from >= 0 && from < curIdx && curIdx - from <= 3 && !reducedMotion()) {
      setMascotIdx(from);
      const tm = setTimeout(() => setMascotIdx(curIdx), 450);
      return () => clearTimeout(tm);
    }
    setMascotIdx(target);
  }, [size.h]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    try { if (playerLevel > 0) localStorage.setItem(SEEN_KEY, String(playerLevel)); } catch { /* blocked */ }
  }, [playerLevel]);

  const w = size.w || 360;
  const nodes = [];
  for (let i = win.start; i < win.end; i++) {
    const level = first + i;
    nodes.push({ i, level, x: nodeX(level, w), y: nodeY(i, total, dy) });
  }

  // Path for the mounted window only, in a box just tall enough to hold it.
  let path = null;
  if (nodes.length > 1) {
    const top = nodes[nodes.length - 1].y - dy;
    const bot = nodes[0].y + dy;
    const pts = [
      { x: nodeX(first + win.start - 1, w), y: nodes[0].y + dy },
      ...nodes,
      { x: nodeX(first + win.end, w), y: nodes[nodes.length - 1].y - dy },
    ].map((p) => ({ x: p.x, y: p.y - top }));
    let d = `M${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
    for (let k = 1; k < pts.length - 1; k++) {
      const mx = (pts[k].x + pts[k + 1].x) / 2, my = (pts[k].y + pts[k + 1].y) / 2;
      d += `Q${pts[k].x.toFixed(1)} ${pts[k].y.toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
    }
    path = (
      <svg className={css.path} width={w} height={bot - top} style={{ transform: `translate3d(0,${top}px,0)` }} aria-hidden>
        <path d={d} className={css.landShadow} />
        <path d={d} className={css.land} />
        <path d={d} className={css.landLit} />
        <path d={d} className={css.pathEdge} />
        <path d={d} className={css.pathBody} stroke={biome.path} />
        <path d={d} className={css.pathDash} />
      </svg>
    );
  }

  // The pin says "you are here", so it only appears in the act the player is in.
  const mascotOn = inAct && mascotIdx >= win.start - CHUNK && mascotIdx < win.end + CHUNK && total > 0;
  const mx = nodeX(first + mascotIdx, w), my = nodeY(mascotIdx, total, dy);

  const goAct = (e: React.FormEvent) => {
    e.preventDefault();
    const n = Math.max(1, Math.min(TOTAL_ACTS, parseInt(jump, 10) || 1));
    router.push(`/map/${n}`);
  };
  const goMine = () => {
    if (inAct) scrollToIdx(curIdx, true);
    else router.push(`/map/${biomeForLevel(playerLevel).act}`);
  };

  const vars = {
    '--accent': biome.accent, '--glow': biome.glow, '--rock': biome.rock, '--fog': biome.fog,
    '--land': mix(biome.rock, biome.accent, 0.24), '--land-lit': mix(biome.rock, biome.accent, 0.42),
    '--land-shadow': mix(biome.rock, '#000000', 0.5),
  } as React.CSSProperties;

  return (
    <div className={css.root} style={vars}>
      <div ref={scrollRef} className={css.scroller}>
        <div className={css.stage} style={{ height: size.h || '100%' }}>
          <div className={css.sky} style={{ background: biome.sky }} />
          {season === 'harvest' && <div className={css.moon} aria-hidden />}
          <div ref={farRef} className={`${css.layer} ${css.far}`} style={{ backgroundImage: layers.far }} aria-hidden />
          <div ref={midRef} className={`${css.layer} ${css.mid}`} style={{ backgroundImage: layers.mid }} aria-hidden />
          <div className={css.clouds} aria-hidden><i /><i /></div>
          <div className={css.camera}>
            <div className={css.plane}>
              <div ref={worldRef} className={css.world}>
                {path}
                {nodes.map((n) => {
                  const cleared = n.level < playerLevel;
                  const current = n.level === playerLevel;
                  const open = cleared || current;
                  const kind = nodeKind(n.level);
                  const st = Math.max(0, Math.min(3, stars[n.level] ?? 0));
                  const label = open
                    ? t('level_n', { n: num(n.level) })
                    : t('level_locked', { n: num(n.level) });
                  return (
                    <div key={n.i} className={css.slot} style={{ transform: `translate3d(${n.x}px,${n.y}px,0)` }}>
                      <button
                        type="button"
                        className={`${css.node} ${current ? css.current : cleared ? css.cleared : css.locked} ${kind === 'boss' ? css.boss : ''}`}
                        disabled={!open}
                        aria-label={kind === 'boss' ? `${label} · ${t('boss')}` : label}
                        onClick={() => onEnterLevel(n.level)}
                      >
                        {n.level}
                      </button>
                      {cleared && <span className={css.stars} aria-hidden>{'★'.repeat(st) + '☆'.repeat(3 - st)}</span>}
                      {kind === 'boss' && <span className={`${css.prop} ${css.crown}`} aria-hidden />}
                      {kind === 'chest' && <span className={`${css.prop} ${css.chest} ${cleared ? css.chestOpen : ''}`} title={t('chest')} aria-hidden />}
                      {kind === 'plain' && n.level % 3 === 0 && (
                        <span
                          className={`${css.prop} ${css.deco}`}
                          style={{ [n.x > w / 2 ? 'right' : 'left']: 30, backgroundImage: decoUri(biome, n.level) }}
                          aria-hidden
                        />
                      )}
                      {kind === 'sign' && (
                        <span className={css.sign} style={{ [n.x > w / 2 ? 'right' : 'left']: 34 }} aria-hidden>
                          {titleFor(n.level)}
                        </span>
                      )}
                    </div>
                  );
                })}
                {mascotOn && (
                  <div className={css.mascot} style={{ transform: `translate3d(${mx}px,${my}px,0)` }} aria-hidden>
                    {/* The player's own avatar marks where they are, like a photo pin on a saga map. */}
                    <div className={css.pin}>
                      <span className={css.pinFrame}><PlayerAvatar id={myAvatar} size={46} /></span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div ref={foreRef} className={`${css.layer} ${css.fore}`} style={{ backgroundImage: layers.fore }} aria-hidden />
          <div className={css.sparkles} aria-hidden />
          {season === 'snow' && <div className={css.snow} aria-hidden />}
          <div className={css.vignette} aria-hidden />
        </div>
        <div style={{ height: Math.max(0, H - (size.h || 0)) }} aria-hidden />
      </div>

      <div className={css.hud}>
        {season && <span className={css.season}>{t(`season_${season}`)}</span>}
        <form className={css.jump} onSubmit={goAct}>
          <label className={css.jumpLabel} htmlFor="bb-act-jump">{t('jump_act')}</label>
          <input
            id="bb-act-jump" className={css.jumpInput} type="number" inputMode="numeric"
            min={1} max={TOTAL_ACTS} value={jump} onChange={(e) => setJump(e.target.value)}
          />
          <button type="submit" className={css.hudBtn}>{t('go')}</button>
        </form>
        <button type="button" className={`${css.hudBtn} ${css.mine}`} onClick={goMine}>{t('my_level')}</button>
      </div>
    </div>
  );
}
