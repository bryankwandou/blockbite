/** Validates a submitted run: the server replays the move log, it never trusts a sent score. */
import { replay, type LogMove } from './deal';
import type { Entry } from './store';

export const MAX_MOVES = 3000;

export function cleanName(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 20);
  return s.length ? s : null;
}

export function checkRun(seed: string, name: unknown, log: unknown): Omit<Entry, 'at'> | string {
  const n = cleanName(name);
  if (!n) return 'bad name';
  if (!Array.isArray(log) || log.length < 1 || log.length > MAX_MOVES) return 'bad log';
  for (const m of log) {
    if (!Array.isArray(m) || m.length !== 3 || !m.every((x) => Number.isInteger(x) && x >= 0 && x < 8)) return 'bad log';
  }
  const r = replay(seed, log as LogMove[]);
  if (!r) return 'illegal move';
  return { name: n, score: r.run.score, moves: r.run.moves, curve: r.curve };
}
