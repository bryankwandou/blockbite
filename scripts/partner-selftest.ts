/**
 * Partner distribution self-test, fully offline: acts as a fake partner and
 * 12 fake players against a local solana-test-validator.
 *
 *   npx tsx scripts/partner-selftest.ts
 *
 * Starts the validator in a temp ledger dir on port 8999 (never mainnet or
 * devnet), runs the suite with the in-memory store, and, when
 * RANKED_DATABASE_URL is set, runs it again with the Postgres store in its
 * own throwaway schema `ptn_selftest_<random>`. Stops the validator at the end.
 * Prints PASS/FAIL per assertion; exit code 1 if anything failed.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Connection, Keypair, LAMPORTS_PER_SOL, Transaction, type PublicKey } from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, createMint, getAccount, getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount, mintTo, transfer,
} from '@solana/spl-token';
import { Distribution, type Eligibility } from '../lib/partner/distribution';
import { MemoryStore } from '../lib/partner/store-memory';
import type { DistStore } from '../lib/partner/types';

const RPC_PORT = 8999;
const RPC = `http://127.0.0.1:${RPC_PORT}`;
const DEC = 6;
const U = 10n ** BigInt(DEC);

let failed = 0;
let passed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) passed++; else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitUp(proc: ChildProcess, seconds: number): Promise<boolean> {
  let exited = false;
  proc.once('exit', () => { exited = true; });
  const conn = new Connection(RPC, 'confirmed');
  for (let i = 0; i < seconds && !exited; i++) {
    try { await conn.getVersion(); await conn.getLatestBlockhash('finalized'); return true; } catch { await sleep(1000); }
  }
  return false;
}

/**
 * solana-test-validator first. On this Windows machine Agave 3.x/4.x fails to
 * unpack its genesis archive ("Access is denied", os error 5), so the
 * fallback is surfpool in --offline mode: a local SVM simnet with no remote
 * datasource, i.e. it never reads mainnet either.
 */
async function startValidator(): Promise<{ proc: ChildProcess; dir: string; kind: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'ptn-ledger-'));
  const tv = spawn('solana-test-validator', [
    '--ledger', dir, '--rpc-port', String(RPC_PORT), '--faucet-port', '9911', '--reset', '--quiet',
    '--dynamic-port-range', '9100-9200',
  ], { stdio: 'ignore' });
  tv.on('error', () => { /* not installed: handled by waitUp */ });
  if (await waitUp(tv, 60)) return { proc: tv, dir, kind: 'solana-test-validator' };
  killTree(tv);
  console.log('      solana-test-validator did not start here; falling back to surfpool --offline');
  const sp = spawn('surfpool', ['start', '--offline', '--no-tui', '--ci', '-p', String(RPC_PORT), '-w', String(RPC_PORT + 1), '--slot-time', '100'],
    { stdio: 'ignore', cwd: dir });
  sp.on('error', () => { /* handled by waitUp */ });
  if (await waitUp(sp, 60)) return { proc: sp, dir, kind: 'surfpool --offline' };
  killTree(sp);
  throw new Error('no local validator could be started');
}

function killTree(p: ChildProcess) {
  if (process.platform === 'win32' && p.pid) spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
  else p.kill('SIGTERM');
}

function stopValidator(v: { proc: ChildProcess }) { killTree(v.proc); }

async function fund(conn: Connection, pk: PublicKey, sol = 2) {
  const sig = await conn.requestAirdrop(pk, sol * LAMPORTS_PER_SOL);
  await conn.confirmTransaction(sig, 'confirmed');
}

async function waitFinalized(conn: Connection, sig: string) {
  for (let i = 0; i < 120; i++) {
    const s = (await conn.getSignatureStatuses([sig])).value[0];
    if (s?.err) throw new Error(`tx failed: ${JSON.stringify(s.err)}`);
    if (s?.confirmationStatus === 'finalized') return;
    await sleep(1000);
  }
  throw new Error('not finalized in time');
}

async function playerSend(conn: Connection, player: Keypair, b64: string): Promise<string> {
  const tx = Transaction.from(Buffer.from(b64, 'base64'));
  tx.partialSign(player);
  return conn.sendRawTransaction(tx.serialize(), { preflightCommitment: 'confirmed' });
}

async function balance(conn: Connection, mint: PublicKey, owner: PublicKey): Promise<bigint> {
  try { return (await getAccount(conn, getAssociatedTokenAddressSync(mint, owner), 'confirmed')).amount; } catch { return 0n; }
}

async function suite(label: string, store: DistStore) {
  console.log(`\n== ${label} ==`);
  const conn = new Connection(RPC, 'confirmed');
  const partner = Keypair.generate();
  const distributor = Keypair.generate();
  const players = Array.from({ length: 12 }, () => Keypair.generate());
  await Promise.all([fund(conn, partner.publicKey, 5), ...players.map((p) => fund(conn, p.publicKey, 1))]);

  const mint = await createMint(conn, partner, partner.publicKey, null, DEC);
  const partnerAta = await getOrCreateAssociatedTokenAccount(conn, partner, mint, partner.publicKey);
  await mintTo(conn, partner, mint, partnerAta.address, partner, 1_000_000n * U);

  const day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const ranking = players.map((p) => p.publicKey.toBase58());
  const elig: Eligibility = {
    dailyTop: async (d, n) => (d === day ? ranking.slice(0, n) : []),
    levelOf: async () => null,
    achievementHolders: async () => [],
  };
  const d = new Distribution(store, conn, distributor, elig);

  // Campaign: daily top 12 for yesterday, 10 tokens per rank, budget 150.
  const c = await d.createCampaign(partner.publicKey.toBase58(), {
    mint: mint.toBase58(), budget: '150', rule: 'daily_top', ruleAmounts: Array(12).fill('10'), startsOn: day, endsOn: day,
  });
  check('campaign created through the API lib', typeof c !== 'string', typeof c === 'string' ? c : '');
  if (typeof c === 'string') return;
  check('mint program and decimals read on-chain', c.decimals === DEC && c.tokenProgram === TOKEN_PROGRAM_ID.toBase58(), `${c.tokenProgram} / ${c.decimals}`);
  const m22 = await createMint(conn, partner, partner.publicKey, null, 9, Keypair.generate(), undefined, TOKEN_2022_PROGRAM_ID);
  const i22 = await d.mintInfo(m22.toBase58());
  check('Token-2022 mint recognized with its decimals', i22?.tokenProgram === TOKEN_2022_PROGRAM_ID.toBase58() && i22?.decimals === 9, JSON.stringify(i22));

  // Allocation before any deposit is refused (cap = min(budget, deposits) = 0).
  const pre = await d.syncCampaign(c);
  check('nothing allocated before a deposit', pre.inserted === 0 && pre.overBudget === 12, JSON.stringify(pre));

  // Deposit 130 to the distributor's ATA (partner pays its creation).
  const target = d.depositTarget(c)!;
  const distAta = await getOrCreateAssociatedTokenAccount(conn, partner, mint, distributor.publicKey);
  check('deposit target is the distributor ATA', distAta.address.toBase58() === target.tokenAccount);
  const depSig = await transfer(conn, partner, partnerAta.address, distAta.address, partner, 130n * U, [], { commitment: 'finalized' });
  await waitFinalized(conn, depSig);
  const dep = await d.verifyDeposit(c, depSig);
  check('deposit verified on-chain', typeof dep !== 'string' && dep.amount === 130n * U, typeof dep === 'string' ? dep : String(dep.amount));
  const dep2 = await d.verifyDeposit(c, depSig);
  check('same deposit signature is not counted twice', typeof dep2 === 'string');

  const s1 = await d.syncCampaign(c);
  check('12 players allocated from the daily ranking', s1.inserted === 12, JSON.stringify(s1));
  const s2 = await d.syncCampaign(c);
  check('re-sync allocates nothing twice', s2.inserted === 0 && s2.duplicate === 12, JSON.stringify(s2));
  const extra = Keypair.generate().publicKey.toBase58();
  const over = await d.allocate(c.id, [{ wallet: extra, period: day, amount: 11n * U }, { wallet: extra, period: 'bonus', amount: 1n * U }]);
  const t1 = await d.totals(c.id);
  check('allocation past the deposit cap is refused', over.inserted === 0 && over.overBudget === 2 && t1.allocated === 120n * U, JSON.stringify(over));
  const fits = await d.allocate(c.id, [{ wallet: extra, period: 'bonus', amount: 10n * U }]);
  const t2 = await d.totals(c.id);
  check('allocation within the cap is accepted, total == deposits', fits.inserted === 1 && t2.allocated === 130n * U && t2.allocated <= t2.deposited - t2.paid + t2.paid);
  const over2 = await d.allocate(c.id, [{ wallet: Keypair.generate().publicKey.toBase58(), period: 'bonus', amount: 1n }]);
  check('one more base unit is refused', over2.overBudget === 1);

  const allocs = await store.allocationsOf(c.id);
  const mine = (p: Keypair) => allocs.find((a) => a.wallet === p.publicKey.toBase58() && a.period === day)!;

  // Wrong wallet.
  const wrong = await d.claim(mine(players[0]).id, players[1].publicKey.toBase58());
  check('claim by the wrong wallet is refused', !wrong.ok && wrong.status === 404);

  // Paused campaign.
  await d.setPaused(c.id, partner.publicKey.toBase58(), true);
  const paused = await d.claim(mine(players[10]).id, players[10].publicKey.toBase58());
  check('paused campaign refuses claims', !paused.ok && paused.status === 423);
  await d.setPaused(c.id, partner.publicKey.toBase58(), false);

  // Live pending: second claim before landing is refused.
  const p0 = players[0];
  const first = await d.claim(mine(p0).id, p0.publicKey.toBase58());
  const second = await d.claim(mine(p0).id, p0.publicKey.toBase58());
  check('second claim while a signed tx is live is refused', first.ok && !second.ok && second.status === 409);

  // Expiry: player 11 gets a tx, never sends it; after expiry it reopens and can be claimed once.
  const p11 = players[11];
  const stale = await d.claim(mine(p11).id, p11.publicKey.toBase58());
  check('stale claim issued', stale.ok);

  // Full claim flow for players 0..10 (player signs and sends).
  const flows = players.slice(0, 11).map(async (p, i) => {
    const a = mine(p);
    const r = i === 0 && first.ok ? first : await d.claim(a.id, p.publicKey.toBase58());
    if (!r.ok) throw new Error(`claim ${i}: ${r.error}`);
    const sig = await playerSend(conn, p, r.transaction);
    await waitFinalized(conn, sig);
    const after = await d.confirm(a.id, p.publicKey.toBase58(), sig);
    return after?.status;
  });
  const statuses = await Promise.allSettled(flows);
  const paidCount = statuses.filter((x) => x.status === 'fulfilled' && x.value === 'paid').length;
  check('11 players claimed and were marked paid', paidCount === 11,
    statuses.filter((x) => x.status === 'rejected').map((x) => String((x as PromiseRejectedResult).reason)).join('; '));

  const dbl = await d.claim(mine(players[3]).id, players[3].publicKey.toBase58());
  check('double claim after payment is refused', !dbl.ok && dbl.status === 409);

  // Wait for the stale tx to expire (finalized height past its lastValidBlockHeight).
  if (stale.ok) {
    const early = await d.claim(mine(p11).id, p11.publicKey.toBase58());
    check('claim refused while the stale tx can still land', !early.ok && early.status === 409);
    process.stdout.write('      waiting for blockhash expiry');
    for (let i = 0; i < 240; i++) {
      if ((await conn.getBlockHeight('finalized')) > stale.lastValidBlockHeight) break;
      if (i % 10 === 0) process.stdout.write('.');
      await sleep(1000);
    }
    console.log('');
    let lateErr = '';
    try { await playerSend(conn, p11, stale.transaction); } catch (e) { lateErr = e instanceof Error ? e.message : String(e); }
    check('expired transaction cannot be sent', /blockhash/i.test(lateErr), lateErr.slice(0, 80));
    const again = await d.claim(mine(p11).id, p11.publicKey.toBase58());
    check('expired pending claim returned to open and a new tx was issued', again.ok);
    if (again.ok) {
      const sig = await playerSend(conn, p11, again.transaction);
      await waitFinalized(conn, sig);
      const done = await d.confirm(mine(p11).id, p11.publicKey.toBase58(), sig);
      check('re-issued claim paid', done?.status === 'paid');
      const thrice = await d.claim(mine(p11).id, p11.publicKey.toBase58());
      check('it can be claimed only once', !thrice.ok && thrice.status === 409);
    }
  }

  // Balances.
  const bals = await Promise.all(players.map((p) => balance(conn, mint, p.publicKey)));
  check('every player holds exactly 10 tokens', bals.every((b) => b === 10n * U), bals.map((b) => String(b / U)).join(','));
  const distBal = (await getAccount(conn, distAta.address, 'confirmed')).amount;
  check('distributor holds deposit minus paid (130 - 120 = 10)', distBal === 10n * U, String(distBal));
  const t3 = await d.totals(c.id);
  check('totals: paid 120, open 10 (unclaimed bonus), pending 0', t3.paid === 120n * U && t3.open === 10n * U && t3.pending === 0n,
    `paid ${t3.paid} open ${t3.open} pending ${t3.pending}`);
  const distSol = await conn.getBalance(distributor.publicKey);
  check('distributor never paid fees or rent (0 SOL, never funded)', distSol === 0, String(distSol));
}

async function main() {
  console.log(`partner-selftest: local validator on ${RPC} (no mainnet, no devnet)`);
  const v = await startValidator();
  console.log(`local chain: ${v.kind} on ${RPC}`);
  try {
    await suite('memory store', new MemoryStore());
    if (process.env.RANKED_DATABASE_URL) {
      process.env.blockbite_DATABASE_URL = process.env.RANKED_DATABASE_URL;
      process.env.RANKED_DB_SCHEMA = `ptn_selftest_${randomBytes(4).toString('hex')}`;
      const { PgStore } = await import('../lib/partner/store-pg');
      const { q, SCHEMA } = await import('../lib/admin/db');
      if (!SCHEMA.startsWith('ptn_selftest_')) throw new Error(`refusing to run against schema ${SCHEMA}`);
      try {
        await suite(`postgres store (schema ${SCHEMA})`, new PgStore());
      } finally {
        await q(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
        console.log(`dropped test schema ${SCHEMA}`);
      }
    } else {
      console.log('\n(postgres store skipped: RANKED_DATABASE_URL is not set)');
    }
  } catch (e) {
    failed++;
    console.log(`FAIL  suite crashed: ${e instanceof Error ? e.stack : String(e)}`);
  } finally {
    stopValidator(v);
    await sleep(1500);
    try { rmSync(v.dir, { recursive: true, force: true }); } catch { /* validator may still hold files */ }
  }
  console.log(`\n${failed ? 'FAIL' : 'PASS'}: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main();
