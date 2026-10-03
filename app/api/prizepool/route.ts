import { NextResponse } from 'next/server';
import { RPC_URL } from '@/lib/solana/config';
import { PRIZE_PROGRAM_ID, PRIZE_STATE, PRIZE_VAULT, USDC_DECIMALS } from '@/lib/ranked/config';

export const dynamic = 'force-dynamic';

/** Byte offsets in the program's accounts (programs/blockbite-prize/src/lib.rs). */
const TOKEN_ACCOUNT_LEN = 165;
const TOKEN_AMOUNT_OFFSET = 64;
const STATE_RESERVED_OFFSET = 8;

/**
 * Every page that shows the pool calls this route, so without a cache each
 * visitor costs an RPC call, and under load the RPC answers 429 and the pool
 * reads 0. Good answers are reused for 15 s per instance and cached by the
 * CDN (s-maxage); errors are never cached.
 */
const TTL_MS = 15_000;
let cached: { at: number; body: Record<string, unknown> } | null = null;
let inflight: Promise<Record<string, unknown>> | null = null;
const CACHE_OK = 'public, s-maxage=15, stale-while-revalidate=60';

/**
 * Live prize-pool balance of the blockbite-prize vault (PRIZE_VAULT).
 *   balance   USDC held by the vault
 *   promised  USDC already posted to winners and not yet claimed or released
 *   free      balance - promised: what upcoming rounds are paid from
 * Until the vault account exists everything is 0.
 */
export async function GET() {
  if (cached && Date.now() - cached.at < TTL_MS) {
    return NextResponse.json(cached.body, { headers: { 'Cache-Control': CACHE_OK } });
  }
  inflight ??= read().finally(() => { inflight = null; });
  const body = await inflight;
  if (body.source === 'error') return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
  cached = { at: Date.now(), body };
  return NextResponse.json(body, { headers: { 'Cache-Control': CACHE_OK } });
}

async function read(): Promise<Record<string, unknown>> {
  const vault = PRIZE_VAULT.toBase58();
  try {
    const { Connection } = await import('@solana/web3.js');
    const conn = new Connection(RPC_URL, 'confirmed');
    const [v, st] = await conn.getMultipleAccountsInfo([PRIZE_VAULT, PRIZE_STATE]);
    if (!v) return { balance: 0, promised: 0, free: 0, source: 'uninitialized', vault };
    if (v.data.length !== TOKEN_ACCOUNT_LEN) throw new Error('vault is not a token account');
    const held = v.data.readBigUInt64LE(TOKEN_AMOUNT_OFFSET);
    const reserved = st && st.owner.equals(PRIZE_PROGRAM_ID) ? st.data.readBigUInt64LE(STATE_RESERVED_OFFSET) : 0n;
    const free = held > reserved ? held - reserved : 0n;
    const ui = (x: bigint) => Number(x) / 10 ** USDC_DECIMALS;
    return { balance: ui(held), promised: ui(reserved), free: ui(free), source: 'on-chain', vault };
  } catch (err) {
    // RPC errors can quote the private RPC URL (and its API key): log, don't echo.
    console.error('prizepool', err);
    return { balance: 0, promised: 0, free: 0, source: 'error', vault };
  }
}
