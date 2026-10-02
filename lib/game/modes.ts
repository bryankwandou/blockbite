// lib/game/modes.ts — the one table of mode rules. UI reads it; check script
// (modes.check.ts) asserts the three modes really differ.

export type ModeId = 'free' | 'daily' | 'monthly';

export interface ModeRules {
  id: ModeId;
  /** i18n key (game namespace) for the mode name. */
  nameKey: string;
  /** Theme colours. accent is used for borders, badges and the board frame. */
  theme: { accent: string; accentSoft: string; ink: string };
  /** Player chases a per-level goal (Free) or a score (Ranked). */
  goal: 'level' | 'score';
  /** Seed source: per-level generator, one seed per UTC day for everyone. */
  seed: 'level' | 'utc-day';
  /** Countdown to the daily reset is shown. */
  timer: boolean;
  hints: boolean;
  undo: boolean;
  /** Attempts per seed; null = unlimited. */
  attempts: number | null;
  /** Prize text may appear. */
  prizeText: boolean;
  /** Monthly view: score is the sum of this many best days; 0 = not summed. */
  sumBestDays: number;
  /** Board this mode plays on. */
  plays: 'level' | 'daily';
}

export const MODES: Record<ModeId, ModeRules> = {
  free: {
    id: 'free', nameKey: 'mode_free',
    theme: { accent: '#2dd4bf', accentSoft: 'rgba(45,212,191,0.14)', ink: '#5eead4' },
    goal: 'level', seed: 'level', timer: false, hints: true, undo: false,
    attempts: null, prizeText: false, sumBestDays: 0, plays: 'level',
  },
  daily: {
    id: 'daily', nameKey: 'mode_daily',
    theme: { accent: '#a78bfa', accentSoft: 'rgba(167,139,250,0.16)', ink: '#c4b5fd' },
    goal: 'score', seed: 'utc-day', timer: true, hints: false, undo: false,
    attempts: 3, prizeText: true, sumBestDays: 0, plays: 'daily',
  },
  monthly: {
    id: 'monthly', nameKey: 'mode_monthly',
    theme: { accent: '#eab308', accentSoft: 'rgba(234,179,8,0.16)', ink: '#fcd34d' },
    goal: 'score', seed: 'utc-day', timer: true, hints: false, undo: false,
    attempts: 3, prizeText: true, sumBestDays: 10, plays: 'daily',
  },
};

/** CSS custom properties for a mode, to spread into a style prop. */
export function modeStyle(id: ModeId): Record<string, string> {
  const t = MODES[id].theme;
  return { '--mode-accent': t.accent, '--mode-soft': t.accentSoft, '--mode-ink': t.ink };
}
