'use client';

/** Browser side of the Ranked API. */

import bs58 from 'bs58';
import type { Prize } from './results';
import type { Move, RankedState } from './rules';

export class RankedApiError extends Error {
  constructor(public status: number, message: string, public state?: RankedState) {
    super(message);
  }
}

const tokenKey = (wallet: string) => `bb_rk_session_${wallet}`;

export function readToken(wallet: string): string | null {
  try {
    const t = sessionStorage.getItem(tokenKey(wallet));
    if (!t) return null;
    const exp = Number(t.split('.')[1]);
    return exp > Date.now() + 60_000 ? t : null;
  } catch {
    return null;
  }
}

async function call<T>(path: string, token: string | null, body?: unknown): Promise<T> {
  return request<T>(`/api/ranked/${path}`, token, body);
}

async function request<T>(url: string, token: string | null, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new RankedApiError(res.status, json.error ?? `request failed (${res.status})`, json.state);
  return json as T;
}

export interface Me {
  wallet: string;
  day: string;
  commitment: string;
  credits: number;
  attempts: number;
  maxAttempts: number;
  salesOpen: boolean;
  runs: { id: string; attempt: number; score: number; moves: number; over: boolean }[];
}

export interface BoardRow { wallet: string; score: number; avatarId: string | null }

export class RankedClient {
  private constructor(public wallet: string, private token: string) {}

  /** Reuses this tab's session, or asks the wallet to sign the sign-in message. */
  static async connect(wallet: string, signMessage: (m: Uint8Array) => Promise<Uint8Array>): Promise<RankedClient> {
    const cached = readToken(wallet);
    if (cached) return new RankedClient(wallet, cached);
    const { message } = await call<{ message: string }>('auth', null, { wallet });
    const sig = await signMessage(new TextEncoder().encode(message));
    const { token } = await call<{ token: string }>('auth', null, { wallet, message, signature: bs58.encode(sig) });
    try {
      sessionStorage.setItem(tokenKey(wallet), token);
    } catch { /* session still works for this page */ }
    // WalletTracker waits for a session to attribute a pending referral.
    window.dispatchEvent(new CustomEvent('bb:ranked-session', { detail: { wallet, token } }));
    return new RankedClient(wallet, token);
  }

  /** Authorization header value for other wallet-signed endpoints (quests). */
  get authorization(): string {
    return `Bearer ${this.token}`;
  }

  static cached(wallet: string): RankedClient | null {
    const t = readToken(wallet);
    return t ? new RankedClient(wallet, t) : null;
  }

  me() {
    return call<Me>('me', this.token);
  }

  start() {
    return call<{ runId: string; day: string; attempt: number; state: RankedState }>('start', this.token, {});
  }

  play(runId: string, fromMoves: number, moves: Move[]) {
    return call<{ state: RankedState }>('play', this.token, { runId, fromMoves, moves });
  }

  run(runId: string) {
    return call<{ runId: string; day: string; attempt: number; state: RankedState; closed: boolean }>(
      `run?id=${encodeURIComponent(runId)}`, this.token);
  }

  credit(signature: string) {
    return call<{ added: number; alreadyCredited: boolean; credits: number }>('credit', this.token, { signature });
  }

  /** Saves this wallet's avatar slug on the server; null clears it. */
  setAvatar(avatarId: string | null) {
    return request<{ wallet: string; avatarId: string | null }>(
      '/api/profile/avatar', this.token, { wallet: this.wallet, avatarId });
  }
}

/**
 * Saves `wallet`'s avatar with this tab's Ranked session, without asking the
 * wallet to sign anything. Resolves false when there is no session (the
 * server would answer 401) or the save failed; the caller keeps its local copy.
 */
export async function saveAvatarIfSignedIn(wallet: string, avatarId: string | null): Promise<boolean> {
  const client = RankedClient.cached(wallet);
  if (!client) return false;
  try {
    await client.setAvatar(avatarId);
    return true;
  } catch {
    return false;
  }
}

export function leaderboard(period: 'day' | 'month') {
  return call<{ rows: BoardRow[]; day?: string; month?: string; final?: boolean }>(`leaderboard?period=${period}`, null);
}

/** One prize from GET /api/ranked/proof; pass it to claimIxs() in ./prize-ix. */
export type { Prize };

export function prizes(wallet: string) {
  return call<{ wallet: string; prizes: Prize[] }>(`proof?wallet=${encodeURIComponent(wallet)}`, null);
}
