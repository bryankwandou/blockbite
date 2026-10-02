/** Route helpers for /api/auth/* (server only). */

import { NextResponse } from 'next/server';
import { getIP, rateLimit } from '@/lib/rate-limit';
import { SESSION_TTL_MS, seal, unseal } from './core';
import { dbConfigured, type RecoveryMethod } from './db';

export const COOKIE = { wallet: 'bb_acct_w', recover: 'bb_acct_r', oauth: 'bb_acct_o', passkey: 'bb_acct_pk' } as const;
const PATH = '/api/auth';

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
export const fail = (status: number, error: string, extra: Record<string, unknown> = {}) => json({ error, ...extra }, status);

export async function body(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const b = await req.json();
    return b && typeof b === 'object' ? (b as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function accountsConfigured(): boolean {
  const s = process.env.ACCOUNT_SECRET ?? process.env.RANKED_SECRET;
  return Boolean(s && s.length >= 32 && dbConfigured());
}

/** httpOnly, Secure, SameSite=Lax, scoped to /api/auth. */
export function setCookie(res: NextResponse, name: string, value: string, maxAgeMs = SESSION_TTL_MS) {
  res.cookies.set(name, value, { httpOnly: true, secure: true, sameSite: 'lax', path: PATH, maxAge: Math.floor(maxAgeMs / 1000) });
}
export function clearCookie(res: NextResponse, name: string) {
  res.cookies.set(name, '', { httpOnly: true, secure: true, sameSite: 'lax', path: PATH, maxAge: 0 });
}

function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export interface WalletSession { w: string; e: number }
export interface RecoverySession { w: string; p: RecoveryMethod; s: string; m: string | null; e: number }
export interface OAuthState { st: string; v: string; n: string; mode: 'bind' | 'recover'; w: string | null; e: number }

export interface PasskeyChallenge { c: string; mode: 'bind' | 'recover'; w: string | null; e: number }

export const walletSession = (req: Request) => unseal<WalletSession>('wallet', readCookie(req, COOKIE.wallet));
export const recoverySession = (req: Request) => unseal<RecoverySession>('recover', readCookie(req, COOKIE.recover));
export const oauthState = (req: Request) => unseal<OAuthState>('oauth', readCookie(req, COOKIE.oauth));

export const passkeyChallenge = (req: Request) => unseal<PasskeyChallenge>('passkey', readCookie(req, COOKIE.passkey));
export const sealPasskey = (p: Omit<PasskeyChallenge, 'e'>) => seal('passkey', { ...p, e: Date.now() + 5 * 60_000 });

/**
 * WebAuthn relying party. WEBAUTHN_ORIGIN pins it in production: one origin or a
 * comma-separated list (e.g. https://blockbite.vercel.app,https://blockbite-game.vercel.app).
 * The request's origin is used when it is on the list, else the first entry. Without
 * the variable the request's own origin is used (fine for localhost). A passkey only
 * works on the domain it was created on.
 */
export function relyingParty(req: Request): { origin: string; rpId: string } {
  const own = new URL(req.url).origin;
  const allowed = (process.env.WEBAUTHN_ORIGIN ?? '').split(',').map((o) => o.trim().replace(/\/$/, '')).filter(Boolean);
  const origin = allowed.length === 0 ? own : allowed.includes(own) ? own : allowed[0];
  return { origin, rpId: new URL(origin).hostname };
}

/** 404 for every Google route unless all three GOOGLE_* env vars are set. */
export const notFound = () => new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });

export const sealWallet = (w: string) => seal('wallet', { w, e: Date.now() + SESSION_TTL_MS });
export const sealRecovery = (r: Omit<RecoverySession, 'e'>) => seal('recover', { ...r, e: Date.now() + SESSION_TTL_MS });
export const sealOAuth = (o: Omit<OAuthState, 'e'>) => seal('oauth', { ...o, e: Date.now() + 10 * 60_000 });

/** IP rate limit for auth endpoints; allows when Vercel KV is unavailable. */
export async function limited(req: Request, bucket: string, limit = 20, windowMs = 15 * 60_000): Promise<boolean> {
  const rl = await rateLimit(`acct:${bucket}:${getIP(req)}`, limit, windowMs).catch(() => null);
  return Boolean(rl && !rl.allowed);
}

export { getIP };
