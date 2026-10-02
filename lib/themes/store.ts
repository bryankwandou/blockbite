'use client';

/**
 * Chosen palette, persisted in localStorage:
 *   bb:palette   ''            default look (app/globals.css)
 *                '<id>'        a preset from SEEDS
 *                'c:<code>'    a custom/shared theme, e.g. 'c:tide-200-3'
 *   bb:pv-light / bb:pv-dark   validated "--token:#rrggbb;" strings for the custom theme,
 *                              so the pre-paint script in app/layout.tsx can apply it without
 *                              shipping the generator.
 */
import { useSyncExternalStore } from 'react';
import { SEEDS, VAR_STRING_RE, customTokens, encodeCode, parseCode, toVarString, type CustomTheme, type Mode } from './gen';

export * from './gen';

const KEY = 'bb:palette';
const STYLE_ID = 'bb-palette-custom';
const listeners = new Set<() => void>();

function ls(k: string, v?: string): string | null {
  try {
    if (v === undefined) return localStorage.getItem(k);
    if (v === '') localStorage.removeItem(k); else localStorage.setItem(k, v);
  } catch { /* storage blocked */ }
  return null;
}

export function getPalette(): string {
  if (typeof window === 'undefined') return '';
  const v = ls(KEY) ?? '';
  if (v.startsWith('c:')) return parseCode(v.slice(2)) ? v : '';
  return SEEDS.some((s) => s.id === v) ? v : '';
}

function customCss(c: CustomTheme): string {
  return (['light', 'dark'] as Mode[])
    .map((m) => {
      const vars = toVarString(customTokens(c, m));
      return VAR_STRING_RE.test(vars) ? `html:root[data-theme='${m}'][data-palette]{${vars}}` : '';
    })
    .join('');
}

/** Apply to <html> now (no persistence). Used for previews too. */
export function applyPalette(value: string) {
  if (typeof document === 'undefined') return;
  const d = document.documentElement;
  let style = document.getElementById(STYLE_ID);
  const custom = value.startsWith('c:') ? parseCode(value.slice(2)) : null;
  if (custom) {
    d.setAttribute('data-palette', custom.base);
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      document.head.appendChild(style);
    }
    style.textContent = customCss(custom);
  } else {
    style?.remove();
    if (SEEDS.some((s) => s.id === value)) d.setAttribute('data-palette', value);
    else d.removeAttribute('data-palette');
  }
}

export function setPalette(value: string) {
  const custom = value.startsWith('c:') ? parseCode(value.slice(2)) : null;
  if (custom) {
    value = `c:${encodeCode(custom)}`;
    ls('bb:pv-light', toVarString(customTokens(custom, 'light')));
    ls('bb:pv-dark', toVarString(customTokens(custom, 'dark')));
  } else {
    if (!SEEDS.some((s) => s.id === value)) value = '';
    ls('bb:pv-light', '');
    ls('bb:pv-dark', '');
  }
  ls(KEY, value);
  applyPalette(value);
  listeners.forEach((f) => f());
}

function subscribe(f: () => void) {
  listeners.add(f);
  return () => { listeners.delete(f); };
}

export function usePalette(): string {
  return useSyncExternalStore(subscribe, getPalette, () => '');
}

function getMode(): Mode {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}
function subscribeMode(f: () => void) {
  const mo = new MutationObserver(f);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => mo.disconnect();
}
/** Current light/dark mode from <html data-theme>. */
export function useMode(): Mode {
  return useSyncExternalStore(subscribeMode, getMode, () => 'dark');
}
