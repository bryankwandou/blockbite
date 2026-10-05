/**
 * Devnet money-path simulation: hundreds of bot players and attackers buy
 * ranked tickets with a devnet test USDC (tUSDC), then every lamport of tUSDC
 * is reconciled against the database.
 *
 *   SIM_FUNDER=~/.config/solana/<devnet key>.json SIM_DATABASE_URL=postgres://… \
 *   SIM_STATE=<dir> npx tsx scripts/devnet-sim.ts [players=300]
 *
 * What is real: the browser's purchase builder (lib/solana/usdc.ts
 * buildTicketPurchaseTx), devnet transactions signed by each bot, the
 * /api/ranked/{auth,credit,me,start,play} route handlers, the purchase
 * verifier and Neon Postgres (schema `rk_devnet_<stamp>`, kept for review).
 *
 * The only stand-in: mainnet USDC and the mainnet vault/team/player token
 * accounts are mapped to their devnet tUSDC twins (same owners, same
 * derivation), outbound when the builder's transaction is signed and inbound
 * when the credit route reads the transaction. The route is pointed at
 * mainnet by design; the map makes it read devnet instead, and any other
 * mainnet call aborts the run.
 */
import assert from 'node:assert/strict';
import { createPrivateKey, randomBytes, sign as edSign } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import bs58 from 'bs58';
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction, createInitializeMint2Instruction, createMintToInstruction,
  createTransferCheckedInstruction, createTransferInstruction, getAssociatedTokenAddressSync, getMinimumBalanceForRentExemptMint,
  MINT_SIZE, TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

const PLAYERS = Number(process.argv[2] ?? 300);
const DEVNET = process.env.SIM_RPC ?? 'https://api.devnet.solana.com';
const MAINNET_RPC = 'https://api.mainnet-beta.solana.com';
const STATE_DIR = process.env.SIM_STATE ?? '.devnet-sim';
const dbUrl = process.env.SIM_DATABASE_URL;
if (!dbUrl || !process.env.SIM_FUNDER) throw new Error('set SIM_FUNDER and SIM_DATABASE_URL');
const STAMP = new Date().toISOString().slice(0, 16).replace(/\D/g, '');
const SCHEMA = `rk_devnet_${STAMP}`;
process.env.blockbite_DATABASE_URL = dbUrl;
process.env.RANKED_DB_SCHEMA = SCHEMA;
process.env.RANKED_SECRET = randomBytes(32).toString('hex');
delete process.env.NEXT_PUBLIC_RPC_URL;

// Public devnet allows ~100 requests / 10 s per IP: every RPC call (the bots'
// and the credit route's) goes through one pacer.
const RPS = Number(process.env.SIM_RPS ?? 8);
let nextSlot = 0;
async function paced<T>(fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + 1000 / RPS;
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
  return fn();
}
const baseFetch = globalThis.fetch;
async function rpcFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  for (let i = 0; ; i++) {
    const res = await paced(() => baseFetch(input, init));
    if (res.status !== 429 || i >= 12) return res;
    nextSlot += 2000; // back everyone off
  }
}
const conn = new Connection(DEVNET, { commitment: 'confirmed', fetch: rpcFetch as typeof fetch, disableRetryOnRateLimit: true });
const funder = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.SIM_FUNDER.replace(/^~/, process.env.HOME ?? process.env.USERPROFILE ?? ''), 'utf8'))));
mkdirSync(STATE_DIR, { recursive: true });
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rnd = (n: number) => Math.floor(Math.random() * n);

async function pool<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}
async function retry<T>(fn: () => Promise<T>, tries = 8): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) { if (i >= tries) throw e; await sleep(500 * 2 ** Math.min(i, 5)); }
  }
}
async function send(tx: Transaction, signers: Keypair[], opts: { skipPreflight?: boolean } = {}): Promise<string> {
  return retry(async () => {
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    tx.feePayer ??= signers[0].publicKey;
    tx.signatures = [];
    tx.sign(...signers);
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: opts.skipPreflight ?? false });
    await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
    return sig;
  });
}
function signMessage(kp: Keypair, msg: string): string {
  const pk = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(kp.secretKey.slice(0, 32))]), format: 'der', type: 'pkcs8' });
  return bs58.encode(edSign(null, Buffer.from(msg, 'utf8'), pk));
}

// ── Accounts ─────────────────────────────────────────────────────────
interface Bot { kp: Keypair; role: 'player' | 'attacker'; usdc: number }
function loadOrMake(file: string, n: number): Keypair[] {
  const p = join(STATE_DIR, file);
  const have: number[][] = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : [];
  while (have.length < n) have.push(Array.from(Keypair.generate().secretKey));
  writeFileSync(p, JSON.stringify(have));
  return have.slice(0, n).map((s) => Keypair.fromSecretKey(Uint8Array.from(s)));
}

async function main() {
  const cfg = await import('../lib/ranked/config');
  const sol = await import('../lib/solana/config');
  const usdc = await import('../lib/solana/usdc');
  const rules = await import('../lib/ranked/rules');
  const db = await import('../lib/ranked/db');
  const { neon } = await import('@neondatabase/serverless');
  const routes = {
    auth: (await import('../app/api/ranked/auth/route')).POST,
    me: (await import('../app/api/ranked/me/route')).GET,
    start: (await import('../app/api/ranked/start/route')).POST,
    play: (await import('../app/api/ranked/play/route')).POST,
    credit: (await import('../app/api/ranked/credit/route')).POST,
  };
  assert.equal(cfg.RANKED_SALES_OPEN, true, 'sales must be open for the simulation');

  log(`funder ${funder.publicKey.toBase58()} balance ${(await conn.getBalance(funder.publicKey)) / LAMPORTS_PER_SOL} SOL; schema ${SCHEMA}`);

  // tUSDC mint (6 decimals, like USDC), reused across runs.
  const mintKp = loadOrMake('mint.json', 1)[0];
  const T_MINT = mintKp.publicKey;
  if (!(await conn.getAccountInfo(T_MINT))) {
    const tx = new Transaction().add(
      SystemProgram.createAccount({ fromPubkey: funder.publicKey, newAccountPubkey: T_MINT, space: MINT_SIZE, lamports: await getMinimumBalanceForRentExemptMint(conn), programId: TOKEN_PROGRAM_ID }),
      createInitializeMint2Instruction(T_MINT, 6, funder.publicKey, null),
    );
    log('created tUSDC mint', T_MINT.toBase58(), await send(tx, [funder, mintKp]));
  }

  // Mainnet ↔ devnet address map (string base58 both ways).
  const toDev = new Map<string, string>();
  const toMain = new Map<string, string>();
  const pair = (main: PublicKey, dev: PublicKey) => { toDev.set(main.toBase58(), dev.toBase58()); toMain.set(dev.toBase58(), main.toBase58()); };
  const devAta = (owner: PublicKey) => getAssociatedTokenAddressSync(T_MINT, owner, true);
  pair(sol.USDC_MINT, T_MINT);
  const VAULT_DEV = devAta(cfg.VAULT_AUTHORITY);
  const TEAM_DEV = devAta(sol.TEAM_WALLET);
  assert.ok(getAssociatedTokenAddressSync(sol.USDC_MINT, cfg.VAULT_AUTHORITY, true).equals(cfg.PRIZE_VAULT));
  assert.ok(getAssociatedTokenAddressSync(sol.USDC_MINT, sol.TEAM_WALLET).equals(cfg.TEAM_USDC_ACCOUNT));
  pair(cfg.PRIZE_VAULT, VAULT_DEV);
  pair(cfg.TEAM_USDC_ACCOUNT, TEAM_DEV);
  const register = (owner: PublicKey) => pair(getAssociatedTokenAddressSync(sol.USDC_MINT, owner, true), devAta(owner));

  // Bots: players get 3–40 tUSDC, attackers 40.
  const players = loadOrMake('players.json', PLAYERS).map((kp): Bot => ({ kp, role: 'player', usdc: 3 + rnd(38) }));
  const attackers = loadOrMake('attackers.json', 24).map((kp): Bot => ({ kp, role: 'attacker', usdc: 40 }));
  const bots = [...players, ...attackers];
  bots.forEach((b) => register(b.kp.publicKey));

  // Funding: vault/team tUSDC accounts, then 8 bots per tx (SOL for fees, tUSDC account, tUSDC).
  await send(new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(funder.publicKey, VAULT_DEV, cfg.VAULT_AUTHORITY, T_MINT),
    createAssociatedTokenAccountIdempotentInstruction(funder.publicKey, TEAM_DEV, sol.TEAM_WALLET, T_MINT),
  ), [funder]);
  const fundState = join(STATE_DIR, `funded-${PLAYERS}.json`);
  if (!existsSync(fundState)) {
    const chunks: Bot[][] = [];
    for (let i = 0; i < bots.length; i += 8) chunks.push(bots.slice(i, i + 8));
    await pool(chunks, 12, async (chunk) => {
      const tx = new Transaction();
      for (const b of chunk) {
        tx.add(SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: b.kp.publicKey, lamports: 10_000_000 }));
        tx.add(createAssociatedTokenAccountIdempotentInstruction(funder.publicKey, devAta(b.kp.publicKey), b.kp.publicKey, T_MINT));
        tx.add(createMintToInstruction(T_MINT, devAta(b.kp.publicKey), funder.publicKey, BigInt(b.usdc) * 1_000_000n));
      }
      await send(tx, [funder]);
    });
    writeFileSync(fundState, JSON.stringify(bots.map((b) => [b.kp.publicKey.toBase58(), b.usdc])));
    log(`funded ${bots.length} bots`);
  } else {
    const saved = new Map<string, number>(JSON.parse(readFileSync(fundState, 'utf8')));
    bots.forEach((b) => { b.usdc = saved.get(b.kp.publicKey.toBase58()) ?? b.usdc; });
    log('bots already funded on an earlier run');
  }

  // Top-up: every bot holds ≥ 0.02 SOL (attackers create mints/accounts) and its tUSDC amount.
  {
    const need: TransactionInstruction[][] = [];
    for (let i = 0; i < bots.length; i += 100) {
      const part = bots.slice(i, i + 100);
      const [wallets, atas] = await Promise.all([
        retry(() => conn.getMultipleAccountsInfo(part.map((b) => b.kp.publicKey))),
        retry(() => conn.getMultipleAccountsInfo(part.map((b) => devAta(b.kp.publicKey)))),
      ]);
      part.forEach((b, j) => {
        const ixs: TransactionInstruction[] = [];
        const minSol = b.role === 'attacker' ? 50_000_000 : 20_000_000;
        const lamports = wallets[j]?.lamports ?? 0;
        if (lamports < minSol) ixs.push(SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: b.kp.publicKey, lamports: minSol - lamports }));
        const have = atas[j] ? atas[j]!.data.readBigUInt64LE(64) : 0n;
        const want = BigInt(b.usdc) * 1_000_000n;
        if (!atas[j]) ixs.push(createAssociatedTokenAccountIdempotentInstruction(funder.publicKey, devAta(b.kp.publicKey), b.kp.publicKey, T_MINT));
        if (have < want) ixs.push(createMintToInstruction(T_MINT, devAta(b.kp.publicKey), funder.publicKey, want - have));
        if (ixs.length) need.push(ixs);
      });
    }
    const chunks: TransactionInstruction[][] = [];
    for (let i = 0; i < need.length; i += 7) chunks.push(need.slice(i, i + 7).flat());
    await pool(chunks, 12, (ixs) => send(new Transaction().add(...ixs), [funder]));
    log(`topped up ${need.length} bots`);
  }

  // ── Interception ────────────────────────────────────────────────────
  // The builder reads mainnet addresses through this connection; it sees the devnet twins.
  const mapPk = (pk: PublicKey) => new PublicKey(toDev.get(pk.toBase58()) ?? pk.toBase58());
  const buildConn = new Proxy(conn, {
    get(target, prop) {
      if (prop === 'getAccountInfo') return (pk: PublicKey, c?: unknown) => target.getAccountInfo(mapPk(pk), c as never);
      const v = Reflect.get(target, prop);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
  // The credit route fetches from mainnet; serve it the devnet transaction with addresses mapped back.
  const realFetch = globalThis.fetch;
  const devRe = new RegExp([...toMain.keys()].join('|'), 'g');
  let rpcReads = 0;
  const CHAOS = Number(process.env.SIM_CHAOS ?? 0);
  let chaosHits = 0, routeThrew = 0, resubmits = 0, doubleCredits = 0;
  const chaosStatuses: Record<number, number> = {};
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(MAINNET_RPC)) return realFetch(input, init);
    const req = JSON.parse(String(init?.body ?? '{}'));
    if (req.method !== 'getTransaction') throw new Error(`unexpected mainnet call ${req.method}`);
    rpcReads++;
    // Chaos: the RPC fails while the server verifies a purchase.
    if (CHAOS && Math.random() < CHAOS) {
      chaosHits++;
      const k = Math.random();
      if (k < 0.34) throw new TypeError('fetch failed (chaos)');
      if (k < 0.67) return new Response('{"jsonrpc":"2.0","error":{"code":429,"message":"chaos"}}', { status: 429 });
      return new Response('<html>502 bad gateway</html>', { status: 502 });
    }
    const res = await rpcFetch(DEVNET, { ...init, body: JSON.stringify(req) });
    const text = (await res.text()).replace(devRe, (m) => toMain.get(m)!);
    return new Response(text, { status: res.status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  // ── API helpers ─────────────────────────────────────────────────────
  const base = 'http://sim.local/api/ranked';
  const call = async (fn: (r: Request) => Promise<Response>, path: string, token?: string, b?: unknown) => {
    const res = await fn(new Request(base + path, {
      method: b === undefined ? 'GET' : 'POST',
      // Each signed-in bot comes from its own IP, as real players do.
      headers: { 'content-type': 'application/json', 'x-real-ip': token ? `sim-${token.slice(-16)}` : 'sim-anon', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: b === undefined ? undefined : JSON.stringify(b),
    }));
    return { status: res.status, body: await res.json() as Record<string, any> };
  };
  async function login(kp: Keypair) {
    const w = kp.publicKey.toBase58();
    const { body: c } = await call(routes.auth, '/auth', undefined, { wallet: w });
    const { body: t } = await call(routes.auth, '/auth', undefined, { wallet: w, message: c.message, signature: signMessage(kp, c.message) });
    assert.ok(t.token, 'login');
    return t.token as string;
  }
  /** Submits a purchase like the client: retries while the tx is not finalized yet. */
  async function credit(token: string, signature: string) {
    for (let i = 0; i < 60; i++) {
      let r: { status: number; body: Record<string, any> };
      try { r = await call(routes.credit, '/credit', token, { signature }); }
      catch (e) { routeThrew++; r = { status: 599, body: { error: String((e as Error).message) } }; }
      if (r.status >= 500) chaosStatuses[r.status] = (chaosStatuses[r.status] ?? 0) + 1;
      // In chaos mode a user who sees an error presses "retry", so every 5xx is retried.
      if (r.status !== 404 && r.status !== 502 && !(CHAOS && r.status >= 500)) {
        // Lost response: the client never saw the 200 and submits the same purchase again.
        if (CHAOS && r.status === 200 && Math.random() < CHAOS) {
          const again = await call(routes.credit, '/credit', token, { signature }).catch(() => null);
          resubmits++;
          if (again && (again.body.added ?? 0) > 0) doubleCredits++;
        }
        return r;
      }
      await sleep(2500);
    }
    return { status: 0, body: { error: 'never finalized' } };
  }
  type S = import('../lib/ranked/rules').RankedState;
  function bestMove(s: S) {
    let best: { slot: 0 | 1 | 2; row: number; col: number; pts: number } | null = null;
    const b = rules.boardFromHex(s.board);
    for (const slot of [0, 1, 2] as const) {
      const p = s.tray[slot];
      if (p === null) continue;
      for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
        if (!rules.fits(b, p, row, col)) continue;
        const pts = rules.applyMove(s, { slot, row, col }).points;
        if (!best || pts > best.pts) best = { slot, row, col, pts };
      }
    }
    return best;
  }
  /** Plays one ranked run; quitAfter = number of trays before a human-like abandon. */
  async function playRun(token: string, quitAfter = Infinity) {
    const r = await call(routes.start, '/start', token, {});
    if (r.status !== 200) return { started: false, status: r.status };
    const runId = r.body.runId as string;
    let st: S = r.body.state;
    let trays = 0;
    while (!st.over && trays++ < quitAfter) {
      const batch = [];
      let local = st;
      while (!rules.trayEmpty(local.tray) && !local.over) {
        const m = bestMove(local)!;
        batch.push({ slot: m.slot, row: m.row, col: m.col });
        local = rules.applyMove(local, m).state;
      }
      // A cheating client also claims a score; the server must ignore it.
      const p = await call(routes.play, '/play', token, { runId, fromMoves: st.moves, moves: batch, score: 99_999_999 });
      if (p.status !== 200) throw new Error(`play ${p.status} ${JSON.stringify(p.body)}`);
      st = p.body.state;
      assert.equal(st.score, local.score, 'server score = local rules score');
    }
    return { started: true, runId, score: st.score, over: st.over };
  }

  // Ledger snapshot: EVERY token account of the tUSDC mint, found on chain, so
  // an account the run creates mid-way (an attacker's aux account, a referrer's
  // fresh ATA) cannot hide money from the totals.
  async function snapshot() {
    const out = new Map<string, bigint>();
    const accs = await retry(() => conn.getProgramAccounts(TOKEN_PROGRAM_ID, {
      commitment: 'finalized',
      filters: [{ dataSize: 165 }, { memcmp: { offset: 0, bytes: T_MINT.toBase58() } }],
    }));
    for (const a of accs) out.set(a.pubkey.toBase58(), a.account.data.readBigUInt64LE(64));
    for (const pk of [VAULT_DEV, TEAM_DEV]) if (!out.has(pk.toBase58())) out.set(pk.toBase58(), 0n);
    return out;
  }
  const supplyOf = async () => BigInt((await retry(() => conn.getTokenSupply(T_MINT, 'finalized'))).value.amount);
  await sleep(15_000); // let funding finalize before the "before" snapshot
  const before = await snapshot();
  const supplyBefore = [...before.values()].reduce((a, b) => a + b, 0n);
  const mintSupplyBefore = await supplyOf();
  log(`before: vault ${before.get(VAULT_DEV.toBase58())} team ${before.get(TEAM_DEV.toBase58())} total ${supplyBefore}`);

  // ── Honest players ──────────────────────────────────────────────────
  interface PlayerLog { wallet: string; tickets: number; refKind: string; referralPaid: boolean; sig?: string; creditStatus?: number; added?: number; runs: number; refusedFourth?: boolean; credits?: number; error?: string }
  const playerLogs: PlayerLog[] = [];
  const t0 = Date.now();
  await pool(players, Number(process.env.SIM_PAR ?? 12), async (bot, i) => {
    const w = bot.kp.publicKey;
    const max = Math.min(bot.usdc, cfg.MAX_TICKETS_PER_PURCHASE);
    const tickets = i === 0 ? Math.min(30, max) : Math.max(1, Math.min(max, 1 + rnd(i % 10 === 0 ? 12 : 5)));
    const roll = Math.random();
    let refKind = 'none';
    let referrer: PublicKey | undefined;
    if (roll < 0.45) { refKind = 'friend'; referrer = players[(i + 1 + rnd(players.length - 1)) % players.length].kp.publicKey; }
    else if (roll < 0.50) { refKind = 'self'; referrer = w; }
    else if (roll < 0.53) { refKind = 'vault-authority'; referrer = cfg.VAULT_AUTHORITY; }
    else if (roll < 0.56) { refKind = 'team'; referrer = sol.TEAM_WALLET; }
    else if (roll < 0.58) { refKind = 'unfunded-stranger'; referrer = Keypair.generate().publicKey; }
    const L: PlayerLog = { wallet: w.toBase58(), tickets, refKind, referralPaid: false, runs: 0 };
    playerLogs.push(L);
    try {
      await sleep(rnd(3000)); // players do not all arrive at once
      const token = await login(bot.kp);
      // Real client builder, mainnet addresses, mapped to devnet only for signing.
      const tx = await usdc.buildTicketPurchaseTx(buildConn as unknown as Connection, w, tickets, referrer);
      tx.instructions.forEach((ix) => ix.keys.forEach((k) => { k.pubkey = mapPk(k.pubkey); }));
      L.referralPaid = tx.instructions.length === 3;
      L.sig = await send(tx, [bot.kp]);
      // Some players double-click "credit" or have two tabs open.
      const tabs = i % 7 === 0 ? 3 : 1;
      const rs = await Promise.all(Array.from({ length: tabs }, () => credit(token, L.sig!)));
      const ok = rs.find((r) => r.status === 200 && r.body.added > 0) ?? rs[0];
      L.creditStatus = ok.status;
      L.added = rs.reduce((a, r) => a + (r.body.added ?? 0), 0);
      if (ok.status !== 200) L.error = JSON.stringify(ok.body);
      // Play: some finish, some quit after a few trays, some leave tickets unused.
      const runsWanted = Math.min(tickets, cfg.MAX_ATTEMPTS_PER_DAY, i % 5 === 4 ? 0 : 1 + rnd(3));
      for (let k = 0; k < runsWanted; k++) {
        const r = await playRun(token, i % 3 === 0 ? 2 + rnd(4) : Infinity);
        if (r.started) L.runs++;
      }
      if (tickets > cfg.MAX_ATTEMPTS_PER_DAY && L.runs === cfg.MAX_ATTEMPTS_PER_DAY) {
        L.refusedFourth = (await call(routes.start, '/start', token, {})).status !== 200;
      }
      L.credits = (await call(routes.me, '/me', token)).body.credits;
    } catch (e) {
      L.error = (e as Error).message.slice(0, 200);
    }
    if (i % 25 === 0) log(`players ${playerLogs.length}/${players.length}`);
  });
  log(`players done in ${Math.round((Date.now() - t0) / 1000)}s`);

  // ── Attackers ──────────────────────────────────────────────────────
  interface AttackLog { name: string; expect: 'refused' | 'credited-once'; landed: boolean; status: number; reason: string; added: number; pass: boolean; sig?: string }
  const attackLogs: AttackLog[] = [];
  const A = attackers.map((a) => a.kp);
  const ata = (kp: Keypair | PublicKey) => devAta(kp instanceof Keypair ? kp.publicKey : kp);
  const xfer = (from: Keypair, to: PublicKey, amount: number, mint = T_MINT, src?: PublicKey) =>
    createTransferCheckedInstruction(src ?? getAssociatedTokenAddressSync(mint, from.publicKey), mint, to, from.publicKey, BigInt(amount), 6);
  async function attack(name: string, who: Keypair, ixs: TransactionInstruction[], expect: AttackLog['expect'] = 'refused', extraSigners: Keypair[] = [], skipPreflight = false) {
    const L: AttackLog = { name, expect, landed: false, status: 0, reason: '', added: 0, pass: false };
    attackLogs.push(L);
    try {
      const tx = new Transaction().add(...ixs);
      tx.feePayer = who.publicKey;
      L.sig = await send(tx, [who, ...extraSigners], { skipPreflight }).catch(async (e) => {
        // A failing tx sent with skipPreflight still lands; find its signature.
        if (!skipPreflight) throw e;
        const sigs = await conn.getSignaturesForAddress(who.publicKey, { limit: 1 });
        return sigs[0].signature;
      });
      L.landed = true;
      const r = await credit(await login(who), L.sig);
      L.status = r.status;
      L.reason = String(r.body.error ?? '');
      L.added = r.body.added ?? 0;
    } catch (e) {
      L.reason = `tx did not land: ${(e as Error).message.slice(0, 120)}`;
    }
    L.pass = expect === 'refused' ? L.added === 0 : L.added > 0;
    log(`attack ${L.pass ? 'ok ' : 'FAIL'} ${name}: ${L.status} ${L.reason || `added ${L.added}`}`);
    return L;
  }
  const V = VAULT_DEV, TM = TEAM_DEV;
  const friend = players[1].kp.publicKey;
  await attack('underpay the vault (0.69 + 0.31)', A[0], [xfer(A[0], V, 690_000), xfer(A[0], TM, 310_000)]);
  await attack('short the team (0.70 + 0.29)', A[1], [xfer(A[1], V, 700_000), xfer(A[1], TM, 290_000)]);
  await attack('skip the team entirely (0.70 only)', A[2], [xfer(A[2], V, 700_000)]);
  await attack('referral 0.10 instead of 0.05', A[3], [xfer(A[3], V, 700_000), xfer(A[3], TM, 200_000), xfer(A[3], ata(friend), 100_000)]);
  await attack('two referrers', A[4], [xfer(A[4], V, 700_000), xfer(A[4], TM, 250_000), xfer(A[4], ata(friend), 25_000), xfer(A[4], ata(players[2].kp), 25_000)]);
  // Self-referral: pay the 5% to a second tUSDC account the buyer owns (an aux keypair account).
  {
    const aux = Keypair.generate();
    const { createInitializeAccount3Instruction, ACCOUNT_SIZE, getMinimumBalanceForRentExemptAccount } = await import('@solana/spl-token');
    await send(new Transaction().add(
      SystemProgram.createAccount({ fromPubkey: A[5].publicKey, newAccountPubkey: aux.publicKey, space: ACCOUNT_SIZE, lamports: await getMinimumBalanceForRentExemptAccount(conn), programId: TOKEN_PROGRAM_ID }),
      createInitializeAccount3Instruction(aux.publicKey, T_MINT, A[5].publicKey),
    ), [A[5], aux]);
    await attack('self-referral through a second own account', A[5], [xfer(A[5], V, 700_000), xfer(A[5], TM, 250_000), xfer(A[5], aux.publicKey, 50_000)]);
  }
  await attack('31 tickets in one purchase (cap is 30)', A[6], [xfer(A[6], V, 31 * 700_000), xfer(A[6], TM, 31 * 300_000)]);
  // Fake "USDC": a second mint the attacker controls, paid to the vault/team owners' accounts of that mint.
  {
    const fake = Keypair.generate();
    const a7 = A[7];
    await send(new Transaction().add(
      SystemProgram.createAccount({ fromPubkey: a7.publicKey, newAccountPubkey: fake.publicKey, space: MINT_SIZE, lamports: await getMinimumBalanceForRentExemptMint(conn), programId: TOKEN_PROGRAM_ID }),
      createInitializeMint2Instruction(fake.publicKey, 6, a7.publicKey, null),
      createAssociatedTokenAccountIdempotentInstruction(a7.publicKey, getAssociatedTokenAddressSync(fake.publicKey, a7.publicKey), a7.publicKey, fake.publicKey),
      createAssociatedTokenAccountIdempotentInstruction(a7.publicKey, getAssociatedTokenAddressSync(fake.publicKey, cfg.VAULT_AUTHORITY, true), cfg.VAULT_AUTHORITY, fake.publicKey),
      createAssociatedTokenAccountIdempotentInstruction(a7.publicKey, getAssociatedTokenAddressSync(fake.publicKey, sol.TEAM_WALLET), sol.TEAM_WALLET, fake.publicKey),
      createMintToInstruction(fake.publicKey, getAssociatedTokenAddressSync(fake.publicKey, a7.publicKey), a7.publicKey, 100_000_000n),
    ), [a7, fake]);
    await attack('fake USDC mint paid to the vault/team owners', a7, [
      xfer(a7, getAssociatedTokenAddressSync(fake.publicKey, cfg.VAULT_AUTHORITY, true), 700_000, fake.publicKey),
      xfer(a7, getAssociatedTokenAddressSync(fake.publicKey, sol.TEAM_WALLET), 300_000, fake.publicKey),
    ]);
    await attack('fake mint sent straight into the real vault account', a7, [
      createTransferInstruction(getAssociatedTokenAddressSync(fake.publicKey, a7.publicKey), V, a7.publicKey, 700_000n),
      xfer(A[7], TM, 300_000),
    ]);
  }
  await attack('extra SOL transfer hidden in the purchase', A[8], [xfer(A[8], V, 700_000), xfer(A[8], TM, 300_000), SystemProgram.transfer({ fromPubkey: A[8].publicKey, toPubkey: A[9].publicKey, lamports: 1000 })]);
  // Someone else's money: A[10] signs and is fee payer, A[11] authorises the transfers. A[10] must not get the tickets.
  await attack('claim tickets for a purchase another wallet paid', A[10], [xfer(A[11], V, 700_000), xfer(A[11], TM, 300_000)], 'refused', [A[11]]);
  {
    const paid = attackLogs[attackLogs.length - 1].sig!;
    const r = await credit(await login(A[11]), paid);
    attackLogs.push({ name: '…the wallet that really paid gets them, once', expect: 'credited-once', landed: true, status: r.status, reason: String(r.body.error ?? ''), added: r.body.added ?? 0, pass: r.body.added === 1, sig: paid });
  }
  {
    // Attackers are reused across runs and keep collecting tUSDC, so size the
    // payment from the live balance: always one ticket more than it holds.
    const held = BigInt((await retry(() => conn.getTokenAccountBalance(ata(A[12]), 'confirmed'))).value.amount);
    const n = Number(held / 1_000_000n) + 1;
    await attack('failed transaction (pays more than it holds)', A[12], [xfer(A[12], V, n * 700_000), xfer(A[12], TM, n * 300_000)], 'refused', [], true);
  }
  await attack('plain transfer (not transferChecked), exact split', A[13], [
    createTransferInstruction(ata(A[13]), V, A[13].publicKey, 700_000n), createTransferInstruction(ata(A[13]), TM, A[13].publicKey, 300_000n),
  ], 'credited-once');
  await attack('overpay the team (0.70 + 0.40)', A[14], [xfer(A[14], V, 700_000), xfer(A[14], TM, 400_000)]);

  // Replay: a stranger submits an honest player's signature.
  const honest = playerLogs.find((p) => p.sig && p.added)!;
  {
    const r = await credit(await login(A[15]), honest.sig!);
    attackLogs.push({ name: "replay another player's purchase signature", expect: 'refused', landed: true, status: r.status, reason: String(r.body.error ?? ''), added: r.body.added ?? 0, pass: !r.body.added });
  }
  // Double spend: one valid purchase submitted 50 times at once.
  {
    const a = A[16];
    const sig = await send(new Transaction().add(xfer(a, V, 1_400_000), xfer(a, TM, 600_000)), [a]);
    const tok = await login(a);
    await credit(tok, sig).then(() => 0); // wait until finalized, first credit
    const rs = await Promise.all(Array.from({ length: 50 }, () => call(routes.credit, '/credit', tok, { signature: sig })));
    const extra = rs.reduce((s, r) => s + (r.body.added ?? 0), 0);
    const credits = (await call(routes.me, '/me', tok)).body.credits;
    attackLogs.push({ name: 'same purchase submitted 51× (50 in parallel)', expect: 'credited-once', landed: true, status: 200, reason: `extra credits ${extra}`, added: credits, pass: extra === 0 && credits === 2, sig });
  }
  // Concurrent starts: 2 tickets, 25 parallel starts.
  {
    const tok = await login(A[16]);
    const rs = await Promise.all(Array.from({ length: 25 }, () => call(routes.start, '/start', tok, {})));
    const ok = rs.filter((r) => r.status === 200).length;
    const credits = (await call(routes.me, '/me', tok)).body.credits;
    attackLogs.push({ name: '25 parallel starts with 2 tickets', expect: 'refused', landed: false, status: 0, reason: `${ok} started, credits now ${credits}`, added: 0, pass: ok === 2 && credits === 0 });
  }
  // Play someone else's run, forged tokens, junk signatures.
  {
    const tok = await login(A[17]);
    const victim = await login(players[3].kp);
    const me = await call(routes.me, '/me', victim);
    const r = await call(routes.play, '/play', tok, { runId: me.body.runs?.[0]?.id ?? 'x', fromMoves: 0, moves: [{ slot: 0, row: 0, col: 0 }] });
    attackLogs.push({ name: "move pieces in another player's run", expect: 'refused', landed: false, status: r.status, reason: String(r.body.error ?? ''), added: 0, pass: r.status !== 200 });
    const forged = await call(routes.credit, '/credit', `${A[17].publicKey.toBase58()}.9999999999999.forged`, { signature: honest.sig });
    attackLogs.push({ name: 'forged session token', expect: 'refused', landed: false, status: forged.status, reason: String(forged.body.error ?? ''), added: 0, pass: forged.status === 401 });
    const junk = Array.from({ length: 300 }, () => bs58.encode(randomBytes(64)));
    const rs = await pool(junk, 15, (s) => call(routes.credit, '/credit', tok, { signature: s }));
    const credited = rs.filter((r) => (r.body.added ?? 0) > 0).length;
    const codes = [...new Set(rs.map((r) => r.status))].join('/');
    attackLogs.push({ name: '300 junk signatures (spam)', expect: 'refused', landed: false, status: 0, reason: `statuses ${codes}`, added: credited, pass: credited === 0 && rs.some((r) => r.status === 429) });
  }

  // ── Reconciliation ─────────────────────────────────────────────────
  log('waiting for finality before the "after" snapshot');
  await sleep(25_000);
  const after = await snapshot();
  const supplyAfter = [...after.values()].reduce((a, b) => a + b, 0n);
  const mintSupplyAfter = await supplyOf();
  const delta = (pk: PublicKey) => (after.get(pk.toBase58()) ?? 0n) - (before.get(pk.toBase58()) ?? 0n);
  // Every account whose balance moved that is not a bot, the vault or the team.
  const known = new Set([V.toBase58(), TM.toBase58(), ...bots.map((b) => devAta(b.kp.publicKey).toBase58())]);
  const otherMoves = [...new Set([...before.keys(), ...after.keys()])]
    .filter((k) => !known.has(k))
    .map((k) => ({ account: k, delta: ((after.get(k) ?? 0n) - (before.get(k) ?? 0n)).toString() }))
    .filter((m) => m.delta !== '0');
  const sqlT = neon(dbUrl!);
  const [dbTot] = await sqlT.query(`SELECT count(*)::int AS n, coalesce(sum(tickets),0)::int AS tickets, coalesce(sum(vault_amount),0)::text AS vault,
     coalesce(sum(CASE WHEN referral_account IS NOT NULL THEN tickets END),0)::int AS ref_tickets FROM ${SCHEMA}.rk_purchases`) as any[];
  const purchases = await sqlT.query(`SELECT sig, wallet, tickets, vault_amount::text AS v, referral_account FROM ${SCHEMA}.rk_purchases`) as any[];

  // Independent check of every credited purchase from token balance changes (not from instructions).
  const perSig: { sig: string; ok: boolean; why?: string }[] = await pool(purchases, 8, async (p) => {
    const tx = await retry(() => conn.getTransaction(p.sig, { commitment: 'finalized', maxSupportedTransactionVersion: 0 }));
    if (!tx?.meta) return { sig: p.sig, ok: false, why: 'missing' };
    const keys = tx.transaction.message.getAccountKeys().staticAccountKeys.map((k) => k.toBase58());
    const ch = new Map<string, bigint>();
    for (const b of tx.meta.postTokenBalances ?? []) if (b.mint === T_MINT.toBase58()) ch.set(keys[b.accountIndex], BigInt(b.uiTokenAmount.amount));
    for (const b of tx.meta.preTokenBalances ?? []) if (b.mint === T_MINT.toBase58()) ch.set(keys[b.accountIndex], (ch.get(keys[b.accountIndex]) ?? 0n) - BigInt(b.uiTokenAmount.amount));
    const n = BigInt(p.tickets);
    const ref = p.referral_account ? (ch.get(toDev.get(p.referral_account)!) ?? 0n) : 0n;
    const buyer = ch.get(devAta(new PublicKey(p.wallet)).toBase58()) ?? 0n;
    const why = [
      ch.get(V.toBase58()) !== n * 700_000n && 'vault',
      ch.get(TM.toBase58()) !== n * 300_000n - ref && 'team',
      p.referral_account && ref !== n * 50_000n && 'referral',
      buyer !== -n * 1_000_000n && 'buyer paid',
      BigInt(p.v) !== n * 700_000n && 'db vault_amount',
    ].filter(Boolean).join(',');
    return { sig: p.sig, ok: !why, why };
  });

  const honestTickets = playerLogs.reduce((s, p) => s + (p.added ?? 0), 0);
  const okPlayers = playerLogs.filter((p) => !p.error);
  const creditsMath = okPlayers.every((p) => p.credits === p.tickets - p.runs);
  const referralDropped = playerLogs.filter((p) => p.sig && ['self', 'vault-authority', 'team', 'unfunded-stranger'].includes(p.refKind)).every((p) => !p.referralPaid);
  const attackDonationVault = delta(V) - BigInt(dbTot.vault);
  const report = {
    when: new Date().toISOString(), cluster: 'devnet', rpc: DEVNET, schema: SCHEMA, tUSDC: T_MINT.toBase58(),
    vaultDev: V.toBase58(), teamDev: TM.toBase58(), funder: funder.publicKey.toBase58(),
    players: { count: players.length, ok: okPlayers.length, errors: playerLogs.filter((p) => p.error).map((p) => ({ wallet: p.wallet, error: p.error })), ticketsCredited: honestTickets,
      runsPlayed: playerLogs.reduce((s, p) => s + p.runs, 0), withReferral: playerLogs.filter((p) => p.referralPaid).length,
      badReferralLinksDroppedByClient: referralDropped, fourthAttemptRefused: playerLogs.filter((p) => p.refusedFourth !== undefined).every((p) => p.refusedFourth),
      creditsEqualTicketsMinusRuns: creditsMath },
    attacks: attackLogs.map(({ sig, ...a }) => a),
    ledger: {
      totalTusdcBefore: supplyBefore.toString(), totalTusdcAfter: supplyAfter.toString(), conserved: supplyBefore === supplyAfter,
      mintSupplyBefore: mintSupplyBefore.toString(), mintSupplyAfter: mintSupplyAfter.toString(),
      everyTokenCounted: supplyBefore === mintSupplyBefore && supplyAfter === mintSupplyAfter,
      otherAccountsMoved: otherMoves,
      vaultIn: delta(V).toString(), teamIn: delta(TM).toString(),
      db: { purchases: dbTot.n, tickets: dbTot.tickets, vaultAmount: dbTot.vault, referralTickets: dbTot.ref_tickets },
      vaultInMinusCredited: attackDonationVault.toString(),
      everyCreditedPurchaseSplitExactly: perSig.every((s) => s.ok), badPurchases: perSig.filter((s) => !s.ok),
    },
    rpcReadsThroughCreditRoute: rpcReads,
    chaos: CHAOS ? { rate: CHAOS, rpcFailuresInjected: chaosHits, creditRouteThrew: routeThrew, serverErrorStatuses: chaosStatuses, lostResponseResubmits: resubmits, doubleCredits } : undefined,
    funderLeft: (await conn.getBalance(funder.publicKey)) / LAMPORTS_PER_SOL,
  };
  const file = join(STATE_DIR, `report-${STAMP}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2));
  writeFileSync(join(STATE_DIR, `players-${STAMP}.json`), JSON.stringify(playerLogs, null, 1));
  log('report', file);
  console.log(JSON.stringify({ ...report, attacks: report.attacks.map((a) => `${a.pass ? 'PASS' : 'FAIL'} ${a.name} → ${a.status} ${a.reason}`), players: { ...report.players, errors: report.players.errors.slice(0, 5) } }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
