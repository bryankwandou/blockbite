/**
 * POST /api/session/start
 * Issues a signed HMAC session token.
 *
 * Body:  { walletAddress: string; level?: number }
 * Reply: { sessionId, token, expiresAt, walletAddress }
 *
 * Token format: 6-part (sessionId|wallet|issuedAt|expiresAt|nonce|hmac)
 * Nonce enables single-use replay protection in /api/session/submit.
 * Session metadata (maxPlacements, nonce) stored in KV keyed by sessionId.
 */

import { NextRequest, NextResponse } from 'next/server';
import { jsonObject } from '@/lib/http/body';
import { createHmac, randomUUID } from 'crypto';
import { rateLimit, getIP } from '@/lib/rate-limit';
import { levelConfig } from '@/lib/game/levelConfig';
import { MAX_GAME_LEVEL } from '@/lib/game/constants';

const SESSION_SECRET = process.env.SESSION_SECRET;
const SESSION_TTL_MS = 60 * 60 * 1000;
const SOLANA_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export async function POST(req: NextRequest) {
  if (!SESSION_SECRET) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 503 });
  }

  const ip = getIP(req);
  const rl = await rateLimit(`session:${ip}`, 10, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': '60' } },
    );
  }

  let body: { walletAddress?: string; level?: number };
  const parsed = await jsonObject<typeof body>(req);
  if (!parsed) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  body = parsed;

  const { walletAddress, level } = body;
  if (!walletAddress || typeof walletAddress !== 'string') {
    return NextResponse.json({ error: 'walletAddress required' }, { status: 400 });
  }
  if (!SOLANA_ADDR_RE.test(walletAddress)) {
    return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 });
  }

  const lvl = Number.isInteger(level) && level! >= 1 && level! <= MAX_GAME_LEVEL ? level! : 1;
  const cfg = levelConfig(lvl);
  const maxPlacements = cfg.moves * 3; // generous upper bound (3x move count)

  const sessionId = randomUUID();
  const nonce = randomUUID();
  const issuedAt = Date.now();
  const expiresAt = issuedAt + SESSION_TTL_MS;

  // Store server-authoritative session metadata in KV
  try {
    const { kv } = await import('@vercel/kv');
    await kv.set(
      `bb:session:${sessionId}`,
      { maxPlacements, nonce, wallet: walletAddress, level: lvl },
      { ex: 3600 },
    );
  } catch { /* KV unavailable — submit will use conservative default */ }

  // 6-part token: sessionId|wallet|issuedAt|expiresAt|nonce|hmac
  const payload = `${sessionId}|${walletAddress}|${issuedAt}|${expiresAt}|${nonce}`;
  const sig = createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  const token = Buffer.from(`${payload}|${sig}`).toString('base64url');

  return NextResponse.json({ sessionId, token, expiresAt, walletAddress });
}
