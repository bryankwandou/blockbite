/**
 * Wallet sign-in for Ranked (server only).
 *
 * The player signs a plain-text message (never a transaction) with their
 * wallet. The server checks the ed25519 signature and returns a short-lived
 * session token. Challenges are stateless: the nonce is an HMAC of the wallet
 * and issue time, so no storage is needed and a stale message is rejected.
 */

import { createHmac, createPublicKey, timingSafeEqual, verify } from 'node:crypto';
import bs58 from 'bs58';

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

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

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
  const pub = createPublicKey({ key: Buffer.concat([SPKI_ED25519, Buffer.from(bs58.decode(wallet))]), format: 'der', type: 'spki' });
  if (!verify(null, Buffer.from(message, 'utf8'), pub, sig)) return null;
  const exp = now + SESSION_TTL_MS;
  return `${wallet}.${exp}.${mac('session', `${wallet}.${exp}`)}`;
}

/** Wallet of a valid session token, or null. */
export function sessionWallet(token: string | null | undefined, now = Date.now()): string | null {
  if (!token) return null;
  const [wallet, exp, sig] = token.split('.');
  if (!wallet || !exp || !sig || !isWallet(wallet)) return null;
  if (!(Number(exp) > now)) return null;
  return same(sig, mac('session', `${wallet}.${exp}`)) ? wallet : null;
}

export function walletFromRequest(req: Request): string | null {
  const h = req.headers.get('authorization') ?? '';
  return sessionWallet(h.startsWith('Bearer ') ? h.slice(7) : null);
}
