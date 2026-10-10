/** Postgres rate limiter with an injected Query (no real DB).   npx tsx scripts/test-rate-limit.ts */
import assert from 'node:assert/strict';

let passed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => unknown | Promise<unknown>) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failures.push(name); console.log(`  FAIL ${name}\n       ${(e as Error).message}`); }
}

/** Fake of the single counting statement: per-key hit list shared across "instances". */
function fakeDb() {
  const hits = new Map<string, number[]>();
  const calls: { text: string; params?: unknown[] }[] = [];
  const q = async (text: string, params?: unknown[]) => {
    calls.push({ text, params });
    if (!text.includes('INSERT INTO')) return [];
    const key = params![0] as string;
    const secs = params![1] as number;
    const now = Date.now();
    const list = (hits.get(key) ?? []).filter((t) => t >= now - secs * 1000);
    const n = list.length + 1;
    list.push(now);
    hits.set(key, list);
    return [{ n }];
  };
  return { q, calls };
}

async function main() {
  delete process.env.KV_REST_API_URL; delete process.env.KV_REST_API_TOKEN;
  delete process.env.blockbite_DATABASE_URL; delete process.env.RANKED_DATABASE_URL; delete process.env.DATABASE_URL;
  const { pgLimit, rateLimit } = await import('../lib/rate-limit');

  await test('allows up to the limit then blocks', async () => {
    const db = fakeDb();
    const r: boolean[] = [];
    for (let i = 0; i < 5; i++) r.push((await pgLimit('k1', 3, 60_000, db.q)).allowed);
    assert.deepEqual(r, [true, true, true, false, false]);
  });
  await test('remaining counts down and floors at 0', async () => {
    const db = fakeDb();
    assert.equal((await pgLimit('k', 2, 1000, db.q)).remaining, 1);
    assert.equal((await pgLimit('k', 2, 1000, db.q)).remaining, 0);
    assert.equal((await pgLimit('k', 2, 1000, db.q)).remaining, 0);
  });
  await test('keys are independent; shared db = shared count across callers', async () => {
    const db = fakeDb();
    await pgLimit('a', 1, 1000, db.q);
    assert.equal((await pgLimit('b', 1, 1000, db.q)).allowed, true);
    assert.equal((await pgLimit('a', 1, 1000, db.q)).allowed, false);
  });
  await test('window is passed in whole seconds, min 1', async () => {
    const db = fakeDb();
    await pgLimit('k', 5, 900_000, db.q);
    await pgLimit('k', 5, 10, db.q);
    const ins = db.calls.filter((c) => c.text.includes('INSERT INTO'));
    assert.equal(ins[0].params![1], 900);
    assert.equal(ins[1].params![1], 1);
  });
  await test('db errors propagate from pgLimit', async () => {
    await assert.rejects(pgLimit('k', 1, 1000, async () => { throw new Error('down'); }), /down/);
  });
  await test('garbage count is an error, not an allow', async () => {
    await assert.rejects(pgLimit('k', 1, 1000, async () => [{}]), /no count/);
  });
  await test('without any DB url rateLimit uses memory and still limits', async () => {
    const r: boolean[] = [];
    for (let i = 0; i < 3; i++) r.push((await rateLimit('mem-test', 2, 60_000)).allowed);
    assert.deepEqual(r, [true, true, false]);
  });
  await test('db url set but unreachable: rateLimit degrades to memory, never throws', async () => {
    process.env.RANKED_DATABASE_URL = 'postgres://u:p@127.0.0.1:1/none';
    const r: boolean[] = [];
    for (let i = 0; i < 3; i++) r.push((await rateLimit('mem-fallback', 2, 60_000)).allowed);
    assert.deepEqual(r, [true, true, false]);
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
