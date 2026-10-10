/**
 * Property test: every purchase tx the client builds (lib/solana/usdc.ts) is
 * accepted by the server check (lib/ranked/purchase-verify.ts), also after a
 * wallet adds Compute Budget / Lighthouse / memo instructions, as legacy or v0;
 * and mutations of a legit tx are refused. Offline: fake Connection, no RPC,
 * no keys on disk (throwaway Keypair.generate only).
 *
 *   npx tsx scripts/test-purchase-property.ts [cases=4000] [seed=1]
 */
import assert from 'node:assert/strict';
import {
  ComputeBudgetProgram, Connection, Keypair, PublicKey, Transaction, TransactionInstruction,
  TransactionMessage, VersionedTransaction,
} from '@solana/web3.js';
import {
  ACCOUNT_SIZE, AccountLayout, ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID,
  createTransferCheckedInstruction, createTransferInstruction, getAssociatedTokenAddressSync,
} from '@solana/spl-token';

const CASES = Number(process.argv[2] ?? 4000);
let rngState = BigInt(process.argv[3] ?? 1);
function rnd(): number { // xorshift64*
  rngState ^= rngState << 13n; rngState &= (1n << 64n) - 1n;
  rngState ^= rngState >> 7n;
  rngState ^= rngState << 17n; rngState &= (1n << 64n) - 1n;
  return Number(rngState % 1_000_000_007n) / 1_000_000_007;
}
const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));

const LIGHTHOUSE = new PublicKey('L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95');
const MEMO = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const BLOCKHASH = '11111111111111111111111111111111';

async function main() {
  const cfg = await import('../lib/ranked/config');
  const { USDC_MINT } = await import('../lib/solana/config');
  const usdc = await import('../lib/solana/usdc');
  const { verifyPurchaseTx } = await import('../lib/ranked/purchase-verify');
  const OTHER_MINT = Keypair.generate().publicKey;

  // â”€â”€ fake chain â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function fakeConnection(exists: Set<string>, balances: Map<string, bigint>): Connection {
    const tokenAccount = (addr: PublicKey) => {
      const data = Buffer.alloc(ACCOUNT_SIZE);
      AccountLayout.encode({
        mint: USDC_MINT, owner: PublicKey.default, amount: balances.get(addr.toBase58()) ?? 0n,
        delegateOption: 0, delegate: PublicKey.default, state: 1, isNativeOption: 0, isNative: 0n,
        delegatedAmount: 0n, closeAuthorityOption: 0, closeAuthority: PublicKey.default,
      }, data);
      return { data, owner: TOKEN_PROGRAM_ID, lamports: 2039280, executable: false, rentEpoch: 0 };
    };
    return {
      getAccountInfo: async (a: PublicKey) => (exists.has(a.toBase58()) ? tokenAccount(a) : null),
      getLatestBlockhash: async () => ({ blockhash: BLOCKHASH, lastValidBlockHeight: 1 }),
    } as unknown as Connection;
  }

  // â”€â”€ wallet + RPC simulation: instructions â†’ jsonParsed shape â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  type ParsedIx = { program?: string; programId: string; parsed?: { type: string; info: Record<string, unknown> } };
  function toParsed(ix: TransactionInstruction): ParsedIx {
    const pid = ix.programId.toBase58();
    if (ix.programId.equals(TOKEN_PROGRAM_ID) || ix.programId.equals(TOKEN_2022_PROGRAM_ID)) {
      const k = ix.keys.map((x) => x.pubkey.toBase58());
      if (ix.data[0] === 12) {
        const amount = Buffer.from(ix.data).readBigUInt64LE(1).toString();
        return { program: 'spl-token', programId: pid, parsed: { type: 'transferChecked', info: {
          source: k[0], mint: k[1], destination: k[2], authority: k[3],
          tokenAmount: { amount, decimals: ix.data[9] } } } };
      }
      if (ix.data[0] === 3) {
        return { program: 'spl-token', programId: pid, parsed: { type: 'transfer', info: {
          source: k[0], destination: k[1], authority: k[2], amount: Buffer.from(ix.data).readBigUInt64LE(1).toString() } } };
      }
      return { program: 'spl-token', programId: pid, parsed: { type: 'other', info: {} } };
    }
    if (ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
      return { program: 'spl-associated-token-account', programId: pid, parsed: { type: ix.data[0] === 1 ? 'createIdempotent' : 'create', info: {} } };
    }
    if (ix.programId.equals(MEMO)) return { program: 'spl-memo', programId: pid, parsed: { type: 'memo', info: {} } };
    // Compute Budget, Lighthouse and anything unknown: verified on mainnet that
    // jsonParsed returns only { programId, accounts, data } for these.
    return { programId: pid };
  }

  function walletAdds(tx: Transaction, payer: PublicKey, style: string): TransactionInstruction[] {
    const ixs = [...tx.instructions];
    const cb = [ComputeBudgetProgram.setComputeUnitLimit({ units: 120_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: int(1, 500_000) })];
    const lh = new TransactionInstruction({ programId: LIGHTHOUSE, keys: [{ pubkey: payer, isSigner: false, isWritable: false }], data: Buffer.from([1, 2, 3]) });
    if (style === 'phantom') return [...cb, ...ixs, lh];
    if (style === 'solflare') return [cb[1], cb[0], ...ixs];
    if (style === 'backpack') return [cb[1], ...ixs];
    if (style === 'memo') return [...ixs, new TransactionInstruction({ programId: MEMO, keys: [], data: Buffer.from('hi') })];
    return ixs;
  }

  /** Serialize/deserialize like a real send, then shape like getTransaction(jsonParsed). */
  function onChain(ixs: TransactionInstruction[], payer: PublicKey, versioned: boolean, blockTime: number, ataCreated: boolean) {
    let out: TransactionInstruction[];
    let keys: { pubkey: string; signer: boolean }[];
    if (versioned) {
      const msg = new TransactionMessage({ payerKey: payer, recentBlockhash: BLOCKHASH, instructions: ixs }).compileToV0Message();
      const vt = VersionedTransaction.deserialize(new VersionedTransaction(msg).serialize());
      out = TransactionMessage.decompile(vt.message).instructions;
      keys = vt.message.staticAccountKeys.map((k, i) => ({ pubkey: k.toBase58(), signer: vt.message.isAccountSigner(i) }));
    } else {
      const t = new Transaction({ feePayer: payer, recentBlockhash: BLOCKHASH }).add(...ixs);
      const m = t.compileMessage();
      const back = Transaction.populate(m);
      out = back.instructions;
      keys = m.accountKeys.map((k, i) => ({ pubkey: k.toBase58(), signer: m.isAccountSigner(i) }));
    }
    const inner = ataCreated ? [{ index: 0, instructions: [
      { program: 'spl-token', programId: TOKEN_PROGRAM_ID.toBase58(), parsed: { type: 'getAccountDataSize', info: {} } },
      { program: 'system', programId: '11111111111111111111111111111111', parsed: { type: 'createAccount', info: {} } },
      { program: 'spl-token', programId: TOKEN_PROGRAM_ID.toBase58(), parsed: { type: 'initializeImmutableOwner', info: {} } },
      { program: 'spl-token', programId: TOKEN_PROGRAM_ID.toBase58(), parsed: { type: 'initializeAccount3', info: {} } },
    ] }] : [];
    return { blockTime, meta: { err: null, innerInstructions: inner }, transaction: { message: { accountKeys: keys, instructions: out.map(toParsed) } } };
  }

  async function build(payer: PublicKey, tickets: number, referrer: string | null, refAtaExists: boolean, nowMs: number) {
    const exists = new Set([cfg.PRIZE_VAULT.toBase58(), getAssociatedTokenAddressSync(USDC_MINT, payer).toBase58()]);
    if (referrer && refAtaExists) {
      try { exists.add(getAssociatedTokenAddressSync(USDC_MINT, new PublicKey(referrer)).toBase58()); } catch { /* off-curve */ }
    }
    const bal = new Map([[getAssociatedTokenAddressSync(USDC_MINT, payer).toBase58(), 10n ** 12n]]);
    const realNow = Date.now;
    Date.now = () => nowMs;
    try { return await usdc.buildTicketPurchaseTx(fakeConnection(exists, bal), payer, tickets, referrer); }
    finally { Date.now = realNow; }
  }

  // â”€â”€ properties â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const stats = { built: 0, accepted: 0, mutationsRejected: 0, windowClosed: 0, withRef: 0, ataCreate: 0 };
  const failures: string[] = [];
  const fail = (m: string) => { if (failures.length < 30) failures.push(m); };
  const DAY = 86_400_000;
  const BASE_DAY = Date.parse('2026-10-06T00:00:00Z');

  for (let c = 0; c < CASES; c++) {
    const payerKp = Keypair.generate();
    const payer = payerKp.publicKey;
    const wallet = payer.toBase58();
    const tickets = c < cfg.MAX_TICKETS_PER_PURCHASE ? c + 1 : int(1, cfg.MAX_TICKETS_PER_PURCHASE);
    const refKind = pick(['none', 'none', 'normal', 'normal', 'self', 'offcurve', 'garbage'] as const);
    const referrer = refKind === 'none' ? null
      : refKind === 'normal' ? Keypair.generate().publicKey.toBase58()
      : refKind === 'self' ? wallet
      : refKind === 'offcurve' ? cfg.VAULT_AUTHORITY.toBase58()
      : 'not-a-key';
    const refAtaExists = rnd() < 0.5;
    // times concentrated around the UTC day boundary
    const nowMs = BASE_DAY + pick([int(0, DAY - 1), DAY - int(0, 6 * 60_000), int(0, 6 * 60_000)]);
    const style = pick(['plain', 'phantom', 'solflare', 'backpack', 'memo'] as const);
    const versioned = rnd() < 0.5;

    let tx: Transaction;
    try { tx = await build(payer, tickets, referrer, refAtaExists, nowMs); }
    catch (e) {
      if ((e as Error).name === 'SalesClosedError' && !usdc.purchaseWindowOpen(nowMs)) { stats.windowClosed++; continue; }
      fail(`case ${c}: build threw ${(e as Error).message}`); continue;
    }
    stats.built++;
    if (!usdc.purchaseWindowOpen(nowMs)) fail(`case ${c}: built inside blackout`);

    // Server's recorded referrer: what the DB would hold. 'garbage' can't be recorded.
    const recorded = refKind === 'garbage' ? null : referrer;
    // landed 0..60 s after build, credited 0..5 min after landing
    const blockTime = Math.floor((nowMs + int(0, 60_000)) / 1000);
    const creditAt = blockTime * 1000 + int(0, 5 * 60_000);
    const ataCreated = tx.instructions.some((i) => i.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID));
    if (ataCreated) stats.ataCreate++;
    const legit = onChain(walletAdds(tx, payer, style), payer, versioned, blockTime, ataCreated);
    const r = verifyPurchaseTx(legit as never, wallet, recorded, creditAt);
    if (typeof r === 'string') { fail(`case ${c}: legit rejected (${r}) n=${tickets} ref=${refKind} ataExists=${refAtaExists} style=${style} v0=${versioned}`); continue; }
    if (r.tickets !== tickets) fail(`case ${c}: tickets ${r.tickets} != ${tickets}`);
    if (r.vaultAmount !== BigInt(tickets * cfg.VAULT_SHARE)) fail(`case ${c}: vault amount`);
    const expectRef = refKind === 'normal' ? getAssociatedTokenAddressSync(USDC_MINT, new PublicKey(referrer!)).toBase58() : null;
    if (r.referralAccount !== expectRef) fail(`case ${c}: referral ${r.referralAccount} != ${expectRef} (${refKind})`);
    if (expectRef) stats.withRef++;
    // rounding: integer shares sum exactly to n Ã— price
    const sum = tx.instructions.filter((i) => i.programId.equals(TOKEN_PROGRAM_ID))
      .reduce((s, i) => s + Buffer.from(i.data).readBigUInt64LE(1), 0n);
    if (sum !== BigInt(tickets) * BigInt(cfg.TICKET_PRICE)) fail(`case ${c}: total ${sum}`);
    stats.accepted++;

    // â”€â”€ mutations: each must be refused â”€â”€
    const base = walletAdds(tx, payer, style);
    const src = getAssociatedTokenAddressSync(USDC_MINT, payer);
    const transfers = base.map((ix, i) => ({ ix, i })).filter(({ ix }) => ix.programId.equals(TOKEN_PROGRAM_ID));
    const amt = (ix: TransactionInstruction) => Buffer.from(ix.data).readBigUInt64LE(1);
    const dst = (ix: TransactionInstruction) => ix.keys[2].pubkey;
    const replace = (i: number, ix: TransactionInstruction) => base.map((x, j) => (j === i ? ix : x));
    const tc = (to: PublicKey, a: bigint, mint = USDC_MINT, prog = TOKEN_PROGRAM_ID, auth = payer) =>
      createTransferCheckedInstruction(src, mint, to, auth, a, 6, [], prog);
    const t0 = pick(transfers);
    const stranger = getAssociatedTokenAddressSync(USDC_MINT, Keypair.generate().publicKey);
    const mutations: [string, TransactionInstruction[], string | null][] = [
      ['wrong mint', replace(t0.i, tc(dst(t0.ix), amt(t0.ix), OTHER_MINT)), recorded],
      ['amount +1', replace(t0.i, tc(dst(t0.ix), amt(t0.ix) + 1n)), recorded],
      ['amount -1', replace(t0.i, tc(dst(t0.ix), amt(t0.ix) - 1n)), recorded],
      ['extra transfer to stranger', [...base, tc(stranger, BigInt(int(1, 2_000_000)))], recorded],
      ['token-2022 program', replace(t0.i, tc(dst(t0.ix), amt(t0.ix), USDC_MINT, TOKEN_2022_PROGRAM_ID)), recorded],
      ['other authority', replace(t0.i, tc(dst(t0.ix), amt(t0.ix), USDC_MINT, TOKEN_PROGRAM_ID, Keypair.generate().publicKey)), recorded],
      ['unknown program', [...base, new TransactionInstruction({ programId: Keypair.generate().publicKey, keys: [], data: Buffer.alloc(0) })], recorded],
    ];
    const vaultT = transfers.find(({ ix }) => dst(ix).equals(cfg.PRIZE_VAULT))!;
    const teamT = transfers.find(({ ix }) => dst(ix).equals(cfg.TEAM_USDC_ACCOUNT))!;
    {
      const sw = base.map((x, j) => (j === vaultT.i ? tc(cfg.TEAM_USDC_ACCOUNT, amt(vaultT.ix)) : j === teamT.i ? tc(cfg.PRIZE_VAULT, amt(teamT.ix)) : x));
      mutations.push(['swapped vault/team', sw, recorded]);
    }
    const refT = transfers.find(({ ix }) => !dst(ix).equals(cfg.PRIZE_VAULT) && !dst(ix).equals(cfg.TEAM_USDC_ACCOUNT));
    if (refT) {
      mutations.push(['referral to stranger', replace(refT.i, tc(stranger, amt(refT.ix))), recorded]);
      mutations.push(['referral but none recorded', base, null]);
      mutations.push(['referral but other recorded', base, Keypair.generate().publicKey.toBase58()]);
      mutations.push(['referral to buyer', replace(refT.i, tc(src, amt(refT.ix))), recorded]);
    } else {
      // a self-added referral leg to the buyer's own account / a stranger
      const add = (to: PublicKey) => base.map((x, j) => (j === teamT.i ? tc(cfg.TEAM_USDC_ACCOUNT, amt(teamT.ix) - BigInt(tickets * cfg.REFERRAL_SHARE)) : x)).concat(tc(to, BigInt(tickets * cfg.REFERRAL_SHARE)));
      mutations.push(['self-referral leg', add(src), wallet]);
      mutations.push(['unrecorded referral leg', add(stranger), recorded]);
    }
    for (const [name, ixs, rec] of mutations) {
      const m = onChain(ixs, payer, versioned, blockTime, ataCreated);
      const res = verifyPurchaseTx(m as never, wallet, rec, creditAt);
      if (typeof res === 'string') stats.mutationsRejected++;
      else {
        // An "amount" mutation that happens to still be a whole valid purchase isn't a bug; ours never are.
        fail(`case ${c}: mutation '${name}' ACCEPTED as ${res.tickets} tickets (ref=${refKind}, style=${style})`);
      }
    }
    // unchecked `transfer` (no mint field) to the right places is chain-safe; must still credit correctly
    if (c % 50 === 0) {
      const plain = base.map((x) => (x.programId.equals(TOKEN_PROGRAM_ID) ? createTransferInstruction(src, dst(x), payer, amt(x)) : x));
      const res = verifyPurchaseTx(onChain(plain, payer, versioned, blockTime, ataCreated) as never, wallet, recorded, creditAt);
      if (typeof res === 'string' || res.tickets !== tickets) fail(`case ${c}: unchecked transfer variant ${String(res)}`);
    }
  }

  // â”€â”€ window/cutoff boundary sweep (seconds around midnight) â”€â”€
  for (let s = -400; s < 0; s++) {
    const t = BASE_DAY + DAY + s * 1000;
    const open = usdc.purchaseWindowOpen(t);
    assert.equal(open, -s * 1000 > usdc.DAY_END_BLACKOUT_MS, `window at ${s}s`);
  }

  console.log(JSON.stringify({ cases: CASES, ...stats }));
  if (failures.length) { console.log('FAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
  console.log('ALL PROPERTIES HOLD');
}

main().catch((e) => { console.error(e); process.exit(1); });
