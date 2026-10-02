/**
 * Browser side: read this device's stats, evaluate locally, and sync to the
 * server when the wallet is signed in.
 *
 * localStorage keys read (the game writes bb_max_level and bb_games_played
 * today; the others count as 0 until the game records them):
 *   bb_max_level, bb_games_played, bb_lines_total, bb_combos_total,
 *   bb_perfect_total, bb_streak_best, bb_best_score, bb:avatars_seen (JSON list)
 */
import { evaluate, type Stats } from './catalog';

const num = (k: string) => {
  const v = Number(localStorage.getItem(k) ?? '0');
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
};

export function readLocalStats(): Stats {
  try {
    let avatars = 0;
    try { avatars = (JSON.parse(localStorage.getItem('bb:avatars_seen') ?? '[]') as unknown[]).length; } catch { /* bad json */ }
    return {
      level: num('bb_max_level'),
      games: num('bb_games_played'),
      lines: num('bb_lines_total'),
      combos: num('bb_combos_total'),
      perfect: num('bb_perfect_total'),
      streak: num('bb_streak_best'),
      score: num('bb_best_score'),
      avatars,
    };
  } catch {
    return {};
  }
}

export interface Synced { unlocked: Map<string, string | null>; server: boolean }

/** Local ids, merged with the server's stored ones when available. */
export async function loadUnlocks(wallet?: string | null): Promise<Synced> {
  const unlocked = new Map<string, string | null>(evaluate(readLocalStats()).map((id) => [id, null]));
  if (!wallet) return { unlocked, server: false };
  let server = false;
  try {
    const r = await fetch('/api/achievements/sync', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ wallet, stats: readLocalStats() }),
    });
    if (r.ok) server = true;
    const g = await fetch(`/api/achievements?wallet=${encodeURIComponent(wallet)}`);
    if (g.ok) {
      const j = (await g.json()) as { unlocks?: { id: string; at: string }[] };
      for (const u of j.unlocks ?? []) unlocked.set(u.id, u.at);
      server = true;
    }
  } catch { /* offline: local only */ }
  return { unlocked, server };
}
