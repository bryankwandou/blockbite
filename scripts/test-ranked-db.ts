/**
 * Real-SQL tests for the stores that other suites only fake: revocation,
 * auth_nonces, purchase/credit idempotency, attempts and UTC day rollover.
 *
 *   RANKED_TEST_DATABASE_URL=postgres://... npx tsx scripts/test-ranked-db.ts
 *   (offline: add  --import ./scripts/pglite-neon-shim.ts  after `tsx`)
 *
 * Uses a throwaway schema `rk_test_<random>`, dropped at the end.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

const url = process.env.RANKED_TEST_DATABASE_URL;
if (!url) throw new Error('set RANKED_TEST_DATABASE_URL');
const schema = `rk_test_${randomBytes(4).toString('hex')}`;
process.env.blockbite_DATABASE_URL = url;
process.env.RANKED_DB_SCHEMA = schema;
process.env.RANKED_SECRET = randomBytes(32).toString('hex');

let passed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => unknown | Promise<unknown>) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failures.push(name); console.log(`  FAIL ${name}\n       ${(e as Error).stack?.split('\n').slice(0, 3).join('\n       ')}`); }
}

async function main() {
  const { neon } = await import('@neondatabase/serverless');
  const raw = neon(url!);
  const db = await import('../lib/ranked/db');
  const rev = await import('../lib/ranked/revocation');
  const { consumeNonce } = await import('../lib/safeEqual');
  const rules = await import('../lib/ranked/rules');
  const hex = (n = 6) => randomBytes(n).toString('hex');
  const w = () => `W${hex()}`;
  const state = () => rules.initialState([0, 1, 2]);

  console.log('revocation (real SQL)');
  await test('a revoked sid is dead, others are not; revoking twice is harmless', async () => {
    const wallet = w(), sid = `s${hex(4)}`;
    const s = { wallet, sid, iat: Date.now() };
    assert.equal(await rev.isSessionRevoked(s), false);
    await rev.revokeSession(sid, Date.now() + 3600_000);
    await rev.revokeSession(sid, Date.now() + 3600_000);
    assert.equal(await rev.isSessionRevoked(s), true);
    assert.equal(await rev.isSessionRevoked({ ...s, sid: 'other' }), false);
  });
  await test('revokeAll kills older tokens only, never moves backwards, is per wallet', async () => {
    const a = w(), b = w(), t = Date.now();
    await rev.revokeAll(a, t);
    assert.equal(await rev.isSessionRevoked({ wallet: a, sid: 'x1', iat: t - 1000 }), true);
    assert.equal(await rev.isSessionRevoked({ wallet: a, sid: 'x2', iat: t + 1000 }), false);
    assert.equal(await rev.isSessionRevoked({ wallet: b, sid: 'x3', iat: t - 1000 }), false);
    await rev.revokeAll(a, t - 500_000);
    assert.equal(await rev.isSessionRevoked({ wallet: a, sid: 'x4', iat: t - 1000 }), true);
    await rev.revokeAll(a, t + 5000);
    assert.equal(await rev.isSessionRevoked({ wallet: a, sid: 'x5', iat: t + 1000 }), true);
  });
  await test('expired revocation rows are pruned (prune forced)', async () => {
    const sid = `exp${hex(4)}`;
    await rev.revokeSession(sid, Date.now() - 1000);
    const orig = Math.random; Math.random = () => 0;
    try { await rev.revokeSession(`live${hex(3)}`, Date.now() + 60_000); } finally { Math.random = orig; }
    const rows = await raw.query(`SELECT 1 FROM ${schema}.session_revocations WHERE sid = $1`, [sid]);
    assert.equal(rows.length, 0);
  });
  await test('not_before beyond 2^31 round-trips as a number', async () => {
    const wl = w(); const t = 1_900_000_000_123;
    await rev.revokeAll(wl, t);
    assert.equal(await rev.isSessionRevoked({ wallet: wl, sid: 'q', iat: t - 1 }), true);
    assert.equal(await rev.isSessionRevoked({ wallet: wl, sid: 'q', iat: t }), false);
  });
  await test('stale not_before rows are pruned when the prune fires', async () => {
    const wl = w();
    await rev.revokeAll(wl, Date.now() - 24 * 3600_000);
    const orig = Math.random; Math.random = () => 0;
    try { await rev.revokeAll(w(), Date.now()); } finally { Math.random = orig; }
    const rows = await raw.query(`SELECT 1 FROM ${schema}.session_not_before WHERE wallet = $1`, [wl]);
    assert.equal(rows.length, 0);
  });

  console.log('auth_nonces (real SQL)');
  await test('a nonce is accepted once, refused on reuse, scoped by scope', async () => {
    const n = hex(12), exp = Date.now() + 60_000;
    assert.equal(await consumeNonce('ranked', n, exp), true);
    assert.equal(await consumeNonce('ranked', n, exp), false);
    assert.equal(await consumeNonce('admin', n, exp), true);
  });
  await test('20 concurrent consumes of one nonce: exactly one wins', async () => {
    const n = hex(12);
    const r = await Promise.all(Array.from({ length: 20 }, () => consumeNonce('ranked', n, Date.now() + 60_000)));
    assert.equal(r.filter(Boolean).length, 1);
  });
  await test('expired nonces are pruned when the prune fires', async () => {
    const old = hex(12);
    await consumeNonce('prune', old, Date.now() - 5000);
    const orig = Math.random; Math.random = () => 0;
    try { await consumeNonce('prune', hex(12), Date.now() + 60_000); } finally { Math.random = orig; }
    const rows = await raw.query(`SELECT 1 FROM ${schema}.auth_nonces WHERE nonce = $1`, [`prune:${old}`]);
    assert.equal(rows.length, 0);
  });

  console.log('credits and purchases');
  const buy = (wallet: string, sig: string, tickets: number, ms = Date.now(), vault = 1_000_000n) =>
    db.creditPurchase({ sig, wallet, tickets, vaultAmount: vault, referralAccount: null, blockTimeMs: ms });
  await test('a signature credits once; replay and concurrent replays add nothing', async () => {
    const wl = w(), sig = `sig${hex(8)}`;
    assert.equal(await buy(wl, sig, 5), true);
    assert.equal(await buy(wl, sig, 5), false);
    const r = await Promise.all(Array.from({ length: 10 }, () => buy(wl, sig, 5)));
    assert.equal(r.filter(Boolean).length, 0);
    assert.equal(await db.getCredits(wl), 5);
    const rows = await raw.query(`SELECT count(*)::int AS n FROM ${schema}.rk_purchases WHERE sig = $1`, [sig]);
    assert.equal(rows[0].n, 1);
  });
  await test('10 concurrent first-time credits of one signature: exactly one wins', async () => {
    const wl = w(), sig = `sig${hex(8)}`;
    const r = await Promise.all(Array.from({ length: 10 }, () => buy(wl, sig, 3)));
    assert.equal(r.filter(Boolean).length, 1);
    assert.equal(await db.getCredits(wl), 3);
  });
  await test('different signatures accumulate; the same signature for another wallet is refused', async () => {
    const wl = w(), other = w();
    await buy(wl, `a${hex()}`, 2);
    const s2 = `b${hex()}`;
    await buy(wl, s2, 4);
    assert.equal(await db.getCredits(wl), 6);
    assert.equal(await buy(other, s2, 4), false);
    assert.equal(await db.getCredits(other), 0);
  });
  await test('credits cannot go negative (CHECK n >= 0)', async () => {
    const wl = w();
    await buy(wl, `c${hex()}`, 1);
    await assert.rejects(raw.query(`UPDATE ${schema}.rk_credits SET n = n - 2 WHERE wallet = $1`, [wl]), /check|violat/i);
  });

  console.log('attempts and day rollover');
  const day = (off: number) => new Date(Date.UTC(2026, 0, 10 + off)).toISOString().slice(0, 10);
  await test('a start without credits spends nothing and opens nothing', async () => {
    const wl = w();
    assert.deepEqual(await db.startRun(`r${hex()}`, wl, day(0), state()), { ok: false, reason: 'no_credits' });
    assert.equal(await db.attemptsOn(wl, day(0)), 0);
  });
  await test('3 attempts per day; the 4th is refused and keeps its credit', async () => {
    const wl = w(); await buy(wl, `d${hex()}`, 10);
    for (let i = 1; i <= 3; i++) assert.deepEqual(await db.startRun(`r${hex()}`, wl, day(0), state()), { ok: true, attempt: i });
    assert.deepEqual(await db.startRun(`r${hex()}`, wl, day(0), state()), { ok: false, reason: 'max_attempts' });
    assert.equal(await db.getCredits(wl), 7);
  });
  await test('the next UTC day resets attempts to 1 for the same wallet', async () => {
    const wl = w(); await buy(wl, `e${hex()}`, 10);
    for (let i = 0; i < 3; i++) await db.startRun(`r${hex()}`, wl, day(0), state());
    assert.deepEqual(await db.startRun(`r${hex()}`, wl, day(1), state()), { ok: true, attempt: 1 });
    assert.equal(await db.attemptsOn(wl, day(0)), 3);
    assert.equal(await db.attemptsOn(wl, day(1)), 1);
  });
  await test('10 concurrent starts with 1 credit: one run, credit ends at 0', async () => {
    const wl = w(); await buy(wl, `f${hex()}`, 1);
    const r = await Promise.all(Array.from({ length: 10 }, () => db.startRun(`r${hex()}`, wl, day(2), state())));
    assert.equal(r.filter((x) => x.ok).length, 1);
    assert.equal(await db.getCredits(wl), 0);
    assert.equal(await db.attemptsOn(wl, day(2)), 1);
  });
  await test('concurrent starts: credits spent always equal runs opened', async () => {
    const wl = w(); await buy(wl, `g${hex()}`, 8);
    const r = await Promise.all(Array.from({ length: 8 }, () => db.startRun(`r${hex()}`, wl, day(3), state())));
    const ok = r.filter((x) => x.ok).length;
    assert.ok(ok >= 1 && ok <= 3, `ok=${ok}`);
    assert.equal(await db.getCredits(wl), 8 - ok);
    assert.equal(await db.attemptsOn(wl, day(3)), ok);
  });
  await test('pool day is the UTC day of block time, at the 23:59:59.999 / 00:00:00 edge', async () => {
    const wl = w();
    const edge = Date.parse('2031-05-09T00:00:00Z');
    await buy(wl, `h${hex()}`, 1, edge - 1, 100n);
    await buy(wl, `i${hex()}`, 1, edge, 200n);
    await buy(wl, `j${hex()}`, 1, edge + 86_400_000 - 1, 400n);
    const m = await db.vaultInflow('2031-05-08', '2031-05-11');
    assert.equal(m.get('2031-05-08'), 100n);
    assert.equal(m.get('2031-05-09'), 600n);
    assert.equal(m.get('2031-05-10'), undefined);
    assert.equal((await db.vaultInflow('2031-05-09', '2031-05-10')).get('2031-05-09'), 600n);
  });

  await raw.query(`DROP SCHEMA ${schema} CASCADE`);
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) { console.log(failures.map((f) => ` - ${f}`).join('\n')); process.exit(1); }
}
main().catch(async (e) => {
  console.error(e);
  try { const { neon } = await import('@neondatabase/serverless'); await neon(url!).query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); } catch { /* best effort */ }
  process.exit(1);
});
