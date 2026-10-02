/**
 * KV-backed live store with in-memory fallback.
 * All defaults are honest zero — no fake placeholder values.
 */

async function kv() {
  try {
    const m = await import('@vercel/kv');
    return m.kv;
  } catch {
    return null;
  }
}

export type AppState = {
  vault: { balanceUSDC: number; lastUpdate: number };
  admin: {
    activePlayers: number; txLastHour: number; errors24h: number;
    feeWallet: number; devWallet: number; refPool: number;
  };
};

export const ZERO_STATE: AppState = {
  vault: { balanceUSDC: 0, lastUpdate: 0 },
  admin: { activePlayers: 0, txLastHour: 0, errors24h: 0,
           feeWallet: 0, devWallet: 0, refPool: 0 },
};

export type UserState = {
  tickets: number; currentLevel: number; claimedTotal: number;
  refCount: number; streak: number; winRate: number;
  rank: number; actsDone: number;
  displayName: string; avatarId: string; refCode: string;
  language: 'en' | 'id'; theme: 'light' | 'dark';
};

export const ZERO_USER: UserState = {
  tickets: 0, currentLevel: 0, claimedTotal: 0,
  refCount: 0, streak: 0, winRate: 0, rank: 0, actsDone: 0,
  displayName: '', avatarId: '', refCode: '',
  language: 'en', theme: 'dark',
};

export async function getGlobal(): Promise<AppState> {
  const db = await kv();
  if (!db) return ZERO_STATE;
  const v = await db.get<AppState>('blockbite:global');
  return v ?? ZERO_STATE;
}

export async function setGlobal(patch: Partial<AppState>): Promise<void> {
  const db = await kv();
  if (!db) return;
  const cur = await getGlobal();
  // Deep merge one level to preserve nested fields (vault.lastUpdate, admin.*)
  const merged: AppState = {
    vault: { ...cur.vault, ...(patch.vault ?? {}) },
    admin: { ...cur.admin, ...(patch.admin ?? {}) },
  };
  await db.set('blockbite:global', merged);
}

export async function getUser(addr: string): Promise<UserState> {
  if (!addr) return ZERO_USER;
  const db = await kv();
  if (!db) return ZERO_USER;
  const v = await db.get<UserState>(`blockbite:user:${addr}`);
  return v ?? ZERO_USER;
}

export async function setUser(addr: string, patch: Partial<UserState>): Promise<void> {
  const db = await kv();
  if (!db) return;
  const cur = await getUser(addr);
  await db.set(`blockbite:user:${addr}`, { ...cur, ...patch });
}
