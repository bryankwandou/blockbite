/**
 * Session revocation: token formats, logout, logout-all, fail-closed. No real DB:
 * a fake Query models the two tables.   npx tsx scripts/test-revocation.ts
 */
import assert from 'node:assert/strict';
import { createHmac, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import bs58 from 'bs58';

function newWallet() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const address = bs58.encode(publicKey.export({ format: 'der', type: 'spki' }).subarray(12));
  return { address, sign: (msg: string) => bs58.encode(sign(null, Buffer.from(msg, 'utf8'), privateKey)) };
}

process.env.RANKED_SECRET = randomBytes(32).toString('hex');

let passed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => unknown | Promise<unknown>) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failures.push(name); console.log(`  FAIL ${name}\n       ${(e as Error).message}`); }
}

async function main() {
  const auth = await import('../lib/ranked/auth');
  const rev = await import('../lib/ranked/revocation');
  const TTL = 12 * 3600_000;

  const revoked = new Set<string>();
  const nbs = new Map<string, number>();
  let down = false;
  const q: import('../lib/ranked/revocation').Query = async (text, p = []) => {
    if (down) throw new Error('db down');
    if (text.startsWith('SELECT EXISTS')) return [{ revoked: revoked.has(p[0] as string), nb: nbs.get(p[1] as string) ?? null }];
    if (text.includes('INSERT INTO') && text.includes('session_revocations')) { revoked.add(p[0] as string); return []; }
    if (text.includes('INSERT INTO') && text.includes('session_not_before')) { nbs.set(p[0] as string, Math.max(nbs.get(p[0] as string) ?? 0, p[1] as number)); return []; }
    return [];
  };
  const req = (t: string) => new Request('http://x/', { headers: { authorization: `Bearer ${t}` } });

  async function login(kp = newWallet(), now = Date.now()) {
    const w = kp.address;
    const msg = auth.challenge(w, now);
    const tok = auth.signIn(w, msg, kp.sign(msg), now)!;
    return { w, tok };
  }
  function legacyToken(w: string, exp: number) {
    const key = createHmac('sha256', process.env.RANKED_SECRET!).update('blockbite:ranked:session').digest();
    return `${w}.${exp}.${createHmac('sha256', key).update(`${w}.${exp}`).digest('base64url')}`;
  }

  console.log('token formats');
  await test('new tokens have 4 parts, unique sid, and verify', async () => {
    const a = await login(); const b = await login(newWallet());
    assert.equal(a.tok.split('.').length, 4);
    assert.equal(auth.sessionWallet(a.tok), a.w);
    assert.notEqual(a.tok.split('.')[2], b.tok.split('.')[2]);
  });
  await test('sid cannot be swapped or stripped (mac covers it)', async () => {
    const { w, tok } = await login();
    const [, exp, , m] = tok.split('.');
    assert.equal(auth.sessionWallet(`${w}.${exp}.AAAAAAAAAAAAAAAA.${m}`), null);
    assert.equal(auth.sessionWallet(`${w}.${exp}.${m}`), null);
  });
  await test('old 3-part tokens still verify until expiry, and expired ones do not', async () => {
    const w = newWallet().address;
    const t = legacyToken(w, Date.now() + 1000);
    assert.equal(auth.sessionWallet(t), w);
    assert.equal(auth.sessionWallet(t, Date.now() + 2000), null);
    assert.equal(auth.sessionWallet(`${w}.${Date.now() + 1000}.forged`), null);
  });

  console.log('revocation');
  await test('fresh session passes the async check', async () => {
    const { w, tok } = await login();
    assert.equal(await auth.walletFromRequestAsync(req(tok), q), w);
  });
  await test('logout revokes only that token', async () => {
    const kp = newWallet();
    const a = await login(kp); const b = await login(kp);
    const s = auth.parseSession(a.tok)!;
    await rev.revokeSession(s.sid, s.exp, q);
    assert.equal(await auth.walletFromRequestAsync(req(a.tok), q), null);
    assert.equal(await auth.walletFromRequestAsync(req(b.tok), q), b.w);
  });
  await test('logout works on an old-format token too', async () => {
    const w = newWallet().address;
    const t = legacyToken(w, Date.now() + TTL);
    assert.equal(await auth.walletFromRequestAsync(req(t), q), w);
    const s = auth.parseSession(t)!;
    await rev.revokeSession(s.sid, s.exp, q);
    assert.equal(await auth.walletFromRequestAsync(req(t), q), null);
  });
  await test('logout-all kills older sessions (v1 and v2) but not a later sign-in', async () => {
    const kp = newWallet();
    const t0 = Date.now() - 3600_000;
    const old = await login(kp, t0);
    const legacy = legacyToken(old.w, t0 + TTL);
    await rev.revokeAll(old.w, Date.now() - 1000, q);
    assert.equal(await auth.walletFromRequestAsync(req(old.tok), q), null);
    assert.equal(await auth.walletFromRequestAsync(req(legacy), q), null);
    const fresh = await login(kp);
    assert.equal(await auth.walletFromRequestAsync(req(fresh.tok), q), old.w);
  });
  await test('logout-all is per wallet and never moves backwards', async () => {
    const a = await login(); const b = await login();
    await rev.revokeAll(a.w, Date.now() + 5000, q);
    assert.equal(await auth.walletFromRequestAsync(req(b.tok), q), b.w);
    await rev.revokeAll(a.w, 1, q);
    assert.ok(nbs.get(a.w)! > Date.now());
  });
  await test('isDead boundaries', () => {
    assert.equal(rev.isDead(100, { revoked: false, notBefore: null }), false);
    assert.equal(rev.isDead(100, { revoked: false, notBefore: 100 }), false);
    assert.equal(rev.isDead(99, { revoked: false, notBefore: 100 }), true);
    assert.equal(rev.isDead(100, { revoked: true, notBefore: null }), true);
  });

  console.log('fail closed');
  await test('DB down: authed check throws SessionCheckError; garbage token still plain null', async () => {
    const { tok } = await login();
    down = true;
    await assert.rejects(auth.walletFromRequestAsync(req(tok), q), auth.SessionCheckError);
    assert.equal(await auth.walletFromRequestAsync(req('junk'), q), null);
    assert.equal(await auth.walletFromRequestAsync(new Request('http://x/'), q), null);
    down = false;
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
