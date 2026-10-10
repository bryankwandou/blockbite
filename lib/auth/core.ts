/**
 * Account recovery core (server only, no I/O): password hashing, signed
 * tokens, wallet challenges, Google id_token checks, lockout and migration
 * cooldown rules. Everything here is pure so lib/auth/auth.check.ts can test it.
 *
 * What recovery can and cannot do: it moves the OFF-CHAIN profile (name,
 * avatar, adventure level, quest completions) to a new wallet. It never
 * touches private keys, tokens, USDC, ranked tickets or unclaimed prizes;
 * those stay with the original wallet because on-chain claims are bound to it.
 */

import {
  createHash, createHmac, createPublicKey, randomBytes, scrypt as scryptCb, timingSafeEqual, verify,
  type JsonWebKey, type ScryptOptions,
} from 'node:crypto';
import bs58 from 'bs58';
import { isWeakEd25519Key } from '@/lib/weak-key';

// ── Constants ───────────────────────────────────────────────────────

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 256;
export const LOCKOUT_MAX_FAILURES = 10;
export const LOCKOUT_WINDOW_MS = 60 * 60_000;
export const MIGRATION_COOLDOWN_MS = 72 * 60 * 60_000;
export const CHALLENGE_TTL_MS = 10 * 60_000;
export const SESSION_TTL_MS = 15 * 60_000;

const SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex');
const WALLET_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,63}$/;

// ── Small helpers ───────────────────────────────────────────────────

export const b64url = (b: Buffer) => b.toString('base64url');

export function same(a: string | Buffer, b: string | Buffer): boolean {
  const x = Buffer.isBuffer(a) ? a : Buffer.from(a);
  const y = Buffer.isBuffer(b) ? b : Buffer.from(b);
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

export function normalizeEmail(e: unknown): string | null {
  if (typeof e !== 'string') return null;
  const s = e.trim().toLowerCase();
  return s.length <= 254 && EMAIL_RE.test(s) ? s : null;
}

// ── Passwords ───────────────────────────────────────────────────────

const SCRYPT = { N: 1 << 15, r: 8, p: 1, keylen: 32 };

function scrypt(pw: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((ok, no) => scryptCb(pw.normalize('NFKC'), salt, keylen, opts, (e, k) => (e ? no(e) : ok(k))));
}

/** `s1$N$r$p$salt$hash`, with a fresh 16-byte salt per password. */
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const { N, r, p, keylen } = SCRYPT;
  const key = await scrypt(pw, salt, keylen, { N, r, p, maxmem: 128 * N * r * 2 });
  return ['s1', N, r, p, b64url(salt), b64url(key)].join('$');
}

/** Constant-time check of `pw` against a stored hash. Malformed hashes never match. */
export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const parts = typeof stored === 'string' ? stored.split('$') : [];
  if (parts.length !== 6 || parts[0] !== 's1') return false;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  if (![N, r, p].every(Number.isInteger) || N < 2 || N > 1 << 20 || r < 1 || r > 32 || p < 1 || p > 16) return false;
  const salt = Buffer.from(parts[4], 'base64url');
  const want = Buffer.from(parts[5], 'base64url');
  if (salt.length < 16 || want.length < 16) return false;
  const got = await scrypt(pw, salt, want.length, { N, r, p, maxmem: 128 * N * r * 2 });
  return timingSafeEqual(got, want);
}

const COMMON = new Set([
  'password', 'passw0rd', 'qwerty', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm', 'letmein', 'welcome', 'admin',
  'iloveyou', 'monkey', 'dragon', 'football', 'baseball', 'sunshine', 'princess', 'master', 'shadow',
  'superman', 'trustno', 'abc', 'abcdef', 'abcdefghij', 'blockbite', 'solana', 'phantom', 'bitcoin',
  'crypto', 'changeme', 'secret', 'login', 'starwars', 'whatever', 'qazwsx', 'pokemon',
  'summer', 'winter', 'spring', 'autumn', 'hello', 'test', 'user', 'love', 'money', 'liverpool',
  'chelsea', 'arsenal', 'barcelona', 'jakarta', 'indonesia', 'bismillah', 'sayang', 'rahasia',
]);

/** Null when acceptable, else a reason code. Basic checks only; this is not a breach database. */
export function passwordProblem(pw: unknown, email?: string | null): string | null {
  if (typeof pw !== 'string') return 'password_invalid';
  if ([...pw].length < PASSWORD_MIN) return 'password_short';
  if (pw.length > PASSWORD_MAX) return 'password_long';
  const lower = pw.toLowerCase();
  if (new Set(lower).size < 4) return 'password_common';
  const letters = lower.replace(/[^a-z]/g, '');
  if (COMMON.has(letters) || COMMON.has(lower)) return 'password_common';
  if (/^(0123456789|1234567890|9876543210|0987654321)+\d*$/.test(lower)) return 'password_common';
  // A digit run with only a couple of letters around it ("1234567890ab").
  if (/(0123456789|1234567890|9876543210|0987654321)/.test(lower) && letters.length <= 3) return 'password_common';
  if (/^(.{1,3})\1+$/.test(lower)) return 'password_common';
  const local = email?.split('@')[0];
  if (local && local.length >= 4 && lower.includes(local)) return 'password_email';
  return null;
}

// ── Recovery codes ──────────────────────────────────────────────────

export const RECOVERY_CODE_COUNT = 10;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L

/** 10 one-time codes like `ABCD-EFGH-JKMN-PQRS` (~79 bits each). Show once; store only hashPassword(code). */
export function generateRecoveryCodes(n = RECOVERY_CODE_COUNT): string[] {
  const out: string[] = [];
  while (out.length < n) {
    const bytes = randomBytes(32);
    let c = '';
    for (const b of bytes) {
      if (b >= 248) continue; // 248 = 8 * 31, keeps the draw unbiased
      c += CODE_ALPHABET[b % 31];
      if (c.length === 16) break;
    }
    if (c.length === 16) out.push(c.match(/.{4}/g)!.join('-'));
  }
  return out;
}

/** Canonical form for hashing/compare: uppercase, separators removed, common look-alikes mapped. */
export function normalizeRecoveryCode(c: unknown): string | null {
  if (typeof c !== 'string') return null;
  const s = c.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (!/^[A-Z2-9]{16}$/.test(s) || /[01]/.test(s)) return null;
  return s;
}

// ── Signed tokens (cookies) ─────────────────────────────────────────

export function accountSecret(): string {
  const s = process.env.ACCOUNT_SECRET ?? process.env.RANKED_SECRET;
  if (!s || s.length < 32) throw new Error('ACCOUNT_SECRET is not configured');
  return s;
}

function mac(label: string, data: string, secret = accountSecret()): string {
  const k = createHmac('sha256', secret).update(`blockbite:account:${label}`).digest();
  return createHmac('sha256', k).update(data).digest('base64url');
}

/** `payload.mac`, payload = base64url(JSON). Every token carries `e` (expiry ms). */
export function seal(label: string, data: Record<string, unknown>, secret?: string): string {
  const body = b64url(Buffer.from(JSON.stringify(data)));
  return `${body}.${mac(label, body, secret)}`;
}

export function unseal<T extends { e: number }>(label: string, token: string | null | undefined, now = Date.now(), secret?: string): T | null {
  if (!token || typeof token !== 'string') return null;
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined || !same(sig, mac(label, body, secret))) return null;
  try {
    const v = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T;
    return typeof v?.e === 'number' && v.e > now ? v : null;
  } catch {
    return null;
  }
}

// ── Wallet challenges ───────────────────────────────────────────────

const ACTION_RE = /^(manage|unbind:(google|password|passkey|codes)|migrate:[1-9A-HJ-NP-Za-km-z]{32,44})$/;
export const isAction = (a: unknown): a is string => typeof a === 'string' && ACTION_RE.test(a);

export function walletChallenge(wallet: string, action: string, now = Date.now(), secret?: string): string {
  const nonce = mac('nonce', `${wallet}:${action}:${now}`, secret).slice(0, 24);
  return [
    'BlockBite account',
    '',
    `Action: ${action}`,
    `Wallet: ${wallet}`,
    `Issued: ${now}`,
    `Nonce: ${nonce}`,
    '',
    'Signing this message only proves you own this wallet. It is not a transaction and moves no funds.',
  ].join('\n');
}

/** True when `message` is a fresh challenge for (wallet, action) signed by wallet's key. */
export function verifyWalletSignature(
  wallet: unknown, action: string, message: unknown, signatureB58: unknown, now = Date.now(), secret?: string,
): wallet is string {
  if (!isWallet(wallet) || !isAction(action) || typeof message !== 'string' || typeof signatureB58 !== 'string') return false;
  const issued = Number(/^Issued: (\d+)$/m.exec(message)?.[1]);
  if (!Number.isFinite(issued) || now - issued > CHALLENGE_TTL_MS || issued - now > 60_000) return false;
  if (message !== walletChallenge(wallet, action, issued, secret)) return false;
  let sig: Buffer;
  try {
    sig = Buffer.from(bs58.decode(signatureB58));
  } catch {
    return false;
  }
  if (sig.length !== 64) return false;
  const key = bs58.decode(wallet);
  if (isWeakEd25519Key(key)) return false;
  const pub = createPublicKey({ key: Buffer.concat([SPKI_ED25519, Buffer.from(key)]), format: 'der', type: 'spki' });
  return verify(null, Buffer.from(message, 'utf8'), pub, sig);
}

// ── Google OAuth (authorization code + PKCE) ────────────────────────

export const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32));
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) };
}

export const randomToken = (n = 24) => b64url(randomBytes(n));

export interface Jwks { keys: (JsonWebKey & { kid?: string })[] }
export interface GoogleClaims { sub: string; email: string }

/**
 * Validates a Google id_token: RS256 signature against the JWKS, iss, aud
 * (and azp when present), exp/iat with 60 s skew, nonce, email_verified.
 * Throws an Error whose message is a short reason code.
 */
export function verifyIdToken(
  token: string, jwks: Jwks, opts: { clientId: string; nonce: string; now?: number },
): GoogleClaims {
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  const parts = typeof token === 'string' ? token.split('.') : [];
  if (parts.length !== 3) throw new Error('malformed');
  let header: { alg?: string; kid?: string };
  let claims: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw new Error('malformed');
  }
  if (header.alg !== 'RS256') throw new Error('alg');
  const jwk = jwks.keys.find((k) => k.kid === header.kid && k.kty === 'RSA');
  if (!jwk) throw new Error('kid');
  const key = createPublicKey({ key: jwk, format: 'jwk' });
  const ok = verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'));
  if (!ok) throw new Error('signature');
  if (!GOOGLE_ISSUERS.includes(String(claims.iss))) throw new Error('iss');
  const aud = claims.aud;
  if (!(aud === opts.clientId || (Array.isArray(aud) && aud.includes(opts.clientId)))) throw new Error('aud');
  if (claims.azp !== undefined && claims.azp !== opts.clientId) throw new Error('azp');
  if (typeof claims.exp !== 'number' || claims.exp + 60 < now) throw new Error('exp');
  if (typeof claims.iat === 'number' && claims.iat - 60 > now) throw new Error('iat');
  if (typeof claims.nonce !== 'string' || !same(claims.nonce, opts.nonce)) throw new Error('nonce');
  if (!(claims.email_verified === true || claims.email_verified === 'true')) throw new Error('email_unverified');
  if (typeof claims.sub !== 'string' || !claims.sub) throw new Error('sub');
  const email = normalizeEmail(claims.email);
  if (!email) throw new Error('email');
  return { sub: claims.sub, email };
}

// ── Lockout and cooldown rules ──────────────────────────────────────

/** Failure log: anything that can count recent failures for a key and record one. */
export interface FailureStore {
  count(key: string, sinceMs: number): Promise<number>;
  add(key: string, atMs: number): Promise<void>;
}

export async function isLocked(store: FailureStore, keys: string[], now = Date.now()): Promise<boolean> {
  for (const k of keys) if ((await store.count(k, now - LOCKOUT_WINDOW_MS)) >= LOCKOUT_MAX_FAILURES) return true;
  return false;
}

export async function recordFailure(store: FailureStore, keys: string[], now = Date.now()): Promise<void> {
  for (const k of keys) await store.add(k, now);
}

/** Milliseconds until another migration is allowed (0 = allowed now). */
export function cooldownLeft(lastMigrationMs: number | null, now = Date.now()): number {
  if (lastMigrationMs === null) return 0;
  return Math.max(0, lastMigrationMs + MIGRATION_COOLDOWN_MS - now);
}
