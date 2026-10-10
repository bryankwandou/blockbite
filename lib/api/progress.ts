export interface PlayerProgress {
  currentLevel: number;
  wallet: string;
}

export async function getPlayerProgress(wallet: string): Promise<PlayerProgress> {
  // Try server-side KV via profile API when wallet is connected
  if (wallet && wallet.length > 10 && typeof window !== 'undefined') {
    try {
      const res = await fetch(`/api/profile?addr=${encodeURIComponent(wallet)}`);
      if (res.ok) {
        const user = await res.json();
        if (typeof user.currentLevel === 'number' && user.currentLevel >= 1) {
          // Take the higher of server and this browser: the server only
          // believes a few levels per game, so it can trail a local record,
          // and progress must never go backwards.
          let local = 0;
          try { local = parseInt(localStorage.getItem('bb_max_level') ?? '0', 10) || 0; } catch { /* blocked */ }
          const best = Math.max(user.currentLevel, local);
          // A full or blocked store must not throw away the server's level.
          try { localStorage.setItem('bb_max_level', String(best)); } catch { /* ignore */ }
          return { currentLevel: best, wallet };
        }
      }
    } catch { /* fall through to localStorage */ }
  }

  // Fallback: localStorage (guests / wallet not connected)
  try {
    const stored = typeof window !== 'undefined'
      ? parseInt(localStorage.getItem('bb_max_level') ?? '1')
      : 1;
    const currentLevel = isNaN(stored) || stored < 1 ? 1 : stored;
    return { currentLevel, wallet };
  } catch {
    return { currentLevel: 1, wallet };
  }
}

/** Persist level completion locally (server is updated via session/submit). */
export function saveProgressLocal(level: number): void {
  try {
    if (typeof window === 'undefined') return;
    const prev = parseInt(localStorage.getItem('bb_max_level') ?? '0');
    if (level > prev) localStorage.setItem('bb_max_level', String(level));
  } catch { /* ignore */ }
}
