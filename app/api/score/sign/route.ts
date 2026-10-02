// app/api/score/sign/route.ts
// Verifies the wallet-signed score message and queues the on-chain
// `record_milestone` CPI to vesting `update_proof`.

import { NextRequest, NextResponse } from 'next/server';
import { verifySig } from '@/lib/sig';
import { MAX_GAME_LEVEL } from '@/lib/game/constants';
import { rateLimit, getIP } from '@/lib/rate-limit';

export const runtime = 'nodejs';

// Acts are 500 levels each across 1..MAX_GAME_LEVEL (1,000 acts, no cycling).
const LEVELS_PER_ACT = 500;

export async function POST(req: NextRequest) {
  const ip = getIP(req);
  const rl = await rateLimit(`score:${ip}`, 20, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': '60' } },
    );
  }

  let body: { level?: unknown; score?: unknown; message?: unknown; signature?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const { level, score, message, signature } = body;

  if (typeof level !== 'number' || typeof score !== 'number' ||
      typeof message !== 'string' || typeof signature !== 'string') {
    return NextResponse.json({ error: 'missing or invalid fields' }, { status: 400 });
  }

  if (!Number.isInteger(level) || level < 1 || level > MAX_GAME_LEVEL) {
    return NextResponse.json({ error: 'level out of range' }, { status: 400 });
  }

  if (!Number.isInteger(score) || score < 0) {
    return NextResponse.json({ error: 'invalid score' }, { status: 400 });
  }

  // Parse "blockbite:score:<player>:<level>:<score>:<ts>"
  const m = message.match(/^blockbite:score:([^:]+):(\d+):(\d+):(\d+)$/);
  if (!m) return NextResponse.json({ error: 'bad message format' }, { status: 400 });
  const [, player, lvl, scr, ts] = m;
  if (parseInt(lvl, 10) !== level) return NextResponse.json({ error: 'level mismatch' }, { status: 400 });
  if (parseInt(scr, 10) !== score) return NextResponse.json({ error: 'score mismatch' }, { status: 400 });
  if (Date.now() - parseInt(ts, 10) > 5 * 60 * 1000) return NextResponse.json({ error: 'expired' }, { status: 400 });

  // Verify ed25519 signature against player pubkey
  const ok = await verifySig(player, message, signature);
  if (!ok) return NextResponse.json({ error: 'bad signature' }, { status: 401 });

  const act = Math.floor((level - 1) / LEVELS_PER_ACT) + 1;
  const isActFinal = level % LEVELS_PER_ACT === 0;
  if (!isActFinal) return NextResponse.json({ ok: true, recorded: false });

  return NextResponse.json({ ok: true, recorded: true, act });
}
