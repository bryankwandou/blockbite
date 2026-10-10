/**
 * POST /api/session/submit
 * Called by the client when a game session ends.
 *
 * Body: { token, score, level, walletAddress }
 * NOTE: `placements` is intentionally NOT accepted from the client.
 *       maxPlacements is retrieved server-side from KV (BBT-001 fix).
 *
 * Validation:
 *   1. 6-part HMAC-SHA256 token (nonce required — legacy 5-part tokens rejected)
 *   2. Token not expired
 *   3. Wallet in token matches body wallet
 *   4. Nonce single-use blacklist (replay protection — BBT-002 fix)
 *   5. Plausibility: score <= serverSidePlacements * MAX_SCORE_PER_MOVE
 *   6. In-memory rate limit 20/min/IP (BBT-004 fix)
 */

import { NextRequest, NextResponse } from 'next/server';
import { jsonObject } from '@/lib/http/body';
import { createHmac, timingSafeEqual } from 'crypto';
import { recordScore } from '@/lib/leaderboard/store';
import { getUser, setUser } from '@/lib/store';
import { adventureConfigured, claimSession, recordAdventure } from '@/lib/adventure/db';
import { isWallet } from '@/lib/ranked/auth';
import { levelConfig } from '@/lib/game/levelConfig';
import { MAX_GAME_LEVEL } from '@/lib/game/constants';
import { rateLimit, getIP } from '@/lib/rate-limit';

const SESSION_SECRET = process.env.SESSION_SECRET;
const MAX_SCORE_PER_MOVE = 200_000;

function verifyToken(token: string): {
  sessionId: string; walletAddress: string; issuedAt: number; expiresAt: number; nonce: string;
} | null {
  try {
    if (!SESSION_SECRET) return null;
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const parts = decoded.split('|');
    // Reject legacy 5-part tokens (no nonce = no replay protection — BBT-002)
    if (parts.length !== 6) return null;
    const [sessionId, wallet, issuedAt, expiresAt, nonce, sig] = parts;
    const payload = `${sessionId}|${wallet}|${issuedAt}|${expiresAt}|${nonce}`;
    const expected = createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
    // Timing-safe comparison (BBT-006)
    if (sig.length !== expected.length) return null;
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    return { sessionId, walletAddress: wallet, issuedAt: Number(issuedAt), expiresAt: Number(expiresAt), nonce };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  // Rate limit (BBT-004) — KV-backed sliding window
  const ip = getIP(req);
  const rl = await rateLimit(`submit:${ip}`, 20, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  let body: { token?: string; score?: number; level?: number; walletAddress?: string };
  const parsed = await jsonObject<typeof body>(req);
  if (!parsed) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  body = parsed;

  const { token, score, level, walletAddress } = body;
  if (!token || score == null || level == null || !walletAddress) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  if (typeof score !== 'number' || !Number.isFinite(score)) {
    return NextResponse.json({ error: 'Score must be a finite number' }, { status: 400 });
  }

  // 1. Verify 6-part token signature
  const session = verifyToken(token);
  if (!session) return NextResponse.json({ error: 'Invalid session token' }, { status: 401 });

  // 2. Token expiry
  if (Date.now() > session.expiresAt) {
    return NextResponse.json({ error: 'Session expired' }, { status: 401 });
  }

  // 3. Wallet match
  if (session.walletAddress !== walletAddress) {
    return NextResponse.json({ error: 'Wallet mismatch' }, { status: 403 });
  }

  // 4. Nonce blacklist + retrieve server-side maxPlacements (BBT-001 + BBT-002)
  if (!Number.isInteger(level)) return NextResponse.json({ error: 'level must be an integer' }, { status: 400 });
  const lvl = level >= 1 && level <= MAX_GAME_LEVEL ? level : 1;
  const cfg = levelConfig(lvl);
  let maxPlacements = cfg.moves * 3; // server-computed default

  try {
    const { kv } = await import('@vercel/kv');
    const nonceKey = `bb:session:used:${session.nonce}`;

    const alreadyUsed = await kv.exists(nonceKey);
    if (alreadyUsed) {
      return NextResponse.json({ error: 'Token already used' }, { status: 401 });
    }

    const meta = await kv.get<{ maxPlacements: number; nonce: string; wallet: string }>(
      `bb:session:${session.sessionId}`,
    );
    if (meta) {
      if (meta.nonce !== session.nonce) {
        return NextResponse.json({ error: 'Nonce mismatch' }, { status: 401 });
      }
      if (meta.wallet !== walletAddress) {
        return NextResponse.json({ error: 'Wallet mismatch' }, { status: 403 });
      }
      maxPlacements = meta.maxPlacements;
    }

    // Blacklist nonce — single-use enforcement
    await kv.set(nonceKey, 1, { ex: 3600 });
  } catch {
    // KV unavailable — proceed with server-computed default (not ideal but not catastrophic)
  }

  // 5. Score plausibility using SERVER-SIDE maxPlacements (BBT-001)
  const maxPlausibleScore = (maxPlacements + 1) * MAX_SCORE_PER_MOVE;
  if (score < 0 || score > maxPlausibleScore) {
    return NextResponse.json({ error: 'Score implausible' }, { status: 422 });
  }

  // 6. Free-mode progress and board (Postgres). KV below is legacy and is
  //    not configured in production, so this is the copy that persists.
  let maxLevel: number | null = null;
  if (adventureConfigured() && isWallet(walletAddress)) {
    try {
      // Single use, enforced in Postgres (the KV nonce check above is a no-op without KV).
      if (!(await claimSession(session.sessionId))) {
        return NextResponse.json({ error: 'Token already used' }, { status: 401 });
      }
      const playedS = Math.max(0, (Date.now() - session.issuedAt) / 1000);
      maxLevel = await recordAdventure(walletAddress, lvl, score, playedS);
    } catch (e) { console.error('adventure', e); }
  }
  try { await recordScore({ walletAddress, score, level: lvl, submittedAt: Date.now() }); } catch { /* KV absent */ }

  // 7. Update profile currentLevel if player advanced
  try {
    const user = await getUser(walletAddress);
    if ((user.currentLevel ?? 0) < lvl) {
      await setUser(walletAddress, { currentLevel: lvl });
    }
  } catch { /* non-critical */ }

  return NextResponse.json({ ok: true, recorded: true, maxLevel });
}
