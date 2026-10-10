/**
 * Wallet sign-in for Ranked (server only).
 *
 * The player signs a plain-text message (never a transaction) with their
 * wallet. The server checks the ed25519 signature and returns a short-lived
 * session token. Challenges are stateless: the nonce is an HMAC of the wallet
 * and issue time, so no storage is needed and a stale message is rejected.
 */

import { createHmac, createPublicKey, randomBytes, verify } from 'node:crypto';
import bs58 from 'bs58';
import { consumeNonce, nonceOf, safeEqual } from '@/lib/safeEqual';
import { isSessionRevoked, type Query } from '@/lib/ranked/revocation';
import { isWeakEd25519Key } from '@/lib/weak-key';

const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex');
const WALLET_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function key(label: string): Buffer {
  const secret = process.env.RANKED_SECRET;
  if (!secret || secret.length < 32) throw new Error('RANKED_SECRET is not configured');
  return createHmac('sha256', secret).update(`blockbite:ranked:${label}`).digest();
}

function mac(label: string, data: string): string {
  return createHmac('sha256', key(label)).update(data).digest('base64url');
}

const same = safeEqual;

export function isWallet(w: unknown): w is string {
  if (typeof w !== 'string' || !WALLET_RE.test(w)) return false;
  try {
    return bs58.decode(w).length === 32;
  } catch {
    return false;
  }
}

export function challenge(wallet: string, now = Date.now()): string {
  const nonce = mac('nonce', `${wallet}:${now}`).slice(0, 24);
  return [
    'BlockBite Ranked sign-in',
    '',
    `Wallet: ${wallet}`,
    `Issued: ${now}`,
    `Nonce: ${nonce}`,
    '',
    'Signing this message only proves you own this wallet. It is not a transaction and moves no funds.',
  ].join('\n');
}

/** Verifies a signed challenge; returns a session token or null. */
export function signIn(wallet: string, message: string, signatureB58: string, now = Date.now()): string | null {
  if (!isWallet(wallet) || typeof message !== 'string' || typeof signatureB58 !== 'string') return null;
  const issued = Number(/^Issued: (\d+)$/m.exec(message)?.[1]);
  if (!Number.isFinite(issued) || now - issued > CHALLENGE_TTL_MS || issued - now > 60_000) return null;
  if (message !== challenge(wallet, issued)) return null;
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
  const exp = now + SESSION_TTL_MS;
  // v2 token: wallet.exp.sid.mac. The random sid is what logout revokes.
  const sid = randomBytes(12).toString('base64url');
  return `${wallet}.${exp}.${sid}.${mac('session', `${wallet}.${exp}.${sid}`)}`;
}

/**
 * signIn + single-use: the challenge nonce is recorded in Postgres on the first
 * successful verify and a replay returns null. Fails closed (throws) if the DB
 * is down; ranked cannot play without that same DB, so nothing extra is lost.
 */
export async function signInOnce(wallet: string, message: string, signatureB58: string, now = Date.now()): Promise<string | null> {
  const token = signIn(wallet, message, signatureB58, now);
  if (!token) return null;
  const nonce = nonceOf(message);
  const issued = Number(/^Issued: (\d+)$/m.exec(message)?.[1]);
  if (!nonce) return null;
  return (await consumeNonce('ranked', nonce, issued + CHALLENGE_TTL_MS + 60_000)) ? token : null;
}

export interface Session { wallet: string; exp: number; sid: string; iat: number }

/**
 * Parses and signature-checks a token. Two formats:
 *  - v2 `wallet.exp.sid.mac` (current)
 *  - v1 `wallet.exp.mac` (issued before revocation existed). Accepted until its own
 *    expiry (<= 12 h) so nobody is kicked out at deploy; its sid is derived from the mac,
 *    so it can still be logged out individually, and logout-all covers it via iat.
 * iat is exp - TTL in both formats. This does NOT consult the revocation store.
 */
export function parseSession(token: string | null | undefined, now = Date.now()): Session | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3 && parts.length !== 4) return null;
  const v2 = parts.length === 4;
  const [wallet, exp] = parts;
  const sig = parts[parts.length - 1];
  const sid = v2 ? parts[2] : `v1:${sig}`;
  if (!wallet || !exp || !sig || !sid || !isWallet(wallet)) return null;
  if (v2 && !/^[A-Za-z0-9_-]{16}$/.test(sid)) return null;
  if (!/^\d{1,16}$/.test(exp) || !(Number(exp) > now)) return null;
  const data = v2 ? `${wallet}.${exp}.${sid}` : `${wallet}.${exp}`;
  if (!same(sig, mac('session', data))) return null;
  return { wallet, exp: Number(exp), sid, iat: Number(exp) - SESSION_TTL_MS };
}

/** Signature + expiry only (no revocation check). */
export function sessionWallet(token: string | null | undefined, now = Date.now()): string | null {
  return parseSession(token, now)?.wallet ?? null;
}

export function bearerOf(req: Request): string | null {
  const h = req.headers.get('authorization') ?? '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

/** Thrown when the revocation store cannot be read; callers answer 503 (fail closed). */
export class SessionCheckError extends Error {}

/** Valid and not revoked, or null. Throws SessionCheckError if the DB is down. */
export async function authedSession(req: Request, q?: Query, now = Date.now()): Promise<Session | null> {
  const s = parseSession(bearerOf(req), now);
  if (!s) return null;
  try {
    return (await isSessionRevoked(s, q)) ? null : s;
  } catch (e) {
    console.error('session revocation check', e);
    throw new SessionCheckError('session check unavailable');
  }
}

export async function walletFromRequestAsync(req: Request, q?: Query): Promise<string | null> {
  return (await authedSession(req, q))?.wallet ?? null;
}
