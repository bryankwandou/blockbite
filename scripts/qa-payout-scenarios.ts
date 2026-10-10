/**
 * QA payout path, end to end. Builds full simulated days with the production
 * TypeScript (ticket-purchase builder, results.ts computed from a PGlite
 * fixture DB, merkle.ts, prize-ix.ts) and writes each scenario as an
 * instruction script to programs/blockbite-prize/tests/fixtures/qa-payout/.
 * The Rust test `payout_replay` executes them against the compiled program.
 * This file models the expected vault / reserved / balances independently and
 * emits them as expect_* lines, so a mismatch on chain fails the Rust run.
 *
 *   npx tsx scripts/qa-payout-scenarios.ts
 *   cargo test --manifest-path programs/blockbite-prize/Cargo.toml --test payout_replay -- --nocapture
 *
 * No network, no real keys: wallets are generated in memory per run.
 */
import './pglite-neon-shim';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import {
  AccountLayout, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync,
} from '@solana/spl-token';

process.env.blockbite_DATABASE_URL = 'postgres://qa:qa@127.0.0.1:5432/qa';
process.env.RANKED_DB_SCHEMA = 'qa_payout';
process.env.RANKED_SECRET = 'a'.repeat(64);

const OUT = join(__dirname, '..', 'programs', 'blockbite-prize', 'tests', 'fixtures', 'qa-payout');

const E = { UNAUTH: 6000, BAD_ACCOUNT: 6001, BAD_IX: 6002, INSUFFICIENT: 6003, EXISTS: 6004, WINDOW: 6005, VETOED: 6006, CLAIMED: 6007, PROOF: 6008, OPEN: 6009, ARGS: 6010 };
const DAY_S = 86_400;
const VETO_S = 86_400;
const CLAIM_S = 90 * 86_400;

type Mods = {
  cfg: typeof import('../lib/ranked/config');
  db: typeof import('../lib/ranked/db');
  results: typeof import('../lib/ranked/results');
  merkle: typeof import('../lib/ranked/merkle');
  pix: typeof import('../lib/ranked/prize-ix');
  usdc: typeof import('../lib/solana/usdc');
  solcfg: typeof import('../lib/solana/config');
  shim: typeof import('./pglite-neon-shim');
};
let M: Mods;

let checks = 0;
const ok = (cond: unknown, msg: string) => { checks++; assert.ok(cond, msg); };
const eq = <T,>(a: T, b: T, msg: string) => { checks++; assert.deepEqual(a, b, msg); };

const msAt = (y: number, mo: number, d: number, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi);
const dayStr = (y: number, mo: number, d: number) => `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const monthStr = (y: number, mo: number) => `${y}-${String(mo).padStart(2, '0')}`;

// ── Scenario recorder + independent model of the on-chain state ───────────

interface MRound {
  id: bigint; addr: PublicKey; total: bigint; claimed: bigint; vetoed: boolean; closed: boolean; postedS: number; prev: bigint;
  count: number; paid: Set<number>; leaves: { w: string; a: bigint }[];
}

class Scn {
  lines: string[] = [];
  nowMs = 0;
  vault = 0n;
  reserved = 0n;
  team = 0n;
  bal = new Map<string, bigint>(); // token account -> balance (everything except the vault)
  rounds = new Map<bigint, MRound>();
  markDay = 0n;
  markMonth = 0n;
  stateMade = false;
  inflow = 0n; // total ever paid into the vault by tickets
  paidOut = 0n; // total ever claimed
  sigN = 0;
  constructor(public name: string) {}

  emit(s: string) { this.lines.push(s); }
  at(ms: number) { this.nowMs = ms; this.emit(`time ${Math.floor(ms / 1000)}`); }
  nowS() { return Math.floor(this.nowMs / 1000); }
  fund(k: PublicKey | string, lamports = 50_000_000) { this.emit(`fund ${k.toString()} ${lamports}`); }

  tx(expect: 'ok' | 'err' | `err:${number}`, label: string, ixs: TransactionInstruction[]) {
    this.emit(`tx ${expect} ${label.replace(/\s+/g, '_')}`);
    for (const ix of ixs) {
      const metas = ix.keys.map((k) => `${k.pubkey.toBase58()}:${k.isSigner ? 's' : '-'}${k.isWritable ? 'w' : '-'}`);
      this.emit(['ix', ix.programId.toBase58(), ix.data.length ? Buffer.from(ix.data).toString('hex') : '-', ...metas].join(' '));
    }
    this.emit('end');
  }

  stateBuf(): Buffer {
    const b = Buffer.alloc(24);
    b.writeBigUInt64LE(this.markDay, 0); b.writeBigUInt64LE(this.reserved, 8); b.writeBigUInt64LE(this.markMonth, 16);
    return b;
  }
  mark(id: bigint) { return id % 100n === 0n ? this.markMonth : this.markDay; }
  setMark(id: bigint, v: bigint) { if (id % 100n === 0n) this.markMonth = v; else this.markDay = v; }

  expectAll(label: string) {
    this.emit(`# expectations: ${label}`);
    this.emit(`expect_vault ${this.vault}`); checks++;
    this.emit(`expect_reserved ${this.reserved}`); checks++;
    if (this.stateMade) {
      this.emit(`expect_state 0 ${this.markDay}`); this.emit(`expect_state 16 ${this.markMonth}`); checks += 2;
    }
    for (const [k, v] of this.bal) { this.emit(`expect_bal ${k} ${v}`); checks++; }
    ok(this.vault >= this.reserved, `${this.name}/${label}: model vault ${this.vault} < reserved ${this.reserved}`);
    // Conservation: unclaimed promises of live rounds are exactly `reserved`.
    let live = 0n;
    for (const r of this.rounds.values()) if (!r.vetoed && !r.closed) live += r.total - r.claimed;
    // closed-after-expiry rounds released their unclaimed share, so live excludes them already.
    eq(live, this.reserved, `${this.name}/${label}: sum of open promises == reserved`);
  }

  write() {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, `${this.name}.txt`), `# generated by scripts/qa-payout-scenarios.ts; do not edit\n${this.lines.join('\n')}\n`);
  }

  // ── Operations ───────────────────────────────────────────────────

  /** A buyer pays `tickets` tickets with the production builder; the tx is replayed on chain. */
  async buy(buyer: Keypair, tickets: number, atMs: number, referrer: PublicKey | null = null, opts: { credit?: boolean } = {}) {
    this.at(atMs);
    const payer = buyer.publicKey;
    const source = getAssociatedTokenAddressSync(M.solcfg.USDC_MINT, payer);
    const have = BigInt(tickets) * 1_000_000n + 123n; // a few extra base units: the buyer keeps the change
    this.emit(`usdc ${source.toBase58()} ${payer.toBase58()} ${have}`);
    this.bal.set(source.toBase58(), have);
    this.fund(payer);
    const teamAcc = M.cfg.TEAM_USDC_ACCOUNT.toBase58();
    if (!this.bal.has(teamAcc)) { this.emit(`usdc ${teamAcc} ${M.solcfg.TEAM_WALLET.toBase58()} 0`); this.bal.set(teamAcc, 0n); }

    const conn = {
      getAccountInfo: async (k: PublicKey) => {
        if (k.equals(M.cfg.PRIZE_VAULT)) return { data: Buffer.alloc(165), owner: TOKEN_PROGRAM_ID, lamports: 1, executable: false };
        if (k.equals(source)) {
          const data = Buffer.alloc(165);
          AccountLayout.encode({
            mint: M.solcfg.USDC_MINT, owner: payer, amount: have, delegateOption: 0, delegate: PublicKey.default, state: 1,
            isNativeOption: 0, isNative: 0n, delegatedAmount: 0n, closeAuthorityOption: 0, closeAuthority: PublicKey.default,
          }, data);
          return { data, owner: TOKEN_PROGRAM_ID, lamports: 1, executable: false };
        }
        return null; // referrer has no USDC account yet
      },
      getLatestBlockhash: async () => ({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 1 }),
    };
    const realNow = Date.now;
    Date.now = () => atMs;
    let tx: Transaction;
    try { tx = await M.usdc.buildTicketPurchaseTx(conn as never, payer, tickets, referrer?.toBase58() ?? null); } finally { Date.now = realNow; }

    const n = BigInt(tickets);
    const refAcc = M.usdc.referralCandidate(payer, referrer);
    const refAmt = refAcc ? n * 50_000n : 0n;
    this.tx('ok', `buy_${tickets}_tickets`, tx.instructions);
    this.vault += n * 700_000n; this.inflow += n * 700_000n;
    const teamAmt = n * 300_000n - refAmt;
    this.team += teamAmt;
    this.bal.set(teamAcc, this.team);
    this.bal.set(source.toBase58(), have - n * 1_000_000n);
    if (refAcc) this.bal.set(refAcc.toBase58(), (this.bal.get(refAcc.toBase58()) ?? 0n) + refAmt);
    // 70/25/5 split (referral) or 70/30: the three legs always add up to the price.
    eq(n * 700_000n + teamAmt + refAmt, n * 1_000_000n, `${this.name}: split of ${tickets} tickets adds up`);
    if (opts.credit !== false) {
      await M.db.creditPurchase({
        sig: `qa${this.name}-${this.sigN++}`, wallet: payer.toBase58(), tickets, vaultAmount: n * 700_000n,
        referralAccount: refAcc?.toBase58() ?? null, blockTimeMs: atMs,
      });
    }
  }

  /** Seeds a finished run (the scores come from the DB like production). */
  async run(wallet: string, day: string, attempt: number, score: number) {
    await M.db.getCredits(wallet); // forces the schema migration
    await M.shim.db.query(
      `INSERT INTO qa_payout.rk_runs (id, wallet, day, attempt, state, score, over) VALUES ($1, $2, $3::date, $4, '{}'::jsonb, $5, true)`,
      [`r-${wallet}-${day}-${attempt}`, wallet, day, attempt, score]);
  }

  /** Computes, stores and posts a round exactly as post-results.ts --send does. Expects the outcome `expect`. */
  async post(kind: 'day' | 'month', period: string, atMs: number, expect: 'ok' | `err:${number}` = 'ok'): Promise<MRound | null> {
    const id = M.results.roundIdOf(kind, period);
    const plan = await M.results.computeRound(kind, period, atMs);
    if (plan.total === 0n || plan.awards.length === 0) return null;
    const row = await M.results.storeRound(plan);
    M.results.treeOf(row);
    return this.postRow(row, atMs, expect, id);
  }

  postRow(row: { roundId: bigint; root: string; total: bigint; leaves: { w: string; a: string }[] }, atMs: number, expect: 'ok' | `err:${number}`, id = row.roundId): MRound | null {
    this.at(atMs);
    const ixs: TransactionInstruction[] = [];
    if (!this.stateMade) ixs.push(...M.pix.createStateIxs((128 + M.pix.STATE_SPACE) * 6960));
    const space = M.pix.roundSpace(row.leaves.length);
    ixs.push(...M.pix.postRoundIxs(id, Buffer.from(row.root, 'hex'), row.total, row.leaves.length, (128 + space) * 6960));
    this.tx(expect, `post_${id}`, ixs);
    if (expect !== 'ok') return null;
    this.stateMade = true;
    const r: MRound = {
      id, addr: M.pix.roundAddress(id), total: row.total, claimed: 0n, vetoed: false, closed: false, postedS: this.nowS(),
      prev: this.mark(id), count: row.leaves.length, paid: new Set(), leaves: row.leaves.map((l) => ({ w: l.w, a: BigInt(l.a) })),
    };
    ok(id > this.mark(id), `${this.name}: model only accepts a forward id`);
    this.setMark(id, id);
    this.reserved += row.total;
    this.rounds.set(id, r);
    return r;
  }

  async stored(roundId: bigint) {
    const row = await M.db.getRound(roundId);
    ok(row, 'round stored');
    if (!row!.postedSig) await M.db.markRoundPosted(roundId, `sig-${roundId}`, this.nowMs);
    return (await M.db.getRound(roundId))!;
  }

  /** Winner `wallet` claims (or `by` sends it for them). Outcome is the model's prediction unless forced. */
  async claim(roundId: bigint, wallet: string, opts: { by?: PublicKey; force?: 'ok' | `err:${number}`; mutate?: (c: { index: number; amount: bigint; proof: Buffer[]; dest: PublicKey }) => void; destOwner?: PublicKey; label?: string } = {}) {
    const r = this.rounds.get(roundId)!;
    const row = await this.stored(roundId);
    const prize = M.results.prizeIn(row, wallet);
    ok(prize, `${wallet} has a prize in ${roundId}`);
    const w = new PublicKey(wallet);
    const c = { index: prize!.index, amount: BigInt(prize!.amount), proof: prize!.proof.map((h) => Buffer.from(h, 'hex')), dest: getAssociatedTokenAddressSync(M.solcfg.USDC_MINT, w) };
    opts.mutate?.(c);
    const payer = opts.by ?? w;
    this.fund(payer);
    const ata = getAssociatedTokenAddressSync(M.solcfg.USDC_MINT, w);
    const claimIx = M.pix.claimIx(roundId, c.index, w, c.amount, c.proof);
    const ixs: TransactionInstruction[] = [createAssociatedTokenAccountIdempotentInstruction(payer, ata, w, M.solcfg.USDC_MINT)];
    if (!c.dest.equals(ata)) {
      // pay somewhere else: rewrite the destination meta (the attack the proof must stop).
      // The attacker's own USDC account exists, so the refusal is the proof, not a missing account.
      ixs.push(createAssociatedTokenAccountIdempotentInstruction(payer, c.dest, opts.destOwner!, M.solcfg.USDC_MINT));
      claimIx.keys[4] = { pubkey: c.dest, isSigner: false, isWritable: true };
    }
    ixs.push(claimIx);
    // model
    let expect: 'ok' | `err:${number}`;
    const t = this.nowS();
    if (opts.force) expect = opts.force;
    else if (r.closed) expect = 'err:6001';
    else if (r.vetoed) expect = `err:${E.VETOED}`;
    else if (t < r.postedS + VETO_S || t >= r.postedS + CLAIM_S) expect = `err:${E.WINDOW}`;
    else if (r.paid.has(c.index)) expect = `err:${E.CLAIMED}`;
    else expect = 'ok';
    this.tx(expect, opts.label ?? `claim_${roundId}_${c.index}`, ixs);
    if (expect === 'ok') {
      r.paid.add(c.index); r.claimed += c.amount; this.reserved -= c.amount; this.vault -= c.amount; this.paidOut += c.amount;
      this.bal.set(ata.toBase58(), (this.bal.get(ata.toBase58()) ?? 0n) + c.amount);
    }
    return { expect, prize: prize!, ata };
  }

  veto(roundId: bigint, o: { signer?: PublicKey; withNext?: boolean | PublicKey; expect?: 'ok' | `err:${number}` } = {}) {
    const r = this.rounds.get(roundId)!;
    const cold = o.signer ?? M.solcfg.TEAM_WALLET;
    let next: PublicKey | null = null;
    if (o.withNext === true) {
      const accs = [...this.rounds.values()].filter((x) => !x.closed).map((x) => {
        const d = Buffer.alloc(80 + Math.ceil(x.count / 8));
        d[0] = 2; d[1] = x.vetoed ? 1 : 0; d.writeBigUInt64LE(x.id, 8); d.writeBigUInt64LE(x.prev, 72);
        return { pubkey: x.addr, data: d };
      });
      next = M.pix.findVetoNext(roundId, this.stateBuf(), accs);
    } else if (o.withNext) next = o.withNext;
    let expect = o.expect;
    if (!expect) {
      if (!cold.equals(M.solcfg.TEAM_WALLET)) expect = `err:${E.UNAUTH}`;
      else if (r.closed) expect = 'err:6001';
      else if (r.vetoed) expect = `err:${E.VETOED}`;
      else if (this.nowS() >= r.postedS + VETO_S) expect = `err:${E.WINDOW}`;
      else expect = 'ok';
    }
    this.tx(expect, `veto_${roundId}${next ? '+next' : ''}`, [M.pix.vetoIx(cold, roundId, next)]);
    if (expect === 'ok') {
      r.vetoed = true;
      this.reserved -= r.total - r.claimed;
      if (this.mark(roundId) === roundId) this.setMark(roundId, r.prev);
      else if (next) {
        const n = [...this.rounds.values()].find((x) => x.addr.equals(next!))!;
        ok(!n.vetoed && n.prev === roundId, 'model: next account is the live successor');
        n.prev = r.prev;
      }
    }
    return next;
  }

  closeRound(roundId: bigint, o: { expect?: 'ok' | `err:${number}` } = {}) {
    const r = this.rounds.get(roundId)!;
    const t = this.nowS();
    const expired = t >= r.postedS + CLAIM_S;
    const expect = o.expect ?? (r.closed ? 'err:6001' : (r.vetoed || r.claimed === r.total || expired) ? 'ok' : `err:${E.OPEN}`);
    const ix = new TransactionInstruction({
      programId: M.cfg.PRIZE_PROGRAM_ID, data: Buffer.from([3]),
      keys: [
        { pubkey: M.cfg.PRIZE_STATE, isSigner: false, isWritable: true },
        { pubkey: r.addr, isSigner: false, isWritable: true },
        { pubkey: M.cfg.PRIZE_POSTER, isSigner: false, isWritable: true },
      ],
    });
    this.tx(expect, `close_${roundId}`, [ix]);
    if (expect === 'ok') {
      if (!r.vetoed) this.reserved -= r.total - r.claimed;
      r.closed = true;
      this.emit(`expect_closed ${r.addr.toBase58()}`); checks++;
    }
  }
}

const kp = () => Keypair.generate();
const pk = (k: Keypair) => k.publicKey.toBase58();

// ── Scenarios ─────────────────────────────────────────────────────────────

/** Basic day: odd ticket counts, referral, a tie, claim windows, every refusal, expiry. */
async function basicDay() {
  const s = new Scn('01-basic-day');
  const [Y, MO] = [2026, 10];
  const day = dayStr(Y, MO, 1);
  const buyers = Array.from({ length: 6 }, kp);
  const ref = kp();
  const tickets = [7, 3, 1, 13, 30, 5];
  await s.buy(buyers[0], tickets[0], msAt(Y, MO, 1, 8), ref.publicKey);
  await s.buy(buyers[1], tickets[1], msAt(Y, MO, 1, 9));
  await s.buy(buyers[2], tickets[2], msAt(Y, MO, 1, 10), buyers[2].publicKey); // self-referral: no leg
  await s.buy(buyers[3], tickets[3], msAt(Y, MO, 1, 11), ref.publicKey);
  await s.buy(buyers[4], tickets[4], msAt(Y, MO, 1, 12));
  await s.buy(buyers[5], tickets[5], msAt(Y, MO, 1, 13));
  const total = tickets.reduce((a, b) => a + b, 0); // 59
  eq(s.vault, BigInt(total) * 700_000n, 'vault holds 70% of every ticket');
  eq(s.team + (s.bal.get(getAssociatedTokenAddressSync(M.solcfg.USDC_MINT, ref.publicKey).toBase58()) ?? 0n), BigInt(total) * 300_000n, 'team + referrer legs are the other 30%');
  s.expectAll('after buys');

  // scores: b1 best of three runs; b2/b3 tie; b5 zero (never ranks)
  const sc = [9000, 5000, 5000, 7000, 0, 100];
  for (let i = 0; i < 6; i++) await s.run(pk(buyers[i]), day, 1, i === 0 ? 100 : sc[i]);
  await s.run(pk(buyers[0]), day, 2, 9000);
  await s.run(pk(buyers[0]), day, 3, 4000);

  const postMs = msAt(Y, MO, 2, 0, 20);
  const r = (await s.post('day', day, postMs))!;
  const expectedPool = (BigInt(total) * 700_000n * 4000n) / 10_000n;
  // 5 ranked wallets: 9000, 7000, 5000/5000 tie (slots 3+4), 100 (slot 5)
  const curve = [2500n, 1800n, 1300n, 1000n, 800n];
  const tie = (expectedPool * (curve[2] + curve[3])) / (10_000n * 2n);
  const want = [(expectedPool * curve[0]) / 10_000n, (expectedPool * curve[1]) / 10_000n, tie, tie, (expectedPool * curve[4]) / 10_000n];
  eq(r.leaves.map((l) => l.a), want, 'awards follow the curve, tie splits slots 3+4 equally');
  eq(r.total, want.reduce((a, b) => a + b, 0n), 'round total = sum of awards');
  ok(r.total <= expectedPool, 'round never promises more than its pool');
  s.expectAll('after post');

  const winners = r.leaves.map((l) => l.w);
  s.at(postMs + 3600_000); // 1h in: the veto window
  await s.claim(r.id, winners[0]); // E_WINDOW predicted by model
  s.at(postMs + VETO_S * 1000 - 1000);
  await s.claim(r.id, winners[0]);
  s.at(postMs + VETO_S * 1000 + 1000);
  // wrong proof / wrong amount / index out of range / redirected / non-winner
  await s.claim(r.id, winners[0], { force: `err:${E.PROOF}`, label: 'claim_bad_proof', mutate: (c) => { c.proof[0] = Buffer.from(c.proof[0]); c.proof[0][0] ^= 1; } });
  await s.claim(r.id, winners[0], { force: `err:${E.PROOF}`, label: 'claim_inflated_amount', mutate: (c) => { c.amount += 1n; } });
  await s.claim(r.id, winners[0], { force: `err:${E.PROOF}`, label: 'claim_wrong_index', mutate: (c) => { c.index = 1; } });
  await s.claim(r.id, winners[0], { force: `err:${E.ARGS}`, label: 'claim_index_out_of_range', mutate: (c) => { c.index = r.count; } });
  await s.claim(r.id, winners[0], { force: `err:${E.PROOF}`, label: 'claim_redirected_to_attacker_ata', destOwner: buyers[4].publicKey, mutate: (c) => { c.dest = getAssociatedTokenAddressSync(M.solcfg.USDC_MINT, buyers[4].publicKey); } });
  // a non-winner sends winner 0's proof with its own USDC account
  await s.claim(r.id, winners[0], { by: buyers[4].publicKey, destOwner: buyers[4].publicKey, force: `err:${E.PROOF}`, label: 'claim_by_non_winner_own_ata', mutate: (c) => { c.dest = getAssociatedTokenAddressSync(M.solcfg.USDC_MINT, buyers[4].publicKey); } });
  s.expectAll('after refused claims');

  // honest claims: winners 0..3 (one via a third party), winner 4 left to expire
  await s.claim(r.id, winners[0]);
  await s.claim(r.id, winners[1], { by: kp().publicKey });
  await s.claim(r.id, winners[2]);
  await s.claim(r.id, winners[3]);
  await s.claim(r.id, winners[0], { label: 'claim_double' }); // E_CLAIMED predicted
  await s.claim(r.id, winners[2], { label: 'claim_double_2' });
  s.expectAll('after claims');
  s.closeRound(r.id); // E_OPEN predicted: winner 4 has not claimed and the window is open

  // 90 days: the last winner loses the prize, the round closes, funds go back to the pool.
  s.at(postMs + CLAIM_S * 1000 - 1000);
  await s.claim(r.id, winners[4], { force: 'ok', label: 'claim_last_second' });
  // (the above claims the last winner at the last second; the expiry path is exercised in scenario 02)
  s.expectAll('after last-second claim');
  s.closeRound(r.id); // everything claimed: closes early
  s.expectAll('after close');
  // ids only move forward, even after the account is gone: re-posting the closed day fails
  const row = (await M.db.getRound(r.id))!;
  s.postRow(row, postMs + CLAIM_S * 1000 + 5000, `err:${E.EXISTS}`);
  // vault == inflow - claimed; the rest is unpromised (pool dust + unpaid curve slots + the month's 60%)
  eq(s.vault, s.inflow - s.paidOut, 'vault = ticket inflow - claims');
  eq(s.reserved, 0n, 'nothing promised once all claimed');
  s.write();
  return { s, r };
}

/** Expiry: an unclaimed prize is released after 90 days, the round closes, vault keeps the money. */
async function expiry() {
  const s = new Scn('02-expiry');
  const [Y, MO] = [2026, 11];
  const day = dayStr(Y, MO, 1);
  const buyer = kp(); const p2 = kp(); const p3 = kp();
  await s.buy(buyer, 10, msAt(Y, MO, 1, 9));
  await s.run(pk(buyer), day, 1, 500); await s.run(pk(p2), day, 1, 400); await s.run(pk(p3), day, 1, 300);
  const postMs = msAt(Y, MO, 2, 0, 15);
  const r = (await s.post('day', day, postMs))!;
  s.at(postMs + VETO_S * 1000 + 1);
  await s.claim(r.id, pk(buyer));
  s.at(postMs + CLAIM_S * 1000 - 1);
  s.closeRound(r.id); // still open for p2, p3: E_OPEN predicted
  s.at(postMs + CLAIM_S * 1000);
  await s.claim(r.id, pk(p2)); // after the window: E_WINDOW
  const before = s.vault;
  s.closeRound(r.id); // expired: closes, releases 2 unclaimed prizes
  eq(s.reserved, 0n, 'unclaimed promises released after expiry');
  eq(s.vault, before, 'closing moves no USDC');
  await s.claim(r.id, pk(p3)); // round gone: refused
  s.expectAll('after expiry');
  // Everything unclaimed stays in the vault, free for later rounds.
  eq(s.vault, s.inflow - s.paidOut, 'vault keeps the expired prizes');
  s.write();
}

/** One-ticket day and month, single winner, 1-leaf tree. */
async function oneTicket() {
  const s = new Scn('03-one-ticket');
  const [Y, MO] = [2026, 12];
  const day = dayStr(Y, MO, 1);
  const w = kp();
  await s.buy(w, 1, msAt(Y, MO, 1, 12));
  await s.run(pk(w), day, 1, 1234);
  const dayPost = msAt(Y, MO, 2, 0, 15);
  const d = (await s.post('day', day, dayPost))!;
  eq(d.leaves.length, 1, 'one leaf');
  eq(d.total, 70_000n, 'day: 280000 pool, rank 1 gets 25% = 70000');
  const monthPost = msAt(Y + 1, 1, 1, 0, 15);
  const m = (await s.post('month', monthStr(Y, MO), monthPost))!;
  eq(m.total, 105_000n, 'month: 420000 pool, rank 1 gets 25%');
  eq(s.markDay, d.id, 'day mark');
  eq(s.markMonth, m.id, 'month mark (separate)');
  s.at(dayPost + VETO_S * 1000 + 1);
  await s.claim(d.id, pk(w), { force: 'ok' });
  // extra proof bytes on a 1-leaf tree must not verify
  await s.claim(d.id, pk(w), { label: 'claim_again_after_paid' });
  s.at(monthPost + VETO_S * 1000 + 1);
  await s.claim(m.id, pk(w), { force: `err:${E.PROOF}`, label: 'claim_month_with_garbage_proof', mutate: (c) => { c.proof = [Buffer.alloc(32, 7)]; } });
  await s.claim(m.id, pk(w));
  eq(s.vault, 700_000n - 70_000n - 105_000n, 'vault = 700000 - claims');
  s.expectAll('end');
  s.write();
}

/** Zero-ticket days, ticket days with no scored run: nothing to post, nothing lost. */
async function zero() {
  const s = new Scn('04-zero');
  const [Y, MO] = [2027, 2];
  // no purchases, no runs at all
  const p0 = await M.results.computeRound('day', dayStr(Y, MO, 3), msAt(Y, MO, 4, 1));
  eq([p0.pool, p0.total, p0.awards.length], [0n, 0n, 0], 'zero-ticket day: empty plan');
  await assert.rejects(() => M.results.storeRound(p0), /nothing to pay/);
  // tickets but nobody scored
  const buyer = kp();
  await s.buy(buyer, 4, msAt(Y, MO, 5, 9));
  await s.run(pk(buyer), dayStr(Y, MO, 5), 1, 0);
  const p1 = await M.results.computeRound('day', dayStr(Y, MO, 5), msAt(Y, MO, 6, 1));
  eq([p1.pool, p1.total, p1.awards.length], [1_120_000n, 0n, 0], 'tickets but no score: pool exists, nobody to pay');
  eq(p1.unallocated, 1_120_000n, 'the whole pool stays unallocated');
  await assert.rejects(() => M.results.storeRound(p1), /nothing to pay/);
  const m = await M.results.computeRound('month', monthStr(Y, MO), msAt(Y, MO + 1, 1, 1));
  eq(m.awards.length, 0, 'month with no scored run pays nobody');
  // not final yet
  await assert.rejects(() => M.results.computeRound('day', dayStr(Y, MO, 5), msAt(Y, MO, 6, 0, 5)), /not over yet/);
  // splitPool math: shares that round to zero are dropped
  eq(M.results.splitPool(3n, [{ wallet: 'a', score: 3 }, { wallet: 'b', score: 2 }]).length, 0, 'pool of 3 units: all shares round to 0, nobody listed');
  eq(M.results.splitPool(4n, [{ wallet: 'a', score: 3 }, { wallet: 'b', score: 2 }]).map((a) => a.amount), [1n], 'pool of 4: only the 25% slot (1 unit) is non-zero');
  assert.throws(() => M.results.splitPool(10n, [{ wallet: 'a', score: 1 }, { wallet: 'b', score: 2 }]), /not sorted/);
  assert.throws(() => M.results.splitPool(10n, [{ wallet: 'a', score: 2 }, { wallet: 'a', score: 1 }]), /twice/);
  assert.throws(() => M.results.splitPool(-1n, []), /negative/);
  checks += 6;
  s.expectAll('only the buy happened');
  s.write();
}

/** Ties: everyone tied, tie across 10th place, tie at the top. */
async function ties() {
  const s = new Scn('05-ties');
  const [Y, MO] = [2027, 3];
  const buyer = kp();
  await s.buy(buyer, 30, msAt(Y, MO, 1, 8));
  await s.buy(buyer, 17, msAt(Y, MO, 1, 9)); // odd: 47 tickets -> 32,900,000 inflow
  const day1 = dayStr(Y, MO, 1);
  const ws = Array.from({ length: 12 }, () => pk(kp()));
  for (const w of ws) await s.run(w, day1, 1, 777); // all twelve tied
  const t1 = msAt(Y, MO, 2, 0, 15);
  const r1 = (await s.post('day', day1, t1))!;
  const pool = (47n * 700_000n * 4000n) / 10_000n;
  eq(r1.leaves.length, 12, 'twelve tied wallets all paid');
  const each = (pool * 10_000n) / (10_000n * 12n);
  ok(r1.leaves.every((l) => l.a === each), 'equal share for a full tie');
  ok(r1.total <= pool && pool - r1.total < 12n, 'dust < number of winners');
  // day 2: tie at ranks 2-3 and across 10th/11th
  await s.buy(buyer, 9, msAt(Y, MO, 2, 9));
  const day2 = dayStr(Y, MO, 2);
  const w2 = Array.from({ length: 12 }, () => pk(kp()));
  const sc2 = [9000, 7000, 7000, 5000, 4000, 3500, 3000, 2500, 2000, 1500, 1500, 100];
  for (let i = 0; i < 12; i++) await s.run(w2[i], day2, 1, sc2[i]);
  const t2 = msAt(Y, MO, 3, 0, 15);
  const r2 = (await s.post('day', day2, t2))!;
  eq(r2.leaves.length, 11, 'rank 12 (score 100) is outside the curve');
  const pool2 = (9n * 700_000n * 4000n) / 10_000n;
  eq(r2.leaves[1].a, (pool2 * (1800n + 1300n)) / 20_000n, 'tie for 2nd/3rd shares slots 2+3');
  eq(r2.leaves[9].a, (pool2 * 400n) / 20_000n, 'tie across 10th: shares only the 10th slot (400 bps)');
  eq(r2.leaves[9].a, r2.leaves[10].a, 'both tied wallets get the same');
  s.expectAll('after posts');
  // everyone claims
  s.at(t2 + VETO_S * 1000 + 1);
  for (const l of r1.leaves) await s.claim(r1.id, l.w, { label: `claim_d1_${l.w.slice(0, 4)}` });
  for (const l of r2.leaves) await s.claim(r2.id, l.w);
  s.expectAll('after claims');
  eq(s.paidOut, r1.total + r2.total, 'both rounds fully paid');
  s.write();
}

/** Veto behaviours: newest, older with the 4th account, chains, window, auth, vetoed claims and close/repost. */
async function veto() {
  const s = new Scn('06-veto');
  const [Y, MO] = [2027, 4];
  const buyer = kp();
  const winners: string[] = [];
  const rs: MRound[] = [];
  for (let d = 1; d <= 4; d++) {
    await s.buy(buyer, 5 + d, msAt(Y, MO, d, 9));
    const w = pk(kp()); winners.push(w);
    await s.run(w, dayStr(Y, MO, d), 1, 1000 * d);
  }
  // Four days posted in one burst after the last one: all inside one veto window.
  const base = msAt(Y, MO, 5, 0, 20);
  for (let d = 1; d <= 4; d++) rs.push((await s.post('day', dayStr(Y, MO, d), base + d * 60_000))!);
  const [a, b, c, d4] = rs;
  eq(d4.prev, c.id, 'chain a<-b<-c<-d'); eq(c.prev, b.id, 'prev'); eq(b.prev, a.id, 'prev');
  s.at(base + 3_600_000);
  s.veto(c.id, { signer: kp().publicKey }); // E_UNAUTHORIZED
  s.veto(c.id, { withNext: kp().publicKey, expect: `err:${E.BAD_ACCOUNT}` }); // junk 4th account
  s.veto(b.id, { withNext: d4.addr, expect: `err:${E.BAD_ACCOUNT}` }); // d4 is not b's successor
  const next = s.veto(c.id, { withNext: true }); // older round: successor d is passed
  ok(next?.equals(d4.addr), 'findVetoNext picked the successor of c');
  eq(d4.prev, b.id, 'veto of c handed its predecessor to d');
  s.veto(c.id); // already vetoed: E_VETOED
  s.expectAll('after vetoing c');
  s.veto(d4.id, { withNext: true }); // latest: the program rolls the mark back by itself
  eq(s.markDay, b.id, 'mark back to b (d.prev was spliced to b)');
  s.expectAll('after vetoing d');
  // Claim on a vetoed round is refused; others unaffected.
  s.at(base + VETO_S * 1000 + 10 * 60_000);
  await s.claim(c.id, winners[2]);
  await s.claim(d4.id, winners[3]);
  s.veto(b.id); // window over: E_WINDOW
  await s.claim(a.id, winners[0]);
  await s.claim(b.id, winners[1]);
  s.expectAll('after window');
  // close vetoed rounds (returns rent, releases nothing further), then corrected re-post of the latest ids
  s.closeRound(c.id); s.closeRound(d4.id);
  // d4's id is free again (mark = b): re-post with a corrected result (same id) now works
  const fixed = { roundId: d4.id, root: Buffer.alloc(32, 9).toString('hex'), total: 1_000n, leaves: [{ w: winners[3], a: '1000' }] };
  s.postRow(fixed, base + VETO_S * 1000 + 20 * 60_000, 'ok');
  s.expectAll('after corrected re-post');
  // c's id is below the mark (d re-posted): stays used
  s.postRow({ roundId: c.id, root: Buffer.alloc(32, 8).toString('hex'), total: 1n, leaves: [{ w: winners[2], a: '1' }] }, base + VETO_S * 1000 + 30 * 60_000, `err:${E.EXISTS}`);
  s.write();
}

/** Older veto WITHOUT the 4th account: the veto stands but the id stays used (documented behaviour). */
async function vetoNoNext() {
  const s = new Scn('07-veto-no-next');
  const [Y, MO] = [2027, 5];
  const buyer = kp();
  const rs: MRound[] = [];
  for (let d = 1; d <= 3; d++) {
    await s.buy(buyer, 3, msAt(Y, MO, d, 9));
    await s.run(pk(kp()), dayStr(Y, MO, d), 1, 100 * d);
  }
  const base = msAt(Y, MO, 4, 0, 20);
  for (let d = 1; d <= 3; d++) rs.push((await s.post('day', dayStr(Y, MO, d), base + d * 60_000))!);
  const [a, b, c] = rs;
  s.at(base + 3_600_000);
  s.veto(a.id); // older, no successor passed: veto stands, mark unchanged
  eq(s.markDay, c.id, 'mark unchanged');
  s.veto(c.id); // latest: mark -> c.prev = b
  s.veto(b.id); // latest again: mark -> b.prev = a (a is vetoed, id stays used)
  eq(s.markDay, a.id, 'mark walks down to the vetoed a');
  s.expectAll('after chain of vetoes');
  s.closeRound(a.id);
  s.postRow({ roundId: a.id, root: Buffer.alloc(32, 5).toString('hex'), total: 10n, leaves: [{ w: pk(kp()), a: '10' }] }, base + 7_200_000, `err:${E.EXISTS}`);
  s.write();
}

/** Month round interleaved with day rounds; month pool = what each day kept back. */
async function month() {
  const s = new Scn('08-month');
  const [Y, MO] = [2027, 6];
  const buyer = kp();
  const A = pk(kp()), B = pk(kp()), C = pk(kp());
  const plan: [number, number][] = [[1, 11], [2, 7], [3, 3]];
  const inflows: bigint[] = [];
  for (const [d, n] of plan) {
    await s.buy(buyer, n, msAt(Y, MO, d, 10));
    inflows.push(BigInt(n) * 700_000n);
    await s.run(A, dayStr(Y, MO, d), 1, d === 1 ? 900 : 100);
    await s.run(B, dayStr(Y, MO, d), 1, 500 * d);
    await s.run(C, dayStr(Y, MO, d), 1, 800);
  }
  const dayRounds: MRound[] = [];
  for (const [d] of plan) dayRounds.push((await s.post('day', dayStr(Y, MO, d), msAt(Y, MO, d + 1, 0, 20)))!);
  const mp = M.results.monthlyPool(inflows);
  const dp = inflows.reduce((a, x) => a + M.results.dailyPool(x), 0n);
  eq(mp + dp, inflows.reduce((a, b) => a + b, 0n), 'day pools + month pool == inflow exactly (rounding goes to the month)');
  const mround = (await s.post('month', monthStr(Y, MO), msAt(Y, MO + 1, 1, 0, 20)))!;
  const daySum = dayRounds.reduce((a, r) => a + r.total, 0n);
  ok(daySum + mround.total <= s.inflow, 'all promised prizes of the month <= ticket inflow');
  eq(s.markMonth, mround.id, 'month mark'); eq(s.markDay, dayRounds[2].id, 'day mark untouched by the month');
  s.expectAll('after all posts');
  // month ranks: B = 500+1000+1500 = 3000, C = 2400, A = 900+100+100 = 1100
  eq(mround.leaves.map((l) => l.w), [B, C, A], 'month board = sum of best days');
  s.at(msAt(Y, MO + 1, 2, 0, 30));
  for (const r of [...dayRounds, mround]) for (const l of r.leaves) await s.claim(r.id, l.w);
  s.expectAll('all claimed');
  eq(s.reserved, 0n, 'nothing promised');
  eq(s.vault, s.inflow - s.paidOut, 'vault = inflow - claims; unpaid curve slots stay');
  s.write();
}

/** The vault can never be over-promised: exact boundary and one unit over. */
async function oversubscribe() {
  const s = new Scn('09-oversubscribe');
  const [Y, MO] = [2027, 7];
  const buyer = kp();
  await s.buy(buyer, 10, msAt(Y, MO, 1, 9)); // vault 7,000,000
  const w = pk(kp());
  const t = msAt(Y, MO, 2, 0, 20);
  const mk = (id: bigint, total: bigint) => ({ roundId: id, root: Buffer.alloc(32, Number(id % 200n)).toString('hex'), total, leaves: [{ w, a: total.toString() }] });
  s.postRow(mk(20270701n, 7_000_001n), t, `err:${E.INSUFFICIENT}`);
  s.postRow(mk(20270701n, 4_000_000n), t + 1000, 'ok'); // reserves 4M
  s.postRow(mk(20270702n, 3_000_001n), t + 2000, `err:${E.INSUFFICIENT}`); // only 3M free
  s.postRow(mk(20270702n, 3_000_000n), t + 3000, 'ok'); // exactly the rest
  eq(s.reserved, 7_000_000n, 'fully promised'); eq(s.reserved, s.vault, 'reserved == vault at the boundary');
  s.postRow(mk(20270703n, 1n), t + 4000, `err:${E.INSUFFICIENT}`); // one base unit more
  // u64 overflow of reserved + total
  s.postRow(mk(20270703n, 0xffff_ffff_ffff_ffffn), t + 5000, `err:${E.INSUFFICIENT}`);
  // a zero-total round is accepted by the program (reserves nothing)
  s.expectAll('boundary');
  s.write();
}

/** The largest tie the server can post (1024 winners): proof depth 10, claim tx size, first/last leaf. */
async function bigTie() {
  const s = new Scn('10-big-tie');
  const [Y, MO] = [2027, 8];
  const buyer = kp();
  await s.buy(buyer, 30, msAt(Y, MO, 1, 9));
  await s.buy(buyer, 30, msAt(Y, MO, 1, 10));
  const day = dayStr(Y, MO, 1);
  // 1024 wallets: insert in one statement
  const ws = Array.from({ length: 1024 }, () => pk(kp()));
  await M.db.getCredits('x');
  const vals = ws.map((w, i) => `('big-${i}', '${w}', '${day}'::date, 1, '{}'::jsonb, 4242, true)`).join(',');
  await M.shim.db.query(`INSERT INTO qa_payout.rk_runs (id, wallet, day, attempt, state, score, over) VALUES ${vals}`);
  const t = msAt(Y, MO, 2, 0, 20);
  const r = (await s.post('day', day, t))!;
  eq(r.leaves.length, 1024, '1024 tied winners');
  const pool = (60n * 700_000n * 4000n) / 10_000n;
  eq(r.leaves[0].a, pool / 1024n, 'floor share');
  eq(pool - r.total, pool % 1024n, 'dust is the remainder');
  eq(M.pix.roundSpace(1024), 80 + 128, 'bitmap 128 bytes');
  s.expectAll('after post');
  s.at(t + VETO_S * 1000 + 1);
  const row = await s.stored(r.id);
  for (const idx of [0, 1, 511, 1022, 1023]) {
    const { prize } = await s.claim(r.id, r.leaves[idx].w);
    // claim tx size: legacy tx with ATA create + claim, 2 signers worst case, must fit 1232 bytes
    const wk = new PublicKey(r.leaves[idx].w);
    const tx = new Transaction();
    tx.recentBlockhash = '11111111111111111111111111111111';
    tx.feePayer = wk;
    tx.add(...M.pix.claimIxs(wk, r.id, prize.index, BigInt(prize.amount), prize.proof.map((h) => Buffer.from(h, 'hex'))));
    const size = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).length + 64; // + 1 signature
    ok(size <= 1232, `claim tx for leaf ${idx} (proof ${prize.proof.length}) is ${size} bytes`);
    console.log(`    leaf ${idx}: proof length ${prize.proof.length}, tx ${size} bytes`);
  }
  void row;
  // one more tied wallet than the limit: the server refuses to build the round
  const over = Array.from({ length: 1025 }, (_, i) => ({ wallet: `w${i}`, score: 5 }));
  assert.throws(() => M.results.splitPool(1_000_000_000n, over), /at most 1024/); checks++;
  s.write();
}

async function main() {
  M = {
    cfg: await import('../lib/ranked/config'),
    db: await import('../lib/ranked/db'),
    results: await import('../lib/ranked/results'),
    merkle: await import('../lib/ranked/merkle'),
    pix: await import('../lib/ranked/prize-ix'),
    usdc: await import('../lib/solana/usdc'),
    solcfg: await import('../lib/solana/config'),
    shim: await import('./pglite-neon-shim'),
  };
  rmSync(OUT, { recursive: true, force: true });
  const steps: [string, () => Promise<unknown>][] = [
    ['basic day', basicDay], ['expiry', expiry], ['one ticket', oneTicket], ['zero', zero], ['ties', ties],
    ['veto', veto], ['veto without next', vetoNoNext], ['month', month], ['oversubscribe', oversubscribe], ['big tie', bigTie],
  ];
  for (const [name, fn] of steps) {
    const before = checks;
    await fn();
    console.log(`  ok  ${name} (${checks - before} TS checks)`);
  }
  console.log(`${steps.length} scenarios written to ${OUT}; ${checks} TS-side checks passed`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
