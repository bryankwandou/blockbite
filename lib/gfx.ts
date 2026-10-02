/**
 * Graphics quality. The resolved level lives on <html data-gfx="low|balanced|high">
 * so CSS and the game renderer can both read it.
 *
 * Preference ('bb:gfx'): auto | low | balanced | high.
 * Auto result is cached in 'bb:gfx-auto' so the pre-paint script can use it.
 */

export type GfxLevel = 'low' | 'balanced' | 'high';
export type GfxPref = 'auto' | GfxLevel;

const KEY = 'bb:gfx';
const AUTO_KEY = 'bb:gfx-auto';
const LEVELS: GfxLevel[] = ['low', 'balanced', 'high'];
const listeners = new Set<() => void>();

const isLevel = (v: unknown): v is GfxLevel => LEVELS.includes(v as GfxLevel);

function ls(k: string, v?: string): string | null {
  try {
    if (v === undefined) return localStorage.getItem(k);
    localStorage.setItem(k, v);
  } catch { /* storage blocked */ }
  return null;
}

export function getGfxPref(): GfxPref {
  if (typeof window === 'undefined') return 'auto';
  const q = new URLSearchParams(location.search).get('gfx');
  if (isLevel(q)) return q;
  const v = ls(KEY);
  return isLevel(v) ? v : 'auto';
}

export function getGfxLevel(): GfxLevel {
  if (typeof document === 'undefined') return 'balanced';
  const v = document.documentElement.dataset.gfx;
  return isLevel(v) ? v : 'balanced';
}

export function subscribeGfx(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; }

function apply(level: GfxLevel) {
  if (document.documentElement.dataset.gfx !== level) document.documentElement.dataset.gfx = level;
  listeners.forEach((f) => f());
}

/** Quick guess from hardware hints; no measurement. */
export function guessGfx(): GfxLevel {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const cores = nav.hardwareConcurrency || 4;
  const mem = nav.deviceMemory ?? 4;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduced || cores <= 2 || mem <= 2) return 'low';
  if (cores >= 8 && mem >= 8) return 'high';
  return 'balanced';
}

/** Count frames for ~1s and return frames/second. */
export function probeFps(ms = 1000): Promise<number> {
  return new Promise((resolve) => {
    let frames = 0;
    const start = performance.now();
    const loop = (now: number) => {
      frames++;
      if (now - start < ms) requestAnimationFrame(loop);
      else resolve((frames * 1000) / (now - start));
    };
    requestAnimationFrame(loop);
  });
}

let probing = false;

/** Resolves once the page has loaded and the main thread has had a quiet moment. */
function settled(): Promise<void> {
  const idle = () => new Promise<void>((r) => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void };
    if (w.requestIdleCallback) w.requestIdleCallback(() => r(), { timeout: 3000 });
    else setTimeout(r, 1500);
  });
  if (document.readyState === 'complete') return idle();
  return new Promise((r) => window.addEventListener('load', () => void idle().then(r), { once: true }));
}

const LOWER: Record<GfxLevel, GfxLevel> = { high: 'balanced', balanced: 'low', low: 'low' };

/**
 * Resolve Auto: hardware guess first, then refine with an FPS probe taken after
 * load (hydration, fonts and wallet scripts make the first second janky on any
 * laptop). A slow probe is re-taken before trusting it, and steps down one level
 * at a time, so a busy start never turns every animation off.
 */
export async function runAutoGfx(): Promise<GfxLevel> {
  let level = guessGfx();
  const cached = ls(AUTO_KEY);
  apply(isLevel(cached) ? cached : level);
  if (probing) return level;
  probing = true;
  try {
    await settled();
    if (document.visibilityState !== 'visible') return level;
    let fps = await probeFps(1500);
    if (fps < 55) fps = Math.max(fps, await probeFps(1500));
    if (fps < 30) level = LOWER[level];
    else if (fps < 55 && level === 'high') level = 'balanced';
    if (getGfxPref() === 'auto') { ls(AUTO_KEY, level); apply(level); }
  } finally { probing = false; }
  return level;
}

export function setGfxPref(p: GfxPref) {
  ls(KEY, p);
  if (p === 'auto') void runAutoGfx();
  else apply(p);
}

/** Call once after mount. */
export function initGfx() {
  if (getGfxPref() === 'auto') void runAutoGfx();
  else apply(getGfxPref() as GfxLevel);
}

/** Inline, pre-paint version (string for layout.tsx). Keep in sync with guessGfx. */
export const GFX_INIT_SCRIPT = `(function(){try{var d=document.documentElement,L=['low','balanced','high'],p=null,a=null;
try{p=localStorage.getItem('${KEY}');a=localStorage.getItem('${AUTO_KEY}')}catch(e){}
var q=new URLSearchParams(location.search).get('gfx');if(L.indexOf(q)>=0)p=q;
var g;if(L.indexOf(p)>=0)g=p;else if(L.indexOf(a)>=0)g=a;else{var n=navigator,c=n.hardwareConcurrency||4,m=n.deviceMemory||4,r=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
g=(r||c<=2||m<=2)?'low':(c>=8&&m>=8)?'high':'balanced'}
d.setAttribute('data-gfx',g);
}catch(e){}})();`;
