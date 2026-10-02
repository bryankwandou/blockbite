/**
 * npx tsx lib/auth/auth.check.ts
 * Offline checks for lib/auth/core.ts: hashing, verify, password policy,
 * signed tokens, wallet challenges, lockout, Google id_token validation
 * against a locally generated RSA key and fake JWKS, migration cooldown.
 */

import assert from 'node:assert/strict';
import { createHash, createSign, generateKeyPairSync, randomBytes, sign as edSign, sign as cryptoSign, type KeyObject } from 'node:crypto';
import { ALG_ES256, ALG_RS256, cborDecode, FLAG_AT, FLAG_UP, FLAG_UV, verifyAssertion, verifyRegistration } from './webauthn';
import bs58 from 'bs58';
import {
  cooldownLeft, generateRecoveryCodes, normalizeRecoveryCode, RECOVERY_CODE_COUNT, hashPassword, isLocked, LOCKOUT_MAX_FAILURES, MIGRATION_COOLDOWN_MS, passwordProblem, pkcePair,
  recordFailure, seal, unseal, verifyIdToken, verifyPassword, verifyWalletSignature, walletChallenge,
  type FailureStore, type Jwks,
} from './core';

const SECRET = 'x'.repeat(40);
let passed = 0;
async function check(name: string, fn: () => unknown | Promise<unknown>) {
  await fn();
  passed++;
  console.log(`ok   ${name}`);
}

const now = Date.UTC(2026, 9, 1, 12);
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

async function main() {
  // ── passwords
  const pw = 'Tangerine-Harbor-42';
  const h = await hashPassword(pw);
  await check('hash format s1$N$r$p$salt$hash', () => assert.match(h, /^s1\$32768\$8\$1\$[\w-]{22}\$[\w-]{43}$/));
  await check('same password hashes differently (per-user salt)', async () => assert.notEqual(await hashPassword(pw), h));
  await check('verify accepts the right password', async () => assert.equal(await verifyPassword(pw, h), true));
  await check('verify rejects a wrong password', async () => assert.equal(await verifyPassword(pw + '!', h), false));
  await check('verify rejects malformed / tampered hashes', async () => {
    assert.equal(await verifyPassword(pw, 'garbage'), false);
    assert.equal(await verifyPassword(pw, h.replace('s1$32768', 's1$99999999')), false);
    const parts = h.split('$');
    parts[5] = Buffer.alloc(32).toString('base64url');
    assert.equal(await verifyPassword(pw, parts.join('$')), false);
  });
  await check('password policy', () => {
    assert.equal(passwordProblem('short1'), 'password_short');
    assert.equal(passwordProblem('Password123!'), 'password_common');
    assert.equal(passwordProblem('1234567890'), 'password_common');
    assert.equal(passwordProblem('aaaaaaaaaaaa'), 'password_common');
    assert.equal(passwordProblem('abcabcabcabc'), 'password_common');
    assert.equal(passwordProblem('johnsmith-blue-77', 'johnsmith@example.com'), 'password_email');
    assert.equal(passwordProblem(pw, 'someone@example.com'), null);
  });

  // ── signed tokens
  await check('seal/unseal round trip, expiry, tamper', () => {
    const tok = seal('wallet', { w: 'abc', e: now + 1000 }, SECRET);
    assert.equal(unseal<{ w: string; e: number }>('wallet', tok, now, SECRET)?.w, 'abc');
    assert.equal(unseal('wallet', tok, now + 2000, SECRET), null);
    assert.equal(unseal('recover', tok, now, SECRET), null); // other label
    const [body, mac] = tok.split('.');
    assert.equal(unseal('wallet', `${b64({ w: 'evil', e: now + 1000 })}.${mac}`, now, SECRET), null);
    assert.equal(unseal('wallet', `${body}.${mac}x`, now, SECRET), null);
  });

  // ── wallet challenges
  const kp = generateKeyPairSync('ed25519');
  const raw = kp.publicKey.export({ format: 'der', type: 'spki' }).subarray(12);
  const wallet = bs58.encode(raw);
  await check('wallet signature: valid, wrong action, stale, wrong key', () => {
    const msg = walletChallenge(wallet, 'manage', now, SECRET);
    const sig = bs58.encode(edSign(null, Buffer.from(msg), kp.privateKey));
    assert.equal(verifyWalletSignature(wallet, 'manage', msg, sig, now + 1000, SECRET), true);
    assert.equal(verifyWalletSignature(wallet, 'unbind:google', msg, sig, now + 1000, SECRET), false);
    assert.equal(verifyWalletSignature(wallet, 'manage', msg, sig, now + 11 * 60_000, SECRET), false);
    const other = generateKeyPairSync('ed25519');
    const bad = bs58.encode(edSign(null, Buffer.from(msg), other.privateKey));
    assert.equal(verifyWalletSignature(wallet, 'manage', msg, bad, now + 1000, SECRET), false);
  });

  // ── lockout
  await check(`lockout after ${LOCKOUT_MAX_FAILURES} failures in an hour`, async () => {
    const log: { k: string; at: number }[] = [];
    const store: FailureStore = {
      async count(k, since) { return log.filter((x) => x.k === k && x.at > since).length; },
      async add(k, at) { log.push({ k, at }); },
    };
    const keys = ['email:a@b.co'];
    for (let i = 0; i < LOCKOUT_MAX_FAILURES - 1; i++) await recordFailure(store, keys, now + i);
    assert.equal(await isLocked(store, keys, now + 100), false);
    await recordFailure(store, keys, now + 100);
    assert.equal(await isLocked(store, keys, now + 101), true);
    assert.equal(await isLocked(store, ['email:other@b.co'], now + 101), false);
    assert.equal(await isLocked(store, keys, now + 60 * 60_000 + 200), false); // window passed
  });

  // ── Google id_token
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...rsa.publicKey.export({ format: 'jwk' }), kid: 'test-kid', alg: 'RS256', use: 'sig' };
  const jwks: Jwks = { keys: [jwk] };
  const clientId = 'client-123.apps.googleusercontent.com';
  const t0 = Math.floor(now / 1000);
  const base = {
    iss: 'https://accounts.google.com', aud: clientId, azp: clientId, sub: '1098765', email: 'Player@Example.com',
    email_verified: true, nonce: 'n-1', iat: t0, exp: t0 + 3600,
  };
  const mint = (claims: Record<string, unknown>, header: Record<string, unknown> = { alg: 'RS256', kid: 'test-kid' }, key = rsa.privateKey) => {
    const data = `${b64(header)}.${b64(claims)}`;
    return `${data}.${createSign('RSA-SHA256').update(data).sign(key).toString('base64url')}`;
  };
  const opts = { clientId, nonce: 'n-1', now };
  const reason = (tok: string, o = opts) => { try { verifyIdToken(tok, jwks, o); return 'ok'; } catch (e) { return (e as Error).message; } };
  await check('id_token: valid token accepted, email normalized', () => {
    assert.deepEqual(verifyIdToken(mint(base), jwks, opts), { sub: '1098765', email: 'player@example.com' });
  });
  await check('id_token: rejects bad signature / unknown kid / alg none', () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
    assert.equal(reason(mint(base, undefined, other.privateKey)), 'signature');
    assert.equal(reason(mint(base, { alg: 'RS256', kid: 'nope' })), 'kid');
    assert.equal(reason(`${b64({ alg: 'none', kid: 'test-kid' })}.${b64(base)}.`), 'alg');
    const [hd, , sg] = mint(base).split('.');
    assert.equal(reason(`${hd}.${b64({ ...base, sub: 'attacker' })}.${sg}`), 'signature');
  });
  await check('id_token: rejects wrong iss / aud / azp / expired / nonce / unverified email', () => {
    assert.equal(reason(mint({ ...base, iss: 'https://evil.example' })), 'iss');
    assert.equal(reason(mint({ ...base, aud: 'other-client' })), 'aud');
    assert.equal(reason(mint({ ...base, azp: 'other-client' })), 'azp');
    assert.equal(reason(mint({ ...base, exp: t0 - 120 })), 'exp');
    assert.equal(reason(mint({ ...base, iat: t0 + 600 })), 'iat');
    assert.equal(reason(mint({ ...base, nonce: 'n-2' })), 'nonce');
    assert.equal(reason(mint({ ...base, email_verified: false })), 'email_unverified');
    assert.equal(reason(mint({ ...base, iss: 'accounts.google.com' })), 'ok');
  });
  await check('PKCE pair is S256 of the verifier', () => {
    const { verifier, challenge } = pkcePair();
    assert.match(verifier, /^[\w-]{43}$/);
    assert.equal(challenge, createHash('sha256').update(verifier).digest('base64url'));
  });

  // ── migration cooldown
  await check('migration cooldown is 72 h', () => {
    assert.equal(MIGRATION_COOLDOWN_MS, 72 * 3600_000);
    assert.equal(cooldownLeft(null, now), 0);
    assert.equal(cooldownLeft(now - 1000, now), MIGRATION_COOLDOWN_MS - 1000);
    assert.equal(cooldownLeft(now - 71 * 3600_000, now), 3600_000);
    assert.equal(cooldownLeft(now - MIGRATION_COOLDOWN_MS, now), 0);
  });

  // ── recovery codes
  await check('recovery codes: 10 unique, readable format, normalize, hash-verify one-time material', async () => {
    const codes = generateRecoveryCodes();
    assert.equal(codes.length, RECOVERY_CODE_COUNT);
    assert.equal(new Set(codes).size, 10);
    for (const c of codes) assert.match(c, /^[A-HJKMNP-Z2-9]{4}(-[A-HJKMNP-Z2-9]{4}){3}$/);
    const c0 = codes[0];
    assert.equal(normalizeRecoveryCode(c0.toLowerCase().replace(/-/g, ' ')), c0.replace(/-/g, ''));
    assert.equal(normalizeRecoveryCode('short'), null);
    assert.equal(normalizeRecoveryCode('AAAA-AAAA-AAAA-AAA0'), null); // 0 maps to nothing valid
    const hc = await hashPassword(normalizeRecoveryCode(c0)!);
    assert.equal(await verifyPassword(normalizeRecoveryCode(c0)!, hc), true);
    assert.equal(await verifyPassword(normalizeRecoveryCode(codes[1])!, hc), false);
    assert.ok(!hc.includes(c0.replace(/-/g, '')));
  });

  // ── passkeys (software authenticator)
  const rpId = 'localhost';
  const origin = 'http://localhost:3100';
  type Auth = { alg: number; priv: KeyObject; cose: Buffer; credId: Buffer; count: number };
  const makeAuth = (alg: number): Auth => {
    const credId = randomBytes(32);
    if (alg === ALG_ES256) {
      const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
      const j = publicKey.export({ format: 'jwk' });
      const cose = cborEncode(new Map<number, unknown>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(j.x!, 'base64url')], [-3, Buffer.from(j.y!, 'base64url')]]));
      return { alg, priv: privateKey, cose, credId, count: 0 };
    }
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const j = publicKey.export({ format: 'jwk' });
    const cose = cborEncode(new Map<number, unknown>([[1, 3], [3, -257], [-1, Buffer.from(j.n!, 'base64url')], [-2, Buffer.from(j.e!, 'base64url')]]));
    return { alg, priv: privateKey, cose, credId, count: 0 };
  };
  const rpHash = (id = rpId) => createHash('sha256').update(id).digest();
  const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
  const cd = (type: string, challenge: string, o = origin) => Buffer.from(JSON.stringify({ type, challenge, origin: o, crossOrigin: false }));
  const register = (a: Auth, challenge: string, o: { fmt?: string; rp?: string; flags?: number; origin?: string } = {}) => {
    const idLen = Buffer.alloc(2); idLen.writeUInt16BE(a.credId.length);
    const authData = Buffer.concat([rpHash(o.rp), Buffer.from([o.flags ?? (FLAG_UP | FLAG_UV | FLAG_AT)]), u32(a.count), Buffer.alloc(16), idLen, a.credId, a.cose]);
    const att = cborEncode(new Map<string, unknown>([['fmt', o.fmt ?? 'none'], ['attStmt', new Map()], ['authData', authData]]));
    return { clientDataJSON: cd('webauthn.create', challenge, o.origin).toString('base64url'), attestationObject: att.toString('base64url') };
  };
  const assertWith = (a: Auth, challenge: string, o: { rp?: string; flags?: number; origin?: string; count?: number; type?: string } = {}) => {
    a.count = o.count ?? a.count + 1;
    const authData = Buffer.concat([rpHash(o.rp), Buffer.from([o.flags ?? (FLAG_UP | FLAG_UV)]), u32(a.count)]);
    const cdj = cd(o.type ?? 'webauthn.get', challenge, o.origin);
    const data = Buffer.concat([authData, createHash('sha256').update(cdj).digest()]);
    const signature = cryptoSign(a.alg === ALG_ES256 ? 'sha256' : 'RSA-SHA256', data, a.priv);
    return { clientDataJSON: cdj.toString('base64url'), authenticatorData: authData.toString('base64url'), signature: signature.toString('base64url') };
  };
  const why = (fn: () => unknown) => { try { fn(); return 'ok'; } catch (e) { return (e as Error).message; } };
  const exp = (challenge: string) => ({ challenge, origin, rpId });

  for (const [name, alg] of [['ES256', ALG_ES256], ['RS256', ALG_RS256]] as const) {
    await check(`passkey ${name}: register (fmt none) then assert, signCount stored`, () => {
      const a = makeAuth(alg);
      const cred = verifyRegistration(register(a, 'reg-challenge'), exp('reg-challenge'));
      assert.equal(cred.credentialId, a.credId.toString('base64url'));
      assert.equal(cred.alg, alg);
      const n1 = verifyAssertion(assertWith(a, 'get-1'), cred, exp('get-1'));
      assert.equal(n1, 1);
      const n2 = verifyAssertion(assertWith(a, 'get-2'), { ...cred, signCount: n1 }, exp('get-2'));
      assert.equal(n2, 2);
    });
  }
  await check('passkey registration rejects wrong challenge / origin / rpId / fmt / missing UP / bad CBOR', () => {
    const a = makeAuth(ALG_ES256);
    assert.equal(why(() => verifyRegistration(register(a, 'c1'), exp('c2'))), 'challenge');
    assert.equal(why(() => verifyRegistration(register(a, 'c1', { origin: 'https://evil.example' }), exp('c1'))), 'origin');
    assert.equal(why(() => verifyRegistration(register(a, 'c1', { rp: 'evil.example' }), exp('c1'))), 'rp_id');
    assert.equal(why(() => verifyRegistration(register(a, 'c1', { fmt: 'packed' }), exp('c1'))), 'fmt');
    assert.equal(why(() => verifyRegistration(register(a, 'c1', { flags: FLAG_AT }), exp('c1'))), 'user_presence');
    assert.notEqual(why(() => verifyRegistration({ clientDataJSON: cd('webauthn.create', 'c1').toString('base64url'), attestationObject: 'oWNmbXQ' }, exp('c1'))), 'ok');
    assert.equal(why(() => cborDecode(Buffer.from([0x5f]))), 'cbor_indefinite');
  });
  await check('passkey assertion rejects wrong challenge / origin / rpId / type / no UP / forged sig / replayed signCount / other key', () => {
    const a = makeAuth(ALG_ES256);
    const cred = verifyRegistration(register(a, 'r'), exp('r'));
    assert.equal(why(() => verifyAssertion(assertWith(a, 'x'), cred, exp('y'))), 'challenge');
    assert.equal(why(() => verifyAssertion(assertWith(a, 'x', { origin: 'https://evil.example' }), cred, exp('x'))), 'origin');
    assert.equal(why(() => verifyAssertion(assertWith(a, 'x', { rp: 'evil.example' }), cred, exp('x'))), 'rp_id');
    assert.equal(why(() => verifyAssertion(assertWith(a, 'x', { type: 'webauthn.create' }), cred, exp('x'))), 'type');
    assert.equal(why(() => verifyAssertion(assertWith(a, 'x', { flags: FLAG_UV }), cred, exp('x'))), 'user_presence');
    const good = assertWith(a, 'x', { count: 7 });
    const forged = { ...good, signature: Buffer.from(good.signature, 'base64url').reverse().toString('base64url') };
    assert.equal(why(() => verifyAssertion(forged, cred, exp('x'))), 'signature');
    assert.equal(why(() => verifyAssertion(good, { ...cred, signCount: 7 }, exp('x'))), 'sign_count');
    assert.equal(why(() => verifyAssertion(good, { ...cred, signCount: 9 }, exp('x'))), 'sign_count');
    assert.equal(why(() => verifyAssertion(good, { ...cred, signCount: 6 }, exp('x'))), 'ok');
    const b = makeAuth(ALG_ES256);
    assert.equal(why(() => verifyAssertion(assertWith(b, 'x'), cred, exp('x'))), 'signature');
    // authenticators without a counter (always 0) are accepted
    const z = makeAuth(ALG_ES256);
    const zc = verifyRegistration(register(z, 'r'), exp('r'));
    assert.equal(why(() => verifyAssertion(assertWith(z, 'x', { count: 0 }), zc, exp('x'))), 'ok');
  });

  console.log(`\n${passed} checks passed`);
}

/** Tiny CBOR encoder for the software authenticator (test only). */
function cborEncode(v: unknown): Buffer {
  const head = (major: number, n: number) => {
    if (n < 24) return Buffer.from([(major << 5) | n]);
    if (n < 256) return Buffer.from([(major << 5) | 24, n]);
    if (n < 65536) { const b = Buffer.alloc(3); b[0] = (major << 5) | 25; b.writeUInt16BE(n, 1); return b; }
    const b = Buffer.alloc(5); b[0] = (major << 5) | 26; b.writeUInt32BE(n, 1); return b;
  };
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (typeof v === 'string') { const b = Buffer.from(v, 'utf8'); return Buffer.concat([head(3, b.length), b]); }
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cborEncode(k), cborEncode(x)])]);
  throw new Error('cborEncode: unsupported');
}

main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
