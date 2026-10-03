/**
 * BlockBite audio: original music and SFX synthesised with the Web Audio API.
 * No audio files. Every track is built around the BlockBite motif
 * ("Block-Block-Bite!": two repeated notes, a leap up, a step down).
 *
 *   import { playSfx } from '@/lib/audio';
 *   playSfx('place'); playSfx('line'); playSfx('combo', 3); playSfx('perfect');
 *   playSfx('gameover'); playSfx('tap');
 *
 * Nothing makes sound until unlockAudio() runs inside a user gesture
 * (MusicController wires that up globally).
 */

import { ALBUM_BY_ID, albumTrackKeys, getTrackDef, type Track } from './albums';
export { ALBUMS, ALBUM_BY_ID, getTrackDef, albumTrackKeys, type Album, type Track } from './albums';
export type TrackId = 'menu' | 'adventure' | 'ranked' | 'monthly';
export type SfxName = 'place' | 'line' | 'combo' | 'perfect' | 'gameover' | 'tap';
export type AudioSettings = { music: number; sfx: number; muted: boolean };

const KEY = 'bb:audio';
const DEFAULTS: AudioSettings = { music: 0.5, sfx: 0.8, muted: false };

/* ── settings store ─────────────────────────────────────────────────── */

let settings: AudioSettings = DEFAULTS;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === 'undefined') return;
  loaded = true;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (raw && typeof raw === 'object') {
      settings = {
        music: clamp01(Number(raw.music ?? DEFAULTS.music)),
        sfx: clamp01(Number(raw.sfx ?? DEFAULTS.sfx)),
        muted: !!raw.muted,
      };
    }
  } catch { /* storage blocked or bad JSON */ }
}

function clamp01(n: number) { return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0; }

export function getAudioSettings(): AudioSettings { load(); return settings; }
const SERVER_SETTINGS = DEFAULTS;
export function getServerAudioSettings(): AudioSettings { return SERVER_SETTINGS; }

export function subscribeAudio(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; }

export function setAudioSettings(patch: Partial<AudioSettings>) {
  load();
  settings = { ...settings, ...patch };
  settings.music = clamp01(settings.music);
  settings.sfx = clamp01(settings.sfx);
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* ignore */ }
  applyVolumes();
  listeners.forEach((f) => f());
}

export function toggleMute() { setAudioSettings({ muted: !getAudioSettings().muted }); }

/* ── engine ─────────────────────────────────────────────────────────── */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let musicBus: GainNode | null = null;
let sfxBus: GainNode | null = null;
let noise: AudioBuffer | null = null;

function applyVolumes() {
  if (!ctx || !master || !musicBus || !sfxBus) return;
  const t = ctx.currentTime;
  master.gain.setTargetAtTime(settings.muted ? 0 : 1, t, 0.03);
  musicBus.gain.setTargetAtTime(settings.music * 0.55, t, 0.05);
  sfxBus.gain.setTargetAtTime(settings.sfx * 0.9, t, 0.02);
}

function ensureCtx(): AudioContext | null {
  if (ctx) return ctx;
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  load();
  ctx = new AC();
  master = ctx.createGain();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 4;
  master.connect(comp).connect(ctx.destination);
  musicBus = ctx.createGain(); musicBus.gain.value = 0; musicBus.connect(master);
  sfxBus = ctx.createGain(); sfxBus.connect(master);
  noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  applyVolumes();
  (window as unknown as { __bbAudio?: unknown }).__bbAudio = { state: () => ctx?.state ?? 'none', track: () => playing };
  return ctx;
}

/** Call from a user gesture. Safe to call many times. */
export function unlockAudio(): Promise<void> {
  const c = ensureCtx();
  if (!c) return Promise.resolve();
  if (c.state === 'suspended') return c.resume().then(() => { if (wanted && !playing && !paused) startContext(); }).catch(() => {});
  if (wanted && !playing && !paused) startContext();
  return Promise.resolve();
}

export function isAudioUnlocked() { return !!ctx && ctx.state === 'running'; }

/* ── synth voices ───────────────────────────────────────────────────── */

const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

function tone(dest: AudioNode, midi: number, at: number, dur: number, wave: OscillatorType, vol: number, opts: { glide?: number; cutoff?: number; detune?: number } = {}) {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = wave;
  o.frequency.setValueAtTime(hz(midi + (opts.glide ?? 0)), at);
  if (opts.glide) o.frequency.exponentialRampToValueAtTime(hz(midi), at + 0.04);
  if (opts.detune) o.detune.value = opts.detune;
  let node: AudioNode = o;
  if (opts.cutoff) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = opts.cutoff; f.Q.value = 2;
    o.connect(f); node = f;
  }
  node.connect(g).connect(dest);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + 0.008);
  g.gain.exponentialRampToValueAtTime(vol * 0.6, at + Math.min(0.08, dur * 0.5));
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.start(at); o.stop(at + dur + 0.02);
}

function kick(dest: AudioNode, at: number, vol = 0.9) {
  if (!ctx) return;
  const o = ctx.createOscillator(); const g = ctx.createGain();
  o.frequency.setValueAtTime(150, at); o.frequency.exponentialRampToValueAtTime(42, at + 0.12);
  g.gain.setValueAtTime(vol, at); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.22);
  o.connect(g).connect(dest); o.start(at); o.stop(at + 0.25);
}

function hiss(dest: AudioNode, at: number, dur: number, vol: number, hp: number) {
  if (!ctx || !noise) return;
  const s = ctx.createBufferSource(); s.buffer = noise;
  const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, at); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  s.connect(f).connect(g).connect(dest);
  s.start(at, Math.random() * 0.5); s.stop(at + dur + 0.02);
}

function tom(dest: AudioNode, at: number, midi: number) {
  if (!ctx) return;
  const o = ctx.createOscillator(); const g = ctx.createGain();
  o.frequency.setValueAtTime(hz(midi + 7), at); o.frequency.exponentialRampToValueAtTime(hz(midi), at + 0.15);
  g.gain.setValueAtTime(0.5, at); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.3);
  o.connect(g).connect(dest); o.start(at); o.stop(at + 0.32);
}


/** scale degree (can be negative or > 6) → semitone offset */
function deg(scale: number[], d: number) {
  const o = Math.floor(d / 7);
  return scale[((d % 7) + 7) % 7] + 12 * o;
}

/* ── playlists ──────────────────────────────────────────────────────── */

export type PlayContext = 'menu' | 'adventure' | 'ranked';
export type RepeatMode = 'all' | 'one' | 'shuffle';
export type Playlist = { album: string; order: string[]; off: string[]; mode: RepeatMode };
export type Playlists = Record<PlayContext, Playlist>;

const PL_KEY = 'bb:playlists';
const CONTEXTS: PlayContext[] = ['menu', 'adventure', 'ranked'];
const DEFAULT_FIRST: Record<PlayContext, string> = { menu: 'classic/menu', adventure: 'classic/adventure', ranked: 'classic/ranked' };

function defaultPlaylist(ctxId: PlayContext, album = 'classic'): Playlist {
  const keys = albumTrackKeys(album);
  const first = DEFAULT_FIRST[ctxId];
  const order = album === 'classic' ? [first, ...keys.filter((k) => k !== first)] : keys;
  // The default album keeps the old behaviour: one theme per mode, looping.
  return { album, order, off: [], mode: album === 'classic' ? 'one' : 'all' };
}

function sanitize(ctxId: PlayContext, p: unknown): Playlist {
  const raw = (p && typeof p === 'object' ? p : {}) as Partial<Playlist>;
  const album = typeof raw.album === 'string' && ALBUM_BY_ID[raw.album] ? raw.album : 'classic';
  const keys = albumTrackKeys(album);
  const base = defaultPlaylist(ctxId, album);
  const order = Array.isArray(raw.order) ? raw.order.filter((k) => keys.includes(k)) : [];
  keys.forEach((k) => { if (!order.includes(k)) order.push(k); });
  const off = Array.isArray(raw.off) ? raw.off.filter((k) => keys.includes(k)) : [];
  const mode: RepeatMode = raw.mode === 'one' || raw.mode === 'shuffle' || raw.mode === 'all' ? raw.mode : base.mode;
  return { album, order: order.length ? order : base.order, off: off.length >= keys.length ? [] : off, mode };
}

let playlists: Playlists = { menu: defaultPlaylist('menu'), adventure: defaultPlaylist('adventure'), ranked: defaultPlaylist('ranked') };
let plLoaded = false;
const SERVER_PLAYLISTS = playlists;

function loadPlaylists() {
  if (plLoaded || typeof window === 'undefined') return;
  plLoaded = true;
  try {
    const raw = JSON.parse(localStorage.getItem(PL_KEY) || 'null');
    if (raw && typeof raw === 'object') {
      playlists = { menu: sanitize('menu', raw.menu), adventure: sanitize('adventure', raw.adventure), ranked: sanitize('ranked', raw.ranked) };
    }
  } catch { /* ignore */ }
}

export function getPlaylists(): Playlists { loadPlaylists(); return playlists; }
export function getServerPlaylists(): Playlists { return SERVER_PLAYLISTS; }

/** Change one context's playlist. Picking a new album resets order/off to that album. */
export function setPlaylist(ctxId: PlayContext, patch: Partial<Playlist>) {
  loadPlaylists();
  const cur = playlists[ctxId];
  const next = patch.album && patch.album !== cur.album
    ? { ...defaultPlaylist(ctxId, patch.album), ...(patch.mode ? { mode: patch.mode } : {}) }
    : sanitize(ctxId, { ...cur, ...patch });
  playlists = { ...playlists, [ctxId]: next };
  try { localStorage.setItem(PL_KEY, JSON.stringify(playlists)); } catch { /* ignore */ }
  playerChanged();
  // If this context is on air, restart it so the change is heard.
  // Reordering or toggling tracks must not cut the song that is playing.
  if (wanted && ctxOf(wanted) === ctxId && !previewing && !paused) {
    const stillValid = !!playing && !patch.album && enabled(next).includes(playing);
    if (!stillValid) { playing = null; startContext(); }
  }
}

export function resetPlaylist(ctxId: PlayContext) { setPlaylist(ctxId, defaultPlaylist(ctxId, playlists[ctxId].album)); }

export const PLAY_CONTEXTS = CONTEXTS;

/* ── sequencer ──────────────────────────────────────────────────────── */

let wanted: TrackId | null = null;
let playing: string | null = null;     // "album/track"
let previewing = false;
let paused = false;
let previewTimer: number | undefined;
let trackGain: GainNode | null = null;
let timer: number | undefined;
let step = 0;
let nextAt = 0;

const playerListeners = new Set<() => void>();
export type NowPlaying = { key: string | null; preview: boolean; paused: boolean };
let nowSnap: NowPlaying = { key: null, preview: false, paused: false };
function playerChanged() {
  if (nowSnap.key !== playing || nowSnap.preview !== previewing || nowSnap.paused !== paused) nowSnap = { key: playing, preview: previewing, paused };
  playerListeners.forEach((f) => f());
}
export function subscribePlayer(f: () => void) { playerListeners.add(f); return () => { playerListeners.delete(f); }; }
export function getNowPlaying() { return nowSnap; }
const SERVER_NOW: NowPlaying = { key: null, preview: false, paused: false };
export function getServerNowPlaying(): NowPlaying { return SERVER_NOW; }

const ctxOf = (id: TrackId): PlayContext => (id === 'monthly' ? 'ranked' : id);

function enabled(p: Playlist) { return p.order.filter((k) => !p.off.includes(k)); }

function firstFor(id: TrackId): string {
  const p = getPlaylists()[ctxOf(id)];
  const list = enabled(p);
  if (id === 'monthly' && p.album === 'classic' && list.includes('classic/monthly')) return 'classic/monthly';
  if (p.mode === 'shuffle') return list[Math.floor(Math.random() * list.length)];
  return list[0];
}

function nextFor(cur: string): string {
  if (!wanted) return cur;
  const p = getPlaylists()[ctxOf(wanted)];
  const list = enabled(p);
  if (!list.length || (p.mode === 'one' && list.includes(cur))) return list.includes(cur) ? cur : list[0];
  if (p.mode === 'shuffle' && list.length > 1) {
    const others = list.filter((k) => k !== cur);
    return others[Math.floor(Math.random() * others.length)];
  }
  const i = list.indexOf(cur);
  return list[(i + 1) % list.length];
}

function scheduleStep(tr: Track, out: GainNode, s: number, at: number) {
  const bar = Math.floor(s / 16) % tr.prog.length;
  const i = s % 16;
  const chord = tr.prog[bar];
  const sixteenth = 60 / tr.bpm / 4;

  const n = tr.lead[bar % tr.lead.length][i];
  if (n !== null && n !== undefined) {
    tone(out, tr.root + deg(tr.scale, n), at, sixteenth * 1.8, tr.leadWave, tr.leadVol, { glide: -1, cutoff: tr.leadWave === 'sawtooth' ? 3200 : undefined });
  }
  const b = tr.bassPattern[i];
  if (b !== null && b !== undefined) {
    tone(out, tr.root - 24 + deg(tr.scale, chord) + (b === 7 ? 12 : b === 4 ? 7 : 0), at, sixteenth * 1.6, tr.bassWave, 0.16, { cutoff: 900 });
  }
  if (tr.arp && i % 2 === 1) {
    const arpDeg = chord + [0, 2, 4, 2][(i >> 1) % 4];
    tone(out, tr.root - 12 + deg(tr.scale, arpDeg), at, sixteenth, 'square', 0.035, { cutoff: 2400 });
  }
  if (tr.pad && i === 0) {
    const len = sixteenth * 16;
    [0, 2, 4].forEach((d) => tone(out, tr.root - 12 + deg(tr.scale, chord + d), at, len, tr.pad!, tr.pad === 'sine' ? 0.05 : 0.025, { cutoff: 1400, detune: d * 3 }));
  }
  if (tr.kick[i] === 'x') kick(out, at);
  if (tr.snare[i] === 'x') { hiss(out, at, 0.14, 0.28, 1800); tone(out, 50, at, 0.08, 'triangle', 0.15); }
  if (tr.hat[i] === 'x') hiss(out, at, 0.035, i % 4 === 2 ? 0.1 : 0.05, 7000);
  if (tr.toms && bar === tr.prog.length - 1 && i >= 12) tom(out, at, 50 - (i - 12) * 2);
}

function tick() {
  if (!ctx || !playing || !trackGain) return;
  let tr = getTrackDef(playing);
  if (!tr) return;
  while (nextAt < ctx.currentTime + 0.15) {
    if (!previewing && step >= (tr.bars ?? 32) * 16) {
      const nxt = nextFor(playing);
      step = 0;
      if (nxt !== playing) { playing = nxt; tr = getTrackDef(playing) ?? tr; playerChanged(); }
    }
    scheduleStep(tr, trackGain, step, nextAt);
    nextAt += 60 / tr.bpm / 4;
    step++;
  }
}

function startKey(key: string) {
  if (!ctx || !musicBus || ctx.state !== 'running') return;
  if (playing === key) return;
  const now = ctx.currentTime;
  if (trackGain) {
    const old = trackGain;
    old.gain.setTargetAtTime(0, now, 0.15);
    window.setTimeout(() => old.disconnect(), 1200);
  }
  trackGain = ctx.createGain();
  trackGain.gain.setValueAtTime(0, now);
  trackGain.gain.linearRampToValueAtTime(1, now + 0.6);
  trackGain.connect(musicBus);
  playing = key;
  step = 0;
  nextAt = now + 0.08;
  if (timer === undefined) timer = window.setInterval(tick, 25);
  playerChanged();
  tick();
}

function startContext() {
  if (!wanted || paused) return;
  const key = firstFor(wanted);
  if (key) startKey(key);
}

/** Ask for the music of a context. It starts as soon as audio is unlocked. */
export function setTrack(id: TrackId | null) {
  const changed = id !== wanted;
  wanted = id;
  if (!id) { stopMusic(); return; }
  if (changed && !previewing && ctx && ctx.state === 'running') { playing = null; startContext(); }
}

/** Play one track right away (the settings preview). Returns to the context after `ms`. */
export function previewTrack(key: string, ms = 20000) {
  if (!getTrackDef(key)) return;
  void unlockAudio().then(() => {
    previewing = true;
    playing = null;
    startKey(key);
    window.clearTimeout(previewTimer);
    previewTimer = window.setTimeout(stopPreview, ms);
  });
}

export function stopPreview() {
  window.clearTimeout(previewTimer);
  if (!previewing) return;
  previewing = false;
  playing = null;
  if (wanted) startContext(); else stopMusic();
  playerChanged();
}

/** The play context (menu / adventure / ranked) whose playlist is on air for this page. */
export function getWantedContext(): PlayContext | null { return wanted ? ctxOf(wanted) : null; }

function enabledForWanted(): string[] { return wanted ? enabled(getPlaylists()[ctxOf(wanted)]) : []; }

/** Play a specific track of the current playlist (not a 20 s preview). */
export function playTrack(key: string) {
  if (!wanted || !getTrackDef(key)) return;
  void unlockAudio().then(() => {
    window.clearTimeout(previewTimer);
    previewing = false;
    paused = false;
    playing = null;
    startKey(key);
    playerChanged();
  });
}

/** Skip to the next (1) or previous (-1) enabled track of the current playlist. */
export function skipTrack(dir: 1 | -1) {
  if (!wanted) return;
  const p = getPlaylists()[ctxOf(wanted)];
  const list = enabled(p);
  if (!list.length) return;
  const cur = playing && list.includes(playing) ? list.indexOf(playing) : (dir === 1 ? -1 : 0);
  let key = list[(cur + dir + list.length) % list.length];
  if (p.mode === 'shuffle' && list.length > 1 && dir === 1) {
    const others = list.filter((k) => k !== playing);
    key = others[Math.floor(Math.random() * others.length)];
  }
  playTrack(key);
}

/** Pause or resume the music without losing the place in the playlist. */
export function setPaused(p: boolean) {
  if (p === paused) return;
  paused = p;
  if (p) {
    window.clearTimeout(previewTimer);
    previewing = false;
    if (timer !== undefined) { window.clearInterval(timer); timer = undefined; }
    if (trackGain && ctx) { const g = trackGain; g.gain.setTargetAtTime(0, ctx.currentTime, 0.08); window.setTimeout(() => g.disconnect(), 600); }
    trackGain = null;
    playerChanged();
  } else {
    const resumeKey = playing && enabledForWanted().includes(playing) ? playing : null;
    playing = null;
    void unlockAudio().then(() => { if (resumeKey) startKey(resumeKey); else startContext(); playerChanged(); });
  }
}
export function isPaused() { return paused; }

export function stopMusic() {
  if (timer !== undefined) { window.clearInterval(timer); timer = undefined; }
  if (trackGain && ctx) { const g = trackGain; g.gain.setTargetAtTime(0, ctx.currentTime, 0.1); window.setTimeout(() => g.disconnect(), 800); }
  trackGain = null; playing = null; paused = false;
  playerChanged();
}

/** "album/track" now on air, or null. */
export function currentTrack() { return playing; }


/* ── sound effects ──────────────────────────────────────────────────── */

/**
 * Play a one-shot effect. `level` scales combo pitch (combo 2, 3, 4…).
 * Silent (no throw) before the first user gesture.
 */
export function playSfx(name: SfxName, level = 1) {
  const c = ensureCtx();
  if (!c || !sfxBus || c.state !== 'running') return;
  const t = c.currentTime + 0.005;
  const out = sfxBus;
  switch (name) {
    case 'tap':
      tone(out, 84, t, 0.05, 'square', 0.08, { cutoff: 3000 });
      break;
    case 'place':
      tone(out, 60, t, 0.09, 'triangle', 0.35, { glide: 5 });
      hiss(out, t, 0.04, 0.12, 2500);
      break;
    case 'line':
      [72, 76, 79, 84].forEach((m, i) => tone(out, m, t + i * 0.05, 0.16, 'square', 0.12, { cutoff: 4000 }));
      hiss(out, t, 0.25, 0.08, 5000);
      break;
    case 'combo': {
      const up = Math.min(12, Math.max(0, level - 1) * 2);
      // the motif's "Block-Block-Bite" in a fast burst, rising with the combo
      [0, 0, 7, 12].forEach((d, i) => tone(out, 72 + up + d, t + i * 0.06, 0.14, 'square', 0.13, { cutoff: 5000 }));
      tone(out, 48 + up, t, 0.3, 'sawtooth', 0.08, { cutoff: 1200 });
      break;
    }
    case 'perfect':
      // full motif fanfare + chord
      [0, 0, 7, 4, 5, 4, 2, 12].forEach((d, i) => tone(out, 72 + d, t + i * 0.09, i === 7 ? 0.7 : 0.16, 'square', 0.12, { cutoff: 5000 }));
      [60, 64, 67, 72].forEach((m) => tone(out, m, t + 0.63, 0.9, 'sawtooth', 0.05, { cutoff: 2500 }));
      hiss(out, t + 0.63, 0.6, 0.1, 6000);
      break;
    case 'gameover':
      [7, 4, 0, -5].forEach((d, i) => tone(out, 67 + d, t + i * 0.16, i === 3 ? 0.6 : 0.18, 'triangle', 0.25, { glide: i === 3 ? 2 : 0 }));
      break;
  }
}
