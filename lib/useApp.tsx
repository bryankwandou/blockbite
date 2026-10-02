'use client';
import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { useLang, setLang as setI18nLang, useT, type Locale } from './i18n';

export type Theme = 'system' | 'light' | 'dark';

export type Palette = {
  bg: string; surface: string; surface2: string;
  text: string; textDim: string; border: string;
  accent: string; accent2: string;
  warn: string; danger: string; ok: string;
  headerGrad: string;
};

export const PALETTES: Record<'light' | 'dark', Palette> = {
  dark: {
    bg: '#08081a', surface: 'rgba(255,255,255,0.04)', surface2: 'rgba(0,0,0,0.35)',
    text: '#fff', textDim: '#94a3b8', border: '#1f1f3a',
    accent: '#a78bfa', accent2: '#5eead4',
    warn: '#fbbf24', danger: '#ef4444', ok: '#22c55e',
    headerGrad: 'linear-gradient(180deg,#1e1b4b 0%,#08081a 100%)',
  },
  light: {
    bg: '#f7f7fb', surface: 'rgba(0,0,0,0.04)', surface2: 'rgba(255,255,255,0.8)',
    text: '#0a0a14', textDim: '#475569', border: '#e2e8f0',
    accent: '#6d28d9', accent2: '#0d9488',
    warn: '#b45309', danger: '#b91c1c', ok: '#15803d',
    headerGrad: 'linear-gradient(180deg,#ede9fe 0%,#f7f7fb 100%)',
  },
};

type AppCtx = {
  lang: Locale; setLang: (l: Locale) => void;
  /** Resolved theme actually shown. */
  theme: 'light' | 'dark';
  /** What the user picked ('system' follows the OS). */
  themePref: Theme;
  setTheme: (t: Theme) => void;
  reduceMotion: boolean; setReduceMotion: (on: boolean) => void;
  /** Legacy lookup for old flat keys; prefer useT(namespace). */
  t: (k: string) => string;
  palette: Palette;
};

const Ctx = createContext<AppCtx | null>(null);

const THEME_KEY = 'bb:theme';
const MOTION_KEY = 'bb:reduce-motion';

function store(k: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
  } catch { /* storage blocked */ }
}
function read(k: string): string | null {
  try { return localStorage.getItem(k); } catch { return null; }
}
function systemTheme(): 'light' | 'dark' {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
function applyTheme(th: 'light' | 'dark') {
  const d = document.documentElement;
  d.setAttribute('data-theme', th);
  d.style.colorScheme = th;
}

// Old flat keys still used by a few pages → namespaced keys.
const LEGACY: Record<string, ['nav' | 'settings' | 'common', string]> = {
  nav_home: ['nav', 'home'], nav_play: ['nav', 'play'], nav_map: ['nav', 'play'],
  nav_shop: ['nav', 'shop'], nav_leader: ['nav', 'leaderboard'], nav_profile: ['nav', 'profile'],
  settings_title: ['settings', 'title'], language: ['nav', 'language'], theme: ['nav', 'theme'],
  dark: ['nav', 'theme_dark'], light: ['nav', 'theme_light'], system: ['nav', 'theme_system'],
  motion: ['settings', 'reduce_motion'], disconnect: ['nav', 'disconnect'],
  connect: ['nav', 'connect_wallet'], no_data: ['common', 'no_data'], empty_lb: ['common', 'no_data'],
  empty_hist: ['common', 'no_data'], backend_off: ['common', 'error'],
};

export function AppProvider({ children }: { children: ReactNode }) {
  const lang = useLang();
  const tNav = useT('nav');
  const tSettings = useT('settings');
  const tCommon = useT('common');
  // Server and first client render agree on 'dark'; the real value is read after mount
  // from <html data-theme>, which the inline init script in app/layout.tsx already set.
  const [theme, setThemeState] = useState<'light' | 'dark'>('dark');
  const [themePref, setThemePref] = useState<Theme>('system');
  const [reduceMotion, setReduceMotionState] = useState(false);

  useEffect(() => {
    const saved = read(THEME_KEY);
    const pref: Theme = saved === 'light' || saved === 'dark' ? saved : 'system';
    const attr = document.documentElement.getAttribute('data-theme');
    const resolved = attr === 'light' || attr === 'dark' ? attr : pref === 'system' ? systemTheme() : pref;
    setThemePref(pref);
    setThemeState(resolved);
    applyTheme(resolved);
    const rm = read(MOTION_KEY) === '1';
    setReduceMotionState(rm);
  }, []);

  // Follow the OS while the preference is 'system'.
  useEffect(() => {
    if (themePref !== 'system' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const on = () => { const th = mq.matches ? 'light' : 'dark'; setThemeState(th); applyTheme(th); };
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, [themePref]);

  const setLang = useCallback((l: Locale) => setI18nLang(l), []);

  const setTheme = useCallback((th: Theme) => {
    const resolved = th === 'system' ? systemTheme() : th;
    store(THEME_KEY, th === 'system' ? null : th);
    setThemePref(th);
    setThemeState(resolved);
    applyTheme(resolved);
  }, []);

  const setReduceMotion = useCallback((on: boolean) => {
    store(MOTION_KEY, on ? '1' : null);
    setReduceMotionState(on);
    if (on) document.documentElement.setAttribute('data-reduce-motion', 'true');
    else document.documentElement.removeAttribute('data-reduce-motion');
  }, []);

  const t = useCallback((k: string) => {
    const m = LEGACY[k];
    if (!m) return k;
    const [ns, key] = m;
    return ns === 'nav' ? tNav(key) : ns === 'settings' ? tSettings(key) : tCommon(key);
  }, [tNav, tSettings, tCommon]);

  return (
    <Ctx.Provider value={{
      lang, setLang, theme, themePref, setTheme,
      reduceMotion, setReduceMotion,
      t,
      palette: PALETTES[theme],
    }}>
      {children}
    </Ctx.Provider>
  );
}

export const useApp = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApp must be inside AppProvider');
  return c;
};
