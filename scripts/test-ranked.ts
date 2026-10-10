/**
 * Ranked test suite: rules, dealing, sign-in, purchase verification, and the
 * API routes end to end against a throwaway Postgres schema.
 *
 *   RANKED_TEST_DATABASE_URL=postgres://… npx tsx scripts/test-ranked.ts
 *
 * The schema `rk_test_<random>` is created and dropped by the run; the
 * database's real tables are never touched.
 */
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import bs58 from 'bs58';

const url = process.env.RANKED_TEST_DATABASE_URL;
if (!url) throw new Error('set RANKED_TEST_DATABASE_URL');
const schema = `rk_test_${randomBytes(4).toString('hex')}`;
process.env.blockbite_DATABASE_URL = url;
process.env.RANKED_DB_SCHEMA = schema;
process.env.RANKED_SECRET = randomBytes(32).toString('hex');
// Unreachable RPC carrying a fake key, to prove errors never echo it.
process.env.NEXT_PUBLIC_RPC_URL = 'http://127.0.0.1:9/?api-key=leakcheck';

let passed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => unknown | Promise<unknown>) {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`  FAIL ${name}\n       ${(e as Error).stack?.split('\n').slice(0, 3).join('\n       ')}`);
  }
}

function newWallet() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(12);
  const address = bs58.encode(raw);
  return { address, sign: (msg: string) => bs58.encode(sign(null, Buffer.from(msg, 'utf8'), privateKey)) };
}

async function main() {
  const rules = await import('../lib/ranked/rules');
  const seed = await import('../lib/ranked/seed');
  const { replayRun } = await import('../lib/ranked/replay');
  const auth = await import('../lib/ranked/auth');
  const { verifyPurchaseTx } = await import('../lib/ranked/purchase-verify');
  const cfg = await import('../lib/ranked/config');
  const db = await import('../lib/ranked/db');
  const { neon } = await import('@neondatabase/serverless');
  const routes = {
    auth: (await import('../app/api/ranked/auth/route')).POST,
    me: (await import('../app/api/ranked/me/route')).GET,
    start: (await import('../app/api/ranked/start/route')).POST,
    play: (await import('../app/api/ranked/play/route')).POST,
    run: (await import('../app/api/ranked/run/route')).GET,
    board: (await import('../app/api/ranked/leaderboard/route')).GET,
    day: (await import('../app/api/ranked/day/route')).GET,
    credit: (await import('../app/api/ranked/credit/route')).POST,
    proof: (await import('../app/api/ranked/proof/route')).GET,
    avatarGet: (await import('../app/api/profile/avatar/route')).GET,
    avatarPost: (await import('../app/api/profile/avatar/route')).POST,
  };
  const results = await import('../lib/ranked/results');
  const merkle = await import('../lib/ranked/merkle');
  const pix = await import('../lib/ranked/prize-ix');
  const { boardFromHex, boardToHex, applyMove, initialState, PIECES, fits, isStuck, RulesError } = rules;

  // Greedy bot: the legal placement that scores most right now.
  type S = import('../lib/ranked/rules').RankedState;
  function bestMove(s: S) {
    let best: { slot: 0 | 1 | 2; row: number; col: number; pts: number } | null = null;
    const b = boardFromHex(s.board);
    for (const slot of [0, 1, 2] as const) {
      const p = s.tray[slot];
      if (p === null) continue;
      for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
        if (!fits(b, p, row, col)) continue;
        const pts = applyMove(s, { slot, row, col }).points;
        if (!best || pts > best.pts) best = { slot, row, col, pts };
      }
    }
    return best;
  }

  const TODAY = seed.dayOf(Date.now());
  const SEED = seed.dailySeed(TODAY);

  console.log('rules');
  await test('same position and seed deal the same tray; different seeds differ', () => {
    const a = seed.trayFor(SEED, boardToHex(0n), 0);
    assert.deepEqual(seed.trayFor(SEED, boardToHex(0n), 0), a);
    const other = seed.dailySeed('2020-01-01');
    const diff = Array.from({ length: 20 }, (_, i) => seed.trayFor(other, boardToHex(BigInt(i)), i).join())
      .filter((t, i) => t !== seed.trayFor(SEED, boardToHex(BigInt(i)), i).join()).length;
    assert.ok(diff >= 15, `only ${diff}/20 trays differed`);
  });
  await test('dealing follows piece weights (100k draws within 2%)', () => {
    const counts = new Array(PIECES.length).fill(0);
    for (let i = 0; i < 33_334; i++) for (const p of seed.trayFor(SEED, boardToHex(0n), i)) counts[p!]++;
    const total = PIECES.reduce((s, p) => s + p.weight, 0);
    PIECES.forEach((p, i) => assert.ok(Math.abs(counts[i] / 100_002 - p.weight / total) < 0.02, p.id));
  });
  await test('illegal moves are rejected', () => {
    const s = initialState([0, 1, 2]);
    assert.throws(() => applyMove(s, { slot: 0, row: 8, col: 0 }), RulesError);
    assert.throws(() => applyMove(s, { slot: 0, row: -1, col: 0 }), RulesError);
    assert.throws(() => applyMove(s, { slot: 3 as 0, row: 0, col: 0 }), RulesError);
    const s2 = applyMove(s, { slot: 0, row: 0, col: 0 }).state;
    assert.throws(() => applyMove(s2, { slot: 0, row: 1, col: 1 }), RulesError); // slot used
    assert.throws(() => applyMove(s2, { slot: 1, row: 0, col: 0 }), RulesError); // overlap
    assert.throws(() => applyMove(s, { slot: 0, row: 0.5, col: 0 }), RulesError);
  });
  await test('a full row clears and scores like the adventure engine', () => {
    const h = PIECES.findIndex((p) => p.id === 'tetro_i_h');
    let s = initialState([h, h, null]);
    s = applyMove(s, { slot: 0, row: 3, col: 0 }).state;
    const r = applyMove(s, { slot: 1, row: 3, col: 4 });
    assert.deepEqual(r.rows, [3]);
    assert.equal(boardFromHex(r.state.board), 0n);
    assert.ok(r.perfect);
    assert.equal(r.points, 80 + 5000); // 8 blocks × 10 + perfect board
    assert.equal(r.state.chain, 1);
    assert.equal(r.state.perfectNext, true);
  });
  await test('stuck is detected only when no remaining piece fits', () => {
    const big = PIECES.findIndex((p) => p.id === 'rect_3x2');
    const mono = PIECES.findIndex((p) => p.id === 'mono');
    const checker = BigInt('0x' + 'aa55'.repeat(4));
    assert.ok(isStuck(checker, [big, null, null]));
    assert.ok(!isStuck(0n, [big, null, null]));
    assert.ok(!isStuck(checker, [big, mono, null]) === !isStuck(checker, [mono, null, null]));
    assert.ok(!isStuck(checker, [null, null, null]));
  });
  await test('replaying a bot game from its log reproduces board and score exactly (50 games)', () => {
    for (let g = 0; g < 50; g++) {
      const sd = seed.dailySeed(`2030-01-${String((g % 28) + 1).padStart(2, '0')}`) ;
      let s = initialState(seed.trayFor(sd, boardToHex(0n), 0));
      const log: { m: [number, number, number][] }[] = [];
      let batch: [number, number, number][] = [];
      while (!s.over) {
        const m = bestMove(s)!;
        s = applyMove(s, m).state;
        batch.push([m.slot, m.row, m.col]);
        if (s.over || rules.trayEmpty(s.tray)) {
          log.push({ m: batch });
          batch = [];
          if (!s.over) s = rules.dealTray(s, seed.trayFor(sd, s.board, s.moves));
        }
        assert.ok(s.moves < 5000);
      }
      assert.deepEqual(replayRun(sd, log), s);
    }
  });

  console.log('sign-in');
  const alice = newWallet();
  const bob = newWallet();
  await test('a correctly signed challenge gives a session for that wallet', () => {
    const msg = auth.challenge(alice.address);
    const tok = auth.signIn(alice.address, msg, alice.sign(msg));
    assert.ok(tok);
    assert.equal(auth.sessionWallet(tok), alice.address);
  });
  await test('wrong signer, edited message, stale message and forged tokens are refused', () => {
    const msg = auth.challenge(alice.address);
    assert.equal(auth.signIn(alice.address, msg, bob.sign(msg)), null);
    const edited = msg.replace('Nonce: ', 'Nonce: x');
    assert.equal(auth.signIn(alice.address, edited, alice.sign(edited)), null);
    const old = auth.challenge(alice.address, Date.now() - 11 * 60_000);
    assert.equal(auth.signIn(alice.address, old, alice.sign(old)), null);
    const bobMsg = auth.challenge(bob.address);
    assert.equal(auth.signIn(alice.address, bobMsg, alice.sign(bobMsg)), null);
    const tok = auth.signIn(alice.address, msg, alice.sign(msg))!;
    const [, exp, sid, mac] = tok.split(".");
    assert.equal(auth.sessionWallet(`${bob.address}.${exp}.${sid}.${mac}`), null);
    assert.equal(auth.sessionWallet(`${alice.address}.${Number(exp) + 1}.${sid}.${mac}`), null);
    assert.equal(auth.sessionWallet(`${alice.address}.${Date.now() - 1}.${sid}.${mac}`), null);
  });

  console.log('purchase verification');
  const W = alice.address;
  const VAULT = cfg.PRIZE_VAULT.toBase58();
  const TEAM = cfg.TEAM_USDC_ACCOUNT.toBase58();
  const REFERRER = bob.address;
  const { usdcAta } = await import('../lib/ranked/purchase-verify');
  const REF = usdcAta(REFERRER)!;
  // Mid-day, so the age and results-cut rules never trigger by accident.
  const NOW = Date.parse('2026-10-06T12:00:00Z');
  const BT = Math.floor(NOW / 1000) - 30;
  const ok = (tickets: number, referralAccount: string | null) =>
    ({ tickets, vaultAmount: BigInt(tickets * 700_000), referralAccount, blockTimeMs: BT * 1000 });
  const xfer = (dest: string, amount: number, authority = W) => ({
    program: 'spl-token',
    parsed: { type: 'transferChecked', info: { authority, destination: dest, mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', source: 'src', tokenAmount: { amount: String(amount) } } },
  });
  const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  const REF_OWNER = newWallet().address;
  // Every destination is listed as a USDC account owned by REF_OWNER unless
  // `balances` overrides it (what jsonParsed puts in meta.postTokenBalances).
  const tx = (ixs: unknown[], err: unknown = null, signer = W,
    balances: Record<string, { mint: string; owner: string } | null> = {}) => {
    const dests = [...new Set((ixs as { parsed?: { info?: { destination?: string } } }[])
      .map((i) => i.parsed?.info?.destination).filter((d): d is string => !!d))];
    const accountKeys = [{ pubkey: signer, signer: true }, ...dests.map((d) => ({ pubkey: d, signer: false }))];
    const postTokenBalances = dests.flatMap((d, i) => {
      const b = d in balances ? balances[d] : { mint: USDC, owner: REF_OWNER };
      return b ? [{ accountIndex: i + 1, ...b }] : [];
    });
    return { blockTime: BT, meta: { err, innerInstructions: [], postTokenBalances }, transaction: { message: { accountKeys, instructions: ixs } } };
  };
  await test('valid purchases credit the right ticket count', () => {
    assert.deepEqual(verifyPurchaseTx(tx([xfer(VAULT, 2_100_000), xfer(TEAM, 900_000)]) as never, W, null, NOW), ok(3, null));
    assert.deepEqual(verifyPurchaseTx(tx([xfer(VAULT, 700_000), xfer(TEAM, 250_000), xfer(REF, 50_000)]) as never, W, REFERRER, NOW), ok(1, REF));
  });
  await test('underpaying, skimming, extra recipients, foreign signers and failures are refused', () => {
    const bad: [unknown, string][] = [
      [tx([xfer(VAULT, 700_000), xfer(TEAM, 299_999)]), 'team short'],
      [tx([xfer(VAULT, 699_999), xfer(TEAM, 300_001)]), 'vault short'],
      [tx([xfer(VAULT, 700_000), xfer(TEAM, 250_000), xfer(REF, 40_000), xfer('Other111111111111111111111111111111111111', 10_000)]), 'two referrers'],
      [tx([xfer(VAULT, 700_000), xfer(TEAM, 200_000), xfer(REF, 100_000)]), 'referral too big'],
      [tx([xfer(VAULT, 700_000, bob.address), xfer(TEAM, 300_000)]), 'someone else pays'],
      [tx([xfer(VAULT, 700_000), xfer(TEAM, 300_000)], { InstructionError: [0, 'x'] }), 'failed tx'],
      [tx([xfer(VAULT, 700_000), xfer(TEAM, 300_000)], null, bob.address), 'not signed by wallet'],
      [tx([xfer(VAULT, 700_000), xfer(TEAM, 300_000), { program: 'system', parsed: { type: 'transfer', info: {} } }]), 'extra instruction'],
      [tx([xfer(VAULT, 31 * 700_000), xfer(TEAM, 31 * 300_000)]), 'over the cap'],
      [tx([xfer(TEAM, 1_000_000)]), 'nothing to vault'],
      [null, 'missing'],
    ];
    for (const [t, why] of bad) assert.equal(typeof verifyPurchaseTx(t as never, W, REFERRER, NOW), 'string', why);
  });

  await test('referral paid to anything but the recorded referrer\'s USDC ATA is refused', () => {
    // A plain `transfer` names no mint: 0.05 of a worthless token to "a referrer".
    const plain = (dest: string, amount: number) => ({
      program: 'spl-token', parsed: { type: 'transfer', info: { authority: W, destination: dest, source: 'src', amount: String(amount) } },
    });
    const base = [xfer(VAULT, 700_000), xfer(TEAM, 250_000)];
    const other = usdcAta(REF_OWNER)!;
    assert.equal(typeof verifyPurchaseTx(tx([...base, xfer(other, 50_000)]) as never, W, REFERRER, NOW), 'string', 'not the recorded referrer');
    assert.equal(typeof verifyPurchaseTx(tx([...base, xfer(REFERRER, 50_000)]) as never, W, REFERRER, NOW), 'string', 'wallet, not its ATA');
    assert.equal(typeof verifyPurchaseTx(tx([...base, xfer(REF, 50_000)]) as never, W, null, NOW), 'string', 'no referrer recorded');
    assert.equal(typeof verifyPurchaseTx(tx([...base, xfer(usdcAta(W)!, 50_000)]) as never, W, W, NOW), 'string', 'self-referral');
    void USDC;
    assert.deepEqual(verifyPurchaseTx(tx([...base, plain(REF, 50_000)]) as never, W, REFERRER, NOW), ok(1, REF),
      'real USDC referral via plain transfer still works');
  });
  await test('wallet-added Lighthouse assertions do not void a purchase; other programs still do', () => {
    const lighthouse = { programId: 'L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95', accounts: [], data: '1' };
    assert.deepEqual(verifyPurchaseTx(tx([xfer(VAULT, 700_000), xfer(TEAM, 300_000), lighthouse]) as never, W, null, NOW), ok(1, null));
    const other = { programId: 'Other111111111111111111111111111111111111', accounts: [], data: '1' };
    assert.equal(typeof verifyPurchaseTx(tx([xfer(VAULT, 700_000), xfer(TEAM, 300_000), other]) as never, W, null, NOW), 'string');
  });
  await test('a referral link never sends the 5% to the vault, the team, the buyer or an off-curve address', async () => {
    const { referralCandidate } = await import('../lib/solana/usdc');
    const { PublicKey } = await import('@solana/web3.js');
    const { getAssociatedTokenAddressSync } = await import('@solana/spl-token');
    const { TEAM_WALLET, USDC_MINT } = await import('../lib/solana/config');
    const payer = new PublicKey(W);
    const friend = new PublicKey(bob.address);
    assert.equal(referralCandidate(payer, cfg.VAULT_AUTHORITY), null, 'vault authority');
    assert.equal(referralCandidate(payer, TEAM_WALLET), null, 'team wallet');
    assert.equal(referralCandidate(payer, payer), null, 'buyer');
    assert.equal(referralCandidate(payer, PublicKey.findProgramAddressSync([Buffer.from('x')], cfg.PRIZE_PROGRAM_ID)[0]), null, 'PDA');
    assert.equal(referralCandidate(payer, undefined), null);
    assert.ok(referralCandidate(payer, friend)!.equals(getAssociatedTokenAddressSync(USDC_MINT, friend)));
  });
  await test('an unreachable Jupiter means "no swap route", not a crashed purchase', async () => {
    const jup = await import('../lib/solana/jupiter-swap');
    assert.ok(!jup.JUP_QUOTE.includes('quote-api.jup.ag'), 'retired v6 host');
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => { throw new TypeError('fetch failed'); }) as typeof fetch;
    try {
      await assert.rejects(jup.quoteSolForUsdc(1), jup.SwapUnavailableError);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
  await test('middleware matcher covers uppercase page routes, not files or the API', async () => {
    const { config } = await import('../proxy');
    const re = new RegExp('^' + config.matcher[0] + '$');
    for (const p of ['/SHOP', '/Leaderboard/x', '/shop']) assert.ok(re.test(p), p);
    for (const p of ['/logo.png', '/api/ranked/me', '/_next/static/x.js']) assert.ok(!re.test(p), p);
  });

  console.log('prizes');
  const W10 = Array.from({ length: 14 }, () => newWallet().address);
  const board = (scores: number[]) => scores.map((score, i) => ({ wallet: W10[i], score }));
  await test('decided rules: best 10 days, 40% day / 60% month, curve sums to 100%', () => {
    assert.equal(cfg.MONTHLY_BEST_DAYS, 10);
    assert.equal(cfg.DAILY_POOL_BPS, 4000);
    assert.deepEqual([...cfg.PAYOUT_CURVE_BPS], [2500, 1800, 1300, 1000, 800, 700, 600, 500, 400, 400]);
    assert.equal(cfg.PAYOUT_CURVE_BPS.reduce((s, x) => s + x, 0), 10_000);
  });
  await test('a full board is paid exactly along the curve', () => {
    const p = results.planRound('day', '2026-10-01', 1_000_000n, board([10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0.5]));
    assert.deepEqual(p.awards.map((a) => a.amount), cfg.PAYOUT_CURVE_BPS.map((b) => BigInt(b * 100)));
    assert.deepEqual(p.awards.map((a) => a.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.equal(p.total, 1_000_000n);
    assert.equal(p.unallocated, 0n);
    assert.equal(p.roundId, 20261001n);
  });
  await test('ties share the slots they cover; a tie across 10th shares what is left', () => {
    const p = results.planRound('day', '2026-10-01', 1_000_000n, board([10, 9, 9, 7, 6, 5, 4, 3, 2, 1, 1, 1, 0.5]));
    const amt = p.awards.map((a) => Number(a.amount));
    assert.deepEqual(amt.slice(0, 3), [250_000, 155_000, 155_000]);
    assert.deepEqual(p.awards.slice(9).map((a) => [a.rank, Number(a.amount)]), [[10, 13_333], [10, 13_333], [10, 13_333]]);
    assert.equal(p.awards.length, 12);
    assert.equal(p.total + p.unallocated, 1_000_000n);
    assert.equal(p.unallocated, 1n);
  });
  await test('a short board leaves the unused slots unallocated, and an empty one pays nothing', () => {
    const p = results.planRound('month', '2026-10', 1_000_001n, board([5, 4]));
    assert.deepEqual(p.awards.map((a) => a.amount), [250_000n, 180_000n]);
    assert.equal(p.unallocated, 1_000_001n - 430_000n);
    assert.equal(p.roundId, 20261000n);
    assert.equal(results.planRound('day', '2026-10-01', 5_000_000n, []).total, 0n);
    assert.equal(results.planRound('day', '2026-10-01', 0n, board([5])).awards.length, 0);
  });
  await test('day pools plus the month pool add up to the inflow exactly', () => {
    const inflows = Array.from({ length: 31 }, (_, i) => BigInt(i * 700_000 + (i % 3)));
    const days = inflows.reduce((s, x) => s + results.dailyPool(x), 0n);
    assert.equal(days + results.monthlyPool(inflows), inflows.reduce((s, x) => s + x, 0n));
    assert.equal(results.dailyPool(1_000_000n), 400_000n);
    assert.equal(results.dailyPool(7n), 2n); // rounding goes to the month
  });
  await test('unsorted boards and repeated wallets are refused', () => {
    assert.throws(() => results.splitPool(100n, board([1, 2])));
    assert.throws(() => results.splitPool(100n, [{ wallet: W10[0], score: 2 }, { wallet: W10[0], score: 1 }]));
  });
  await test('periods: final 10 minutes after they end; months roll over the year', () => {
    assert.equal(results.isFinal('day', '2026-10-01', Date.parse('2026-10-02T00:09:59Z')), false);
    assert.equal(results.isFinal('day', '2026-10-01', Date.parse('2026-10-02T00:10:00Z')), true);
    assert.deepEqual(results.periodSpan('month', '2026-12'), { from: '2026-12-01', to: '2027-01-01' });
    assert.deepEqual(results.periodSpan('day', '2028-02-28'), { from: '2028-02-28', to: '2028-02-29' });
    assert.throws(() => results.periodSpan('month', '2026-13'));
    assert.throws(() => results.periodSpan('day', '2026-02-30'));
  });
  await test('merkle proofs verify for every leaf of odd and even trees, and only for that leaf', () => {
    const outsider = newWallet().address;
    for (const n of [1, 2, 3, 7, 10, 33]) {
      const leaves = Array.from({ length: n }, (_, i) => ({ wallet: W10[i % W10.length], amount: BigInt(1000 + i) }));
      const levels = merkle.buildTree(7n, leaves);
      const root = merkle.rootOf(levels);
      leaves.forEach((l, i) => {
        const p = merkle.proofFor(levels, i);
        assert.ok(merkle.verifyProof(root, 7n, i, l.wallet, l.amount, p), `n=${n} i=${i}`);
        assert.ok(!merkle.verifyProof(root, 7n, i, l.wallet, l.amount + 1n, p));
        assert.ok(!merkle.verifyProof(root, 8n, i, l.wallet, l.amount, p));
        assert.ok(!merkle.verifyProof(root, 7n, i, outsider, l.amount, p));
        if (n > 1) assert.ok(!merkle.verifyProof(root, 7n, (i + 1) % n, l.wallet, l.amount, p));
      });
    }
  });
  await test('PostResults and Claim encode the program layout', async () => {
    const { PublicKey } = await import('@solana/web3.js');
    const root = Buffer.alloc(32, 7);
    const post = pix.postResultsIx(20261001n, root, 123n, 11);
    assert.equal(post.data.length, 53);
    assert.equal(post.data[0], 0);
    assert.equal(post.data.readBigUInt64LE(1), 20261001n);
    assert.ok(post.data.subarray(9, 41).equals(root));
    assert.equal(post.data.readBigUInt64LE(41), 123n);
    assert.equal(post.data.readUInt32LE(49), 11);
    assert.ok(post.keys[2].pubkey.equals(pix.roundAddress(20261001n)));
    assert.equal(post.keys.length, 4);
    assert.ok(post.keys[0].pubkey.equals(cfg.PRIZE_POSTER) && post.keys[0].isSigner);
    const c = pix.claimIx(20261001n, 3, new PublicKey(W10[0]), 99n, [root, root]);
    assert.equal(c.data.length, 13 + 64);
    assert.equal(c.data.readUInt32LE(1), 3);
    assert.equal(c.data.readBigUInt64LE(5), 99n);
    assert.throws(() => pix.claimIx(1n, 0, new PublicKey(W10[0]), 1n, Array(17).fill(root)));
  });

  console.log('api (schema ' + schema + ')');
  const base = 'http://test.local/api/ranked';
  const call = async (fn: (r: Request) => Promise<Response>, path: string, token?: string, b?: unknown) => {
    const res = await fn(new Request(base + path, {
      method: b === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: b === undefined ? undefined : JSON.stringify(b),
    }));
    return { status: res.status, body: await res.json() as Record<string, any> };
  };
  async function login(w: ReturnType<typeof newWallet>) {
    const { body: c } = await call(routes.auth, '/auth', undefined, { wallet: w.address });
    const { body: t } = await call(routes.auth, '/auth', undefined, { wallet: w.address, message: c.message, signature: w.sign(c.message) });
    return t.token as string;
  }
  let fakeSig = 0;
  const grant = (wallet: string, n: number) =>
    db.creditPurchase({ sig: `test${fakeSig++}`, wallet, tickets: n, vaultAmount: BigInt(n * 700_000), referralAccount: null, blockTimeMs: Date.now() });

  const ta = await login(alice);
  const tb = await login(bob);
  await test('sign-in through the route works; no token means 401', async () => {
    assert.ok(ta && tb);
    assert.equal((await call(routes.me, '/me')).status, 401);
    assert.equal((await call(routes.start, '/start', 'garbage', {})).status, 401);
  });
  await test('ticket sales are open; an unreadable purchase credits nothing', async () => {
    assert.equal(cfg.RANKED_SALES_OPEN, true);
    // The test RPC is unreachable: the route must answer 502 and leave credits at 0.
    assert.equal((await call(routes.credit, '/credit', ta, { signature: '1'.repeat(88) })).status, 502);
    assert.equal((await call(routes.me, '/me', ta)).body.credits, 0);
  });
  await test('starting without tickets costs nothing and is refused', async () => {
    assert.equal((await call(routes.start, '/start', ta, {})).status, 402);
  });
  await test('a purchase signature is credited only once', async () => {
    assert.equal(await db.creditPurchase({ sig: 'dup', wallet: alice.address, tickets: 2, vaultAmount: 1_400_000n, referralAccount: null, blockTimeMs: Date.now() }), true);
    assert.equal(await db.creditPurchase({ sig: 'dup', wallet: alice.address, tickets: 2, vaultAmount: 1_400_000n, referralAccount: null, blockTimeMs: Date.now() }), false);
    assert.equal((await call(routes.me, '/me', ta)).body.credits, 2);
  });

  let runId = '';
  let st: S;
  await test('start spends one ticket; the first tray comes from the run seed', async () => {
    const r = await call(routes.start, '/start', ta, {});
    assert.equal(r.status, 200);
    runId = r.body.runId;
    st = r.body.state;
    assert.deepEqual(st.tray, seed.trayFor(seed.runSeed(SEED, runId), boardToHex(0n), 0));
    const me = await call(routes.me, '/me', ta);
    assert.equal(me.body.credits, 1);
    assert.equal(me.body.attempts, 1);
    assert.equal(me.body.commitment, seed.commitment(SEED));
  });
  await test('the next tray is only dealt after all three pieces are placed', async () => {
    const m1 = bestMove(st)!;
    const r1 = await call(routes.play, '/play', ta, { runId, fromMoves: 0, moves: [m1] });
    assert.equal(r1.status, 200);
    assert.equal(r1.body.state.tray.filter((p: number | null) => p !== null).length, 2);
    st = r1.body.state;
    const batch = [];
    let local = st;
    while (!rules.trayEmpty(local.tray) && !local.over) {
      const m = bestMove(local)!;
      batch.push({ slot: m.slot, row: m.row, col: m.col });
      local = applyMove(local, m).state;
    }
    const r2 = await call(routes.play, '/play', ta, { runId, fromMoves: 1, moves: batch });
    assert.equal(r2.status, 200);
    st = r2.body.state;
    assert.equal(st.score, local.score, 'server score equals local rules score');
    if (!st.over) assert.deepEqual(st.tray, seed.trayFor(seed.runSeed(SEED, runId), local.board, local.moves));
  });
  await test('replayed, stale or forked requests are refused (single history)', async () => {
    const m = bestMove(st)!;
    const stale = await call(routes.play, '/play', ta, { runId, fromMoves: 1, moves: [m] });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.state.moves, st.moves);
  });
  await test('illegal moves are refused and change nothing', async () => {
    const before = st.moves;
    const r = await call(routes.play, '/play', ta, { runId, fromMoves: before, moves: [{ slot: 0, row: 9, col: 9 }] });
    assert.equal(r.status, 422);
    const cur = await call(routes.run, `/run?id=${runId}`, ta);
    assert.equal(cur.body.state.moves, before);
  });
  await test('a client-claimed score is ignored', async () => {
    const m = bestMove(st)!;
    const r = await call(routes.play, '/play', ta, { runId, fromMoves: st.moves, moves: [m], score: 99_999_999, state: { score: 99_999_999 } });
    assert.equal(r.status, 200);
    assert.ok(r.body.state.score < 99_999_999);
    st = r.body.state;
  });
  await test('another wallet cannot read or play your run', async () => {
    assert.equal((await call(routes.run, `/run?id=${runId}`, tb)).status, 404);
    assert.equal((await call(routes.play, '/play', tb, { runId, fromMoves: st.moves, moves: [bestMove(st)!] })).status, 404);
  });
  await test('a full game played through the API matches an offline replay', async () => {
    let guard = 0;
    while (!st.over) {
      const batch = [];
      let local = st;
      while (!rules.trayEmpty(local.tray) && !local.over) {
        const m = bestMove(local)!;
        batch.push({ slot: m.slot, row: m.row, col: m.col });
        local = applyMove(local, m).state;
      }
      const r = await call(routes.play, '/play', ta, { runId, fromMoves: st.moves, moves: batch });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      st = r.body.state;
      assert.ok(++guard < 400);
    }
    const rows = await neon(url!).query(`SELECT log, score::float8 AS score FROM ${schema}.rk_runs WHERE id = $1`, [runId]);
    const replayed = replayRun(seed.runSeed(SEED, runId), rows[0].log);
    assert.equal(replayed.score, rows[0].score);
    assert.deepEqual(replayed, st);
    assert.equal((await call(routes.play, '/play', ta, { runId, fromMoves: st.moves, moves: [{ slot: 0, row: 0, col: 0 }] })).status, 409);
  });
  await test('fast play is flagged for review, not blocked', async () => {
    const rows = await neon(url!).query(`SELECT flags FROM ${schema}.rk_runs WHERE id = $1`, [runId]);
    assert.ok(rows[0].flags > 0, 'bot speed should be flagged');
  });
  await test('at most 3 attempts per day, and a refused 4th keeps its ticket', async () => {
    await grant(alice.address, 5);
    assert.equal((await call(routes.start, '/start', ta, {})).status, 200);
    assert.equal((await call(routes.start, '/start', ta, {})).status, 200);
    const credits = (await call(routes.me, '/me', ta)).body.credits;
    assert.equal((await call(routes.start, '/start', ta, {})).status, 429);
    assert.equal((await call(routes.me, '/me', ta)).body.credits, credits);
  });
  await test('concurrent starts never overspend or exceed the limit', async () => {
    await grant(bob.address, 3);
    const rs = await Promise.all(Array.from({ length: 6 }, () => call(routes.start, '/start', tb, {})));
    const ok = rs.filter((r) => r.status === 200).length;
    const me = (await call(routes.me, '/me', tb)).body;
    assert.ok(ok >= 1 && ok <= 3);
    assert.equal(me.attempts, ok);
    assert.equal(me.credits, 3 - ok);
  });
  await test('leaderboard shows the best run per wallet; today publishes only the commitment', async () => {
    const lb = await call(routes.board, '/leaderboard?period=day');
    const a = lb.body.rows.find((r: { wallet: string }) => r.wallet === alice.address);
    assert.equal(a.score, st.score);
    const day = await call(routes.day, `/day?d=${TODAY}`);
    assert.equal(day.body.seed, undefined);
    assert.equal(day.body.commitment, seed.commitment(SEED));
    const month = await call(routes.board, '/leaderboard?period=month');
    assert.equal(month.body.rows.find((r: { wallet: string }) => r.wallet === alice.address).score, st.score);
  });
  await test('a finished day publishes seed + logs, and the verifier logic accepts it', async () => {
    const past = '2026-01-15';
    const ps = seed.dailySeed(past);
    await grant(alice.address, 1);
    const id = `past-${randomBytes(4).toString('hex')}`;
    const rs = seed.runSeed(ps, id);
    let s = initialState(seed.trayFor(rs, boardToHex(0n), 0));
    assert.equal((await db.startRun(id, alice.address, past, s)).ok, true);
    for (let i = 0; i < 5 && !s.over; i++) {
      const from = s.moves;
      const batch: [number, number, number][] = [];
      while (!rules.trayEmpty(s.tray) && !s.over) {
        const m = bestMove(s)!;
        batch.push([m.slot, m.row, m.col]);
        s = applyMove(s, m).state;
      }
      if (!s.over) s = rules.dealTray(s, seed.trayFor(rs, s.board, s.moves));
      assert.ok(await db.advanceRun({ id, wallet: alice.address, day: past, fromMoves: from, state: s, step: { t: 0, m: batch }, flag: false }));
    }
    const pub = (await call(routes.day, `/day?d=${past}`)).body;
    assert.equal(pub.final, true);
    assert.equal(seed.commitment(pub.seed), pub.commitment);
    const run = pub.runs.find((r: { id: string }) => r.id === id);
    assert.equal(replayRun(seed.runSeed(pub.seed, run.id), run.log).score, run.score);
    assert.equal(pub.leaderboard[0].score, s.score);
  });
  await test('a day seed stays hidden until 10 minutes after the day ends', async () => {
    const real = Date.now;
    const next = Date.parse(TODAY + 'T00:00:00Z') + 86_400_000;
    try {
      Date.now = () => next + 5 * 60_000; // 00:05 the next day
      const early = (await call(routes.day, `/day?d=${TODAY}`)).body;
      assert.equal(early.seed, undefined);
      assert.equal(early.final, false);
      Date.now = () => next + 11 * 60_000;
      const late = (await call(routes.day, `/day?d=${TODAY}`)).body;
      assert.equal(late.seed, SEED);
    } finally {
      Date.now = real;
    }
  });
  await test('prize pool errors do not echo internal error text', async () => {
    const r = await (await import('../app/api/prizepool/route')).GET();
    const b = await r.json() as Record<string, unknown>;
    assert.equal(b.source, 'error', 'test RPC is unreachable');
    assert.equal(b.error, undefined);
    assert.ok(!JSON.stringify(b).includes('leakcheck'));
  });
  await test('a closed day cannot be played any more', async () => {
    const past = (await neon(url!).query(`SELECT id FROM ${schema}.rk_runs WHERE day = '2026-01-15'`))[0].id;
    const cur = await call(routes.run, `/run?id=${past}`, ta);
    assert.equal(cur.body.closed, true);
    const r = await call(routes.play, '/play', ta, { runId: past, fromMoves: cur.body.state.moves, moves: [bestMove(cur.body.state) ?? { slot: 0, row: 0, col: 0 }] });
    assert.equal(r.status, 409);
  });

  console.log('results, proofs and avatars');
  const sqlT = neon(url!);
  const carol = newWallet();
  const dave = newWallet();
  const erin = newWallet();
  const seedRun = (wallet: string, day: string, attempt: number, score: number, flags = 0) => sqlT.query(
    `INSERT INTO ${schema}.rk_runs (id, wallet, day, attempt, state, score, over, flags)
     VALUES ($1, $2, $3::date, $4, '{}'::jsonb, $5, true, $6)`,
    [`seed-${randomBytes(6).toString('hex')}`, wallet, day, attempt, score, flags]);
  const seedPurchase = (wallet: string, at: string, vault: number) => sqlT.query(
    `INSERT INTO ${schema}.rk_purchases (sig, wallet, tickets, vault_amount, created_at) VALUES ($1, $2, 1, $3, $4::timestamptz)`,
    [`seed-${randomBytes(6).toString('hex')}`, wallet, vault, at]);
  const callAt = async (fn: (r: Request) => Promise<Response>, path: string, token?: string, b?: unknown) => {
    const res = await fn(new Request('http://test.local' + path, {
      method: b === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: b === undefined ? undefined : JSON.stringify(b),
    }));
    return { status: res.status, body: await res.json() as Record<string, any> };
  };

  await test("month score is the sum of each wallet's 10 best days", async () => {
    for (let d = 1; d <= 12; d++) {
      const day = `2025-03-${String(d).padStart(2, '0')}`;
      await seedRun(carol.address, day, 1, d * 100);
      await seedRun(carol.address, day, 2, d * 10); // a worse attempt the same day does not count
    }
    for (const d of ['2025-03-02', '2025-03-03', '2025-03-04']) await seedRun(dave.address, d, 1, 2000, 1);
    await seedRun(erin.address, '2025-04-01', 1, 99_999); // next month
    await seedRun(erin.address, '2025-02-28', 1, 99_999); // previous month
    const want = [[carol.address, (3 + 4 + 5 + 6 + 7 + 8 + 9 + 10 + 11 + 12) * 100], [dave.address, 6000]];
    assert.deepEqual((await db.monthBoard('2025-03')).map((r) => [r.wallet, r.score]), want);
    const api = await call(routes.board, '/leaderboard?period=month&m=2025-03');
    assert.deepEqual(api.body.rows.map((r: { wallet: string; score: number }) => [r.wallet, r.score]), want);
    assert.ok(api.body.rows.every((r: object) => 'avatarId' in r));
  });
  await test("a round's pool comes from its period's vault inflow, its winners from its board", async () => {
    await seedPurchase(carol.address, '2025-03-05T10:00:00Z', 1_000_000);
    await seedPurchase(dave.address, '2025-03-05T23:59:59Z', 700_000);
    await seedPurchase(dave.address, '2025-03-06T00:00:00Z', 2_100_000);
    await seedPurchase(dave.address, '2025-04-01T00:00:00Z', 9_999_999); // next month
    const day = await results.computeRound('day', '2025-03-05');
    assert.equal(day.roundId, 20250305n);
    assert.equal(day.pool, 680_000n); // 40% of 1.7 USDC
    assert.deepEqual(day.awards.map((a) => [a.wallet, a.amount]), [[carol.address, 170_000n]]);
    assert.equal(day.unallocated, 510_000n);
    const month = await results.computeRound('month', '2025-03');
    assert.equal(month.pool, (1_700_000n - 680_000n) + (2_100_000n - 840_000n)); // the other 60% of each day
    assert.deepEqual(month.awards.map((a) => [a.wallet, a.amount]), [[carol.address, 570_000n], [dave.address, 410_400n]]);
    await assert.rejects(results.computeRound('day', TODAY), /not over/);
    await assert.rejects(results.computeRound('month', TODAY.slice(0, 7)), /not over/);
  });
  await test('post-results: the dry run prints the round and stores nothing; --send without key or RPC stops first', async () => {
    const { spawn } = await import('node:child_process');
    // Async (not spawnSync): with the offline PGlite shim the child queries this process over loopback,
    // which a blocked event loop could not answer. Fixed arguments only; shell: true lets `npx` resolve on Windows too.
    const run = (args: string[]) => new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
      const child = spawn(`npx tsx ${process.env.QA2_PG_PORT ? '--import ./scripts/pglite-neon-shim.ts ' : ''}scripts/post-results.ts ${args.join(' ')}`, {
        shell: true,
        env: { ...process.env, blockbite_DATABASE_URL: url, RANKED_DB_SCHEMA: schema, PRIZE_RPC_URL: 'http://127.0.0.1:9/?api-key=leakcheck', PRIZE_POSTER_KEY: '' },
      });
      let stdout = '', stderr = '';
      child.stdout.on('data', (d) => (stdout += d)); child.stderr.on('data', (d) => (stderr += d));
      const timer = setTimeout(() => child.kill(), 180_000);
      child.on('close', (status) => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
    });
    const plan = await results.computeRound('month', '2025-03');
    const dry = await run(['month', '2025-03']);
    assert.equal(dry.status, 0, dry.stderr + dry.stdout);
    assert.ok(dry.stdout.includes(`root ${results.rootOfLeaves(plan.roundId, results.leavesOf(plan))}`), dry.stdout);
    assert.ok(dry.stdout.includes('FLAGGED'), 'speed-review flags are shown');
    assert.ok(dry.stdout.includes('dry run: nothing stored'));
    const send = await run(['month', '2025-03', '--send']);
    assert.notEqual(send.status, 0);
    assert.ok(!(send.stdout + send.stderr).includes('leakcheck'), 'RPC URL must not be printed');
    assert.equal(await db.getRound(plan.roundId), null);
  });
  let dayRow!: Awaited<ReturnType<typeof db.saveRound>>;
  await test('a computed round is stored once and never recomputed', async () => {
    const plan = await results.computeRound('day', '2025-03-05');
    dayRow = await results.storeRound(plan);
    assert.equal(dayRow.root, results.rootOfLeaves(plan.roundId, results.leavesOf(plan)));
    assert.equal(dayRow.postedSig, null);
    const inflated = { ...plan, total: plan.total + 1n, awards: plan.awards.map((a) => ({ ...a, amount: a.amount + 1n })) };
    const again = await results.storeRound(inflated);
    assert.equal(again.root, dayRow.root);
    assert.equal(again.total, dayRow.total);
    await assert.rejects(results.storeRound(results.planRound('day', '2025-03-09', 0n, [])), /nothing to pay/);
  });
  await test('proof API: nothing before posting, then proofs that verify and build a claim', async () => {
    const { PublicKey } = await import('@solana/web3.js');
    const q = (w: string, extra = '') => call(routes.proof, `/proof?wallet=${w}${extra}`);
    assert.deepEqual((await q(carol.address)).body.prizes, []);
    const postedMs = Date.now() - 3_600_000;
    assert.equal(await db.markRoundPosted(dayRow.roundId, 'sigDay', postedMs), true);
    assert.equal(await db.markRoundPosted(dayRow.roundId, 'sigOther', postedMs), false, 'recorded once');
    const monthRow = await results.storeRound(await results.computeRound('month', '2025-03'));
    await db.markRoundPosted(monthRow.roundId, 'sigMonth', postedMs + 1000);
    // Posted more than 90 days ago: expired, not served.
    const old = await results.storeRound(results.planRound('day', '2025-03-04', 1000n, [{ wallet: dave.address, score: 1 }]));
    await db.markRoundPosted(old.roundId, 'sigOld', Date.now() - 91 * 86_400_000);

    const c = await q(carol.address);
    assert.equal(c.status, 200);
    assert.deepEqual(c.body.prizes.map((p: { roundId: string; amount: string }) => [p.roundId, p.amount]),
      [['20250300', '570000'], ['20250305', '170000']]);
    const d = (await q(dave.address)).body.prizes;
    assert.deepEqual(d.map((p: { roundId: string }) => p.roundId), ['20250300']);
    for (const [w, p] of [[carol.address, c.body.prizes[0]], [carol.address, c.body.prizes[1]], [dave.address, d[0]]] as const) {
      const proof = p.proof.map((h: string) => Buffer.from(h, 'hex'));
      assert.ok(merkle.verifyProof(Buffer.from(p.root, 'hex'), BigInt(p.roundId), p.index, w, BigInt(p.amount), proof));
      assert.equal(p.round, pix.roundAddress(BigInt(p.roundId)).toBase58());
      assert.equal(p.claimableAt - p.postedAt, cfg.PRIZE_VETO_WINDOW_S * 1000);
      assert.equal(p.expiresAt - p.postedAt, cfg.PRIZE_CLAIM_WINDOW_S * 1000);
      const ixs = pix.claimIxs(new PublicKey(w), BigInt(p.roundId), p.index, BigInt(p.amount), proof);
      assert.equal(ixs[1].data.length, 13 + 32 * proof.length);
    }
    assert.equal(d[0].proof.length, 1, 'two-leaf round: one sibling');
    assert.ok(Math.abs(c.body.prizes[1].postedAt - postedMs) < 1000);
    assert.equal(c.body.prizes[1].postSig, 'sigDay');
    assert.equal((await q(carol.address, '&round=20250305')).body.prizes.length, 1);
    assert.equal((await q(carol.address, '&round=20250306')).body.prizes.length, 0);
    assert.deepEqual((await q(erin.address)).body.prizes, []);
    assert.equal((await q('not-a-wallet')).status, 400);
    assert.equal((await q(carol.address, '&round=1x')).status, 400);
  });
  await test('avatar: anyone can read it; only the signed-in wallet sets its own, and only as a slug', async () => {
    const path = '/api/profile/avatar';
    assert.deepEqual((await callAt(routes.avatarGet, `${path}?wallet=${alice.address}`)).body, { wallet: alice.address, avatarId: null });
    assert.equal((await callAt(routes.avatarGet, `${path}?wallet=nope`)).status, 400);
    const anon = await callAt(routes.avatarPost, path, undefined, { wallet: alice.address, avatarId: 'rex' });
    assert.equal(anon.status, 401);
    assert.equal(typeof anon.body.error, 'string');
    assert.equal(anon.body.signIn, '/api/ranked/auth');
    assert.equal((await callAt(routes.avatarPost, path, 'forged.1.x', { wallet: alice.address, avatarId: 'rex' })).status, 401);
    assert.equal((await callAt(routes.avatarPost, path, tb, { wallet: alice.address, avatarId: 'rex' })).status, 403, "bob cannot set alice's");
    for (const bad of ['Rex', 'rex!', 'rex_1', '', 'a'.repeat(41), 'https://x.io/a.png', '../x', ' rex', 7, {}, true]) {
      assert.equal((await callAt(routes.avatarPost, path, ta, { wallet: alice.address, avatarId: bad })).status, 400, JSON.stringify(bad));
    }
    assert.equal((await callAt(routes.avatarPost, path, ta, { avatarId: 'rex' })).status, 400, 'wallet is required');
    const ok = await callAt(routes.avatarPost, path, ta, { wallet: alice.address, avatarId: 'pilot-sky-eye' });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body, { wallet: alice.address, avatarId: 'pilot-sky-eye' });
    assert.equal((await callAt(routes.avatarGet, `${path}?wallet=${alice.address}`)).body.avatarId, 'pilot-sky-eye');
    assert.equal((await callAt(routes.avatarPost, path, ta, { wallet: alice.address, avatarId: 'a'.repeat(40) })).status, 400, 'a well-formed slug that is no avatar is refused');
    assert.equal((await callAt(routes.avatarPost, path, ta, { wallet: alice.address, avatarId: null })).status, 200);
    assert.equal((await callAt(routes.avatarGet, `${path}?wallet=${alice.address}`)).body.avatarId, null);
    assert.equal((await callAt(routes.avatarPost, path, ta, { wallet: alice.address, avatarId: 'pilot-neon-hack' })).status, 200);
    // The column itself refuses anything but a slug.
    await assert.rejects(sqlT.query(`INSERT INTO ${schema}.rk_players (wallet, avatar_id) VALUES ('x', 'Not A Slug')`));
  });
  await test('leaderboard rows carry each wallet\'s avatarId (null when unset)', async () => {
    const day = (await call(routes.board, '/leaderboard?period=day')).body.rows;
    assert.equal(day.find((r: { wallet: string }) => r.wallet === alice.address).avatarId, 'pilot-neon-hack');
    const month = (await call(routes.board, '/leaderboard?period=month&m=2025-03')).body.rows;
    assert.equal(month.find((r: { wallet: string }) => r.wallet === carol.address).avatarId, null);
    const pub = (await call(routes.day, '/day?d=2026-01-15')).body;
    assert.equal(pub.leaderboard[0].avatarId, 'pilot-neon-hack', 'published day boards include it too');
  });

  await neon(url!).query(`DROP SCHEMA ${schema} CASCADE`);
  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  try {
    const { neon } = await import('@neondatabase/serverless');
    await neon(url!).query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  } catch { /* ignore */ }
  process.exit(2);
});
