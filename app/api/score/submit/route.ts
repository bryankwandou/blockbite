/**
 * POST /api/score/submit
 *
 * Simplified score submission — used as fallback when SESSION_SECRET is not set
 * (sessions without a token) AND as the "blockchain layer" verification endpoint.
 *
 * Accepts an optional Solana memo transaction signature. When provided,
 * the server verifies the memo exists on-chain and contains the correct
 * score/wallet data — this creates an immutable blockchain audit trail.
 *
 * Body: {
 *   walletAddress: string
 *   score:         number
 *   level:         number
 *   txSignature?:  string   // Solana memo tx — blockchain proof
 * }
 *
 * Security:
 *   - Requires a ranked session (Authorization: Bearer <token>); the wallet is
 *     taken from the session and the body wallet must match it (403 otherwise)
 *   - Rate limited: 10 submissions / min / IP
 *   - Score plausibility: max 5_000_000 per submission
 *   - When txSignature provided: verified against Solana RPC
 */

import { NextRequest, NextResponse } from 'next/server';
import { jsonObject } from '@/lib/http/body';
import { MAX_GAME_LEVEL } from '@/lib/game/constants';
import { recordScore } from '@/lib/leaderboard/store';
import { rateLimit, getIP } from '@/lib/rate-limit';
import { RPC_URL } from '@/lib/solana/config';
import { PublicKey } from '@solana/web3.js';
import { walletFromRequestAsync } from '@/lib/ranked/auth';

/** A real 32-byte ed25519 public key (on curve), not just base58-shaped text. */
function isRealWallet(addr: string): boolean {
  try {
    const pk = new PublicKey(addr);
    return pk.toBytes().length === 32 && PublicKey.isOnCurve(pk.toBytes());
  } catch {
    return false;
  }
}
const MAX_SCORE = 5_000_000;

/** Verify a Solana memo transaction on-chain and check wallet + score match. */
async function verifyMemoTx(
  txSignature: string,
  walletAddress: string,
  score: number,
): Promise<boolean> {
  try {
    const res = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'getTransaction',
        params: [txSignature, { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }],
      }),
    });
    const data = await res.json();
    const tx = data?.result;
    if (!tx) return false;

    // Check the transaction was signed by the claimed wallet
    const signers: string[] = tx.transaction?.message?.accountKeys ?? [];
    if (!signers.includes(walletAddress)) return false;

    // Check memo contains the score (memo program logs)
    const logs: string[] = tx.meta?.logMessages ?? [];
    const memoLog = logs.find(l => l.includes('Program log: Memo'));
    if (!memoLog) return false;

    // Memo format: "BB:score:{score}:wallet:{wallet}"
    const expectedMemo = `BB:score:${score}:wallet:${walletAddress}`;
    return memoLog.includes(expectedMemo);
  } catch {
    return false; // RPC unavailable — accept without on-chain verification
  }
}

export async function POST(req: NextRequest) {
  const ip = getIP(req);
  const rl = await rateLimit(`score:${ip}`, 10, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  let body: { walletAddress?: string; score?: number; level?: number; txSignature?: string };
  const parsed = await jsonObject<typeof body>(req);
  if (!parsed) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  body = parsed;

  const { walletAddress, score, level, txSignature } = body;

  let sessionW: string | null;
  try {
    sessionW = await walletFromRequestAsync(req);
  } catch {
    return NextResponse.json({ error: 'Session check unavailable, try again' }, { status: 503 });
  }
  if (!sessionW) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  }
  if (!walletAddress || typeof walletAddress !== 'string' || !isRealWallet(walletAddress)) {
    return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 });
  }
  if (walletAddress !== sessionW) {
    return NextResponse.json({ error: 'Session does not match wallet' }, { status: 403 });
  }
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > MAX_SCORE) {
    return NextResponse.json({ error: 'Score out of range' }, { status: 422 });
  }

  // Blockchain verification (optional but strongly preferred)
  let blockchainVerified = false;
  if (txSignature) {
    blockchainVerified = await verifyMemoTx(txSignature, walletAddress, score);
  }

  await recordScore({
    walletAddress,
    score,
    level: Number.isInteger(level) && (level as number) >= 1 && (level as number) <= MAX_GAME_LEVEL ? (level as number) : 1,
    submittedAt: Date.now(),
    txSignature: blockchainVerified ? txSignature : undefined,
  });

  return NextResponse.json({
    ok: true,
    recorded: true,
    blockchainVerified,
    message: blockchainVerified
      ? 'Score recorded with on-chain proof'
      : 'Score recorded (no blockchain proof)',
  });
}
