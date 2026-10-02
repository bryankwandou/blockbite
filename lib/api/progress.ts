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
          // Sync localStorage to match server so offline reads stay consistent
          localStorage.setItem('bb_max_level', String(user.currentLevel));
          return { currentLevel: user.currentLevel, wallet };
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
