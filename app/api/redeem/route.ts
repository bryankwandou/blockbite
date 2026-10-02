import { NextRequest, NextResponse } from 'next/server';
import { verifySig } from '@/lib/sig';
import { rateLimit, getIP } from '@/lib/rate-limit';

// Solana base58 address: 32–44 alphanumeric chars (no 0, O, I, l)
const SOLANA_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export async function POST(req: NextRequest) {
  // BBT-005: rate limit redeem to 10/min/IP
  const ip = getIP(req);
  const rl = await rateLimit(`redeem:${ip}`, 10, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  try {
    const { addr, act, sig } = await req.json();
    if (!addr || act == null || !sig) {
      return NextResponse.json({ error: 'missing fields' }, { status: 400 });
    }

    if (typeof addr !== 'string' || !SOLANA_ADDR_RE.test(addr)) {
      return NextResponse.json({ error: 'invalid addr' }, { status: 400 });
    }

    const actNum = Number(act);
    if (!Number.isInteger(actNum) || actNum < 1 || actNum > 8) {
      return NextResponse.json({ error: 'act must be 1–8' }, { status: 400 });
    }

    const message = `blockbite:redeem:${addr}:act${actNum}`;
    const ok = await verifySig(addr, message, sig);
    if (!ok) return NextResponse.json({ error: 'bad signature' }, { status: 403 });

    // On-chain claim will be triggered by the frontend via vestingClient.
    // This route records the intent in KV for deduplication.
    try {
      const { kv } = await import('@vercel/kv');
      const key = `blockbite:redeem:${addr}:act${actNum}`;
      const exists = await kv.exists(key);
      if (exists) return NextResponse.json({ error: 'already redeemed' }, { status: 409 });
      await kv.set(key, { ts: Date.now() });
    } catch { /* no KV — proceed */ }

    return NextResponse.json({ ok: true, addr, act: actNum });
  } catch {
    return NextResponse.json({ error: 'server error' }, { status: 500 });
  }
}
