/**
 * Wallet sign-in for /admin and /partner (server only).
 *
 * Same scheme as lib/ranked/auth.ts: the wallet signs a plain-text message
 * (never a transaction); the nonce is an HMAC of wallet + role + issue time,
 * so no storage is needed. The session lives in an httpOnly cookie.
 *
 * Admin = wallet listed in env ADMIN_WALLETS (comma separated).
 * Partner = any signed-in wallet; what it may do depends on ptn_partners.status.
 */

import { createHmac, createPublicKey, verify } from 'node:crypto';
import bs58 from 'bs58';
import { isWallet } from '@/lib/ranked/auth';
import { consumeNonce, nonceOf, safeEqual } from '@/lib/safeEqual';
import { isWeakEd25519Key } from '@/lib/weak-key';

export type Role = 'admin' | 'partner';

const CHALLENGE_TTL_MS = 10 * 60 * 1000;
export const SESSION_TTL_S: Record<Role, number> = { admin: 30 * 60, partner: 4 * 60 * 60 };
export const COOKIE: Record<Role, string> = { admin: 'bb_adm', partner: 'bb_ptn' };
const SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex');

function secret(): string {
  const s = process.env.ADMIN_SESSION_SECRET ?? process.env.RANKED_SECRET;
  if (!s || s.length < 32) throw new Error('ADMIN_SESSION_SECRET is not configured');
  return s;
}

export function authConfigured(): boolean {
  const s = process.env.ADMIN_SESSION_SECRET ?? process.env.RANKED_SECRET;
  return Boolean(s && s.length >= 32);
}

function mac(label: string, data: string): string {
  const k = createHmac('sha256', secret()).update(`blockbite:console:${label}`).digest();
  return createHmac('sha256', k).update(data).digest('base64url');
}

const same = safeEqual;

export function adminWallets(): string[] {
  return (process.env.ADMIN_WALLETS ?? '').split(',').map((s) => s.trim()).filter(isWallet);
}

export function challenge(role: Role, wallet: string, now = Date.now()): string {
  const nonce = mac('nonce', `${role}:${wallet}:${now}`).slice(0, 24);
  return [
    role === 'admin' ? 'BlockBite Admin sign-in' : 'BlockBite Partner sign-in',
    '',
    `Wallet: ${wallet}`,
    `Issued: ${now}`,
    `Nonce: ${nonce}`,
    '',
    'Signing this message only proves you own this wallet. It is not a transaction and moves no funds.',
  ].join('\n');
}

/** Verifies a signed challenge; returns a session token or null. */
export function signIn(role: Role, wallet: string, message: string, signatureB58: string, now = Date.now()): string | null {
  if (!isWallet(wallet) || typeof message !== 'string' || typeof signatureB58 !== 'string') return null;
  if (role === 'admin' && !adminWallets().includes(wallet)) return null;
  const issued = Number(/^Issued: (\d+)$/m.exec(message)?.[1]);
  if (!Number.isFinite(issued) || now - issued > CHALLENGE_TTL_MS || issued - now > 60_000) return null;
  if (message !== challenge(role, wallet, issued)) return null;
  let sig: Buffer;
  try {
    sig = Buffer.from(bs58.decode(signatureB58));
  } catch {
    return null;
  }
  if (sig.length !== 64) return null;
  const key = bs58.decode(wallet);
  if (isWeakEd25519Key(key)) return null;
  const pub = createPublicKey({ key: Buffer.concat([SPKI_ED25519, Buffer.from(key)]), format: 'der', type: 'spki' });
  if (!verify(null, Buffer.from(message, 'utf8'), pub, sig)) return null;
  const exp = now + SESSION_TTL_S[role] * 1000;
  return `${wallet}.${exp}.${mac(`session:${role}`, `${wallet}.${exp}`)}`;
}

/** signIn + single-use nonce (Postgres). Throws if the DB is unavailable: admin/partner fail closed. */
export async function signInOnce(role: Role, wallet: string, message: string, signatureB58: string, now = Date.now()): Promise<string | null> {
  const token = signIn(role, wallet, message, signatureB58, now);
  if (!token) return null;
  const nonce = nonceOf(message);
  const issued = Number(/^Issued: (\d+)$/m.exec(message)?.[1]);
  if (!nonce) return null;
  return (await consumeNonce(role, nonce, issued + CHALLENGE_TTL_MS + 60_000)) ? token : null;
}

function cookieValue(req: Request, name: string): string | null {
  const raw = req.headers.get('cookie') ?? '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) {
      try {
        return decodeURIComponent(v.join('='));
      } catch {
        return null; // malformed %-escape: treat as signed out
      }
    }
  }
  return null;
}

/** Wallet of a valid session cookie for `role`, or null. Admin is re-checked against ADMIN_WALLETS. */
export function sessionWallet(req: Request, role: Role, now = Date.now()): string | null {
  if (!authConfigured()) return null;
  const token = cookieValue(req, COOKIE[role]);
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [wallet, exp, sig] = parts;
  if (!wallet || !exp || !sig || !isWallet(wallet) || !/^\d{1,16}$/.test(exp) || !(Number(exp) > now)) return null;
  if (!same(sig, mac(`session:${role}`, `${wallet}.${exp}`))) return null;
  if (role === 'admin' && !adminWallets().includes(wallet)) return null;
  return wallet;
}

export function setCookieHeader(role: Role, token: string | null): string {
  const base = `${COOKIE[role]}=${token ? encodeURIComponent(token) : ''}; Path=/; HttpOnly; SameSite=Strict`;
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return token ? `${base}; Max-Age=${SESSION_TTL_S[role]}${secure}` : `${base}; Max-Age=0${secure}`;
}
