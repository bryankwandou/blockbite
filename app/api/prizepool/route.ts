import { NextResponse } from 'next/server';
import { RPC_URL } from '@/lib/solana/config';
import { PRIZE_PROGRAM_ID, PRIZE_STATE, PRIZE_VAULT, USDC_DECIMALS } from '@/lib/ranked/config';

export const dynamic = 'force-dynamic';

/** Byte offsets in the program's accounts (programs/blockbite-prize/src/lib.rs). */
const TOKEN_ACCOUNT_LEN = 165;
const TOKEN_AMOUNT_OFFSET = 64;
const STATE_RESERVED_OFFSET = 8;

/**
 * Live prize-pool balance of the blockbite-prize vault (PRIZE_VAULT).
 *   balance   USDC held by the vault
 *   promised  USDC already posted to winners and not yet claimed or released
 *   free      balance - promised: what upcoming rounds are paid from
 * Until the vault account exists everything is 0.
 */
export async function GET() {
  const vault = PRIZE_VAULT.toBase58();
  try {
    const { Connection } = await import('@solana/web3.js');
    const conn = new Connection(RPC_URL, 'confirmed');
    const [v, st] = await conn.getMultipleAccountsInfo([PRIZE_VAULT, PRIZE_STATE]);
    if (!v) return NextResponse.json({ balance: 0, promised: 0, free: 0, source: 'uninitialized', vault });
    if (v.data.length !== TOKEN_ACCOUNT_LEN) throw new Error('vault is not a token account');
    const held = v.data.readBigUInt64LE(TOKEN_AMOUNT_OFFSET);
    const reserved = st && st.owner.equals(PRIZE_PROGRAM_ID) ? st.data.readBigUInt64LE(STATE_RESERVED_OFFSET) : 0n;
    const free = held > reserved ? held - reserved : 0n;
    const ui = (x: bigint) => Number(x) / 10 ** USDC_DECIMALS;
    return NextResponse.json({ balance: ui(held), promised: ui(reserved), free: ui(free), source: 'on-chain', vault });
  } catch (err) {
    // RPC errors can quote the private RPC URL (and its API key): log, don't echo.
    console.error('prizepool', err);
    return NextResponse.json({ balance: 0, promised: 0, free: 0, source: 'error', vault });
  }
}
