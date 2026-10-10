/**
 * Local run stats. Every access is guarded: storage can be blocked
 * (private mode, site data off) or full, and a throw here must never reach
 * the game. Not called from the reducer: React may run a reducer twice.
 */
function num(store: Pick<Storage, 'getItem'>, k: string, dflt: number): number {
  const n = parseInt(store.getItem(k) ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : dflt;
}

/** Record one finished game. `reachedLevel` raises bb_max_level, never lowers it. */
export function recordGameOver(reachedLevel: number, store?: Storage): void {
  try {
    const s = store ?? localStorage;
    if (reachedLevel > num(s, 'bb_max_level', 1)) s.setItem('bb_max_level', String(reachedLevel));
    s.setItem('bb_games_played', String(num(s, 'bb_games_played', 0) + 1));
  } catch { /* storage blocked or full */ }
}
