'use client';

/**
 * UI translations.
 *
 *   const t = useT('shop');
 *   t('buy_button')                 → "Buy"
 *   t('tickets_left', { n: 3 })     → "3 tickets left"   ({n} placeholders)
 *
 * The language is shared app-wide (localStorage 'bb:lang', else the browser
 * language). Missing keys fall back to English, then to the key itself.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { DEFAULT_LOCALE, isLocale, LOCALES, matchLocale, type Locale } from './locales';
import { EN, type Namespace } from './registry';

export { LOCALES, type Locale } from './locales';
export type { Namespace } from './registry';

const KEY = 'bb:lang';
let current: Locale | null = null;
const listeners = new Set<() => void>();
const cache = new Map<string, Record<string, string>>();

function detect(): Locale {
  try {
    const saved = localStorage.getItem(KEY);
    if (isLocale(saved)) return saved;
  } catch { /* storage blocked */ }
  for (const tag of typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language]) {
    const m = tag && matchLocale(tag);
    if (m) return m;
  }
  return DEFAULT_LOCALE;
}

function applyToDocument(l: Locale) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = l;
  document.documentElement.dir = LOCALES.find((x) => x.code === l)?.dir ?? 'ltr';
}

export function getLang(): Locale {
  if (current === null) {
    current = typeof window === 'undefined' ? DEFAULT_LOCALE : detect();
    applyToDocument(current);
  }
  return current;
}

export function setLang(l: Locale) {
  current = l;
  try {
    localStorage.setItem(KEY, l);
  } catch { /* storage blocked */ }
  applyToDocument(l);
  listeners.forEach((f) => f());
}

function subscribe(f: () => void) {
  listeners.add(f);
  return () => listeners.delete(f);
}

export function useLang(): Locale {
  return useSyncExternalStore(subscribe, getLang, () => DEFAULT_LOCALE);
}

async function load(ns: Namespace, lang: Locale) {
  const k = `${ns}:${lang}`;
  if (cache.has(k)) return;
  try {
    cache.set(k, (await import(`./messages/${ns}/${lang}.json`)).default);
  } catch {
    cache.set(k, {});
  }
}

export function useT(ns: Namespace) {
  const lang = useLang();
  const [, bump] = useState(0);
  useEffect(() => {
    if (lang !== 'en' && !cache.has(`${ns}:${lang}`)) load(ns, lang).then(() => bump((x) => x + 1));
  }, [ns, lang]);
  return useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const s = (lang !== 'en' ? cache.get(`${ns}:${lang}`)?.[key] : undefined) ?? EN[ns]?.[key] ?? key;
      if (!vars) return s;
      // {n|one|other}: English-style plural chosen by Intl.PluralRules for the active language.
      const plural = (v: string, forms: string) => {
        const [one, other] = forms.split('|');
        return new Intl.PluralRules(lang).select(Number(vars[v])) === 'one' ? one : (other ?? one);
      };
      return s
        .replace(/\{(\w+)\|([^{}]*)\}/g, (_, v, forms) => plural(v, forms))
        .replace(/\{(\w+)\}/g, (_, v) => String(vars[v] ?? `{${v}}`));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ns, lang, cache.get(`${ns}:${lang}`)],
  );
}
