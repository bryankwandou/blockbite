'use client';

import { useState, useEffect, useRef, useLayoutEffect, Suspense } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import MuteToggle from '@/components/audio/MuteToggle';
import MusicPanel, { MusicIcon } from '@/components/audio/MusicPanel';
import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import styles from './Navbar.module.css';
import { useLang, setLang, useT, LOCALES, type Locale } from '@/lib/i18n';
import { useApp, type Theme } from '@/lib/useApp';
import { PlayerAvatar, useMyAvatar } from './CssAvatars';

const CustomWalletButton = dynamic(
  () => import('./CustomWalletButton'),
  { ssr: false, loading: () => <div className={styles.walletPlaceholder} /> }
);

const NAV_LINKS = [
  { key: 'play',        href: '/game'        },
  { key: 'ranked',      href: '/ranked'      },
  { key: 'leaderboard', href: '/leaderboard' },
  { key: 'shop',        href: '/shop'        },
  { key: 'guide',       href: '/how-to-play' },
] as const;

export function SunIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6" />
    </svg>
  );
}
export function MoonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.5 14.6A8.5 8.5 0 0 1 9.4 3.5a8.5 8.5 0 1 0 11.1 11.1Z" />
    </svg>
  );
}
export function SystemIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" />
    </svg>
  );
}
export function GlobeIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3Z" />
    </svg>
  );
}

export default function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const [musicOpen, setMusicOpen] = useState(false);
  const langRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const lang = useLang();
  const { theme, themePref, setTheme } = useApp();
  const t = useT('nav');
  const myAvatar = useMyAvatar();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Close menus on navigation.
  useEffect(() => { setMenuOpen(false); setLangMenuOpen(false); }, [pathname]);

  // Outside click / Escape closes the language list and the drawer.
  useEffect(() => {
    if (!langMenuOpen && !menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (langMenuOpen && langRef.current && !langRef.current.contains(e.target as Node)) setLangMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setLangMenuOpen(false); setMenuOpen(false); }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [langMenuOpen, menuOpen]);

  const pickLang = (l: Locale) => { setLang(l); setLangMenuOpen(false); };
  const nextTheme = theme === 'dark' ? 'light' : 'dark';
  const themeLabel = theme === 'dark' ? t('switch_to_light') : t('switch_to_dark');
  const isActive = (href: string) => {
    const on = (p: string) => pathname === p || !!pathname?.startsWith(p + '/');
    if (href === '/game') return on('/game') || on('/play') || on('/map');
    return href !== '/' && on(href);
  };

  // Sliding pill under the active desktop link.
  const ulRef = useRef<HTMLUListElement>(null);
  const linkRefs = useRef<Record<string, HTMLAnchorElement | null>>({});
  const pillRef = useRef<HTMLLIElement>(null);
  const measured = useRef(false);
  const activeKey = NAV_LINKS.find((l) => isActive(l.href))?.key ?? null;

  useLayoutEffect(() => {
    const place = () => {
      const pill = pillRef.current;
      if (!pill) return;
      const el = activeKey ? linkRefs.current[activeKey] : null;
      if (!el || el.offsetWidth === 0) { pill.classList.remove(styles.pillVisible); return; }
      if (!measured.current) pill.classList.add(styles.pillInstant);
      const ul = ulRef.current;
      const left = ul ? el.getBoundingClientRect().left - ul.getBoundingClientRect().left - ul.clientLeft : el.offsetLeft;
      pill.style.width = `${el.offsetWidth}px`;
      pill.style.transform = `translateX(${left}px)`;
      pill.classList.add(styles.pillVisible);
      if (!measured.current) {
        measured.current = true;
        void pill.offsetWidth; // flush so the first placement does not animate
        pill.classList.remove(styles.pillInstant);
      }
    };
    place();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : null;
    if (ro && ulRef.current) ro.observe(ulRef.current);
    window.addEventListener('resize', place);
    let cancelled = false;
    document.fonts?.ready.then(() => { if (!cancelled) place(); });
    return () => { cancelled = true; ro?.disconnect(); window.removeEventListener('resize', place); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, activeKey, lang]);

  const THEMES: { id: Theme; label: string; icon: React.ReactNode }[] = [
    { id: 'light', label: t('theme_light'), icon: <SunIcon /> },
    { id: 'dark', label: t('theme_dark'), icon: <MoonIcon /> },
    { id: 'system', label: t('theme_system'), icon: <SystemIcon /> },
  ];

  return (
    <nav className={`${styles.nav} ${scrolled ? styles.scrolled : ''}`} aria-label={t('main_nav')}>
      <div className={styles.inner}>

        <Link href="/" className={styles.logo} aria-label={t('home')}>
          <span className={styles.logoMark}>
            <Image src="/logo.png" alt="" width={40} height={40} priority />
          </span>
          {/* Wordmark drawn by CSS (::before/::after): it is the brand, never translated. */}
          <span className={styles.logoText} aria-hidden="true" />
        </Link>

        <ul className={styles.links} ref={ulRef}>
          <li className={styles.pill} ref={pillRef} aria-hidden="true" />
          {NAV_LINKS.map((link) => (
            <li key={link.key}>
              <Link
                href={link.href}
                ref={(el) => { linkRefs.current[link.key] = el; }}
                className={`${styles.link} ${isActive(link.href) ? styles.active : ''}`}
                aria-current={isActive(link.href) ? 'page' : undefined}
              >
                {t(link.key)}
              </Link>
            </li>
          ))}
        </ul>

        <div className={styles.right}>
          <div className={`${styles.langMenuContainer} ${styles.deskOnly}`} ref={langRef}>
            <button
              type="button"
              className={styles.iconToggle}
              onClick={() => setLangMenuOpen((o) => !o)}
              aria-label={t('change_language')}
              aria-haspopup="listbox"
              aria-expanded={langMenuOpen}
              title={t('change_language')}
            >
              <GlobeIcon />
              <span className={styles.langCode}>{lang.split('-')[0].toUpperCase()}</span>
            </button>
            {langMenuOpen && (
              <div className={styles.langDropdown} role="listbox" aria-label={t('language')}>
                {LOCALES.map((l) => (
                  <button
                    key={l.code}
                    type="button"
                    role="option"
                    aria-selected={l.code === lang}
                    lang={l.code}
                    dir={l.dir}
                    className={`${styles.langOption} ${l.code === lang ? styles.langOptionActive : ''}`}
                    onClick={() => pickLang(l.code)}
                  >
                    {l.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            className={styles.iconToggle}
            onClick={() => { setMenuOpen(false); setMusicOpen(true); }}
            aria-label={t('music_open')}
            aria-haspopup="dialog"
            aria-expanded={musicOpen}
            title={t('music_open')}
          >
            <MusicIcon />
          </button>

          <MuteToggle className={styles.iconToggle} />

          <button
            type="button"
            className={`${styles.iconToggle} ${styles.deskOnly}`}
            onClick={() => setTheme(nextTheme)}
            aria-label={themeLabel}
            title={themeLabel}
          >
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>

          <Link
            href="/profile"
            aria-label={t('profile')}
            title={t('profile')}
            style={{ display: 'inline-flex', flexShrink: 0, borderRadius: 10, lineHeight: 0 }}
          >
            <PlayerAvatar id={myAvatar} size={30} />
          </Link>

          <div className={styles.walletSlot}>
            <CustomWalletButton />
          </div>

          <button
            type="button"
            className={`${styles.menuToggle} ${menuOpen ? styles.menuToggleOpen : ''}`}
            onClick={() => setMenuOpen((o) => !o)}
            aria-label={menuOpen ? t('close_menu') : t('open_menu')}
            aria-expanded={menuOpen}
            aria-controls="bb-mobile-menu"
          >
            <span /><span /><span />
          </button>
        </div>
      </div>

      {menuOpen && (
        <div className={styles.mobileMenu} id="bb-mobile-menu">
          <div className={styles.mobileLinks}>
            {NAV_LINKS.map((link, i) => (
              <Link
                key={link.key}
                href={link.href}
                className={`${styles.mobileLink} ${isActive(link.href) ? styles.active : ''}`}
                style={{ animationDelay: `${i * 30}ms` }}
                onClick={() => setMenuOpen(false)}
              >
                <span className={styles.mobileDot} aria-hidden="true" />
                {t(link.key)}
              </Link>
            ))}
            <Link
              href="/settings"
              className={`${styles.mobileLink} ${isActive('/settings') ? styles.active : ''}`}
              style={{ animationDelay: `${NAV_LINKS.length * 30}ms` }}
              onClick={() => setMenuOpen(false)}
            >
              <span className={styles.mobileDot} aria-hidden="true" />
              {t('settings')}
            </Link>
          </div>

          <button
            type="button"
            className={styles.mobileLink}
            style={{ animationDelay: `${(NAV_LINKS.length + 1) * 30}ms`, background: 'none', border: 0, font: 'inherit', textAlign: 'start', cursor: 'pointer' }}
            onClick={() => { setMenuOpen(false); setMusicOpen(true); }}
          >
            <span className={styles.mobileDot} aria-hidden="true" />
            {t('music')}
          </button>

          <div className={styles.mobilePrefs}>
            <label className={styles.prefRow}>
              <span className={styles.prefLabel}><GlobeIcon />{t('language')}</span>
              <select
                className={styles.langSelect}
                value={lang}
                onChange={(e) => setLang(e.target.value as Locale)}
              >
                {LOCALES.map((l) => (
                  <option key={l.code} value={l.code}>{l.name}</option>
                ))}
              </select>
            </label>
            <div className={styles.prefRow}>
              <span className={styles.prefLabel}>{t('theme')}</span>
              <div className={styles.themeSeg} role="radiogroup" aria-label={t('theme')}>
                {THEMES.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    role="radio"
                    aria-checked={themePref === o.id}
                    aria-label={o.label}
                    title={o.label}
                    className={`${styles.themeOpt} ${themePref === o.id ? styles.themeOptOn : ''}`}
                    onClick={() => setTheme(o.id)}
                  >
                    {o.icon}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
      <Suspense fallback={null}><MusicPanel open={musicOpen} onClose={() => setMusicOpen(false)} /></Suspense>
    </nav>
  );
}
