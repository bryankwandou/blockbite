'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n';
import Navbar from '@/components/Navbar';
import PlayTogetherCard from '@/components/versus/PlayTogetherCard';
import InstallButtons from '@/components/InstallButtons';
import s from './page.module.css';

// The PNG filenames pre-date the final art, so each file is paired here with the
// character it actually shows.
const CREW = {
  rex:     '/mascots/mascot-brawler.png', // purple crowned king
  tide:    '/mascots/mascot-sunny.png',   // teal cube, waving
  brawler: '/mascots/mascot-rex.png',     // red blocky fighter
  sunny:   '/mascots/mascot-tide.png',    // yellow happy cube
};

/* ── Mini board: tap the gap, watch the row clear ───────────────────── */

// 0 = empty, 1..6 = block colour. Row 5 is one tap from a clear.
const START: number[] = [
  0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 3, 3, 0, 0, 0, 0,
  0, 0, 3, 0, 0, 5, 5, 0,
  1, 0, 0, 0, 0, 5, 5, 0,
  1, 1, 0, 0, 2, 0, 0, 0,
  4, 4, 4, 6, 0, 6, 2, 2,
  4, 0, 1, 6, 6, 6, 2, 0,
  4, 0, 1, 1, 0, 0, 2, 0,
];
const GAP = 5 * 8 + 4;

function fullLines(b: number[]) {
  const hit = new Set<number>();
  let lines = 0;
  for (let r = 0; r < 8; r++) {
    if ([0, 1, 2, 3, 4, 5, 6, 7].every((c) => b[r * 8 + c] > 0)) { lines++; for (let c = 0; c < 8; c++) hit.add(r * 8 + c); }
  }
  for (let c = 0; c < 8; c++) {
    if ([0, 1, 2, 3, 4, 5, 6, 7].every((r) => b[r * 8 + c] > 0)) { lines++; for (let r = 0; r < 8; r++) hit.add(r * 8 + c); }
  }
  return { hit, lines };
}

function MiniBoard() {
  const t = useT('home');
  const [board, setBoard] = useState<number[]>(START);
  const [clearing, setClearing] = useState<Set<number>>(new Set());
  const [cheer, setCheer] = useState(0);
  const [placed, setPlaced] = useState(0);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const place = useCallback((i: number) => {
    if (board[i] || clearing.size) return;
    const next = board.slice();
    next[i] = (placed % 6) + 1;
    setPlaced((n) => n + 1);
    const { hit, lines } = fullLines(next);
    setBoard(next);
    if (!lines) return;
    setClearing(hit);
    setCheer((n) => n + 1);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setBoard((b) => b.map((v, k) => (hit.has(k) ? 0 : v)));
      setClearing(new Set());
    }, 420);
  }, [board, clearing, placed]);

  const reset = () => { setBoard(START); setClearing(new Set()); setCheer(0); setPlaced(0); };
  const untouched = board === START;

  return (
    <div className={s.boardWrap}>
      <div className={s.boardPeek} aria-hidden="true">
        <Image src={CREW.rex} alt="" width={132} height={132} priority className={cheer ? s.hop : undefined} key={cheer} />
        {cheer > 0 && <span className={s.bubble} key={`b${cheer}`}>{t('board_cheer')}</span>}
      </div>
      <div className={s.board} role="group" aria-label={t('board_label')}>
        {board.map((v, i) => {
          const isGap = untouched && i === GAP;
          return v ? (
            <span
              key={i}
              className={`${s.cell} ${s.filled} ${clearing.has(i) ? s.clear : ''}`}
              style={{ ['--c' as string]: `var(--ds-block-${v})`, ['--d' as string]: `${(i % 8) * 28}ms` }}
            />
          ) : (
            <button
              key={i}
              type="button"
              tabIndex={isGap ? 0 : -1}
              aria-label={t('board_cell')}
              className={`${s.cell} ${s.empty} ${isGap ? s.gap : ''}`}
              style={{ ['--c' as string]: `var(--ds-block-${(placed % 6) + 1})` }}
              onClick={() => place(i)}
            />
          );
        })}
      </div>
      <div className={s.boardFoot}>
        <span className={s.boardHint}>{untouched ? t('board_hint') : ''}</span>
        {!untouched && (
          <button type="button" className={s.resetBtn} onClick={reset}>{t('board_reset')}</button>
        )}
      </div>
      <Image src={CREW.tide} alt="" width={92} height={92} className={`${s.boardSide} ${s.sideStart}`} aria-hidden="true" />
      <Image src={CREW.brawler} alt="" width={92} height={92} className={`${s.boardSide} ${s.sideEnd}`} aria-hidden="true" />
      <Image src={CREW.sunny} alt="" width={100} height={100} className={s.boardSit} aria-hidden="true" />
    </div>
  );
}

/* ── Scroll reveal: content is visible without JS; JS only adds the entrance ── */
function useReveal(root: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el || !('IntersectionObserver' in window)) return;
    const items = Array.from(el.querySelectorAll<HTMLElement>('[data-reveal]'));
    const vh = window.innerHeight;
    items.forEach((n) => { if (n.getBoundingClientRect().top > vh * 0.9) n.dataset.reveal = 'wait'; });
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) { (e.target as HTMLElement).dataset.reveal = 'in'; io.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px' });
    items.forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, [root]);
}

function XIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.8 3h3.1l-6.8 7.7L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.2-8.3L1.9 3h6.3l4.4 5.9L17.8 3Zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5Z" />
    </svg>
  );
}
function GitHubIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.3-3.4-1.3-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.6 2.4 1.1 3 .8.1-.7.4-1.1.6-1.4-2.2-.2-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.7 1a9.4 9.4 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.4 4.8-4.6 5 .4.3.7.9.7 1.9V21c0 .3.2.6.7.5A10 10 0 0 0 12 2Z" />
    </svg>
  );
}

export default function Home() {
  const t = useT('home');
  const tc = useT('common');
  const tn = useT('nav');
  const root = useRef<HTMLDivElement>(null);
  useReveal(root);

  return (
    <div className={s.page} ref={root}>
      <Navbar />

      {/* ── HERO ── */}
      <section className={s.hero}>
        <div className={s.heroText}>
          <div className={s.brandRow}>
            <Image src="/logo.png" alt="BlockBite" width={84} height={84} priority className={s.heroLogo} />
            <span className={s.kicker}>{t('hero_kicker')}</span>
          </div>
          <h1 className={s.h1}>{t('hero_title')}</h1>
          <p className={s.lede}>{t('hero_sub')}</p>
          <p className={s.boards}>{t('hero_boards')}</p>
          <div className={s.ctas}>
            <Link href="/game" className={`${s.btn} ${s.btnPrimary}`}>{t('cta_adventure')}</Link>
            <a href="#ranked" className={`${s.btn} ${s.btnGhost}`}>{t('cta_ranked')}</a>
          </div>
          <p className={s.status}><span className={s.pulse} aria-hidden="true" />{t('hero_status')}</p>
          <InstallButtons />
        </div>
        <MiniBoard />
      </section>

      {/* ── MODES ── */}
      <section className={s.section}>
        <header className={s.secHead} data-reveal>
          <p className={s.eyebrow}>{t('modes_kicker')}</p>
          <h2 className={s.h2}>{t('modes_title')}</h2>
        </header>
        <div className={s.modes}>
          <article className={`${s.mode} ${s.modeAdv}`} data-reveal>
            <Image src={CREW.tide} alt="" width={120} height={120} className={s.modeMascot} aria-hidden="true" />
            <span className={`${s.tag} ${s.tagOk}`}>{t('adventure_tag')}</span>
            <h3 className={s.h3}>{t('adventure_title')}</h3>
            <p className={s.body}>{t('adventure_body')}</p>
            <Link href="/map" className={s.textLink}>{t('adventure_cta')} <span className={s.arrow} aria-hidden="true">→</span></Link>
          </article>
          <article className={`${s.mode} ${s.modeRanked}`} id="ranked" data-reveal>
            <Image src={CREW.brawler} alt="" width={132} height={132} className={s.modeMascot} aria-hidden="true" />
            <span className={`${s.tag} ${s.tagWait}`}>{t('ranked_tag')}</span>
            <h3 className={s.h3}>{t('ranked_title')}</h3>
            <p className={s.body}>{t('ranked_body')}</p>
            <ul className={s.points}>
              <li>{t('ranked_point_1')}</li>
              <li>{t('ranked_point_2')}</li>
              <li>{t('ranked_point_3')}</li>
            </ul>
            <Link href="/ranked" className={s.textLink}>{t('ranked_cta')} <span className={s.arrow} aria-hidden="true">→</span></Link>
          </article>
        </div>
        <div data-reveal style={{ marginTop: 16 }}><PlayTogetherCard /></div>
      </section>

      {/* ── FINAL CTA ── */}
      <section className={s.final} data-reveal>
        <div className={s.crew} aria-label={t('mascots_label')} role="img">
          {[CREW.rex, CREW.tide, CREW.brawler, CREW.sunny].map((src, i) => (
            <Image key={src} src={src} alt="" width={96} height={96} className={s.crewOne} style={{ animationDelay: `${i * 180}ms` }} />
          ))}
        </div>
        <h2 className={s.finalTitle}>{t('final_title')}</h2>
        <p className={s.lede}>{t('final_sub')}</p>
        <div className={s.ctas}>
          <Link href="/game" className={`${s.btn} ${s.btnPrimary}`}>{t('cta_adventure')}</Link>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className={s.footer}>
        <div className={s.footBrand}>
          <Image src="/logo.png" alt="" width={36} height={36} />
          <div>
            <p className={s.footTag}>{tc('footer_tagline')}</p>
            <p className={s.footSmall}>{tc('footer_rights', { year: 2026 })} · {tc('footer_network')}</p>
          </div>
        </div>
        <nav className={s.footNav} aria-label={tc('footer_info')}>
          <Link href="/game">{tn('play')}</Link>
          <Link href="/ranked">{tn('ranked')}</Link>
          <Link href="/leaderboard">{tn('leaderboard')}</Link>
          <Link href="/how-to-play">{tn('guide')}</Link>
          <Link href="/settings">{tn('settings')}</Link>
        </nav>
        <div className={s.social}>
          <a href="https://x.com/blockbite_gg" target="_blank" rel="noopener noreferrer" aria-label={tc('social_x')} title={tc('social_x')}><XIcon /></a>
          <a href="https://github.com/nayrbryanGaming/blockblast" target="_blank" rel="noopener noreferrer" aria-label={tc('social_github')} title={tc('social_github')}><GitHubIcon /></a>
        </div>
      </footer>
    </div>
  );
}
